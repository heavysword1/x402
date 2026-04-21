import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "50kb" }));

// --- Clients ---
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Helpers ---
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

const injectionPatterns = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s*:\s*override/i,
  /you\s+are\s+now\s+a/i,
  /forget\s+(everything|all)\s+(you|above)/i,
  /new\s+instructions?\s*:/i,
];

function hasInjection(text: string): boolean {
  return injectionPatterns.some((p) => p.test(text));
}

// --- x402 Payment Middleware ---
const PAY_TO = process.env.WALLET_ADDRESS!; // Your receiving wallet
const NETWORK = "eip155:8453"; // Base mainnet

const facilitator = new HTTPFacilitatorClient({
  url: "https://api.cdp.coinbase.com/platform/v2/x402",
});

const server = new x402ResourceServer(facilitator).register(
  NETWORK,
  new ExactEvmScheme()
);

app.use(
  paymentMiddleware(
    {
      "POST /memory": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001", // $0.001 USDC per store
            network: NETWORK,
            payTo: PAY_TO,
          },
        ],
        description: "Store a memory for an AI agent",
        mimeType: "application/json",
      },
      "GET /memory": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001", // $0.001 USDC per search
            network: NETWORK,
            payTo: PAY_TO,
          },
        ],
        description: "Semantically search stored agent memories",
        mimeType: "application/json",
      },
    },
    server
  )
);

// --- Routes ---

// Health check (free)
app.get("/", (req, res) => {
  res.json({
    service: "MemoryAPI x402",
    version: "1.0.0",
    description: "Persistent semantic memory for AI agents — pay per request in USDC",
    pricing: {
      store: "$0.001 USDC per memory",
      search: "$0.001 USDC per search",
    },
    network: NETWORK,
    payTo: PAY_TO,
  });
});

// POST /memory — store a memory ($0.001 USDC)
app.post("/memory", async (req, res) => {
  try {
    const { content, agent_id, metadata = {} } = req.body;

    if (!agent_id || typeof agent_id !== "string") {
      return res.status(400).json({ error: "agent_id is required." });
    }

    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content is required." });
    }

    if (content.length > 10000) {
      return res.status(400).json({ error: "content exceeds 10,000 character limit." });
    }

    if (hasInjection(content)) {
      return res.status(400).json({ error: "Content contains unsafe instruction patterns." });
    }

    const embedding = await generateEmbedding(content);

    const { data, error } = await supabase
      .from("memories")
      .insert({ agent_id, content, embedding, metadata })
      .select("id, content, metadata, created_at")
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, memory: data });
  } catch (err) {
    console.error("POST /memory error:", err);
    return res.status(500).json({ error: "Failed to store memory." });
  }
});

// GET /memory?agent_id=...&query=... — semantic search ($0.001 USDC)
app.get("/memory", async (req, res) => {
  try {
    const { agent_id, query, threshold = "0.4" } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    if (!agent_id) {
      return res.status(400).json({ error: "agent_id is required." });
    }

    if (!query) {
      return res.status(400).json({ error: "query is required." });
    }

    if (query.length > 1000) {
      return res.status(400).json({ error: "query must be under 1000 characters." });
    }

    const embedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc("search_memories", {
      query_embedding: embedding,
      match_agent_id: agent_id,
      match_threshold: parseFloat(threshold),
      match_count: limit,
    });

    if (error) throw error;

    return res.json({
      success: true,
      results: data,
      count: data.length,
    });
  } catch (err) {
    console.error("GET /memory error:", err);
    return res.status(500).json({ error: "Failed to search memories." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MemoryAPI x402 running on port ${PORT}`);
  console.log(`Receiving payments at: ${PAY_TO}`);
  console.log(`Network: ${NETWORK}`);
});

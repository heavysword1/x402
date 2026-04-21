# MemoryAPI x402 Example

> Persistent semantic memory for AI agents — pay per request in USDC via x402

This example demonstrates how to build a pay-per-request memory API for AI agents using x402. Agents store and retrieve memories without accounts or API keys — they simply pay $0.001 USDC per request on Base.

## What It Does

- **Store memories** — agents POST natural language memories, stored as vector embeddings
- **Search memories** — agents search semantically using natural language queries
- **Pay per request** — no accounts, no API keys, just USDC on Base via x402

## Architecture

```
AI Agent → POST /memory (pays $0.001 USDC) → x402 middleware verifies → Stored in Supabase + pgvector
AI Agent → GET /memory?query=... (pays $0.001 USDC) → x402 middleware verifies → Semantic search results
```

## Prerequisites

- Node.js 18+
- [Supabase](https://supabase.com) project with pgvector enabled
- [OpenAI API key](https://platform.openai.com/api-keys) for embeddings
- An EVM wallet address to receive USDC payments (e.g. Coinbase Wallet)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/x402-foundation/x402
cd examples/typescript/servers/memoryapi
npm install
```

### 2. Set up Supabase

Enable pgvector and run this schema in your Supabase SQL editor:

```sql
create extension if not exists vector;

create table memories (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index on memories using hnsw (embedding vector_cosine_ops);
create index on memories (agent_id);

create or replace function search_memories(
  query_embedding vector(1536),
  match_agent_id text,
  match_threshold float default 0.4,
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language sql stable
as $$
  select id, content, metadata,
    1 - (embedding <=> query_embedding) as similarity,
    created_at
  from memories
  where agent_id = match_agent_id
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
WALLET_ADDRESS=0xYourWalletAddress
PORT=3000
```

### 4. Run

```bash
npm run dev
```

## API Reference

### `GET /`
Free health check. Returns service info and pricing.

```bash
curl http://localhost:3000/
```

---

### `POST /memory` — Store a memory
**Price:** $0.001 USDC per request

```bash
# Without payment — returns 402 with payment instructions
curl -X POST http://localhost:3000/memory \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "my-agent", "content": "User prefers dark mode"}'

# Response: 402 Payment Required
# {
#   "x402Version": 1,
#   "accepts": [{ "scheme": "exact", "price": "$0.001", "network": "eip155:8453" }]
# }
```

**Request body:**
```json
{
  "agent_id": "my-agent",
  "content": "User prefers dark mode and React Native",
  "metadata": { "type": "preference" }
}
```

**Response:**
```json
{
  "success": true,
  "memory": {
    "id": "uuid",
    "content": "User prefers dark mode and React Native",
    "metadata": { "type": "preference" },
    "created_at": "2026-04-21T..."
  }
}
```

---

### `GET /memory` — Search memories
**Price:** $0.001 USDC per request

**Query params:**
- `agent_id` (required) — agent namespace
- `query` (required) — natural language search
- `limit` (optional, default 10, max 50)
- `threshold` (optional, default 0.4)

```bash
curl "http://localhost:3000/memory?agent_id=my-agent&query=what+does+the+user+prefer"
```

**Response:**
```json
{
  "success": true,
  "count": 1,
  "results": [
    {
      "id": "uuid",
      "content": "User prefers dark mode and React Native",
      "similarity": 0.87,
      "metadata": { "type": "preference" },
      "created_at": "2026-04-21T..."
    }
  ]
}
```

## How x402 Payment Works

1. Agent sends request without payment → server returns **402 Payment Required** with USDC price and wallet address
2. Agent constructs payment on Base using USDC
3. Agent resends request with `PAYMENT-SIGNATURE` header
4. x402 middleware verifies payment via CDP facilitator
5. Request proceeds and memory is stored/retrieved

No accounts. No API keys. No monthly subscriptions. Just USDC.

## Hosted Version

A hosted version of this API is available at:

- **API:** https://api.memoryapi.org
- **Docs:** https://memoryapi.org
- **GitHub:** https://github.com/heavysword1/memoryapi

The hosted version also offers:
- Traditional API key auth with monthly plans
- MCP endpoint for Claude Desktop / Cursor / Windsurf
- Free tier (100 memories)

## License

MIT © 2026 Ocean Digital Group

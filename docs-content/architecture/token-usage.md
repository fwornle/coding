# Token Usage Dashboard

## Overview

The Token Usage Dashboard provides real-time visibility into LLM token consumption across all cognitive processes. Every call through the LLM Proxy Bridge is logged with provider, model, token counts, latency, and process attribution, enabling cost analysis and optimization.

**Dashboard URL**: [http://localhost:3032/token-usage](http://localhost:3032/token-usage)

---

## Architecture

![Token Usage Architecture](../images/token-usage-architecture.png)

### Data Flow

1. **Cognitive processes** (observation writer, consolidator, wave analysis agents, etc.) send completion requests to the LLM Proxy Bridge (`:12435`)
2. Each request includes a **`process`** identifier (e.g., `observation-writer`, `consolidator`)
3. The proxy routes to the appropriate provider (Copilot, Claude Code, Anthropic, etc.)
4. After completion, the proxy logs the call to **SQLite** (`.observations/token-usage.db`)
5. The Health Dashboard server proxies query requests to the proxy's API
6. The frontend renders charts and tables from the aggregated data

### Key Files

| File | Purpose |
|------|---------|
| `integrations/llm-cli-proxy/src/server.ts` | Proxy bridge with SQLite logging |
| `integrations/system-health-dashboard/src/pages/token-usage.tsx` | Dashboard frontend page |
| `integrations/system-health-dashboard/server.js` | Proxy route to forward API requests |
| `.observations/token-usage.db` | SQLite database with all logged calls |

---

## Dashboard Page

### Summary Cards

The top of the page shows key aggregates for the selected time window:

- **Total Calls** — number of LLM completions
- **Input Tokens** — total prompt tokens consumed
- **Output Tokens** — total completion tokens generated
- **Total Tokens** — combined input + output

### Charts

#### Token Distribution by Process (Treemap)

A proportional treemap showing which cognitive processes consume the most tokens. Larger blocks indicate higher usage. Hover for exact counts.

Typical top consumers:

- **consolidator** — digest-to-insight synthesis (large context windows)
- **observation-writer** — session event classification and summarization
- **wave1-analysis** — batch code analysis agents
- **insight-generator** — entity insight document generation

#### Provider Usage (Donut Chart)

Shows the distribution of calls across LLM providers. In normal operation, `copilot` dominates (zero-cost subscription). Fallback to paid APIs (`anthropic`, `groq`) appears when subscriptions are exhausted.

#### Token Timeline (Area Chart)

Hourly token consumption over the selected time window. Two stacked areas show input vs. output tokens. Spikes correspond to batch operations (consolidation runs, wave analysis).

#### Recent Calls (Table)

Sortable table of individual LLM calls showing:

| Column | Description |
|--------|-------------|
| Time | When the call was made |
| Process | Which cognitive process |
| Provider | LLM provider used |
| Model | Specific model |
| Input | Input token count |
| Output | Output token count |
| Latency | Round-trip time in ms |

---

## API Endpoints

The LLM Proxy Bridge exposes REST endpoints for programmatic access:

### Summary

```
GET /api/token-usage/summary?hours=24
```

Returns aggregated statistics for the specified time window:

```json
{
  "total_calls": 142,
  "total_input": 285000,
  "total_output": 73000,
  "by_process": [
    { "process": "consolidator", "calls": 58, "input_tokens": 180000, "output_tokens": 45000 },
    { "process": "observation-writer", "calls": 45, "input_tokens": 62000, "output_tokens": 18000 }
  ],
  "by_provider": [
    { "provider": "copilot", "calls": 130, "input_tokens": 260000, "output_tokens": 68000 }
  ],
  "by_model": [
    { "model": "claude-sonnet-4-5", "calls": 95, "input_tokens": 200000, "output_tokens": 52000 }
  ],
  "by_subscription": [
    { "subscription": "copilot-subscription", "calls": 130, "tokens": 328000 }
  ],
  "by_hour": [
    { "hour": "2026-05-15T06:00:00", "calls": 12, "input_tokens": 24000, "output_tokens": 6000 }
  ]
}
```

### Recent Calls

```
GET /api/token-usage/recent?limit=50
```

Returns the most recent individual LLM calls:

```json
{
  "data": [
    {
      "timestamp": "2026-05-15T06:45:12.000Z",
      "provider": "copilot",
      "model": "claude-sonnet-4-5",
      "process": "consolidator",
      "input_tokens": 3200,
      "output_tokens": 850,
      "total_tokens": 4050,
      "latency_ms": 2340,
      "subscription": "copilot-subscription"
    }
  ]
}
```

---

## Cognitive Process Reference

Each LLM caller identifies itself with a `process` field in the completion request:

| Process ID | System | Description | Tier |
|------------|--------|-------------|------|
| `observation-writer` | Online Learning | Classifies and summarizes session events | Fast/Standard |
| `consolidator` | Online Learning | Synthesizes digests into insights | Standard |
| `insight-generator` | Wave Analysis | Generates entity insight documents | Premium |
| `content-validator` | Wave Analysis | Validates and refreshes entity content | Standard |
| `wave1-analysis` | Wave Analysis | Batch code analysis agents | Standard/Premium |
| `constraint-check` | Constraints | Evaluates semantic constraint rules | Fast |
| `auto-heal` | Health Monitor | Service recovery decision-making | Fast |
| `health-check` | Health Monitor | Proxy liveness ping (0 tokens) | Fast |

---

## Storage

- **Database**: `.observations/token-usage.db` (SQLite WAL mode)
- **Schema**: Single `token_usage` table with indexed `timestamp` and `process` columns
- **Retention**: All calls logged indefinitely; periodic cleanup can be done manually
- **Size**: ~1KB per logged call; ~100KB per 100 calls

### Manual Queries

```bash
# Total tokens today
sqlite3 .observations/token-usage.db \
  "SELECT SUM(input_tokens), SUM(output_tokens) FROM token_usage WHERE timestamp > datetime('now', '-24 hours')"

# Top processes by token usage
sqlite3 .observations/token-usage.db \
  "SELECT process, SUM(total_tokens) as total FROM token_usage GROUP BY process ORDER BY total DESC"

# Provider distribution
sqlite3 .observations/token-usage.db \
  "SELECT provider, COUNT(*), SUM(total_tokens) FROM token_usage GROUP BY provider"
```

---

## Troubleshooting

### No data showing

1. Verify obs_api / proxy bridge is running: `curl http://localhost:12435/api/health`
2. Check the database exists: `ls -la .observations/token-usage.db`
3. Verify the dashboard server can reach the proxy: `curl http://localhost:3033/api/token-usage/summary?hours=1`

### Unknown process

Calls showing `process: "unknown"` come from callers that haven't been updated to pass a process identifier. The proxy bridge health checks also show as `unknown` — these consume 0 tokens and can be filtered out.

### Token counts showing 0

Some providers (particularly Copilot) don't always return token counts in the response. The proxy estimates tokens from the prompt/response text length (~4 chars per token) when the provider returns 0.

---

## Related Documentation

- [LLM Architecture](llm-architecture.md) — Provider routing, subscriptions, fallback chains
- [Health Monitoring](health-monitoring.md) — System health dashboard overview
- [Observational Memory](../core-systems/observational-memory.md) — Online learning pipeline

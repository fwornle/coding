# Phase 29: Retrieval Service - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 29-retrieval-service
**Areas discussed:** Service location, Hybrid scoring, Response format, Token budgeting

---

## Service Location

| Option | Description | Selected |
|--------|-------------|----------|
| Health API (port 3033) | Add /api/retrieve to existing Express server. Already has observation endpoints, SQLite access. | ✓ |
| New standalone service | Separate Express app on its own port. Clean separation but another process. | |
| SSE server (port 3848) | Add to semantic-analysis SSE server. Has MCP access but is submodule. | |

**User's choice:** Health API (port 3033) -- recommended option

---

## Hybrid Scoring

| Option | Description | Selected |
|--------|-------------|----------|
| Weighted RRF fusion | Reciprocal Rank Fusion across semantic + keyword + recency. Simple, proven. | ✓ |
| Linear combination | weighted_score = 0.6*semantic + 0.2*keyword + 0.2*recency. More tunable. | |
| You decide | Claude picks based on research findings. | |

**User's choice:** Weighted RRF fusion -- recommended option

---

## Response Format

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-formatted markdown | Ready to inject into agent context. Tier headers, source attribution. | ✓ |
| Structured JSON | Array of results with metadata. Each adapter formats. | |
| Both | JSON with pre-rendered markdown field. | |

**User's choice:** Pre-formatted markdown -- recommended option

---

## Token Budgeting

| Option | Description | Selected |
|--------|-------------|----------|
| gpt-tokenizer | GPT-4 tokenizer, ~5-10% variance vs Claude. Already in package.json. | ✓ |
| Character-based estimation | ~4 chars per token heuristic. Simpler but less accurate. | |
| You decide | Claude picks. | |

**User's choice:** gpt-tokenizer -- recommended option

---

## Claude's Discretion

- FTS table creation strategy
- RRF constant k parameter
- Recency decay half-life
- Query embedding approach (on-the-fly vs pre-computed)
- Error handling when Qdrant unreachable

## Deferred Ideas

None -- discussion stayed within phase scope.

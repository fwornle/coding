# Phase 28: Embedding Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 28-embedding-pipeline
**Areas discussed:** Embedding approach, Qdrant collections, Write-time hooks, Batch backfill

---

## Embedding Approach

| Option | Description | Selected |
|--------|-------------|----------|
| fastembed (Node.js) | ONNX runtime in Node.js, no Python dep. ~25MB model download on first use. Same 384-dim vectors. | ✓ |
| Keep Python subprocess | Fix Docker to install sentence-transformers+torch. Heavier but proven model. | |
| LLM proxy embedding endpoint | Route through existing port 12435 proxy. Adds latency but no new deps. | |

**User's choice:** fastembed (Node.js) -- recommended option
**Notes:** Replaces broken Python subprocess pipeline. No Python/torch dependency needed.

---

## Qdrant Collections

| Option | Description | Selected |
|--------|-------------|----------|
| Separate per tier | 4 collections: observations, digests, insights, kg_entities. Independent scoring, easier debugging. | ✓ |
| Single unified collection | One collection with 'tier' metadata field. Simpler setup but scoring harder. | |
| You decide | Claude picks based on Qdrant API best practices. | |

**User's choice:** Separate per tier -- recommended option
**Notes:** Enables independent tier-weighted scoring in Phase 29.

---

## Write-Time Hooks

| Option | Description | Selected |
|--------|-------------|----------|
| Direct in writers | Add embed call in ObservationWriter, consolidation daemon. Fire-and-forget. | |
| Event bus / queue | Writers emit events, separate embedding daemon consumes. Decoupled. | ✓ |
| Polling daemon | Periodic poll for un-embedded items. Simplest but adds latency. | |

**User's choice:** Event bus / queue
**Notes:** User preferred decoupled architecture. Follow-up question asked about event bus type.

### Follow-up: Event Bus Type

| Option | Description | Selected |
|--------|-------------|----------|
| Node EventEmitter | In-process event emitter, simplest. | |
| Redis pub/sub | Redis already in Docker stack. Cross-process, survives restarts. | ✓ |
| SQLite trigger + poll | Add 'embedded_at' column, poll for NULLs. Durable but not event-driven. | |

**User's choice:** Redis pub/sub
**Notes:** Cross-process communication needed since ObservationWriter runs on host and embedding service may be separate.

---

## Batch Backfill

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot CLI script | Run once to embed all existing items. Content-hash idempotency. | ✓ |
| Incremental daemon | Background process that gradually embeds. Gentler but slower. | |
| Part of startup | Embedding service checks for gaps on startup. Self-healing but delays start. | |

**User's choice:** One-shot CLI script -- recommended option
**Notes:** Content-hash based idempotency for re-run safety.

---

## Claude's Discretion

- Redis channel naming and message format
- Embedding batch size for backfill
- EmbeddingCache reuse decision
- ONNX model download strategy

## Deferred Ideas

None -- discussion stayed within phase scope.

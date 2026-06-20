# Phase 62: Worker Pool Core & stream-JSON Transport - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 62-worker-pool-core-stream-json-transport
**Areas discussed:** System-prompt ↔ worker affinity, Pool sizing & overflow policy, Which models get a warm pool, Escape-hatch composition

---

## System-prompt ↔ worker affinity

| Option | Description | Selected |
|--------|-------------|----------|
| Key by (model × prompt-hash), LRU-bounded | Worker bound to boot-time system prompt; each distinct prompt gets a small pool, LRU-capped. Researcher verifies per-message system prompt → if yes, collapse to model-only. Keeps heavy custom-prompt callers on the fast path. | ✓ |
| Pool default-prompt only; custom stays on execFile | Simplest, but consolidator/observation-writer (custom prompt) are exactly the slow-path victims — they'd never benefit. | |
| Assume per-message system prompt works | Model-only keying, prompt per request. Cleanest IF the protocol supports it — unverified. | |

**User's choice:** Key by (model × prompt-hash), LRU-bounded (Recommended)
**Notes:** Researcher must verify per-message system-prompt support; if available, keying collapses to model-only (D-03). Heavy custom-prompt callers are the milestone's primary beneficiaries (D-04).

---

## Pool sizing & overflow policy

| Option | Description | Selected |
|--------|-------------|----------|
| 2 workers/key, overflow → execFile fallback | Default 2 (configurable). When both busy, overflow takes the existing per-call execFile path — graceful degradation, no queue latency, no unbounded RAM. | ✓ |
| Queue with timeout | Overflow waits for a free worker (bounded depth + timeout). Risks head-of-line blocking behind multi-second calls. | |
| Overflow-spawn temp workers | Spawn beyond pool size under burst, reap after. Max throughput, RAM can spike. | |

**User's choice:** 2 workers/key, overflow → execFile fallback (Recommended)
**Notes:** Pool stays the steady-state fast path; execFile overflow = graceful fall to today's behavior.

---

## Which models get a warm pool

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy pool for any fallback model | CLI-fallback trigger already gates pool creation. haiku stays cold naturally; sonnet/opus warm on demand. Future-proof to rate-limit shifts. | ✓ |
| Hardcode sonnet + opus only | Explicit allow-list; brittle if haiku starts hitting fallback. | |

**User's choice:** Lazy pool for any fallback model (Recommended)

---

## Escape-hatch composition

| Option | Description | Selected |
|--------|-------------|----------|
| Orthogonal matrix, no per-model flag | DISABLE_WORKER_POOL=1 → execFile fallback; DISABLE_CLAUDE_DIRECT=1 → pool primary; both → pure execFile (today's behavior). No per-model disable (YAGNI). | ✓ |
| Add per-model disable too | e.g. LLM_PROXY_WORKER_POOL_MODELS=sonnet. More control, more surface to test/document. | |

**User's choice:** Orthogonal matrix, no per-model flag (Recommended)
**Notes:** Global hatch + execFile-overflow fallback already cover degraded modes (D-08, D-09).

---

## Claude's Discretion

- Module structure (separate `worker-pool.mjs` vs inline), config-knob env-var names, stream-JSON event parsing / token-extraction adaptation, worker↔request matching data structure.
- Worker abstraction should expose a cancel hook now (seam for Phase 63/WLIFE-04) even though full cancellation lands later.

## Deferred Ideas

None from scope creep — discussion stayed within Phase 62 scope. Four `todo.match-phase` hits were reviewed and NOT folded (low-confidence keyword noise from the v7.2 domain). Four researcher open-questions recorded in CONTEXT.md `<deferred>` (per-message system prompt support, per-model worker isolation, stream-JSON cancel mechanism, spawn-only speedup quantification).

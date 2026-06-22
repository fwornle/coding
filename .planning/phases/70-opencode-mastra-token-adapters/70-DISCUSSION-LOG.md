# Phase 70: OpenCode + Mastra Token Adapters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 70-opencode-mastra-token-adapters
**Areas discussed:** OpenCode→proxy routing mechanism, task_id + agent stamping (envelope), Mastra scope + fallback tier, Mastra adapter write path & packaging

---

## OpenCode → proxy routing mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| OpenAI-compat shim on proxy | Add /v1/chat/completions to rapid-llm-proxy mapping to /api/complete; OpenCode custom OpenAI-compatible provider points at it | ✓ |
| OpenCode plugin → /api/complete | Use @opencode-ai/plugin to intercept model calls and forward to native /api/complete | |
| Research feasibility first | Don't lock; researcher confirms OpenCode capabilities, proposes mechanism | |

**User's choice:** OpenAI-compat shim on proxy.

### Sub-decision: streaming

| Option | Description | Selected |
|--------|-------------|----------|
| Non-streaming first | Buffered single chat/completions response wrapping /api/complete JSON; streaming = later upgrade | ✓ |
| Streaming required | Shim emits SSE chunks | |
| Let research decide | Pick based on what OpenCode tolerates | |

**User's choice:** Non-streaming first.

### Sub-decision: address

| Option | Description | Selected |
|--------|-------------|----------|
| Host-side → localhost:12435 | OpenCode runs host-side; baseURL http://localhost:12435/v1 | ✓ |
| In-container → host.docker.internal:12435 | OpenCode containerized, reaches host proxy | |
| Both / research confirms | Env-driven baseURL, research confirms | |

**User's choice:** Host-side → localhost:12435. ROADMAP's `host.docker.internal:12435` treated as the container-perspective alias for the same proxy.

---

## task_id + agent stamping (envelope)

| Option | Description | Selected |
|--------|-------------|----------|
| Envelope field, wins if present | body.task_id used when present, else resolveLiveTaskId() fallback; backward-compatible | ✓ |
| Envelope only, no span fallback | Only envelope task_id for opencode calls | |
| Keep server-side span only | No envelope field; rely on resolveLiveTaskId() (rejected vs SC-2) | |

**User's choice:** Envelope field, wins if present.

### Sub-decision: who injects task_id

| Option | Description | Selected |
|--------|-------------|----------|
| Shim resolves server-side | Shim sets agent='opencode', granularity_tier='per-llm-call', task_id=resolveLiveTaskId(); optional client X-Task-Id override wins if present | ✓ |
| Client-side header injection | OpenCode plugin/wrapper adds X-Task-Id per request | |
| Research the cleanest injection | Prefer client injection if cheap, else server-side | |

**User's choice:** Shim resolves server-side (with optional client override accepted).

---

## Mastra: scope + fallback tier

| Option | Description | Selected |
|--------|-------------|----------|
| Route Mastra through proxy if possible | Point Mastra model at proxy shim → per-llm-call rows agent='mastra' for free; framework instrumentation only as fallback | ✓ |
| Framework instrumentation per SC-3/4 | Dedicated adapter at identified surface (middleware/hooks/callbacks) | |
| Research decides the surface first | Inspect plugin/Mastra, recommend approach | |

**User's choice:** Route Mastra through proxy if possible.

### Sub-decision: fallback tier

| Option | Description | Selected |
|--------|-------------|----------|
| Best-available, aggregate floor | Finest tier surface exposes, per-session-aggregate floor (mirror Phase 69 D-04); stamp actual tier per row | ✓ |
| Per-step required | Only ship if per-step surface exists, else defer | |
| Aggregate is fine | Just emit per-session-aggregate | |

**User's choice:** Best-available, aggregate floor.

---

## Mastra adapter write path & packaging

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse write path; extend opencode supervisor | Phase-69 write path (distinct user_hash, better-sqlite3 + busy_timeout + WAL test, getActiveMeasurement + backfill); try/catch-isolated hook on sub-agent-live-opencode, no new plist | ✓ |
| Reuse write path; dedicated Mastra daemon | Same write path, new launchd job | |
| Decide only if fallback triggers | Defer packaging to planner | |

**User's choice:** Reuse write path; extend opencode supervisor. (Only built if Mastra proxy-route proves impossible.)

---

## Claude's Discretion

- Shim model-id → provider-chain mapping (pass `body.model` through, no new routing logic).
- Replace vs add the OpenCode provider in `~/.config/opencode/opencode.json` (prefer additive + documented switch; don't break existing setup).
- Exact envelope field name for the optional client task_id override (`X-Task-Id` header vs `body.task_id`).
- Whether Mastra's model endpoint is redirectable (resolves the proxy-route-vs-fallback fork).

## Deferred Ideas

- Streaming (SSE) support for the OpenCode shim — documented upgrade path, not Phase-70 scope.

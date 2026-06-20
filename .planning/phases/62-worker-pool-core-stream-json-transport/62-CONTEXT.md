# Phase 62: Worker Pool Core & stream-JSON Transport - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the per-call `claude` CLI `execFile` spawn (on the **claude-code CLI-fallback path only**) with warm, per-model, persistent stream-JSON workers, plus a single env escape hatch that disables the whole mechanism. Delivers POOL-01..04 + GUARD-01.

**In scope:** the worker abstraction (persistent `claude -p --input-format stream-json --output-format stream-json` subprocess), per-key pool management, request→worker routing with concurrency-1, the `LLM_PROXY_DISABLE_WORKER_POOL=1` escape hatch, and wiring the pool into the existing dispatcher at the two `completeClaudeCodeViaCLI` call sites.

**Out of scope (later phases):** lazy-spawn/idle-evict/crash-recovery/cancellation lifecycle (Phase 63), CLI-version pinning + stderr throttling (Phase 64), the steady-state latency + crash-survival acceptance probe (Phase 65), dashboard latency observability (Phase 66). Cross-provider fallback (claude-code→copilot) stays permanently excluded.

</domain>

<decisions>
## Implementation Decisions

### Worker keying / system-prompt affinity
- **D-01:** Workers are keyed by **(model × system-prompt-hash)**. A persistent stream-JSON worker is bound to its boot-time system prompt, so a worker serves only requests whose system prompt matches its boot prompt. Each distinct (model, prompt) gets its own small pool.
- **D-02:** The number of distinct prompt-pools is **LRU-bounded** (configurable cap) to keep RAM finite — when the cap is exceeded, the least-recently-used prompt-pool's workers are drained/evicted. (The proxy in practice uses a small, stable set of system prompts: consolidator's, observation-writer's, and the default `"You are a helpful assistant."` — so fragmentation is bounded in normal operation.)
- **D-03:** **Researcher must verify** whether `claude -p --input-format stream-json` supports a **per-message system prompt** (sent with each `{type:"user",...}` event) rather than only at session start. **If it does, collapse keying to model-only** (D-01 simplifies to model-only, prompt sent per request — strictly better: no fragmentation). The (model × prompt-hash) design is the safe default if per-message system prompt is NOT supported.
- **D-04:** Rationale for NOT pooling only the default prompt: the heaviest fallback callers (consolidator / observation-writer, which are the actual ~14s pain points pinned to claude-code/sonnet) use **custom** system prompts. Excluding custom-prompt traffic from the pool would leave the milestone's primary beneficiary on the slow path.

### Pool sizing & overflow policy
- **D-05:** Default **2 workers per (model × prompt) key**, configurable (env/config knob — name TBD by planner, e.g. `LLM_PROXY_WORKER_POOL_SIZE`). Matches the seed's "2-3 workers" guidance at the conservative end.
- **D-06:** Concurrency-1 per worker (POOL-03). When **all workers for a key are busy**, the overflow request **falls back to the existing per-call `execFileAsync` path** (`completeClaudeCodeViaCLI`). NOT a queue (avoids head-of-line blocking behind multi-second calls), NOT overflow-spawn (avoids unbounded RAM under burst). This degrades gracefully to today's behavior under load and keeps the pool as the steady-state fast path.

### Model scope
- **D-07:** **Lazy pool for any model that hits the CLI-fallback path** — the existing fallback trigger (direct-API 429/401 → CLI) already gates pool creation. No hardcoded model allow-list. haiku rarely 429s on the direct path so its pool stays cold naturally; sonnet/opus pools warm on demand. Future-proof if Anthropic's per-model rate-limit profile shifts.

### Escape-hatch composition
- **D-08:** `LLM_PROXY_DISABLE_WORKER_POOL=1` and the **existing** `LLM_PROXY_DISABLE_CLAUDE_DIRECT=1` are **orthogonal**:
  - Neither set → direct API primary; on fallback, **worker pool** serves.
  - `DISABLE_WORKER_POOL=1` → direct API primary; on fallback, **old execFile** path (pool fully off).
  - `DISABLE_CLAUDE_DIRECT=1` → skip direct; **worker pool** becomes the primary claude-code path.
  - Both set → skip direct + execFile only = **today's pure-CLI behavior** (the safe baseline).
- **D-09:** **No per-model disable flag** (YAGNI). The global hatch (D-08) plus the execFile-overflow fallback (D-06) already cover degraded modes.

### Claude's Discretion
- Internal module structure (separate `worker-pool.mjs` vs inline in `server.mjs`), the exact config-knob env-var names, the stream-JSON event parsing/token-extraction adaptation, and the worker→request matching data structure are all planner/executor choices. The worker abstraction SHOULD expose a cancel hook now (even though full cancellation propagation lands in Phase 63/WLIFE-04) so later phases extend rather than refactor it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone design & requirements
- `.planning/research/v7.2-llm-proxy-perf-worker-pool.md` — THE research seed (filename retains v7.2 origin; content is the v7.3 seed). Measured latency breakdown, persistent-worker design constraints, pool size/affinity/lifecycle guidance, 5 open questions, acceptance criteria. **Read first.**
- `.planning/ROADMAP.md` § "Milestone v7.3" / "Phase 62" — phase goal + 5 success criteria.
- `.planning/REQUIREMENTS.md` § v7.3 — POOL-01..04, GUARD-01 (+ the WLIFE/GUARD/PERF reqs landing in phases 63-66 for context).

### Code under change
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — the `claude-code` provider. Key anchors:
  - `completeClaudeCodeViaCLI()` (~:1071) — the per-call `execFileAsync` path being replaced by the pool AND retained as the D-06 overflow fallback. Note the context-stripping flags at ~:1106-1122 (`--tools ''`, `--no-session-persistence`, `--disable-slash-commands`, `--strict-mcp-config --mcp-config '{}'`, `--setting-sources ''`, always-pass `--system-prompt`) and `cwd:'/tmp'` (~:1134) — workers MUST replicate these as session-start args or the ~130-token floor balloons to ~15K.
  - `completeClaudeCode()` dispatcher (~:1214) — where the pool slots in (the two `completeClaudeCodeViaCLI(...)` call sites at ~:1216 and ~:1227).
  - `completeClaudeCodeDirect()` (~:949) — the fast direct-OAuth path that stays primary + unchanged (POOL-04); 429/401 → `shouldFallbackToCLI` is the pool's trigger.
  - Token extraction from `output.modelUsage`/`output.usage` (~:1158-1168) — must be adapted to stream-JSON `result`/`assistant` events.
  - `buildClaudeEnv()`, `CLAUDE_CLI`, `resolveClaudeModel()` (~:1073) — env + binary + model-name mapping the worker reuses.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `completeClaudeCodeViaCLI()` — keep as-is for the D-06 overflow fallback and the D-08 escape-hatch path; the worker pool is a faster alternative to it, not a full replacement.
- The context-stripping CLI flag set (~:1106-1122) — translate verbatim into stream-JSON worker startup args.
- `buildClaudeEnv()` + `cwd:'/tmp'` — reuse for worker spawn so worker subprocesses don't pollute the active-projects status-line tracker.
- `resolveClaudeModel()` — maps body.model → `haiku`/`sonnet`/`opus` for the `--model` startup flag (the per-model worker key, D-07).

### Established Patterns
- Escape-hatch-via-env is already the house style (`LLM_PROXY_DISABLE_CLAUDE_DIRECT`); D-08 extends it orthogonally.
- Client-disconnect abort: the execFile path uses `signal: clientAbortSignal` to SIGTERM the subprocess (~:1138). Persistent workers can't be SIGTERM'd per-request — the worker abstraction must expose a request-level cancel (full impl in Phase 63/WLIFE-04, but the seam belongs here).
- All claude-code traffic funnels through the single `completeClaudeCode()` dispatcher — one insertion point, no scattered call sites.

### Integration Points
- The pool is engaged ONLY inside `completeClaudeCode()` on the fallback branch — `completeClaudeCodeDirect()` (haiku, ~0.9s) is untouched (POOL-04).
- Stream-JSON I/O: write `{type:"user", message:...}` JSON-Lines to worker stdin, read `{type:"assistant"...}` / `{type:"result"...}` from stdout. The result-event shape is what the token-extraction + content assembly must consume.

</code_context>

<specifics>
## Specific Ideas

- Target win reframed by the codebase scout: the current execFile path **already** strips the CLI's auto-injected ~16-22K system prompt to ~130 tokens via `--system-prompt <minimal>`. So the seed's "keep cache_creation warm" rationale is **partly already captured** — the dominant remaining win is the **~500-1500ms spawn + CLI-boot cost per call**, with a secondary prompt-cache-read benefit for repeated identical (model×prompt) traffic. Researcher should quantify the spawn-only savings to confirm the ≤3s steady-state target (PERF-01) is reachable on this already-optimized baseline.

</specifics>

<deferred>
## Deferred Ideas

None from scope creep — discussion stayed within Phase 62 scope. (Worker lifecycle, hygiene, acceptance, and dashboard observability are already scoped as Phases 63-66, not deferred ideas.)

### Open questions for the researcher (not deferrals — must be answered before/within planning)
1. Does `claude -p --input-format stream-json` accept a **per-message system prompt**? If yes → collapse worker keying to model-only (D-03).
2. Does a `--model M`-booted stream-JSON worker **reject a request for a different model** mid-stream? (Confirms per-model worker isolation; seed open-Q #2.)
3. Stream-JSON **cancellation**: is there a `{type:"cancel"}` (or equivalent) input event, or must cancellation SIGTERM + respawn the worker? (Drives the cancel-hook seam; full use in Phase 63.)
4. Quantify the **actual** spawn-only speedup given the already-minimized ~130-token prompt, to validate PERF-01's ≤3s steady-state on the current baseline.

### Reviewed Todos (not folded)
The `todo.match-phase 62` matches were all low-confidence keyword-noise (score 0.6 on generic words like "phase"/"system"/"per") and belong to the v7.2 VKB/observability domain, not the LLM-proxy worker pool. Reviewed and NOT folded:
- `2026-05-23-orphan-digest-observation-refs.md` — km-core data integrity (v7.2).
- `2026-06-10-okm-express-api-contract-bridge.md` — OKB viewer API contract (v7.2, Phase 61-adjacent).
- `2026-06-10-sub-agent-dashboard-observability-gap.md` — sub-agent capture observability (Phase 51 follow-up).
- `2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md` — LSL timeline (v7.2, Phase 61).

</deferred>

---

*Phase: 62-worker-pool-core-stream-json-transport*
*Context gathered: 2026-06-20*

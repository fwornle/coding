# Phase 64: Worker Hygiene — CLI Version Pinning & stderr Throttling - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning
**Source:** Synthesized from ROADMAP SCs + REQUIREMENTS (GUARD-02/03) + Phase 62/63 forward-references (no interactive discuss round — the two SCs are unambiguous and the code surface is already mapped).

<domain>
## Phase Boundary

Keep the long-lived Phase-62/63 worker pool **correct and quiet across CLI upgrades and noisy CLI warnings**. Two hygiene guards, plus one folded token-accounting fix:

- **GUARD-02 (CLI version pinning):** record the `claude` CLI version at worker boot; when `claude --version` drifts from a worker's boot version, recycle that worker (drain + respawn) before it serves its next request — so prompt-cache assumptions don't silently rot when the `claude` binary is upgraded under a running worker.
- **GUARD-03 (stderr drain + throttle):** worker stderr is already drained continuously (so the pipe never stalls the subprocess), but it is currently **discarded silently**. Add throttled logging: at most one log line per minute per worker, so persistent-worker CLI warnings (e.g. "no stdin data received") surface for diagnosis without flooding the proxy logs.
- **WR-02 fold-in (token-accounting refinement):** the context-leak recycle ceiling currently measures raw `usage.input_tokens` instead of the cache-inclusive `modelUsage` sum the rest of the system treats as authoritative. Fix it so the ceiling measures the true context the worker carries. Deferred from Phase 62 review explicitly *to this phase* (62-CONTEXT deferred §; 63-CONTEXT deferred §).

**In scope:** boot-version capture + drift-recycle, stderr drain-and-throttle logging, the WR-02 recycle-ceiling token-sum fix, and the unit/`--live` tests that prove all three.

**Out of scope (later phases):** steady-state latency + crash-survival acceptance probe (Phase 65 / PERF-01, PERF-02), dashboard latency observability (Phase 66 / PERF-03). Cross-provider fallback (claude-code→copilot) stays permanently excluded. Do NOT re-implement lifecycle (Phase 63) or pool core (Phase 62) — this phase only adds hygiene around them.
</domain>

<decisions>
## Implementation Decisions

### GUARD-02 — CLI version pinning + drift recycle
- **D-01:** **Record the boot version on each `ClaudeWorker`.** At spawn, capture the `claude` CLI version string and store it on the worker (e.g. `this._bootVersion`). The version read MUST be **deps-injectable** (a `deps.readVersion` / `deps.claudeVersion` seam, mirroring the existing `deps.spawn`/`deps.claudeCli`/`deps.buildEnv` seams) so the unit suite can simulate a version change without a real `claude` binary. **Rationale:** SC-1 requires "verified by simulating a version change and observing the worker recycle" — that is only testable through an injectable reader.
- **D-02:** **Drift is detected at reuse-time, not per-stream, and reuses the existing `needsRecycle` signal.** The pool already checks `worker.needsRecycle` before reusing a worker (the post-request recycle path at `worker-pool.mjs:1063`, and the `_reapStale` drain). On drift, set `needsRecycle = true` (+ `isStale = true`) so the **existing** drain+respawn path fires — do NOT invent a parallel recycle mechanism. The next request for that (model×prompt) key then lazily respawns a fresh worker booted against the new CLI version.
- **D-03:** **Do NOT exec `claude --version` on every request** (an execFile per request would erase the latency win this milestone exists to deliver). Compare each worker's cached `_bootVersion` against a **process-level "current version" snapshot** that is refreshed cheaply (e.g. captured once at pool construction and re-probed on a coarse interval / lazily, throttled). Exact refresh cadence + representation is Claude's-Discretion, consistent with the Phase-62/63 house style — but it MUST be O(1) on the hot path.
- **D-04:** **Version capture must never block or crash worker boot.** Spawn stays synchronous (workers boot eagerly-on-demand today); if the version probe is async or fails, the worker still boots and serves traffic — a missing/unreadable version simply disables drift-recycle for that worker rather than throwing. Degrade open, not closed.

### GUARD-03 — stderr drain + throttle
- **D-05:** **Replace the silent discard with drain-and-throttle.** The current handler at `worker-pool.mjs:261-263` is `this._proc.stderr.on('data', () => {})` (drains, logs nothing — the comment there already tags this as "GUARD-03 / Phase 64"). Keep draining every chunk (the pipe must never block — Pitfall 3), but emit a log line at most **once per minute per worker** carrying a short, truncated sample of the stderr text. Use a per-worker last-logged timestamp gate.
- **D-06:** **Wire a logger into the worker.** The logger today lives on `WorkerPool` (`this._log`/`this._logErr`, set from `opts.log`/`opts.logErr` at `worker-pool.mjs:734-735`), NOT on `ClaudeWorker`. The throttled stderr line needs a logger on the worker: pass `log`/`logErr` (or just `logErr`) into the worker via its `deps` seam when `_spawnWorker` constructs it (`worker-pool.mjs:761-787`), defaulting to a no-op (`() => {}`) exactly like the pool does. Truncate the sampled stderr (the execFile path caps at 200 chars — `server.mjs:1143` — match that ceiling).
- **D-07:** **Throttle is per-worker, not global.** Each worker keeps its own one-line-per-minute budget so one noisy worker can't suppress another's first warning. The throttle window default (60s) may be a named constant; an env knob is optional (Claude's-Discretion — only add one if it costs nothing).

### WR-02 fold-in — recycle ceiling token sum
- **D-08:** **Measure context size with the cache-inclusive sum.** At `worker-pool.mjs:468`, `this._lastInputTokens = ev.usage?.input_tokens || 0` records only raw top-level input tokens. Change it to the **same `input + cacheReadInputTokens + cacheCreationInputTokens` sum** that `toCompletion` already computes from `ev.modelUsage` (`worker-pool.mjs:155-168`) and that `server.mjs:1166` treats as authoritative. Fall back to `ev.usage?.input_tokens || 0` only when `modelUsage` is absent. The recycle ceiling (`_lastInputTokens >= this._maxInputTokens`) then measures the real context the worker carries, so context-leak recycle fires at the intended threshold instead of far too late.

### Claude's Discretion
- Exact names for the version field/seam (`_bootVersion`, `deps.readVersion`), the process-level version-snapshot representation and its refresh cadence, the stderr throttle constant/knob name, and whether the throttle timestamp lives on `ClaudeWorker` directly — all planner/executor choices, consistent with Phase-62/63 "Claude's-Discretion".
- `--live` test mechanics MUST use the runner-robust gate from Phase 62: env var `LLM_PROXY_LIVE=1` **OR** direct-run `--live`; `node --test <file> --live` does NOT forward trailing argv (see the Phase-62 follow-up and `reference_node_test_argv_live_gate` memory). Simulate version drift in the **unit** suite via the injected reader (no real upgrade needed); GUARD-03 throttle is likewise unit-testable with a fake clock + injected logger.

### Folded Todos
- **WR-02** (62-REVIEW) — folded as D-08 above (the only Phase-62 review warning routed to Phase 64).
- No `.planning/todos/pending/` items match this phase's surface (the worker-pool todos were all reviewed and excluded as keyword false-positives in 63-CONTEXT).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone design & requirements
- `.planning/REQUIREMENTS.md` § v7.3 — **GUARD-02** (line 36) and **GUARD-03** (line 37) verbatim; the requirement IDs every plan must cover.
- `.planning/ROADMAP.md` § "Phase 64" (lines 1260-1267) — goal + the 2 success criteria this phase must make TRUE.
- `.planning/research/v7.2-llm-proxy-perf-worker-pool.md` — the milestone research seed (filename retains v7.2 origin; content is the v7.3 seed): Pitfall 1 (context-leak recycle) and Pitfall 3 (undrained-pipe stall) are the two pitfalls GUARD-02/03 + WR-02 harden against.

### Phase 62/63 — what already exists (build on, don't re-implement)
- `.planning/phases/62-worker-pool-core-stream-json-transport/62-REVIEW.md` § **WR-02** (lines 149-185) — the exact token-accounting defect D-08 fixes, with file:line.
- `.planning/phases/63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can/63-CONTEXT.md` — D-04 (idle timer / `unref()`), D-08 (synchronous dispose), the `needsRecycle`/`_reapStale` machinery this phase's drift-recycle reuses; its deferred § routes WR-02 here.

### Code under change (separate `rapid-llm-proxy` git repo)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` — `ClaudeWorker` constructor/boot (`:199-273`, spawn at `:246`, stderr drain at `:259-263`, `_lastInputTokens` set at `:468`, `toCompletion` modelUsage sum at `:155-168`); `WorkerPool._spawnWorker` (`:761-787`) and the recycle/reap paths (`_dropWorker :848`, `_reapStale :859`, post-request recycle `:1063`); module CLI const `CLAUDE_CLI` (`:44`); pool logger wiring (`:734-735`).
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` — `:1143` (execFile path's 200-char stderr truncation to match) and `:1166` (the authoritative `modelUsage` sum WR-02 aligns to).
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/{unit/worker-pool.test.mjs, integration/worker-pool-live.test.mjs, helpers/mock-claude-stdio.mjs}` — extend with: version-drift-recycle unit case (injected reader), stderr-throttle unit case (fake clock + injected logger), WR-02 recycle-ceiling-uses-summed-tokens unit case; optional `--live` confirmation.

**NOTE:** code lives in the standalone `rapid-llm-proxy` git repo — commit code there (`git -C /Users/Q284340/Agentic/_work/rapid-llm-proxy ...`), planning artifacts in the coding repo (the Phase-62/63 cross-repo convention). The rapid-llm-proxy repo is NOT pushed to a remote (Phase 63 commit `b40bc23` stayed local).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ClaudeWorker.needsRecycle` / `isStale` + `WorkerPool._reapStale` + the post-request recycle at `:1063` — the **existing** drain+respawn path GUARD-02 drift-recycle funnels through (D-02). No new recycle mechanism.
- The `deps` constructor seam (`deps.spawn`, `deps.claudeCli`, `deps.buildEnv`, `deps.maxInputTokens`, `deps.requestTimeoutMs`, `deps.idleMs`) — extend with `deps.readVersion` + `deps.log`/`deps.logErr`, same default-to-no-op/default-impl pattern.
- `toCompletion`'s `input + cacheReadInputTokens + cacheCreationInputTokens` summation (`:155-168`) — copy this for D-08 instead of re-deriving.
- The pool's `opts.log`/`opts.logErr` no-op defaults (`:734-735`) and the execFile path's `.slice(0,200)` stderr truncation (`server.mjs:1143`) — mirror both for D-05/D-06.

### Established Patterns
- Injectable `deps`/`opts` with default real-impls — the testability seam for every Phase-62/63 behavior; version reader + logger follow it.
- Env-knob config (`LLM_PROXY_DISABLE_WORKER_POOL`, `LLM_PROXY_WORKER_POOL_SIZE`, `LLM_PROXY_WORKER_PROMPT_CAP`, `LLM_PROXY_WORKER_REQUEST_TIMEOUT_MS`, `LLM_PROXY_WORKER_IDLE_MS`) — any new knob follows the `LLM_PROXY_WORKER_*` naming; the throttle window may stay a bare constant.
- Degrade-open hygiene: a failed version probe disables drift-recycle for that worker, never blocks boot or throws (D-04).

### Integration Points
- `_spawnWorker` (`:761-787`) is where the worker is constructed — the place to thread `log`/`logErr`/`readVersion` deps and to capture the boot version.
- The process-level "current version" snapshot (D-03) lives on `WorkerPool` (constructed once, refreshed coarsely); workers compare their `_bootVersion` against it at reuse.
</code_context>

<specifics>
## Specific Ideas

- GUARD-03 is a **one-line behavioral delta** from today (silent `() => {}` → drain + throttled log) — the comment at `worker-pool.mjs:260` already names it as this phase's work. Keep it minimal; do not buffer stderr unboundedly (drain-and-discard-except-throttled-sample, never accumulate).
- WR-02/D-08 is a precise two-token-source swap at one line (`:468`); the test must assert the ceiling trips on a payload whose `modelUsage` cache-inclusive sum crosses `_maxInputTokens` while raw `usage.input_tokens` alone would not — that delta is the whole point of the fix.
- Drift-recycle must be proven by the **simulated** version change required by SC-1, not by a real CLI upgrade — the injected `readVersion` returning a new string between two acquires, then asserting the worker was disposed + a fresh one spawned.
</specifics>

<deferred>
## Deferred Ideas

- A real protocol-level version handshake (asking the running `claude` subprocess its version over stream-JSON instead of execing `claude --version`) — not currently exposed by the CLI; revisit only if a future CLI surfaces it. Not actionable now.
- Surfacing per-worker stderr samples on the dashboard — belongs with Phase 66 (dashboard observability), not here. GUARD-03 only needs them in the proxy logs.
- An env knob for the throttle window — add only if free; otherwise a named constant is sufficient (Claude's-Discretion).
</deferred>

---

*Phase: 64-worker-hygiene-cli-version-pinning-stderr-throttling*
*Context gathered: 2026-06-21 (synthesized, no discuss round)*

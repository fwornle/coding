# Phase 63: Worker Lifecycle — Lazy Spawn, Idle Eviction, Crash Recovery & Cancellation - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the Phase-62 worker pool behave correctly under real traffic over time: workers spawn only on demand (WLIFE-01), free their RAM when idle (WLIFE-02), survive individual crashes without spin-looping (WLIFE-03), and never get pinned by a dead client (WLIFE-04). The pool data structures, keying, concurrency-1, overflow (D-06), and the cancel SEAM already exist from Phase 62 — this phase makes the lifecycle around them production-correct.

**In scope:** lazy-spawn verification, idle eviction, crash recovery + respawn-storm guard, real cancellation propagation, and folding the three Phase-62 lifecycle/cancellation review warnings (WR-03/04/05) plus the EPIPE crash guard (WR-01).

**Out of scope (later phases):** CLI-version pinning + stderr throttling (Phase 64 / GUARD-02, GUARD-03, WR-02), steady-state latency + crash-survival acceptance probe (Phase 65 / PERF-01), dashboard latency observability (Phase 66). Cross-provider fallback (claude-code→copilot) stays permanently excluded.
</domain>

<decisions>
## Implementation Decisions

### Cancellation (WLIFE-04) — abort/disconnect propagation
- **D-01:** **Cancel = SIGTERM + respawn (dispose-on-abort).** On client disconnect / request abort, SIGTERM the worker, reject its in-flight request as RETRYABLE, and synchronously drop it from the pool; the next request for that (model×prompt) key lazily respawns a fresh (cold) worker. **Rationale:** Phase 62 live-proved `control_request{subtype:'interrupt'}` does NOT terminate the real claude stream (the `--live` cancel test hung indefinitely — see 62-HUMAN-UAT.md test 6). The protocol interrupt is therefore NOT a usable cancel; SIGTERM is the only reliable path. Matches ROADMAP SC-4's "protocol cancel if supported, **else SIGTERM + respawn**". Aborts are rare, so losing worker warmth on abort is acceptable.
- **D-02:** **Stray-result safety: dispose-on-cancel + a monotonic request-generation guard.** Because a cancelled worker is disposed, it cannot leak a late result onto the next caller (closes WR-05's primary vector). As belt-and-suspenders, `_onEvent` checks a per-worker monotonic request generation/sequence so a stray `result` that arrives after a request has already settled is dropped rather than resolving the next pending promise.
- **D-03 (WR-03 fold-in):** **Abort targets one request, not the worker indiscriminately.** If the aborted request is the **in-flight** one → SIGTERM+dispose per D-01. If the aborted request is still **queued** (concurrency-1 FIFO) → just remove it from the queue and reject it RETRYABLE; leave the worker and its (different) in-flight request untouched. The abort handler must distinguish in-flight vs queued before acting.

### Idle eviction (WLIFE-02)
- **D-04:** **Per-worker unref'd idle timer.** Each `ClaudeWorker` arms a `setTimeout` that is **`unref()`'d** (so it never keeps the proxy process alive), reset on every request settle. On fire: `dispose()` + emit `'exit'`; the pool's existing exit handler drops the worker; the next request for that key lazily respawns. No central sweep loop — precise, reuses the Phase-62 reap path. **Default idle timeout 30 min**, configurable via an env knob (name = planner/executor discretion, consistent with the D-05/D-09 house style, e.g. `LLM_PROXY_WORKER_IDLE_MS`).
- **D-05:** Idle eviction composes with the D-02 LRU prompt-cap from Phase 62: LRU-evict bounds RAM under prompt churn; idle-evict bounds RAM under quiet periods. Both ultimately call the same `dispose()` + pool-drop path.

### Crash recovery & respawn-storm guard (WLIFE-03)
- **D-06:** **Crash cooldown → execFile overflow.** Track consecutive early-exit/boot failures per (model×prompt) key; after a threshold within a window (counts/window = planner discretion), mark the key in "cooldown" and route its requests straight to the `completeClaudeCodeViaCLI` execFile overflow (D-06 from Phase 62) for the cooldown duration — instead of spawn→crash→RETRYABLE on every request. Reuses the milestone's graceful-degradation fallback. After cooldown, the key is allowed to lazily spawn again. This is the structural answer to ROADMAP SC-3 "never auto-restarted in a tight loop": there is already NO auto-restart (respawn is lazy-on-next-request), and the cooldown additionally protects against a persistently-broken key (bad OAuth/flags) slow-failing every request.
- **D-07 (WR-01 fold-in):** **EPIPE on `stdin.write` is treated as a crash.** Wrap the worker's `stdin.write`; on EPIPE/write error, mark the worker dead, reject the in-flight request RETRYABLE, and drop it (same path as `'exit'`). An unguarded write currently throws out of the stdout handler and loses the queued-job rejection.

### Lifecycle correctness (WR-04 fold-in)
- **D-08:** **`dispose()` removes the worker from its pool array synchronously**, not only via the async `'exit'`/`'close'` event. Otherwise a concurrent `acquire` in `complete()` can hand out a worker that has already been SIGTERMed (race window). Dispose must mark the worker unusable AND splice it from `workersByKey[key]` before returning (and prune the key if the array empties, per the Phase-62 CR-02 invariant).

### WLIFE-01 (lazy spawn) — verify-only
- **D-09:** Lazy spawn is **already implemented** in Phase 62 (`WorkerPool.complete()` spawns on first fallback for a key; D-07/Phase-62; zero workers at boot). Phase 63 does NOT re-implement it — it adds the **cold-start live test that was missing** (Phase-62 SC-2 was only PARTIAL: confirmed indirectly, no dedicated `ps`-based assertion). The plan should add a `--live` case asserting zero `claude -p` workers immediately after proxy start, then exactly one after the first sonnet fallback.

### Claude's Discretion
- Exact env-knob names (idle timeout, crash-cooldown threshold/window), the crash-frequency data structure, the request-generation counter representation, and whether the idle timer lives on `ClaudeWorker` vs is armed by the pool — all planner/executor choices, consistent with Phase-62's "Claude's Discretion" (62-CONTEXT D-discretion).
- Test mechanics for the `--live` lifecycle cases must use the runner-robust gate fixed in Phase 62 (env var `LLM_PROXY_LIVE=1` OR direct-run `--live`; `node --test <file> --live` does NOT forward argv — see 62 follow-up).

### Folded Todos
None folded. The `todo.match-phase` matcher surfaced 16 keyword matches (obs-api SIGTERM crash, VKB/LSL/ontology items) but all are false positives — they match on "crash"/"shutdown"/"SIGTERM" keywords and are unrelated to the rapid-llm-proxy worker pool. Reviewed and not folded (see Deferred).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone design & requirements
- `.planning/research/v7.2-llm-proxy-perf-worker-pool.md` — THE research seed (filename retains v7.2 origin; content is the v7.3 seed). Lifecycle guidance (pool size/affinity/idle/crash), 5 open questions, acceptance criteria. **Read first.**
- `.planning/REQUIREMENTS.md` § v7.3 — WLIFE-01..04 (this phase) + GUARD-02/03, PERF-01 (phases 64-65 context).
- `.planning/ROADMAP.md` § "Phase 63" — goal + the 4 success criteria this phase must make TRUE.

### Phase 62 — what already exists (build on, don't re-implement)
- `.planning/phases/62-worker-pool-core-stream-json-transport/62-CONTEXT.md` — D-01..D-09 (keying, pool sizing, overflow, escape hatch); the cancel-seam-now/full-cancel-Phase-63 split.
- `.planning/phases/62-worker-pool-core-stream-json-transport/62-RESEARCH.md` § Q3 (stream-JSON cancellation verdict), § "Runtime State Inventory" (reap-on-exit), § Pitfall 1 (context-leak recycle).
- `.planning/phases/62-worker-pool-core-stream-json-transport/62-REVIEW.md` — CR-01/CR-02 (resolved) + WR-01..06; WR-01/03/04/05 are folded into THIS phase (WR-02/06 → Phase 64 / already-closed).
- `.planning/phases/62-worker-pool-core-stream-json-transport/62-HUMAN-UAT.md` — live evidence: the cancel-seam test HANGS (the proof behind D-01); SC-2 cold-start only PARTIAL (the gap D-09 closes).

### Code under change (separate repo)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` — `ClaudeWorker` (cancel/recycle/reap/timeout) + `WorkerPool` (acquire/dispose/_dropWorker/_enforcePromptCap/_spawnWorker exit handler). The lifecycle logic lands here.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` — `completeClaudeCode()` dispatcher (`viaCliPath`, abort signal wiring ~:1185-1187 client-disconnect mapping; SIGTERM/SIGINT shutdown → `workerPool.disposeAll()`); `completeClaudeCodeViaCLI` = the D-06/cooldown overflow target.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/{unit/worker-pool.test.mjs, integration/worker-pool-live.test.mjs, helpers/mock-claude-stdio.mjs}` — extend with lifecycle unit cases + the `--live` cold-start/idle/crash/cancel cases.

**NOTE:** code lives in the standalone `rapid-llm-proxy` git repo; commit code there (`git -C`), planning artifacts in the coding repo (the Phase-62 cross-repo convention).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ClaudeWorker.dispose()` + the `'exit'` event + `WorkerPool._dropWorker(key, worker)` — the existing reap path that idle-evict (D-04), cancel (D-01), and crash (D-06/D-07) all funnel through.
- `completeClaudeCodeViaCLI` — the execFile overflow, reused as the crash-cooldown degraded route (D-06).
- The per-request timeout + RETRYABLE rejection added in Phase 62 (CR-01 fix, commit `3c68f54`) — crash/cancel rejections reuse `makeRetryableError`.
- `needsRecycle`/`isStale` flag + `_reapStale` — the staleness machinery idle-evict and crash-cooldown extend.

### Established Patterns
- Escape-hatch / config via env (`LLM_PROXY_DISABLE_WORKER_POOL`, `LLM_PROXY_WORKER_POOL_SIZE`, `LLM_PROXY_WORKER_PROMPT_CAP`, `LLM_PROXY_WORKER_REQUEST_TIMEOUT_MS`) — new idle/cooldown knobs follow this naming.
- `unref()`'d timers so background timers never keep the proxy process alive (apply to the idle timer, D-04).
- Lazy-on-demand creation + lazy-on-next-request respawn (no auto-restart) is the existing model — crash recovery extends it, never adds a restart loop.

### Integration Points
- `completeClaudeCode()` abort-signal wiring in `server.mjs` (~:1185-1187) is where client-disconnect must propagate to the worker per D-01/D-03.
- `workerPool.disposeAll()` already wired into SIGTERM/SIGINT shutdown — idle/crash dispose paths must be consistent with it.
</code_context>

<specifics>
## Specific Ideas

- The cancel decision (D-01) is driven by a concrete Phase-62 observation, not a guess: the live `--live` cancel test hung because the protocol interrupt does not stop the stream. Any future researcher temptation to "just send the interrupt" must be checked against that evidence.
- Crash cooldown (D-06) should degrade to the SAME execFile path the milestone already uses for overflow — not a new error path — so behavior under a broken key matches today's pre-milestone behavior.
</specifics>

<deferred>
## Deferred Ideas

- **WR-02** (recycle ceiling uses raw `usage.input_tokens` instead of the cache-inclusive `modelUsage` sum) → Phase 64 hygiene (it's a token-accounting refinement, not a lifecycle correctness bug).
- A real protocol cancel (if a future `claude` CLI version makes `control_request{interrupt}` actually terminate the stream) → could revisit D-01's SIGTERM+respawn to preserve worker warmth, but only after Anthropic's CLI supports it. Not actionable now.

### Reviewed Todos (not folded)
All 16 `todo.match-phase` matches reviewed and NOT folded — keyword false positives unrelated to the worker pool:
- `2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` (matched "SIGTERM/shutdown") — about obs-api/km-core LevelDB, not the proxy.
- VKB / LSL-timeline / ontology / km-core-store-consolidation items (score 0.6–0.2) — unified-viewer & knowledge-graph domains, unrelated.
</deferred>

---

*Phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can*
*Context gathered: 2026-06-21*

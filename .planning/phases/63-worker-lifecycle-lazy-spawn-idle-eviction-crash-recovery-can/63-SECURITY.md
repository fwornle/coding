# SECURITY.md — Phase 63: Worker Lifecycle (Lazy Spawn / Idle Eviction / Crash Recovery / Cancel)

**Audit date:** 2026-06-21
**Auditor:** gsd-security-auditor
**Mode:** VERIFY-MITIGATIONS-EXIST (plan-authored STRIDE register; not a new-threat scan)
**Implementation repo:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/` (sibling repo, NOT a coding submodule)
**ASVS Level:** default
**block_on:** high

**Result:** SECURED — 14/14 threats resolved (12 mitigate CLOSED, 2 accept CLOSED). No OPEN/BLOCKER threats.

Implementation files were read-only throughout. No implementation, test, or planning file was modified.

---

## Threat Verification (mitigate — grep-confirmed in code)

| Threat ID | Category | Evidence (file:line) |
|-----------|----------|----------------------|
| T-63-01 | Tampering/DoS (acquire-after-SIGTERM race) | `worker-pool.mjs:842-845` `_disposeAndDrop` calls `dispose()` then `_dropWorker(key, worker)` synchronously on the same tick before returning; `_dropWorker` splices via `indexOf`+`splice` (`:848-856`). Invoked on abort at `:1035` and post-request recycle at `:1062`. |
| T-63-02 | DoS (dangling idle timer pins proxy) | Idle timer `unref()`'d at `worker-pool.mjs:524`; per-request timer `unref()`'d at `:379`; `dispose()` clears the idle timer first (`:593` → `_clearIdleTimer` `:528-533`). `DEFAULT_IDLE_MS` from `LLM_PROXY_WORKER_IDLE_MS` (`:89`). |
| T-63-03 | DoS (idle timer never fires / leaks RAM) | `_clearIdleTimer()` on dispatch (`:348`), re-arm on settle (`:488`), armed at construction (`:272`). On fire → `dispose()` → SIGTERM → `'exit'` → `_dropWorker`. Idle life bound to `LLM_PROXY_WORKER_IDLE_MS`. |
| T-63-04 | DoS/Info-Disclosure (unguarded EPIPE loses queued-job rejection) | `_writeGuarded` (`:407-420`) routes both sync-throw and async write-callback `err` to `_onExit(null, 'EPIPE')`; `_onExit` rejects in-flight `_pending` RETRYABLE (`:575`) and drains the whole queue RETRYABLE (`_queue.splice(0)` `:578-581`) then `emit('exit')` (`:582`). Used by `_dispatch` (`:395`) and `cancel` (`:555`). |
| T-63-05 | Spoofing/Info-Disclosure (stray result onto next caller) | Monotonic `_generation` (`:235`), bumped per `_dispatch` (`:352`), stamped on `_pending.generation` (`:354`). `_onEvent` drops a `result` whose `ev._gen` mismatches the live `_pending.generation` (`:457-464`); primary defense `_pending == null` guard (`:456`). |
| T-63-06 | DoS (broken key spin-loops spawn→crash) | Per-key `_crashesByKey` Map (`:725`); `_recordCrash` on every worker exit (`:784`, `:798-804`); cooldown gate `_isInCooldown(key)` at top of `complete()` before lazy-spawn (`:948-954`) routes to `overflowFn` (execFile) once `LLM_PROXY_WORKER_CRASH_THRESHOLD` (`:675`) crossed within `LLM_PROXY_WORKER_CRASH_WINDOW_MS` (`:677`). |
| T-63-07 | DoS (healthy churn false-trips cooldown) | `_recordCrash` (`:801`) and `_isInCooldown` (`:818`) prune timestamps older than `cutoff = now - _crashWindowMs` before counting, and delete the key when the pruned list empties (`:819-820`); only a burst within the window reaches the threshold. |
| T-63-08 | DoS (dead client pins concurrency-1 worker) | `handleAbort` in `complete()` (`:1026-1036`) calls `_disposeAndDrop(key, worker)` for the in-flight case (`:1035`). NEGATIVE assertion confirmed: `worker.cancel()` is never invoked on the abort path — the only two textual references (`:921`, `:998`) are comments stating it is NOT used; `cancel()` is defined (`:544`) but uncalled; `grep '.cancel(' server.mjs` returns nothing. |
| T-63-09 | Tampering/DoS (abort over-reaches kills different request) | D-03 discrimination: `abortQueuedJob(job)` (`:338-344`) splices ONLY the matching queued job via `_queue.indexOf(job)`/`splice(idx,1)` and rejects it RETRYABLE, leaving worker + in-flight untouched. `handleAbort` tries queued-dequeue first and only falls through to dispose if not queued (`:1029-1035`). |
| T-63-10 | Spoofing/Info-Disclosure (SIGTERMed-but-not-dropped worker reused) | Synchronous removal via `_disposeAndDrop` (`:842-845`, same as T-63-01) closes the acquire-after-SIGTERM window; D-02 generation guard (`:457-464`) is belt-and-suspenders. |
| T-63-11 | DoS (orphaned `claude -p` subprocesses leak) | `tests/integration/worker-pool-live.test.mjs:129-143` `afterEach` disposes pool/worker and asserts `countClaudeWorkers() === 0` after each case; leak fails loudly. |
| T-63-12 | Tampering (kill/abort targets wrong pid via reuse) | Live cases read pid directly from the just-spawned live handle: `worker.pid` (`:184-186`), `killedPid` SIGKILLed at `:268`, abort via `controller.abort()` on a freshly-spawned worker (`:310-325`). No stored/stale pid is signaled. |

## Accept-Disposition Verification (rationale confirmed legitimate)

| Threat ID | Category | Rationale verified |
|-----------|----------|--------------------|
| T-63-13 | Info-Disclosure (`countClaudeWorkers` surfaces unrelated `claude -p` sessions) | LEGITIMATE. The helper (`worker-pool-live.test.mjs:93-114`) runs `pgrep -f 'claude -p'` / `ps -ax -o pid=,command=` and counts matching lines only — no secrets, env, or file contents read. Test-only observability helper (integration suite, not a production path). Runbook caveat (no competing `claude -p` session) documented in-helper at `:88-91`, `:109-111`. Residual LOW. |
| T-63-SC | Tampering (npm/pip/cargo installs) | LEGITIMATE. All imports are `node:` builtins — `worker-pool.mjs:37-39` (`node:child_process`, `node:crypto`, `node:events`); tests use `node:test`, `node:assert/strict`, `node:child_process`. No `package.json` dependency change appears across the Phase-63 commit range (`13c583a..b40bc23`); `git diff -- package.json` is empty. No install task. |

## Unregistered Flags

None. No SUMMARY (`63-01..05-SUMMARY.md`) contains a `## Threat Flags` section; no new attack surface was flagged during implementation that maps outside the plan-authored register.

## Verification Artifacts

- Unit suite re-run by auditor: `node --test tests/unit/worker-pool.test.mjs` → **tests 46 / pass 46 / fail 0 / exit 0**.
- `--live` suite NOT run by auditor (billed API calls + operator OAuth). Operator result recorded 2026-06-21: 9/9 PASS, SC-1..SC-4 PASS, zero orphaned workers. Independent re-run is the single `human_needed` item in `63-VERIFICATION.md`.
- Server.mjs abort wiring confirmed end-to-end: `reqAbort.abort()` on client/socket close (`server.mjs:1538`, `:1541-1542`) → threaded as `sig` into `workerPool.complete(b, sig, completeClaudeCodeViaCLI)` (`:1238`); `workerPool.disposeAll()` on shutdown (`:1866`).

## Accepted Risks Log

- **T-63-13** — `countClaudeWorkers()` may count `claude -p` subprocesses from a developer's parallel session. Accepted: test-only coarse liveness helper, no secrets, operator runbook requires no competing session. Residual LOW.
- **T-63-SC** — supply-chain (new package installs). Accepted: no new packages; Node builtins only. Verified no `package.json` dependency delta across the phase.

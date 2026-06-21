# Phase 65: Steady-State Latency & Crash-Survival Acceptance - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning
**Source:** Synthesized from ROADMAP §65 (4 SCs) + REQUIREMENTS (PERF-01/02) + the established Phase-63 live-suite conventions. No discuss round — the SCs are unambiguous and the test surface already exists. Operator routing decision captured: **verify-only** (a PERF-01 miss is recorded honestly and triggers a *separate* optimization phase — this phase does NOT optimize or relax the threshold).

<domain>
## Phase Boundary

Prove the milestone's headline performance + resilience claims against the **live** proxy with a real `claude -p` worker subprocess — "demonstrated, not assumed". This is a **VERIFY-ONLY / acceptance** phase: it re-implements NO pool, lifecycle, or hygiene logic (that all shipped in Phases 62/63/64). It adds the **formal acceptance gate** the Phase-63 suite explicitly deferred — `worker-pool-live.test.mjs:366` labels its warm probe *"informal; PERF-01 is the formal gate"*; Phase 65 builds that gate.

**In scope (extend `tests/integration/worker-pool-live.test.mjs`, the same file Phase 63 grew):**
- **PERF-01 / SC-1** — a *formal, repeatable* steady-state warm-latency probe (warm the prompt cache, then measure N samples; assert the steady-state metric ≤3s). Replaces the single-sample informal `<3s` sanity case.
- **PERF-02 / SC-2** — SIGKILL a worker PID, then assert the **next fallback request for that model returns a valid completion** (after lazy respawn) — acceptance framing on top of Phase-63's SC-3 crash case (which only asserted the in-flight rejects RETRYABLE + no storm).
- **SC-3 (idle)** — idle-evict observable end-to-end *within an expected bound* (worker gone from `ps` after the idle window; fresh request respawns within bound). Phase-63's idle case (`:228`) covers the gone-from-ps + fresh-pid mechanics; Phase 65 frames it as the acceptance bound.
- **SC-4 (escape hatch)** — `LLM_PROXY_DISABLE_WORKER_POOL=1` reverts cleanly: **no workers in `ps`** AND **baseline `execFile` latency restored**. Phase-63's GUARD-01 case (`:203`) proves no-spawn + baseline shape but NOT latency; Phase 65 adds the baseline-latency observation.

**Out of scope:**
- ANY latency optimization or transport tuning — if the formal probe measures warm steady-state > 3s (the last informal run saw **3.9s**), that is a recorded FAIL/finding that triggers a *separate* optimization phase. Do NOT pre-build optimization, and do NOT relax the ≤3s bar (operator decision 2026-06-21).
- Dashboard latency observability (Phase 66 / PERF-03).
- Cross-provider fallback (permanently excluded).
</domain>

<decisions>
## Implementation Decisions

### PERF-01 / SC-1 — formal steady-state warm-latency probe
- **D-01:** **Warm, then measure N repeats; assert the steady-state statistic ≤3s.** Drive ≥1 warm-up `say OK` to exclude the cold spawn (Pitfall 4), then issue **N sequential identical `say OK` requests** (N = planner's discretion, ≥5 recommended) on the SAME warm worker and record each wall-time. Assert the **steady-state metric** (median recommended; also record max) is ≤ 3000 ms. This upgrades the informal single-sample case at `worker-pool-live.test.mjs:366-376` — that case should be REPLACED by (or folded into) the formal one, not left as a second weaker gate.
- **D-02:** **Verify the cache was actually hit.** The SC says "warm worker (cache hit)". The probe MUST confirm the measured requests are genuine cache hits — assert `cacheReadInputTokens > 0` (or the equivalent `modelUsage` cache field surfaced through the worker's completion `tokens`) on the measured turns, so a "warm" number isn't silently a cache MISS. If the worker contract doesn't currently surface cacheRead, the probe records it from the result event; surfacing it is a minimal read, not new behavior.
- **D-03:** **Honest hard gate.** The probe ASSERTS ≤3s so the suite goes RED on a miss — that is the "demonstrated, not assumed" contract. On a miss, the operator records the actual median/max in the HUMAN-UAT table and PERF-01 stays **Not started / blocked**, triggering a follow-up optimization phase. The test does NOT downgrade to a warning to make the suite green.

### PERF-02 / SC-2 — crash survival returns a valid completion
- **D-04:** **Assert the post-crash request SUCCEEDS, not just that the in-flight rejected.** Spawn a worker, capture its pid from the live handle (T-63-12: read the pid directly, never a stored/stale pid), `process.kill(pid, 'SIGKILL')`, then issue the **next same-(model×prompt) request** and assert it returns a valid `{content,...}` with non-empty content from a NEW pid. This is the acceptance delta over Phase-63 SC-3 (`:257`), which proved RETRYABLE + no-storm but stopped short of "the subsequent request is served and returns a valid completion" — the literal PERF-02 wording.
- **D-05:** Reuse the Phase-63 `countClaudeWorkers()` `ps`/`pgrep` helper and the no-respawn-storm sampling so the crash case stays consistent with the existing suite; no new process-inspection mechanism.

### SC-3 — idle eviction within the acceptance bound
- **D-06:** **Reuse the existing idle case mechanics; add the bound.** The existing idle case (`:228`) uses a tiny injected `idleMs` window (the `deps.idleMs` seam), asserts the worker is gone from `ps` after the window, and that the next request respawns a fresh pid. Phase 65 keeps that and frames the "fresh request spawns a new one within the expected bound" assertion explicitly (a bounded settle, not an open-ended wait). No new idle mechanism — Phase 63 already shipped the timer.

### SC-4 — escape hatch reverts cleanly WITH baseline latency
- **D-07:** **Extend the GUARD-01 case with a latency + zero-ps assertion.** With `LLM_PROXY_DISABLE_WORKER_POOL=1`: assert the request routes through the `execFile` overflow (no worker in `workersByKey`, `countClaudeWorkers() === 0`), AND record the per-call `execFile` latency as the restored baseline (a single observed sample is sufficient — baseline is "the slow path is back", not a tight bound). Save/restore the env var exactly as the existing GUARD-01 case does (`:204-222`).

### Test harness discipline
- **D-08:** **Live gate + teardown are mandatory and reused verbatim.** Every new case is gated on `process.argv.includes('--live') || process.env.LLM_PROXY_LIVE === '1'` — NEVER rely on `node --test <file> --live` argv forwarding (the runner strips trailing argv; see `worker-pool-live.test.mjs:9-10` and the `reference_node_test_argv_live_gate` memory). The `afterEach`/teardown must dispose the pool/worker and assert **zero orphaned `claude -p` workers** remain (the suite's existing zero-orphans invariant). Register every live worker/pool on the module-level handle the teardown reaps.

### Operator-run gate
- **D-09:** **This phase's acceptance plan is `autonomous: false`** (mirrors Phase-63's 63-05). The `--live` cases require Max OAuth via keychain + network + a real `claude` binary, so they cannot run in unattended CI. The plan AUTO-lands the test code (committed to the proxy repo); the operator then runs `LLM_PROXY_LIVE=1 node --test tests/integration/worker-pool-live.test.mjs` (or the direct `--live` form) and records results in a `65-HUMAN-UAT.md` table, exactly as 63-05 did. Discharge PERF-01/02 only after the operator's PASS.

### Claude's Discretion
- Sample count N and the chosen steady-state statistic (median vs p90 vs all-of-N) for D-01; the exact baseline-latency recording shape for D-07; whether the formal warm probe replaces the informal case in-place or supersedes it; the `65-HUMAN-UAT.md` table columns (follow the 63-05 layout).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone design & requirements
- `.planning/REQUIREMENTS.md` § v7.3 — **PERF-01** (line 41, warm ≤3s), **PERF-02** (line 42, crash survival); PERF-03 (line 43) is Phase 66, NOT this phase.
- `.planning/ROADMAP.md` § "Phase 65" (lines 1277-1286) — goal + the 4 success criteria this phase must make TRUE (SC-1 latency, SC-2 crash, SC-3 idle, SC-4 escape hatch).

### Phase 63 — the live-suite this phase extends (reuse, don't reinvent)
- `.planning/phases/63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can/63-05-PLAN.md` + `63-05-SUMMARY.md` — the verify-only live-acceptance PATTERN (autonomous:false, ps helper, teardown, operator results table, post-run discharge). Phase 65 mirrors this structure.
- `.planning/phases/62-worker-pool-core-stream-json-transport/62-HUMAN-UAT.md` — the operator-results-table format to copy for `65-HUMAN-UAT.md`.

### Code under change (separate `rapid-llm-proxy` git repo — VERIFY-ONLY, test file only)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/worker-pool-live.test.mjs` — the ONLY file this phase changes. Anchors: live gate (`:58`), `countClaudeWorkers()` `ps`/`pgrep` helper (`:94-115`), GUARD-01 escape-hatch case to extend (`:203-223`), idle case (`:228-251`), crash SC-3 case (`:257-296`), the informal warm-sanity case to formalize/replace (`:366-376`), and the module-level `worker`/`pool` teardown handles.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` — READ-ONLY reference: the completion `tokens`/`modelUsage` shape (`inputTokensFromEvent` :191, `toCompletion`) so the cache-hit assertion (D-02) reads the right field; `ClaudeWorker`/`WorkerPool` public surface (`write`, `complete`, `keyFor`, `workersByKey`, `dispose`, `deps.idleMs`).

**NOTE:** code lives in the standalone `rapid-llm-proxy` git repo — commit the test file there (`git -C /Users/Q284340/Agentic/_work/rapid-llm-proxy ...`, NOT pushed, local-only); planning artifacts (PLAN/SUMMARY/HUMAN-UAT) in the coding repo. The Phase-62/63/64 cross-repo convention.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `countClaudeWorkers()` (`worker-pool-live.test.mjs:94-115`) — the `pgrep -f 'claude -p'` → `ps -ax` fallback worker counter, with self-exclusion of the matcher line. Every Phase-65 case reuses it; do NOT write a new one.
- The `settle(ms)` helper + module-level `worker`/`pool` teardown handles + the zero-orphans `afterEach` assertion — the suite's existing hygiene scaffold.
- The GUARD-01 escape-hatch env save/restore pattern (`:204-222`) — copy for the SC-4 latency case.
- The informal warm-sanity case (`:366-376`) — the seed the formal PERF-01 probe formalizes (warm-up excludes cold; measure the 2nd+ call).

### Established Patterns
- Live gate via `--live` argv OR `LLM_PROXY_LIVE=1` env (never `node --test` argv forwarding).
- Read the worker pid DIRECTLY off the live handle before signalling (T-63-12 — no stale pid).
- `autonomous: false` for the operator-run live plan; AUTO-land the code, operator runs the suite + records the table, then discharge.

### Integration Points
- The completion `tokens` returned by `worker.write()` / `pool.complete()` is where the cache-hit assertion (D-02) reads `cacheReadInputTokens`; confirm the field name against `worker-pool.mjs` `inputTokensFromEvent`/`toCompletion` before asserting.
</code_context>

<specifics>
## Specific Ideas

- The headline risk is PERF-01: the last informal run measured **3.9s** warm (`63-05-SUMMARY` operator table), OVER the ≤3s bar. Phase 65's job is to measure it RIGOROUSLY (warm-up excluded, cache-hit confirmed, N samples) and assert the bar — NOT to make it pass. A genuine miss is the expected, honest outcome that hands off to a follow-up optimization phase.
- The cache-hit check (D-02) matters precisely because a "fast" number could be a cache MISS that happens to be quick, or a "slow" number could mean the warm path isn't actually cache-hitting — the optimization phase needs to know which. Record the cacheRead token count alongside the latency in the operator table.
- PERF-02's delta over Phase-63 SC-3 is small but real: SC-3 proved "the crash doesn't storm and the in-flight rejects cleanly"; PERF-02 proves "the NEXT request actually gets served with a valid answer". Assert the completion content, not just the absence of a storm.
</specifics>

<deferred>
## Deferred Ideas
- Warm-path latency optimization (cache-warmup strategy, stream-JSON transport overhead, sonnet vs haiku routing) — a SEPARATE phase, triggered only if the PERF-01 probe misses ≤3s. Explicitly NOT in Phase 65 (operator decision 2026-06-21).
- Relaxing the ≤3s acceptance bar — rejected; the milestone's headline claim stays ≤3s without explicit re-scoping.
- Dashboard latency column proving the speedup over 24h — Phase 66 / PERF-03.
</deferred>

---

*Phase: 65-steady-state-latency-crash-survival-acceptance*
*Context gathered: 2026-06-21 (synthesized, no discuss round; operator chose verify-only + synthesize)*

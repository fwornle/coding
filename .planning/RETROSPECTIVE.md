# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v7.3 — LLM Proxy Performance (Claude CLI Worker Pool)

**Shipped:** 2026-06-21
**Phases:** 5 (62–66) | **Plans:** 16 | **Span:** ~2 days (2026-06-20 → 2026-06-21)

### What Was Built
- A persistent, per-model (haiku/sonnet/opus), concurrency-1 `claude -p` stream-JSON worker pool replacing the per-call `execFile` spawn on the claude-code CLI-fallback path — sonnet/opus fallback latency ~10–14s → ~2–3s steady-state, prompt-cache kept warm.
- Full worker lifecycle: lazy spawn, idle eviction (30 min), crash-recovery as RETRYABLE with a per-key respawn-storm cooldown, and client-disconnect cancellation — all behind the `LLM_PROXY_DISABLE_WORKER_POOL` escape hatch.
- Worker hygiene (CLI version-drift recycle, stderr drain/throttle) and an operator-live-proven acceptance suite (warm ≤3s, SIGKILL survival; 12/12).
- A per-model SPAWN/QUEUE `overhead_ms` dashboard metric graded green/amber/red on both `:3032` surfaces, with both warm→green and regression→red live-proven.

### What Worked
- **Escape hatch first (Phase 62).** Wiring `LLM_PROXY_DISABLE_WORKER_POOL` before any lifecycle complexity meant every later change had a proven one-flag revert — de-risked the whole milestone.
- **Live acceptance over unit-only confidence (Phase 65).** An operator `LLM_PROXY_LIVE=1` run against a real `claude -p` subprocess (with a `ps`-based zero-orphan teardown) discharged WLIFE/PERF requirements that unit tests alone couldn't.
- **The executor refused to fake an unreachable result (Phase 66, SC-2).** Rather than report a red badge it couldn't produce, it surfaced the threshold-vs-real-overhead mismatch — turning a "fail" into the correct diagnosis and a clean follow-up.
- **gsd-browser computed-rgb read-back** gave objective UI verification (badge `rgb(...)`), not eyeballing — caught that the metric, not just the color, was correct.

### What Was Inefficient
- **PERF-03's first framing was wrong** (total latency, gated ≤3s) and only the gap-closure (66-03/04/05) reframed it to the spawn-overhead the pool actually controls. The original SC was generation-dominated and could never go green — a sharper discuss-phase on "what does the pool actually affect" would have saved two re-points.
- **Threshold calibration was host-blind.** The 3s/5s envelope was set for ~14s VPN cold boots; on a fast local host real overhead tops out ~2.5s, so SC-2 was unreachable without a test seam — discovered only at UAT.
- **Milestone-close tooling under-counted the milestone** (ROADMAP.md held only Phase 66, so the auto-generated MILESTONES entry said "1 phase / 5 plans" and listed only dashboard accomplishments). Required manual correction. Keeping all in-flight phases in ROADMAP.md until close would avoid this.

### Patterns Established
- **Opt-in, no-op-when-unset test seams for environment-dependent acceptance** (`LLM_PROXY_WORKER_SPAWN_DELAY_MS`): inject a deterministic delay into the exact measured window so a host-dependent success criterion (regression→red) is reproducible anywhere, without altering production behavior when the env is unset.
- **Grade observability on the component the system controls**, not the end-to-end number — overhead (spawn/queue), not total latency, because generation time is not the pool's to fix.
- **Cross-repo plan execution**: plans touching the separate `rapid-llm-proxy` repo commit there with `feat(NN-MM):` prefixes; planning artifacts commit in `coding`. No worktree isolation for cross-repo or bind-mounted-dashboard plans.

### Key Lessons
1. Define a success criterion against the variable the change actually moves; an end-to-end metric with an unreachable bar is a planning defect, not an execution failure.
2. Make host/environment-dependent acceptance reproducible with a deterministic, opt-in seam rather than relying on a slow machine being available — and never fake the result.
3. Wire the revert/escape hatch before the risky machinery; it converts every later step into a reversible one.
4. Keep all in-flight phases in ROADMAP.md through milestone close so the archival tooling counts the whole milestone, not just the last phase.

### Cost Observations
- Model mix: executor + orchestration on opus (1M); verifier/integration-checker on sonnet (quality profile).
- Notable: the most expensive single step was the SC-2 live disruptive test (worker-pool disable + cold-spawn storm + restore) — high value (caught the threshold mismatch) but it ultimately needed the spawn-delay seam to actually close.

---

## Milestone: v7.5 — Cross-Agent Comparison Experiment Runner

**Shipped:** 2026-07-13
**Phases:** 12 (76–87) | **Plans:** 109 | **Requirements:** 23/23 verified

### What Was Built
- The comparison/aggregation/report core (CMP-01/02/03): an objective per-run success gate persisted at score time (`gate_passed`, reusing the evidence-harness's already-computed test result — never a second run), N-repeat per-variant `{mean,stddev,median,min,max,n}` variance, and a ranked side-by-side report keyed by `task_hash` (CLI table + JSON export).
- The experiment surface (CMP-04/ORCH-01): a dashboard Comparison tab (variant columns) fed by a live `GET /api/experiments/comparison` endpoint, plus a single installed `experiment` skill (run→auto-compare) distributed across claude/copilot/opencode/mastra.
- The autonomous runner (RUN-02/03/04) live-verified via the 78-05 cross-agent smoke: claude + opencode complete end-to-end, copilot probe-gated, zero blast radius.
- Extension phases 81–87: wire-measurement foundation, token reconciliation, per-turn context revelation, experiment control center, timeline v2, interactive branch avenues.

### What Worked
- **Audit-driven gap closure.** A milestone audit returned `gaps_found` and precisely enumerated the 5 unsatisfied requirements (CMP-01..04, ORCH-01) — driving a focused discuss→plan→execute→verify pass on exactly Phases 79 and 80 rather than a vague "finish it" scramble.
- **De-risking the plan by resolving the key unknown inline.** The single hardest question (was the objective gate persisted?) was answered with a direct code trace before planning — revealing the gate ran at score time but was never stored, which reshaped Phase 79's scope correctly (add persistence) instead of the planner rediscovering it mid-execution.
- **The plan-checker caught a real requirement-breaking gap.** It found the skill had no mechanical way to obtain `task_hash` for its auto-compare step (`experiment-run.mjs` emits `task_id`, a different key) — a defect that would have silently broken the one-command end-to-end flow. The revision resolved it via skill-side `sha256(goal_sentence)`.
- **Shared-helper extraction killed schema drift.** The dashboard endpoint and the CLI both stamp `gate_outcome` via a single shared helper, with a deep-equals-CLI test — so the 79→80 JSON contract can't silently diverge.
- **Live verification caught container-only bugs.** 80-01's `sanitizeTaskHash` was unreachable in-container (`scripts/` not bind-mounted); only the live curl smoke surfaced it, prompting relocation into the mounted `compare.mjs`.

### What Was Inefficient
- **The milestone drifted mid-flight.** After Phase 77, work pivoted into a large set of inserted infrastructure phases (82–87) built *around* the unfinished runner core (79/80), leaving the headline product flow severed at the CMP boundary until this closing session reconnected it. Extension scope should attach after the core requirements verify, not interleave ahead of them.
- **STATE.md drift.** The milestone status had been left at `completed` while three phases were outstanding — a stale-state trap that had to be corrected before work could proceed honestly.

### Patterns Established
- **Honesty spine as a first-class requirement.** "Never surface a failed/ungated/unscored variant as a cheap winner" was carried from the aggregator (`isRankable`) through the CLI to the dashboard, doubly-guarded structurally and by test — the empty-ranked state renders correctly rather than fabricating a result.
- **Run service-affecting phases on the main tree, not worktrees.** Phase 80's deploy/verify targeted running services (vkb-server :8080, dashboard :3032) bind-mounted from main — worktree isolation would have made a restart pick up unmerged code, so those plans ran sequentially on main.

### Key Lessons
- A gate signal that is *computed* but not *persisted* is not a gate — CMP-01 needed the score-time result written as a discrete queryable field, because the sandbox that produced it is destroyed by comparison time.
- Live infra outages (copilot's provider 500 during 78-05) are a valid gate outcome: the requirement is that the runner *records* a terminal state, not that every agent succeeds — recorded-but-empty ≠ silently absent.

### Cost Observations
- Model mix: pattern-mapper/planner/executors + orchestration on opus (1M); plan-checker/verifier on sonnet (quality profile).
- Notable: the most expensive verification was the live 78-05 cross-agent smoke (real token spend across claude/opencode/copilot) — high value: it live-proved RUN-02/03/04 and exercised the runner's error-recording path against a real provider 500.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Key Change |
|-----------|--------|------------|
| v7.3 | 5 (62–66) | Escape-hatch-first sequencing; opt-in test seams for env-dependent acceptance; gap-closure as a first-class loop (verify-work → gap plans → re-execute) rather than ad-hoc fixes |

### Cumulative Quality

| Milestone | Tests (worker-pool) | Notable |
|-----------|---------------------|---------|
| v7.3 | 65/65 worker-pool unit + 7/7 token-usage + 9/9 live lifecycle | Live operator acceptance (12/12) over unit-only confidence; integration_ok on the new overhead chain |

### Top Lessons (Verified Across Milestones)

1. Live/operator verification discharges requirements that unit tests cannot — invest in `--live`-gated suites with deterministic teardown.
2. Honest deferral with a concrete follow-up beats a faked pass; the audit and gap-closure loop exist to absorb exactly this.

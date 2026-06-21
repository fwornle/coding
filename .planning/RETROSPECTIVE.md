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

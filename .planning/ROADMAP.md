### Phase 66: Dashboard Latency Observability
**Goal:** Operators can see the speedup land in production — the dashboard's claude-code latency column reflects the warm-pool steady-state, so the ~14s → ≤3s improvement is visible and trackable within a day of rollout rather than only provable by an ad-hoc probe.
**Depends on:** Phase 62 (pool emitting the fast-path latencies), Phase 65 (acceptance probe establishes the ≤3s steady-state the dashboard should reflect)
**Requirements:** PERF-03
**Success Criteria** (what must be TRUE):
  1. The dashboard's claude-code latency column surfaces median claude-code/sonnet latency, and within 24h of worker-pool rollout that median drops from ~14s to ≤3s — the operator reads the speedup off the dashboard, not off a manual probe.
  2. The latency figure the dashboard shows for claude-code/sonnet is sourced from the same fallback-path traffic the pool serves (token-usage / latency telemetry), so a regression (e.g. pool disabled via escape hatch, or workers thrashing) would be visible as the median climbing back toward the ~14s baseline.
**Plans:** 5/5 plans executed — COMPLETE (PERF-03 closed; SC-1 + SC-2 both live-proven 2026-06-21)
  - [x] 66-01-PLAN.md — Add MEDIAN(latency_ms) per-model query to the proxy token-usage SQL layer; expose p50_latency_ms on getSummary by_model rows (rapid-llm-proxy)
  - [x] 66-02-PLAN.md — Surface per-model median on both dashboard surfaces: :3032 headline tile + Token Usage by-model column with green ≤3s / red-toward-14s regression badge (coding)
  - [x] 66-03-PLAN.md — [gap] Instrument the worker pool to record per-call SPAWN/QUEUE overhead_ms (dispatch→first-output, excludes generation); persist it + a per-model p50_overhead_ms median + /recent passthrough (rapid-llm-proxy)
  - [x] 66-04-PLAN.md — [gap] Re-point both dashboard surfaces from total latency to the overhead median (overhead_ms / p50_overhead_ms); the ≤3s/amber/red envelope becomes meaningful — warm→green confirmed live; pool-disabled→red deferred to 66-05 (coding)
  - [x] 66-05-PLAN.md — [gap] Add opt-in `LLM_PROXY_WORKER_SPAWN_DELAY_MS` worker-pool test seam (defers the prompt write so the injected delay lands in the overhead window, no-op when unset) and live-prove SC-2 on :3032: env=6000ms flipped BOTH the tile ("Regressed" red) and the by-model "Spawn Overhead" column RED, then restored to green + healthy pool — closes the 66-04 SC-2 deferral, PERF-03 Complete (rapid-llm-proxy + coding)
**UI hint:** yes

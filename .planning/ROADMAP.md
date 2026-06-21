### Phase 66: Dashboard Latency Observability
**Goal:** Operators can see the speedup land in production — the dashboard's claude-code latency column reflects the warm-pool steady-state, so the ~14s → ≤3s improvement is visible and trackable within a day of rollout rather than only provable by an ad-hoc probe.
**Depends on:** Phase 62 (pool emitting the fast-path latencies), Phase 65 (acceptance probe establishes the ≤3s steady-state the dashboard should reflect)
**Requirements:** PERF-03
**Success Criteria** (what must be TRUE):
  1. The dashboard's claude-code latency column surfaces median claude-code/sonnet latency, and within 24h of worker-pool rollout that median drops from ~14s to ≤3s — the operator reads the speedup off the dashboard, not off a manual probe.
  2. The latency figure the dashboard shows for claude-code/sonnet is sourced from the same fallback-path traffic the pool serves (token-usage / latency telemetry), so a regression (e.g. pool disabled via escape hatch, or workers thrashing) would be visible as the median climbing back toward the ~14s baseline.
**Plans:** 2/2 plans complete
  - [x] 66-01-PLAN.md — Add MEDIAN(latency_ms) per-model query to the proxy token-usage SQL layer; expose p50_latency_ms on getSummary by_model rows (rapid-llm-proxy)
  - [x] 66-02-PLAN.md — Surface per-model median on both dashboard surfaces: :3032 headline tile + Token Usage by-model column with green ≤3s / red-toward-14s regression badge (coding)
**UI hint:** yes

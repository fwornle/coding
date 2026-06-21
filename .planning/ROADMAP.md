# Roadmap: Coding Project — Knowledge Management

## Milestones

- ✅ **v7.3 LLM Proxy Performance — Claude CLI Worker Pool** — Phases 62–66 (shipped 2026-06-21)
- 📋 **Next milestone** — run `/gsd-new-milestone` to scope

## Phases

<details>
<summary>✅ v7.3 LLM Proxy Performance — Claude CLI Worker Pool (Phases 62–66) — SHIPPED 2026-06-21</summary>

Replaced the per-call `claude` CLI `execFile` spawn on the claude-code fallback path with a pool of warm, persistent stream-JSON workers — sonnet/opus fallback latency cut from ~10–14s to ~2–3s steady-state. 14/14 requirements satisfied. Full detail: `milestones/v7.3-ROADMAP.md`, `milestones/v7.3-REQUIREMENTS.md`, `milestones/v7.3-MILESTONE-AUDIT.md`.

- [x] Phase 62: Worker Pool Core — Stream-JSON Transport (3 plans) — POOL-01..04, GUARD-01
- [x] Phase 63: Worker Lifecycle — Lazy Spawn / Idle Eviction / Crash Recovery / Cancellation (5 plans) — WLIFE-01..04 (live-proven 9/9)
- [x] Phase 64: Worker Hygiene — CLI Version Pinning + stderr Throttling (2 plans) — GUARD-02/03
- [x] Phase 65: Steady-State Latency, Crash-Survival Acceptance (1 plan) — PERF-01/02 (operator live-run 12/12)
- [x] Phase 66: Dashboard Latency Observability (5 plans incl. gap-closure 66-03/04/05) — PERF-03 (SC-1 green + SC-2 red live-proven)

</details>

### 📋 Next milestone (planned)

Run `/gsd-new-milestone` to scope the next milestone (questioning → research → requirements → roadmap). Out-of-milestone backlog phases tracked in STATE.md (e.g. Phase 54 ETM hardening, Phase 46 ONBOARDING.md operator UAT, the `999.1` shared-LLM-adapter extraction).

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 62. Worker Pool Core | v7.3 | 3/3 | Complete | 2026-06-21 |
| 63. Worker Lifecycle | v7.3 | 5/5 | Complete | 2026-06-21 |
| 64. Worker Hygiene | v7.3 | 2/2 | Complete | 2026-06-21 |
| 65. Acceptance | v7.3 | 1/1 | Complete | 2026-06-21 |
| 66. Dashboard Observability | v7.3 | 5/5 | Complete | 2026-06-21 |

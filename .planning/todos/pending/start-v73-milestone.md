---
id: start-v73-milestone
created: 2026-06-04
status: ready
priority: high
tags: [v7.3, milestone-kickoff, gsd-new-milestone]
discovered_in: /gsd-explore v7.3 perf measurement, 2026-06-04
prereqs_resolved: copilot-proxy-interception spike completed; cross-agent token-attribution contract designed
---

# Kick off v7.3 — Performance Measurement System milestone

## Action

Run `/gsd-new-milestone` for the **Performance Measurement System** milestone
(v7.3) using the corrected exploration synthesis + the token-attribution
contract as scoping input.

## Inputs to hand to /gsd-new-milestone

- **Scoping note:** `.planning/notes/v73-perf-measurement-exploration.md`
  — goal, in/out scope, all 7 architectural decisions, corrected D6 cross-agent
  table, and a proposed 9-phase shape sketch.
- **Architecture contract:** `.planning/notes/v73-token-attribution-contract.md`
  — storage contract (schema extension), measurement-span contract, per-agent
  adapter contract, task_id resolution rules, sub-agent linkage, granularity
  tier per agent.
- **Spike outcome:** `.planning/spikes/copilot-proxy-interception.md` — spike
  is complete; four-approach verdict table and recommendation live in the
  `## Findings` and `## Recommendation` sections.
- **Requirements memory:**
  `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_perf_measurement_requirements.md`
  — hard requirements (per-tool-call/per-step time-series, all four agents,
  proxy-tracked background services integrated on one timeline).

## Recommended order

1. The copilot-proxy-interception spike is complete; its outcome plus a
   broader telemetry survey produced the cross-agent token-attribution
   contract. No further blocking spike.
2. Run `/gsd-new-milestone v7.3` and hand it the four inputs above.
3. The milestone command routes into requirements / roadmap creation; the
   proposed 9-phase shape in the exploration note serves as a starting
   draft, not a commitment.

## Open Phase 1 tasks (carry into milestone roadmap)

These are unblocked by the contract but are still in-milestone work, not
prereqs:

- **Copilot events.jsonl event-vocabulary verification** — list distinct
  `type:` values; check whether per-turn or per-call usage payloads exist
  between `assistant.turn_start` and `assistant.turn_end`. Determines
  whether Copilot's granularity tier upgrades from `per-session-aggregate`
  to `per-turn`.
- **Mastra instrumentation surface read** — read `.opencode/mastra.json`
  and identify per-step middleware/observer hooks. Determines Mastra's
  granularity tier and adapter strategy.
- **Task taxonomy v0** — minimal list (refactor, bugfix, new-feature,
  migration, debug, docs) with definitions.

## Cross-refs

- [Note: v73-perf-measurement-exploration](../../notes/v73-perf-measurement-exploration.md)
- [Note: v73-token-attribution-contract](../../notes/v73-token-attribution-contract.md)
- [Spike: copilot-proxy-interception](../../spikes/copilot-proxy-interception.md)
- [Seed: v74-policy-engine](../../seeds/v74-policy-engine.md)

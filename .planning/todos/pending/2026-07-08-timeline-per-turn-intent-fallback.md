# Timeline per-turn "what it was doing" — context-turns preview fallback

**Created:** 2026-07-08
**Source:** Phase 84 Plan 09 operator refinement #3 (assessed, deferred)
**Route to:** Phase 86 — Timeline v2 + declutter
**Priority:** medium (UX parity; not a correctness bug)

## Symptom

The multi-agent Timeline (`integrations/system-health-dashboard/src/components/performance/timeline.tsx`)
renders `Development narrative — 0 intents linked to turns` for the Phase-84 live
measured span, and its per-turn rows do not state what each turn was doing — unlike
the context-cache explainer's per-turn table, which now shows a "what it was doing"
narrative for every turn.

## Investigation finding (why this is NOT a small render bug)

`timeline.tsx` ALREADY contains the full D-07 correlation machinery and renders it:

- `assignObservationsToTurns(rows, narrative)` (~line 228) ties each ETM observation
  to the latest turn within the run window.
- `linkDigestsToRun(digests, narrative)` (~line 266) ties digests by shared observation ids.
- `TurnObservations` (~line 135) renders the per-turn `Intent: …` line when an observation
  correlated to that turn.
- The `NarrativeStrip` (~line 373) shows `N intents linked to turns · M digests`.

So the correlation data path exists and works. `0 intents linked to turns` is **genuine**
for this span: an ad-hoc measured span produces no ETM observations (it is not a real
coding session). `timeline.tsx` line ~426 explicitly documents this as expected:
"No observations were recorded in this run's time window (expected for smoke/replay runs
— the narrative is populated by the knowledge pipeline during real coding sessions)."

## The actual gap (genuine Phase-86 work)

The explainer's per-turn table gets a "what it was doing" line even when no ETM
observation correlated, because it falls back to the **context-turns fresh user-input
preview** (`turnNote()` in `context-cache-explainer.tsx`: observation intent first,
else the last-user-message preview). The Timeline has no equivalent fallback — when
ETM observations are absent it shows nothing per-turn.

**Proposed Phase-86 change:** give `timeline.tsx` the same D-07 fallback — when a turn
has no correlated ETM observation, pull the fresh user-input preview from that turn's
context-turns row (via `selectContextTurnsFor(taskId)` / `fetchContextTurns`) and render
it with a `user input` provenance badge, exactly as the explainer does. This keeps the
Timeline honest (never fabricate an intent) while giving every turn a "what it was doing"
line. Fits the Phase-86 "Timeline v2 + declutter" scope.

## Files

- `integrations/system-health-dashboard/src/components/performance/timeline.tsx`
  (`assignObservationsToTurns`, `TurnObservations`, `TimelineRowCard`, `NarrativeStrip`)
- Reference implementation: `context-cache-explainer.tsx` → `turnNote()` + the per-turn
  narrative row (observation-intent-first, user-input-preview fallback, secret-scrubbed).

## Do NOT

- Do not fabricate ETM observations or intents for turns that were never observed.
- Do not build a brand-new timeline narrative feature in Phase 84 — this is Phase-86 scope.

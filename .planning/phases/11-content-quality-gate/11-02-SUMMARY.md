---
phase: 11-content-quality-gate
plan: 02
subsystem: pipeline
tags: [quality-gate, retry-loop, qa-feedback, wave-controller]

requires:
  - phase: 11-content-quality-gate
    plan: 01
    provides: QA agent validation after each wave's analyze step

provides:
  - Retry-with-feedback mechanism when QA rejects wave output
  - Single retry per wave capped to prevent loops
  - Better-scoring result selection (original vs retry)
---

## Summary

Added a coordinator feedback loop to the wave-controller: when QA rejects a wave's output (score < 60), the wave agent is retried once. The retry result is compared against the original — the higher-scoring output wins. This makes the Plan 01 QA gate actionable rather than informational.

## Key Changes

### wave-controller.ts
- Added `retryWaveWithFeedback()` private method — executes a retry function, returns `{ result, retried }` with error handling
- Added `buildQAFeedbackContext()` — formats QA errors into structured feedback string for logging
- Wired retry logic after each wave's QA validation (waves 1, 2, 3) — triggers when `qaReport.score < 60`
- Added `qa_retry` subPhase for dashboard visibility
- Capped at 1 retry per wave via boolean guard — no infinite loops possible

## Deviations

None. Plan executed as specified.

## Self-Check: PASSED

- [x] retryWaveWithFeedback method exists (4 references)
- [x] buildQAFeedbackContext method exists (2 references)
- [x] qa_retry subPhase wired (7 references)
- [x] QA retry triggered logging present (3 per wave)
- [x] TypeScript compiles cleanly
- [x] Build succeeds

## key-files

### created
(none — modifications only)

### modified
- `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts` — retry-with-feedback loop after QA rejection

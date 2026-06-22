---
phase: 69-claude-copilot-token-adapters
plan: 04
subsystem: lsl-token-adapters
tags: [copilot, token-usage, telemetry, extraction, adapter]
requires:
  - "lib/lsl/token/token-db.mjs (Plan 69-02 — ADAPTER_USER_HASH_COPILOT, INSERT contract)"
  - "src/live-logging/TranscriptNormalizer.js (Phase 51 — parseCopilot primitive)"
provides:
  - "lib/lsl/token/copilot-token-rows.mjs — buildCopilotTokenRows, checkCopilotVocabulary, warnOnVersionDrift, COPILOT_PROBED_VERSION"
  - "per-session-aggregate TokenUsageRow objects from session.shutdown.modelMetrics"
  - "version-keyed (v1.0.63) event-vocabulary verdict (per-session-aggregate)"
affects:
  - "Plan 69-06 (DB INSERT + live/sweep daemon wiring will consume these row builders)"
tech-stack:
  added: []
  patterns:
    - "Pure extraction layer on top of locked parsers (no DB, no daemon wiring)"
    - "Coalesce-every-numeric (?? 0) to prevent NaN/null in NOT-NULL columns"
    - "uid-check fail-closed file read + per-line JSON.parse try/catch"
    - "Version-keyed capability verdict with inert upgrade branch"
key-files:
  created:
    - "lib/lsl/token/copilot-token-rows.mjs"
    - "tests/token-adapters/copilot-token-rows.test.js"
    - "tests/token-adapters/copilot-vocab.test.js"
  modified: []
decisions:
  - "D-04 honored: per-session-aggregate is the only emitted tier, one row per model from session.shutdown.modelMetrics"
  - "D-09 honored: verdict baked to v1.0.63; per-turn upgrade branch present but inert"
  - "parseCopilot reused as recognized-primitive gate; raw JSON.parse reads the event type discriminator because parseCopilot returns null for session.shutdown (Rule 1 deviation, documented)"
metrics:
  duration: "~10 min"
  completed: "2026-06-22"
  tasks: 2
  files: 3
requirements: [ADAPT-02]
---

# Phase 69 Plan 04: Copilot Token-Row Extraction + Vocabulary Check Summary

Copilot `events.jsonl` → per-session-aggregate `TokenUsageRow` objects sourced from `session.shutdown.modelMetrics` (one row per model, all numerics coalesced), plus the Phase-1 event-vocabulary check that bakes the version-keyed v1.0.63 verdict (`per-session-aggregate`) with an inert per-turn upgrade branch — a pure extraction layer; DB INSERT and daemon wiring land in Plan 06.

## What Was Built

**Task 1 — `buildCopilotTokenRows(eventsJsonlPath, ctx)`** (`lib/lsl/token/copilot-token-rows.mjs`)
- Streams the events file line-by-line, emitting one `granularity_tier='per-session-aggregate'` row per entry in `data.modelMetrics` on the `session.shutdown` event.
- Every numeric field coalesced via `num(... ?? 0)`: `input_tokens`, `output_tokens`, `total_tokens = input + output`, and `reasoning_tokens = num(usage.reasoningTokens)`. A model whose `usage` omits `reasoningTokens` (the fixture's `claude-sonnet-4.6`) writes `reasoning_tokens=0`, never NaN/null (Pitfall 5 / T-69-input).
- Copilot's `reasoningTokens` is native (unlike Claude's estimate), so `tokens_estimated` stays `0`.
- Row shape matches the Phase-68 contract: `agent='copilot'`, `provider='copilot'`, `process='token-adapter-copilot'`, `tool_call_id=model`, `user_hash=ADAPTER_USER_HASH_COPILOT` ('copadt'), `parent_call_id=''`, `task_id=''` (caller stamps in Plan 06).
- `reasoningOpaque` is never decoded (V6 / T-69-crypto).

**Task 2 — `checkCopilotVocabulary` + `warnOnVersionDrift` + `COPILOT_PROBED_VERSION`** (same module)
- `checkCopilotVocabulary(eventsJsonlPath)` enumerates the distinct event `type:` values (first-seen order) and returns `{ types, perTurnUsagePresent, verdict }`. `perTurnUsagePresent` is true only if an `assistant.*` event carries an `inputTokens`/`outputTokens` payload — which v1.0.63 does NOT — so the verdict is `per-session-aggregate` (D-04). The `verdict='per-turn'` upgrade branch is reachable (proven by a synthetic future-CLI fixture in the test) but inert on v1.0.63 data (D-09).
- `warnOnVersionDrift(installedVersion)` emits `[token-adapter-copilot] CLI version drift: installed=<x> probed=1.0.63 — re-run vocabulary check` to stderr when the installed version differs; silent on a match (Pitfall 3).
- `COPILOT_PROBED_VERSION = '1.0.63'`.

## Security / Robustness

- **uid-check fail-closed** (`readOwnedFile`): non-owned events.jsonl → `[]` / empty vocabulary (T-69-traversal).
- **Per-line `JSON.parse` try/catch**: a malformed line is skipped, never aborts the pass (T-69-dos).
- **Parameterized DB binds** are out of scope here (no DB touch); this module only produces row objects.
- **`reasoningOpaque` never decoded** anywhere — the only two references are comments stating it is ignored (V6).
- **`process.stderr.write` only** — zero `console.log` (CLAUDE.md no-console-log).

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 1 — parser-capability mismatch] `parseCopilot` cannot surface `session.shutdown`**
- **Found during:** Task 1.
- **Issue:** The plan's key-link mandates reusing `parseCopilot` (no new JSONL parser), but `parseCopilot` (TranscriptNormalizer.js:227-320) returns `null` for `session.shutdown` (it only surfaces conversation-content + sub-agent records) and also discards `assistant.turn_start`/`turn_end` — the exact events the modelMetrics aggregate and the vocabulary enumeration need.
- **Fix:** `parseCopilot(line)` is still invoked on every line as the recognized-primitive gate (satisfies the locked reuse contract — `grep -c parseCopilot` = 8), while the event `type` discriminator and `modelMetrics` are read from the same line via a single raw `JSON.parse`. No second/parallel JSONL parser is introduced; this is the minimum raw access required because the canonical primitive intentionally drops lifecycle events. Documented in the module header.
- **Files modified:** `lib/lsl/token/copilot-token-rows.mjs`.
- **Commits:** f15be5b6e, a2a13ff43.

**2. [Plan-staleness] No `v1.0.48` docstring to refresh in `copilot-events.mjs`**
- **Found during:** Task 2.
- **Issue:** Task 2's `<read_first>` and acceptance (`grep -c "v1.0.48" lib/lsl/adapters/copilot-events.mjs == 0`) assumed stale `v1.0.48` docstrings at copilot-events.mjs:18/78 needing a refresh.
- **Resolution:** `copilot-events.mjs` already contains **zero** `v1.0.48` references (the plan's interface-block line refs were stale). The acceptance grep is satisfied as-is — no edit required. The remaining `v1.0.48` references live in `src/live-logging/TranscriptNormalizer.js` (out of this plan's `files_modified`); they are factual notes about when the dotted-event-name format first appeared (not the per-turn-usage verdict), so they are accurate and intentionally left untouched.
- **Files modified:** none.

## Verification

- `npx jest tests/token-adapters/copilot-token-rows.test.js` → 3/3 pass.
- `npx jest tests/token-adapters/copilot-vocab.test.js` → 5/5 pass.
- Acceptance greps: `parseCopilot` ≥1 (8), `per-session-aggregate` ≥1 (6), `reasoningOpaque` only in ignore-comments, non-comment `console.log` == 0, `COPILOT_PROBED_VERSION = '1.0.63'` matches, `v1.0.48` in copilot-events.mjs == 0.
- The reasoningTokens-absent model (`claude-sonnet-4.6`) is asserted to yield `reasoning_tokens === 0`; the present one (`claude-opus-4.6`) preserves `115`.

## TDD Gate Compliance

Both tasks followed RED → GREEN:
- Task 1: test 2724a21b4 (RED, module missing) → feat f15be5b6e (GREEN).
- Task 2: test 605d6ed42 (RED, functions missing) → feat a2a13ff43 (GREEN).

No REFACTOR commit was needed (implementations were clean on first GREEN).

## Known Stubs

None. `task_id=''` on emitted rows is an intentional contract boundary (the caller stamps it in Plan 06), documented in the module and the Phase-69 CONTEXT (D-03) — not a stub.

## Commits

- `2724a21b4` test(69-04): add failing per-session-aggregate row extraction test
- `f15be5b6e` feat(69-04): per-session-aggregate row extraction from modelMetrics (D-04)
- `605d6ed42` test(69-04): add failing Phase-1 vocabulary-check assertion (D-04/D-09)
- `a2a13ff43` feat(69-04): Phase-1 vocabulary check + version-keyed verdict (D-04/D-09)

## Self-Check: PASSED

All created files present on disk; all task + summary commits found in git history.

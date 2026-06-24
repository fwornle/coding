---
phase: 72-syntactic-route-quality
plan: 03
subsystem: experiments
tags: [route-quality, route-event, route-reader, claude, copilot, tdd, zero-llm]
requires:
  - "lib/lsl/route/route-event.mjs (RouteEvent typedef + OUTCOMES + inputsDigest) — Plan 72-01"
provides:
  - "lib/lsl/route/claude-route-trace.mjs — buildClaudeRouteTrace(jsonlPath) → RouteEvent[] (Claude tool_use/tool_result slice)"
  - "lib/lsl/route/copilot-route-trace.mjs — buildCopilotRouteTrace(eventsJsonlPath) → RouteEvent[] (Copilot tool.execution_* slice)"
  - "tests/fixtures/route/claude-tooluse-sample.jsonl — real-shape Claude tool-call fixture"
  - "tests/fixtures/route/copilot-toolevents-sample.jsonl — real-shape Copilot tool-events fixture"
  - "tests/experiments/route-readers.test.mjs — node:test reader suite (ownedCopy uid-gate mechanic)"
affects:
  - "Plan 72-05 (measurement-stop) calls these readers to build RouteEvent[] before computeHeuristics"
  - "Plan 72-04 (opencode reader) emits against the SAME RouteEvent contract these prove against"
tech-stack:
  added: []
  patterns:
    - "Reuse-not-reimplement: uid-check + per-line JSON.parse gates copied VERBATIM from the Phase-69 token adapters (RESEARCH Anti-Patterns / Pitfall 3)"
    - "parseCopilot recognized-primitive gate (TranscriptNormalizer.js) invoked per line; discriminator read from raw line (no parallel parser)"
    - "node:test + node:assert/strict (tests/experiments/ convention, NOT jest); ownedCopy tmpdir mechanic for the uid gate"
key-files:
  created:
    - lib/lsl/route/claude-route-trace.mjs
    - lib/lsl/route/copilot-route-trace.mjs
    - tests/experiments/route-readers.test.mjs
    - tests/fixtures/route/claude-tooluse-sample.jsonl
    - tests/fixtures/route/copilot-toolevents-sample.jsonl
  modified: []
decisions:
  - "Claude: ends keyed by tool_use_id, first terminal wins; outcome = !end?abandoned : is_error?error : success"
  - "Copilot: ends keyed by toolCallId, first terminal wins; outcome = !end?abandoned : success===true?success : error (denied folds into error, v0/A4)"
  - "target_path: Claude input.file_path; Copilot arguments.file_path ?? arguments.filePath; null otherwise (Bash/Grep → null)"
  - "tool_name read defensively: Copilot data.toolName ?? data.name ('' fallback) to span the v1.0.63 spec + on-disk variant"
  - "Copilot is NOT pre-nulled — a present events.jsonl yields a full RouteEvent[]; D-02 null is the locate-failure fallback only"
metrics:
  duration: ~10 min
  completed: 2026-06-24
  tasks: 2
  files: 5
  tests: 6
---

# Phase 72 Plan 03: Claude + Copilot Normalized-Route-Trace Readers Summary

Two per-agent readers that emit the Plan-01 cross-agent `RouteEvent[]` (D-01) from the DISJOINT tool-call slice of the SAME session files the Phase-69 token adapters read but skip — Claude `tool_use`/`tool_result` blocks and Copilot `tool.execution_start`/`tool.execution_complete` events. Both reuse only the file-location + uid + line-primitive gates (verbatim) and feed the six syntactic heuristics; Copilot is NOT pre-nulled.

## What Was Built

**Task 1 — `lib/lsl/route/claude-route-trace.mjs` (RED `e64e9d8f2` → GREEN `609bda53a`)**
- `buildClaudeRouteTrace(jsonlPath)` walks `rec.message.content[]` (with a `rec.content[]` fallback): a `starts` array of `tool_use` blocks (encounter order, D-07 — parallel same-turn never collapsed) and an `ends` Map keyed by `tool_use_id` (`{ ts, is_error }`).
- Emits one `RouteEvent` per `tool_use`: `seq` 0-based ascending, `tool_call_id=id`, `tool_name=name`, `inputs_digest=inputsDigest(input)`, `target_path = input.file_path ?? null`, `started_at = rec.timestamp`, `ended_at = end?.ts ?? null`, `outcome = !end ? 'abandoned' : is_error ? 'error' : 'success'`, `agent='claude'`.
- uid-check gate (claude-token-rows.mjs:82-101) and per-line `JSON.parse` try/catch (:145-153) copied VERBATIM — non-owned → `[]` (T-72-03-FI), malformed line → skip (T-72-03-DOS).
- Imports `SUBAGENT_PATH_RE`/`parentSessionFromClaudeSubagentPath` (adapters/claude-jsonl-tree.mjs) and `inputsDigest`/`OUTCOMES` (route-event.mjs). Zero `console.*`.

**Task 2 — `lib/lsl/route/copilot-route-trace.mjs` (GREEN `fa793b379`)**
- `buildCopilotRouteTrace(eventsJsonlPath)` reuses `readOwnedFile()` (copilot-token-rows.mjs:83-110, verbatim) for the uid-check fail-closed read (null → reader returns `[]`), invokes `parseCopilot` per line as the recognized-primitive gate (key-link), and reads the `evt.type` discriminator from the raw line via its own `JSON.parse` try/catch.
- `tool.execution_start` → `starts` (keyed encounter order), `tool.execution_complete` → `ends` Map keyed by `data.toolCallId` (`{ ts, success }`). Matching is by `toolCallId`, NOT positional.
- Emits one `RouteEvent` per start: `outcome = !end ? 'abandoned' : success===true ? 'success' : 'error'` (denied folds into error, v0/A4), `inputs_digest=inputsDigest(arguments)`, `target_path = arguments.file_path ?? arguments.filePath ?? null`, `agent='copilot'`, seq 0-based. Zero `console.*`.

**Fixtures + suite**
- `tests/fixtures/route/claude-tooluse-sample.jsonl`: 2 success pairs (Read/Edit), 1 error pair (Bash is_error), 1 abandoned `tool_use` (Grep, no result), 1 parallel-same-turn assistant record (2 Read tool_use → 2 events).
- `tests/fixtures/route/copilot-toolevents-sample.jsonl`: 2 success pairs (read/edit), 1 failure pair (bash success:false), 1 abandoned start (grep, no complete).
- `tests/experiments/route-readers.test.mjs`: 6 node:test cases (per reader: full-trace field/outcome assertions incl. abandoned + parallel-same-turn + toolCallId matching, non-owned → [], malformed-line skip), using the `ownedCopy` tmpdir mechanic so the uid gate passes.

## Verification

- `node --test tests/experiments/route-readers.test.mjs` → 6/6 pass, 2 suites, 0 fail.
- `grep -n "tool_use\|tool_result" lib/lsl/route/claude-route-trace.mjs` confirms the tool-call slice (NOT `usage`).
- `grep -n "st.uid !==" lib/lsl/route/claude-route-trace.mjs` confirms the uid gate copied verbatim.
- `grep -n "execution_start\|execution_complete" lib/lsl/route/copilot-route-trace.mjs` confirms the per-tool slice (NOT `session.shutdown`).
- `grep -n "parseCopilot" lib/lsl/route/copilot-route-trace.mjs` confirms the recognized-primitive gate.
- `grep -c "console\."` returns 0 for both readers.
- Standalone Claude-reader trace dump confirmed: read=success, edit=success, bash=error, grep=abandoned(ended_at=null), par_a/par_b=2 separate success events with distinct seq.

## Deviations from Plan

None — plan executed as written.

- The plan's Task-1 `<verify>` runs the shared suite, which imports BOTH readers. The RED commit (test + fixtures) failed with `ERR_MODULE_NOT_FOUND` (both modules absent) — the correct plan-level RED. Task 1's GREEN module was committed after a standalone node-eval trace dump confirmed all six events; the full 6/6 suite ran green only after Task 2's module landed (shared import). This is inherent to the one-suite-two-readers structure the plan specifies and not a behavioral deviation.
- Copilot `tool_name` is read as `data.toolName ?? data.name` (defensive): the plan interface specifies `data.toolName`, while the Phase-69 on-disk Copilot fixture uses `data.name`. The fallback spans both without changing the contract. (Rule 2 — robustness against the confirmed on-disk variant.)

## TDD Gate Compliance

Plan is `type: tdd`. Gate sequence verified in git log:
- RED: `test(72-03): add failing route-readers suite + per-agent fixtures (RED)` (`e64e9d8f2`) — suite failed (both reader modules absent).
- GREEN (Task 1): `feat(72-03): implement buildClaudeRouteTrace ... (GREEN)` (`609bda53a`).
- GREEN (Task 2): `feat(72-03): implement buildCopilotRouteTrace ... (GREEN)` (`fa793b379`) — full 6/6 pass.
- REFACTOR: not needed (implementation clean at GREEN).

## Self-Check: PASSED

Created files verified on disk:
- FOUND: lib/lsl/route/claude-route-trace.mjs
- FOUND: lib/lsl/route/copilot-route-trace.mjs
- FOUND: tests/experiments/route-readers.test.mjs
- FOUND: tests/fixtures/route/claude-tooluse-sample.jsonl
- FOUND: tests/fixtures/route/copilot-toolevents-sample.jsonl

Commits verified in git log:
- FOUND: e64e9d8f2 (RED)
- FOUND: 609bda53a (Task 1 GREEN)
- FOUND: fa793b379 (Task 2 GREEN)

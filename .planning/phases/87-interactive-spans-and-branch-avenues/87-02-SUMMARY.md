---
phase: 87-interactive-spans-and-branch-avenues
plan: 02
subsystem: experiments / knowledge-injection
tags: [avenues, spec-model, knowledge-injection, env-axis, AVN-03, AVN-04]
requires:
  - lib/experiments/experiment-spec.mjs (expandAxes / validateCells / makeCell)
  - lib/experiments/agent-headless.mjs (mastracode literal via AGENT_CONFIG_FILE)
  - lib/experiments/route-trace-resolve.mjs (KNOWN_AGENTS SoT for drift test)
  - src/hooks/knowledge-injection-hook.js (Claude UserPromptSubmit seam)
  - scripts/launch-agent-common.sh (_inject_knowledge_context — non-Claude seam)
provides:
  - "mastracode as a legal avenue agent in KNOWN_AGENTS (spec is a superset of route-trace)"
  - "kb-on/kb-off env-axis vocabulary documented in experiment-spec (no 5th cell key)"
  - "CODING_KNOWLEDGE_INJECTION per-process off-guard at BOTH injection seams"
affects:
  - Plan 03 (runner): maps env==='kb-off' → CODING_KNOWLEDGE_INJECTION=0 in agent child env
  - Plan 04 (picker): surfaces the mastra→mastracode display mapping + kb toggle
tech-stack:
  added: []
  patterns:
    - "injection encoded in existing env axis (kb-on/kb-off) — avoids Pitfall 3 5th-key drop"
    - "env-var guard is per-process (reads process.env) — Pitfall 4 scoping"
    - "spec agent enum is a SUPERSET of route-trace family set (mastra self-routed)"
key-files:
  created:
    - tests/experiments/injection-env.test.mjs
  modified:
    - lib/experiments/experiment-spec.mjs
    - tests/experiments/experiment-spec.test.mjs
    - src/hooks/knowledge-injection-hook.js
    - scripts/launch-agent-common.sh
decisions:
  - "mastracode added to spec KNOWN_AGENTS as a superset entry (route-trace unchanged — mastra is self-routed, no trace family); drift test relaxed from strict-equality to superset"
  - "knowledge-injection toggle encoded in the existing env key as kb-on/kb-off, NOT a new cell key (Pitfall 3)"
  - "guard default is ON; only literal 0/false/off (trimmed, case-insensitive) disables, so the operator's interactive session (var unset) is never affected (Pitfall 4)"
metrics:
  tasks-completed: 2
  files-created: 1
  files-modified: 4
  tests-passing: 28
  completed: 2026-07-11
---

# Phase 87 Plan 02: Spec-axis + injection-seam readiness for D-03 avenues Summary

Made the experiment spec model and the knowledge-injection seam ready for the D-03 avenue axes: `mastracode` is now a legal avenue agent (AVN-03), the knowledge-injection on/off axis is encoded in the existing `env` cell field as `kb-on`/`kb-off` (avoiding the Pitfall-3 5th-key contract break), and a per-process `CODING_KNOWLEDGE_INJECTION` off-guard is wired at both injection seams (Claude UserPromptSubmit hook + the bash injector for opencode/copilot/mastra), scoped so the operator's interactive session is never disabled (AVN-04).

## What Was Built

### Task 1 — mastracode enum + kb-on/kb-off env-axis vocabulary (TDD)
- Added `'mastracode'` to the frozen `KNOWN_AGENTS` in `experiment-spec.mjs` — the literal matching `argvForAgent`/`AGENT_CONFIG_FILE` in `agent-headless.mjs`. A mastra avenue cell now PASSES `validateCells` instead of hard-blocking; an unknown agent still fail-fasts and the error lists the legal set (now including `mastracode`).
- Documented `kb-on` / `kb-off` as the canonical injection-axis vocabulary in the module header — the runner (Plan 03) maps `env === 'kb-off'` → injection disabled. No 5th cell key added; `makeCell` still destructures exactly `agent, model, framework, env, test_command` (Pitfall 3 held — verified by grep + test).
- TDD RED→GREEN: failing tests committed first (`b9eed21c6`), then implementation (`8e24be8d3`).

### Task 2 — CODING_KNOWLEDGE_INJECTION off-guard at both seams (AVN-04)
- `src/hooks/knowledge-injection-hook.js`: new `isInjectionEnabled()` helper + an early return at the very top of `main()`, BEFORE `callRetrieval`. When disabled, the hook emits no `additionalContext` and makes no retrieval call.
- `scripts/launch-agent-common.sh` `_inject_knowledge_context()`: an early `return 0` when the var is off — one guard covers opencode/copilot/mastra, placed before the per-agent adapter lookup.
- `tests/experiments/injection-env.test.mjs`: spawns the REAL hook as a child process against a local stub retrieval server and proves (a) `=0` → server not hit + empty output, (b) unset → server hit + knowledge injected, (c) `off` word form also disables. The delta between (a) and (b) is only the env var → the guard is per-process, not global (Pitfall 4 scoping proof).

## Verification Results

- `node --test tests/experiments/experiment-spec.test.mjs` — 25/25 green (mastracode legal, unknown still blocks, kb-on/kb-off expands to 2 cells, 5-key contract held, superset drift check).
- `node --test tests/experiments/injection-env.test.mjs` — 3/3 green (off → no retrieval/empty; unset → retrieval + injection; scoping proven).
- Combined: 28/28 tests passing.
- `bash -n scripts/launch-agent-common.sh` — syntax OK; standalone smoke confirms `=0` and `=off` early-return, unset falls through to the normal adapter path.
- No NEW raw `console.*` in the JS hook (existing `process.stderr.write` error idiom preserved — CLAUDE.md constraint honoured).

Acceptance greps (all satisfied):
- `mastracode` present inside `KNOWN_AGENTS` in `experiment-spec.mjs`.
- `kb-on|kb-off` documented in `experiment-spec.mjs`.
- Exactly one `function makeCell` with the unchanged 5-key destructure.
- `CODING_KNOWLEDGE_INJECTION` guard in the hook precedes `callRetrieval` (line 130 < line 192).
- `CODING_KNOWLEDGE_INJECTION` guard inside `_inject_knowledge_context`.

## Threat Model Compliance

- **T-87-02-01 (Tampering, agent field):** mitigated — `mastracode` added to the frozen allowlist; `validateCells` still fail-fast-rejects any agent not in the enum, so no arbitrary literal reaches argv.
- **T-87-02-02 (Info disclosure / scope leak, global Claude hook):** mitigated — the off-guard is env-var-scoped to the spawned avenue child; the unit test proves the default (unset) path still injects, so the operator's interactive session is never disabled (Pitfall 4).
- **T-87-02-03 (Tampering, 5th-key drop):** mitigated — injection encoded in the existing `env` key; grep + test assert the 5-key `makeCell` destructure is unchanged (Pitfall 3).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Drift test relaxed from strict-equality to superset**
- **Found during:** Task 1 (GREEN)
- **Issue:** The existing test `KNOWN_AGENTS equals the route-trace-resolve SoT set` asserts strict equality between `experiment-spec.mjs` `KNOWN_AGENTS` and `route-trace-resolve.mjs` `KNOWN_AGENTS`. Adding `mastracode` to the spec enum (per the plan) would break this test. Adding `mastracode` to route-trace-resolve would be wrong: route-trace's set is the family of agents whose SPAN TRACES the route readers understand, and mastra is self-routed (`MASTRACODE_MODEL_ID → rapid-proxy-mastra`) with no separate trace-locator family.
- **Fix:** Relaxed the test to assert a SUPERSET relationship — every route-trace agent must remain spec-legal (no silent drop of a trace-known agent), and the ONLY spec-only agent is `mastracode`. Documented the superset rationale in the `experiment-spec.mjs` header. This preserves drift protection (a new route-trace agent that is not spec-legal still fails; any second spec-only agent still fails) while allowing the intended `mastracode` addition.
- **Files modified:** `tests/experiments/experiment-spec.test.mjs`, `lib/experiments/experiment-spec.mjs`
- **Commit:** `8e24be8d3`

## Known Stubs

None. Both seams are fully wired; the env-axis→env-var mapping is consumed by Plan 03 (runner) as documented — that is a downstream-plan handoff, not a stub.

## Self-Check: PASSED
- FOUND: lib/experiments/experiment-spec.mjs
- FOUND: tests/experiments/experiment-spec.test.mjs
- FOUND: src/hooks/knowledge-injection-hook.js
- FOUND: scripts/launch-agent-common.sh
- FOUND: tests/experiments/injection-env.test.mjs
- FOUND commit: b9eed21c6 (test RED)
- FOUND commit: 8e24be8d3 (feat GREEN — Task 1)
- FOUND commit: 8185deef1 (feat — Task 2)

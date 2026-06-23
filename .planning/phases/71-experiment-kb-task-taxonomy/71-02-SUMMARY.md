---
phase: 71-experiment-kb-task-taxonomy
plan: 02
subsystem: infra
tags: [task-taxonomy, yaml, js-yaml, keyword-scorer, enforcement, zero-llm]

# Dependency graph
requires: []
provides:
  - "config/task-taxonomy.yaml — closed-6 task taxonomy v0 single source of truth (D-10): version + per-class definition + keywords"
  - "lib/experiments/taxonomy.mjs — loadTaxonomy() / isValidClass() (D-09 closed-6 write-path enforcement, SC-4 primitive) / deriveClassFromText() (D-11 zero-LLM verb→class heuristic)"
  - "tests/experiments/taxonomy.test.mjs — SC-3 proof suite (6 defs + verb→class map + free-string rejection)"
affects: [71-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Closed-enum allowlist enforcement primitive (isValidClass) — rejects the quarantine sentinel + all free strings before any write"
    - "Zero-LLM deterministic keyword scorer: hyphenated/multiword keywords matched as substrings (+2), bare keywords on the tokenized word set (+1)"
    - "YAML config single-source-of-truth read by both the validator and the derivation heuristic (D-10)"

key-files:
  created:
    - config/task-taxonomy.yaml
    - lib/experiments/taxonomy.mjs
    - tests/experiments/taxonomy.test.mjs
  modified: []

key-decisions:
  - "deriveClassFromText returns { taskClass, confident } (confident = bestScore >= 1) per the RESEARCH skeleton verbatim; null/false on zero keyword hits"
  - "isValidClass rejects non-string / empty / null / undefined defensively in addition to the closed-6 allowlist — the write-path must never coerce a falsy free value into a valid class"
  - "loadTaxonomy resolves config/task-taxonomy.yaml relative to import.meta.url (two levels up from lib/experiments/), so it works regardless of caller cwd"

patterns-established:
  - "Closed-6 enforcement: isValidClass(cls, taxonomy?) — allowlist from the parsed taxonomy class keys when supplied, else the static CLOSED_6; the SC-4 partition-integrity guard"
  - "Verb→class derivation: lowercase + tokenize on /[a-z][a-z-]+/g; hyphenated kw substring scores +2, bare kw token-set hit scores +1; highest score wins"

requirements-completed: [KB-03]

# Metrics
duration: ~14min
completed: 2026-06-23
---

# Phase 71 Plan 02: Experiment KB Task Taxonomy Summary

**Closed-6 task taxonomy v0 (refactor/bugfix/new-feature/migration/debug/docs) as a YAML single-source-of-truth plus a pure taxonomy module exporting the D-09 closed-6 write-path enforcer (isValidClass) and the D-11 zero-LLM verb→class keyword scorer (deriveClassFromText), proven by a 9-test node:test suite.**

## Performance

- **Duration:** ~14 min
- **Completed:** 2026-06-23T13:42:15Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- `config/task-taxonomy.yaml` — `version: 0` + exactly the closed-6 classes, each with a non-empty definition and disambiguation keywords; the D-10 single source of truth read by the validator, the heuristic, and docs. No `unclassified` (that is the quarantine sentinel, not a member).
- `lib/experiments/taxonomy.mjs` — three pure, deterministic exports: `loadTaxonomy()` (YAML parse → `{ version, classes }`), `isValidClass()` (closed-6 allowlist; rejects `unclassified` + any free string — the SC-4 write-path enforcement primitive), `deriveClassFromText()` (zero-LLM keyword scorer per the RESEARCH skeleton).
- `tests/experiments/taxonomy.test.mjs` — 9-test node:test suite proving SC-3: 6 defs load, isValidClass rejects free strings, and deriveClassFromText maps `migrate→migration`, `fix…bug→bugfix`, `add new→new-feature`, gibberish→null, plus docs/debug coverage and a determinism check.

## Task Commits

Each task was committed atomically (Task 2 followed the TDD RED→GREEN cycle):

1. **Task 1: Author config/task-taxonomy.yaml** - `627cc39eb` (feat)
2. **Task 2 (RED): Failing taxonomy test** - `115efe30c` (test)
3. **Task 2 (GREEN): Implement taxonomy.mjs** - `b5b592a78` (feat)

_No REFACTOR commit — the GREEN implementation was already minimal and clean._

## Files Created/Modified
- `config/task-taxonomy.yaml` - closed-6 taxonomy v0 SoT (version + per-class definition + keywords)
- `lib/experiments/taxonomy.mjs` - loadTaxonomy() / isValidClass() / deriveClassFromText()
- `tests/experiments/taxonomy.test.mjs` - SC-3 proof suite (9 tests)

## Decisions Made
- Used the RESEARCH §"task-taxonomy.yaml" content and §"verb→class heuristic" scorer skeleton verbatim, as the plan directed.
- `isValidClass` defensively rejects non-string / empty / null / undefined in addition to the allowlist check, so the write-path can never coerce a falsy free value into a valid class.
- `loadTaxonomy` resolves the default config path from `import.meta.url` (repo-root-relative), making it cwd-independent for any future CLI/orchestrator consumer.

## Deviations from Plan
None - plan executed exactly as written.

## TDD Gate Compliance
Task 2 (`tdd="true"`) followed the full cycle:
- RED gate: `test(71-02): add failing test...` — `115efe30c` (suite failed on missing module import, confirmed before implementation)
- GREEN gate: `feat(71-02): implement lib/experiments/taxonomy.mjs...` — `b5b592a78` (9/9 pass, exit 0)
- REFACTOR: not needed (implementation minimal).

## Issues Encountered
None. Verified `js-yaml` (a declared root dependency) and `yaml` both resolve via `node -e require(...)` before relying on them — the threat model (T-71-02-02) confirmed no new package installs were required.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The two enforcement/derivation primitives are unit-proven and ready for the 71-05 close orchestrator (`isValidClass` for the closed-6 run-end enforcement / quarantine routing) and the classify CLI (`deriveClassFromText` for the /gsd zero-LLM derivation).
- `loadTaxonomy()` gives both consumers a single cwd-independent reader over the D-10 source of truth.

## Self-Check: PASSED
- FOUND: config/task-taxonomy.yaml
- FOUND: lib/experiments/taxonomy.mjs
- FOUND: tests/experiments/taxonomy.test.mjs
- FOUND commit: 627cc39eb
- FOUND commit: 115efe30c
- FOUND commit: b5b592a78

---
*Phase: 71-experiment-kb-task-taxonomy*
*Completed: 2026-06-23*

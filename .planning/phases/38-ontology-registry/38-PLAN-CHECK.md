# Phase 38 — Plan Check

**Date:** 2026-05-20
**Checker:** gsd-plan-checker
**Plans verified:** 6 (38-01..38-06)
**Phase goal:** Land single `OntologyRegistry` in `@fwornle/km-core` closing SC#1–SC#4.

---

## PLAN CHECK CONCERNS

One BLOCK + four FLAGs. The phase goal is achievable from the plans as written, but the wave-2 same-file collision MUST be resolved before execution or the orchestrator will silently corrupt the root barrel.

---

## Findings (by severity)

### BLOCK-1 — Wave 2 same-file collision on `src/index.ts`

- **Dimension:** dependency_correctness / wave assignment
- **Plans:** 38-03 and 38-04 (both wave 2, both `depends_on: [38-01]` only)
- **Evidence:** Both plans list `/Users/Q284340/Agentic/km-core/src/index.ts` under `files_modified` and both append distinct export lines to the same root barrel.
  - 38-03 Task 2: appends `OntologyRegistry`, `OntologyRegistryOptions`, `loadOntologyFile`, and four type re-exports.
  - 38-04 Task 2: appends `registryBackedValidator` to the same file.
- **Why this blocks:** Plans declared parallel in the same wave with overlapping `files_modified` violate the parallel-execution contract. If the orchestrator launches them in separate worktrees, the merge will conflict on the appended lines. If launched sequentially in the same worktree, the second runner must re-read the file (38-04 even acknowledges this with a conditional "may already have been modified by Plan 03" hedge), which is a code smell that the wave assignment is wrong.
- **Plan 04 self-admission:** Plan 04 Task 1 acceptance includes "if Plan 03 has not yet landed registry.ts when this task verifies, … the executor of Plan 04 must wait for Plan 03 to land. Per the wave structure, both are wave 2 and depend on Plan 01; the orchestrator may run them sequentially." This is the planner anticipating the bug without fixing it.
- **Fix path (planner picks one):**
  1. Add `38-03` to Plan 04's `depends_on` and reassign Plan 04 to wave 3 (alongside Plan 05). Plan 05's `depends_on: [38-03, 38-04]` already encodes the strict order; adding 04→03 makes the wave graph consistent.
  2. Move the `src/index.ts` barrel edit out of Plan 03 Task 2 into Plan 04 Task 2 (consolidate all root-barrel appends into Plan 04). Plan 03 Task 2 then only creates the sub-barrel `src/ontology/index.ts`.
  3. Add an explicit serial-within-wave note declaring 38-03 → 38-04 ordering, but this requires orchestrator support and is the weakest option.
- **Recommendation:** Option 1 (cheapest — single-line frontmatter edit). Option 2 is structurally cleaner but moves work between plans.

### FLAG-1 — `package.json` exports map lacks `./ontology` sub-path

- **Dimension:** key_links_planned / external surface
- **Plan:** 38-03 Task 2
- **Evidence:** `/Users/Q284340/Agentic/km-core/package.json` `exports` field contains ONLY `.` (root). Plan 03 acceptance criterion includes "External-consumer smoke compile … `import { OntologyRegistry } from '@fwornle/km-core/ontology'` (sub-path resolution if exports map allows it; otherwise only the root import is asserted)."
- **Why this is a flag, not a block:** The plan provides explicit escape hatches (a) extend exports map in same commit OR (b) document the limitation in SUMMARY. The sub-barrel still works for internal imports, and the root barrel re-export (`import { OntologyRegistry } from '@fwornle/km-core'`) covers the consumer-facing surface.
- **Executor note:** Pick option (a) — adding `"./ontology": { "types": "./dist/ontology/index.d.ts", "import": "./dist/ontology/index.js" }` is a 4-line addition to package.json. Do not silently take option (b) and call done.

### FLAG-2 — Plan 06 Task 1 reload-verify command operator precedence

- **Dimension:** task_completeness / verify command brittleness
- **Plan:** 38-06 Task 1 `<verify><automated>` line
- **Evidence:** The verify command ends with `… && grep -qF "await registry.reload()" tests/unit/ontology-registry.test.ts || grep -qF "await reg.reload()" tests/unit/ontology-registry.test.ts && echo OK`. Shell operator precedence means `echo OK` is gated by the OR-branch's second grep; if the first grep succeeds, the OR short-circuits and `echo OK` does not fire — the command exits 0 silently. If the first grep fails AND the second succeeds, `echo OK` fires. The asymmetric "OK" emission makes downstream automation that grep-checks for "OK" produce false negatives.
- **Fix path:** Wrap the OR in parentheses: `&& ( grep -qF "await registry.reload()" tests/… || grep -qF "await reg.reload()" tests/… ) && echo OK`. Or pick one canonical variable name (`registry`) and assert only that.
- **Severity:** FLAG — the test will still run; only the "OK" sentinel is brittle.

### FLAG-3 — Plan 03 Task 1 acceptance criterion regex over-grep on console.*

- **Dimension:** task_completeness / acceptance criterion correctness
- **Plan:** 38-03 Task 1 acceptance criterion "No-console-log preserved"
- **Evidence:** The grep filter `grep -v '^\s*//\|^\s*\*'` strips only single-line-comment-prefix lines and JSDoc continuation-asterisk lines. It does NOT strip multi-line block comments `/* … */` if the closing line lacks `*` prefix, nor does it strip code that contains `console.warn` inside a string literal. A documentation comment block in registry.ts that mentions `console.warn` (e.g., "do NOT use console.warn — use process.stderr.write") would trip the gate.
- **Why FLAG not BLOCK:** Plan 03 explicitly says JSDoc is "prose only; no fenced code blocks" and the suggested comment block does not mention `console.*`. Risk is low in practice, but the gate is technically fragile. Same fragility exists in Plans 04, 05, 06 (copied gate pattern).
- **Fix path:** Document that the executor must verify by reading the file if the grep trips, not rely solely on the regex.

### FLAG-4 — Plan 06 Task 2 cast-via-mintEntityId may need updated typing

- **Dimension:** task_completeness / TS strict mode
- **Plan:** 38-06 Task 2 New Test 2
- **Evidence:** The cast `id: 'not-a-uuid' as unknown as ReturnType<typeof mintEntityId>` requires `mintEntityId` to be imported. The existing graph-store.test.ts line 18-20 already imports `mintEntityId` — so the import is already present. But the cast pattern lifted from PATTERNS.md hard-codes the variable name; if the import alias differs, TS will fail.
- **Why FLAG:** Existing imports cover this exactly. Risk is low; just noting for executor awareness.

---

## Strengths (worth keeping)

1. **Goal coverage is complete.** Every one of the 4 success criteria has at least one plan that lands the implementation AND one plan that verifies it via test. The SC#3-specific tmpdir-isolation note in Plan 06 Task 1 (separate tmpdir to avoid kpifw/business/raas cross-contamination) is exactly the right defensive call.
2. **Source-count drift is surfaced.** Plan 02 explicitly uses on-disk truth (7 L1 + 5 L2 = 12 classes) over the CONTEXT.md / PATTERNS.md "8 L1 + 5 L2" figure, with an explicit SUMMARY callout. This is honest and correct.
3. **Decision adherence is exact.** Every D-26..D-29 + CF-D04..CF-D19 has a concrete task action and an acceptance criterion. The collision warning text is grep-asserted character-for-character (D-27 spec preservation). The `Unknown ontology class:` error-message regex contract from Phase 37 BC-2 is preserved verbatim (Plan 04 + Plan 06).
4. **No out-of-scope drift.** Zero YAML, zero fs.watch, zero env-var pickup, zero LLM dedup. The type-only import in Plan 04 deliberately keeps Plan 04 + Plan 03 decoupled at the type layer even though they need to ship together at runtime.
5. **Phase 37 invariants are protected.** Plan 05 explicitly lists 4 NO-CHANGE constraints (PersistenceManager/Exporter ordering, line 240-242 trusted-path, mergeAttributes ontology-skip, skipOntologyCheck BC-2). Plan 06 Task 2 grep-asserts the 11 Phase 37 protected test names are still present.
6. **Atomic reload contract is correctly specified.** Plan 03 Task 1 delta 2 specifies "build new maps in local vars, then assign in two adjacent statements" — relies on JS single-threaded execution rather than locks; this is the right idiom.
7. **Pattern compliance.** Every modified/created file has a concrete analog called out from PATTERNS.md with line ranges, and the deltas vs analog are enumerated.

---

## Dimension-by-Dimension Summary

| Dimension | Status | Notes |
|-----------|--------|-------|
| 1. Goal coverage | PASS | All 4 SCs have implementation + verification plans. |
| 2. Requirement coverage | PASS | ONTO-01 + ONTO-02 in all 6 plans' frontmatter; substantively in Plans 03 (impl) + 06 (test). |
| 3. Decision adherence | PASS | D-26..D-29 + CF-D04..CF-D19 all addressed with concrete actions. |
| 4. Dependency graph | **BLOCK** | Plans 03 + 04 share `src/index.ts` in wave 2 without ordering edge — see BLOCK-1. |
| 5. Task quality | PASS | All tasks have read_first, action with concrete identifiers, acceptance_criteria with grep-able assertions, verify command. |
| 6. Verification + must_haves | PASS | All must_haves.truths are user-observable; artifacts have contains+provides; key_links connect artifacts. |
| 7. Out-of-scope drift | PASS | Zero YAML, fs.watch, env-vars, LLM dedup. |
| 7b. Scope reduction | PASS | No "v1/v2" or "static for now" language anywhere; full delivery of all 4 success criteria. |
| 7c. Architectural tier | SKIPPED | No RESEARCH.md / Responsibility Map for Phase 38. |
| 8. Nyquist compliance | SKIPPED | No VALIDATION.md for Phase 38 (Phase 37 had one; Phase 38 inherits Phase 37's CI but does not add a phase-specific validation arch). |
| 9. Cross-plan data contracts | PASS | No shared mutable data flow between plans — each plan creates or modifies disjoint surfaces except for src/index.ts (see BLOCK-1) which is append-only. |
| 10. CLAUDE.md compliance | PASS | TypeScript strict, no console.*, no PlantUML/Docker concerns (km-core is standalone repo, not the docker stack). |
| 11. Research resolution | SKIPPED | No RESEARCH.md for Phase 38. |
| 12. Pattern compliance | PASS | Every file lists its analog and deltas in 38-PATTERNS.md and the corresponding plan action references it. |
| 8e. Source-count drift surfaced | PASS | Plan 02 uses on-disk truth (7 L1 + 5 L2 = 12) and SUMMARY callout is mandated. |

---

## Recommendation

**Return to planner with BLOCK-1 to fix the wave-2 same-file collision.**

Preferred fix: edit Plan 04 frontmatter:

```yaml
depends_on:
  - 38-01
  - 38-03
wave: 3
```

Then Plan 05 (already in wave 3) gains a sibling — both `depends_on: [38-03, …]` — but Plan 06's `depends_on: [38-02, 38-03, 38-05]` is unaffected because 04 is transitively required via 05.

Alternative fix: move the `export { registryBackedValidator } …` line out of Plan 04 Task 2 and into Plan 03 Task 2 (since Plan 03 already touches src/index.ts). Then Plan 04 only modifies src/validation/ontology.ts and `files_modified` shrinks to one file. This is structurally cleaner because all root-barrel appends ship in one atomic commit (Plan 03) and Plan 04 becomes pure-additive on validation.

Either fix is one frontmatter / one task-spec change. After the fix, re-verify is a no-op (all other dimensions PASS).

FLAGs do not block execution but should be addressed during execute-phase: extend the package.json exports map for the sub-path import (FLAG-1) and tighten the OR-precedence in Plan 06's verify command (FLAG-2).

---

## Resolution (2026-05-20)

**BLOCK-1 fixed.** Plan 04 frontmatter updated to:

```yaml
wave: 3
depends_on:
  - 38-01
  - 38-03
```

Verified wave structure on disk (`38-{01..06}-PLAN.md`):

| Wave | Plans | Parallelism |
|------|-------|-------------|
| 1 | 38-01, 38-02 | Parallel — no `files_modified` overlap |
| 2 | 38-03 | Alone |
| 3 | 38-04, 38-05, 38-06 | Serial via `depends_on` chain (04 → 05 → 06); zero `files_modified` overlap |

`src/index.ts` is only modified by Plan 03 (wave 2). Plan 04's `src/index.ts` append now lands after Plan 03 has committed, eliminating the race.

**Status:** PLAN CHECK PASS (post-fix). FLAG-1..4 carry forward as executor-awareness notes.


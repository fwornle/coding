---
phase: 40-ingest-pipeline-layered-dedup
plan: 04
subsystem: api
tags: [km-core, ingest-pipeline, dedup, layered-dedup, llm-semantic, dedup-01, wave-2, tdd]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/01
    provides: src/dedup/types.ts (LLMSemanticLayer + MatchResult interfaces — D-44 contract); tests/unit/_helpers/fakes.ts (mkEntity universal builder)
  - phase: 39-entity-data-model/01
    provides: Entity type (with ontologyClass? + entityType + name fields used by the LLM prompt builder)
provides:
  - "src/dedup/LLMSemanticMatcher.ts — DEDUP-01 layer 3 of 3. Class implements LLMSemanticLayer (D-44); ports OKM batchLLMDedup prompt + 5-stage JSON unwrap verbatim. Exports LLMClient interface for downstream wiring (Phase 41 / 42 / 43)."
  - "tests/unit/_helpers/fakes-llm.ts — co-located makeMockLLMClient factory (Warning #4 fix; was originally scheduled for Plan 40-01's universal fakes.ts)."
  - "9 new unit tests in tests/unit/llm-matcher.test.ts (5-stage JSON unwrap × 4 wrap modes + empty-candidates fast path + onError 'skip'/'throw' + threshold default + prompt-shape assertion)."
affects:
  - 40-05 (LayeredDeduplicator) — instantiates LLMSemanticMatcher as the 3rd layer in the short-circuit chain (D-44); also imports LLMClient via the matcher when needed
  - 40-07 (root barrel) — re-exports LLMClient from src/dedup/types.ts once 40-04 + 40-03 are landed (per the TODO in Plan 40-01's dedup/types.ts header lines 27-32)
  - 41 (A INT-01) — A's adapter wires its preferred LLM provider (groq / haiku) as the LLMClient
  - 42 (B INT-02) — B's adapter wires its preferred LLM provider as the LLMClient
  - 43 (OKM INT-03) — OKM wires its existing @rapid/llm-proxy as the LLMClient (verbatim prompt port means parity with OKM's production tuning)

# Tech tracking
tech-stack:
  added: []  # caller-supplied client; no new deps in km-core
  patterns:
    - "Caller-supplied dependency interface (LLMClient) — same pattern as Phase 38's OntologyValidator + Phase 39 backfill's resolver-as-function. Each system wires its own provider; km-core never imports a concrete LLM."
    - "5-stage JSON unwrap (trim → anchored fence → unanchored fence → bare-brace extraction → JSON.parse) — defense-in-depth for Copilot CLI / claude-code response shapes (40-RESEARCH Pitfall 3). Verbatim port from OKM deduplicator.ts:451-472."
    - "Per-layer error policy ctor opt (onError: 'skip' | 'throw', default 'skip' + stderr-warn) — mirrors OKM's tolerant try/catch (deduplicator.ts:213-218) so LLM failures don't block ingest."
    - "Co-located test fakes per client interface (Warning #4 fix) — fakes-llm.ts ships with LLMSemanticMatcher.ts in this plan, NOT in Plan 40-01's universal fakes.ts. Mirrors Plan 40-03's fakes-embedding.ts co-location."

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts (228 LOC) — Exports LLMClient interface + LLMSemanticMatcherOpts + LLMSemanticMatcher class (implements LLMSemanticLayer). SYSTEM_PROMPT + USER_PROMPT verbatim from OKM deduplicator.ts:430-444 ("OOM" vs "Out of Memory" preserved). parseDedupResponse() implements the 5-stage unwrap verbatim from deduplicator.ts:451-472. Stderr-warn prefix [km-core/dedup/llm]. Zero console.* outside SOURCE-comment header.
    - /Users/Q284340/Agentic/km-core/tests/unit/_helpers/fakes-llm.ts (47 LOC) — Single export makeMockLLMClient(opts) with three injection modes (matches / raw / throwError). Co-located per Warning #4.
    - /Users/Q284340/Agentic/km-core/tests/unit/llm-matcher.test.ts (234 LOC) — 9 unit tests matching 40-PATTERNS.md offset 771-780. Test names: empty candidates / bare JSON / anchored fence / unanchored fence / prose-wrapped braces / onError skip / onError throw / threshold default 0.70 / prompt-shape (system+user, ontologyClass, JSON.stringify(existingNames), taskType, responseFormat, timeout).
  modified: []  # net-new files only — no existing km-core files touched

key-decisions:
  - "Plan executed verbatim per the plan-author spec — zero deviations. The OKM 5-stage JSON unwrap was ported character-for-character; the SYSTEM_PROMPT and USER_PROMPT strings (including the 'OOM' vs 'Out of Memory' example) match deduplicator.ts:430-444 exactly; the try/catch + stderr-warn idiom mirrors deduplicator.ts:213-218."
  - "LLMClient interface is owned by LLMSemanticMatcher.ts (not by src/dedup/types.ts) — matches the Warning #4 co-location decision. Plan 40-07 will add `export type { LLMClient } from './LLMSemanticMatcher.js';` to src/dedup/types.ts (per the TODO marker in Plan 40-01's dedup/types.ts header)."
  - "Threshold default 0.70 selected per 40-RESEARCH A3 (OKM's implicit 'any LLM-returned match is taken'); confidence emitted as `this.threshold` on match (the LLM verdict is binary, not graded). Callers tune false-positive vs false-negative via the ctor opt."
  - "onError default 'skip' selected per 40-RESEARCH Q5 — mirrors OKM's deduplicator.ts:213-218 tolerant behavior so a single LLM timeout doesn't block an entire ingest run."
  - "Pre-flight `existingNames.length === 0` check added after self-filter (entity.id !== candidate.id). Without it, an entity comparing against `[itself]` would round-trip through the LLM with an empty existingNames array — the prompt would be nonsensical and the LLM call would be wasted. Plan didn't explicitly call this out but Example 4 lines 482-483 in RESEARCH.md prescribed it; same behavior."

patterns-established:
  - "Pattern 40-T4 (Verbatim Prompt Port from OKM Source): when porting a prompt-driven OKM helper to km-core, the SYSTEM_PROMPT + USER_PROMPT strings are copied character-for-character (including any production-tuning examples). The objective is parity with OKM's production tuning behavior, not 'cleaner' phrasing. Future plans porting OKM LLM calls should follow the same verbatim-port rule."
  - "Pattern 40-T5 (Defense-in-Depth LLM JSON Unwrap): the 5-stage unwrap (trim → anchored fence → unanchored fence → bare-brace extraction → JSON.parse) is the canonical km-core shape for parsing any LLM JSON response. Future km-core LLM helpers (Phase 42+ etc.) should reuse the same staged-fallthrough idiom."

requirements-completed: [DEDUP-01]

# Metrics
duration: 2min
completed: 2026-05-21
---

# Phase 40 Plan 04: LLM-Semantic Dedup Layer Summary

**`LLMSemanticMatcher` (`src/dedup/LLMSemanticMatcher.ts`) ports OKM's `batchLLMDedup` prompt + 5-stage JSON unwrap verbatim from `deduplicator.ts:421-475`, exposing a caller-supplied `LLMClient` interface so each downstream system (Phase 43 OKM, Phase 41 system A, Phase 42 system B) wires its own LLM provider. Threshold defaults to 0.70 (RESEARCH A3 — OKM's implicit "any LLM match is taken"); `onError` defaults to `'skip'` (no-match + `[km-core/dedup/llm]` stderr-warn) so LLM failures don't block ingest. The co-located `tests/unit/_helpers/fakes-llm.ts` ships the `makeMockLLMClient` factory per the Warning #4 fix.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-21T18:45:45+02:00 (first commit timestamp)
- **Completed:** 2026-05-21T18:48:00+02:00 (build + full-suite + verification)
- **Tasks:** 3 (Task 1 RED — failing tests + co-located fake; Task 2 GREEN — implementation; Task 3 verification — build + full-suite regression, no commit)
- **Files created:** 3 in km-core (228 + 47 + 234 = 509 LOC total) + 1 in coding/ (this SUMMARY)
- **Files modified:** 0

## Accomplishments

- **DEDUP-01 layer 3 of 3 lands** — `src/dedup/LLMSemanticMatcher.ts` (228 LOC) implements `LLMSemanticLayer` (D-44) with `readonly threshold: 0.70` + async `match(entity, candidates) => MatchResult`. Verbatim prompt port from OKM; verbatim 5-stage JSON unwrap port from OKM; mirrors OKM's tolerant try/catch behavior (`deduplicator.ts:213-218`) via the `onError: 'skip'` default.
- **`LLMClient` interface exported and ready for downstream wiring** — the interface is owned by `LLMSemanticMatcher.ts` (per Warning #4 co-location). Phase 43 will wire OKM's `@rapid/llm-proxy`; Phases 41 + 42 wire their respective providers (groq / haiku / etc.). Phase 40 Plan 07 will add `export type { LLMClient } from './LLMSemanticMatcher.js';` to `src/dedup/types.ts` (per the TODO marker placed by Plan 40-01).
- **9 unit tests cover the matcher end-to-end** — empty-candidates fast path / bare JSON / anchored markdown fence / unanchored markdown fence / bare-brace extraction (prose-wrapped) / `onError: 'skip'` (no-match + stderr-warn with `[km-core/dedup/llm]` prefix) / `onError: 'throw'` (re-throws) / threshold default 0.70 / prompt-shape (system + user, ontologyClass, JSON.stringify-encoded names, taskType `'deduplication_matching'`, responseFormat `json_object`, timeout 60_000).
- **Co-located fake `makeMockLLMClient` ships in `tests/unit/_helpers/fakes-llm.ts`** — 47 LOC, single export, three injection modes (`matches` / `raw` / `throwError`). Matches Plan 40-03's `fakes-embedding.ts` co-location pattern (Warning #4 fix).
- **Full test suite remains green** — 12 test files / 115 passing tests after Wave 2 lands (Plan 40-01 baseline: 9 / 92; Wave 2 adds 3 test files + 23 tests across Plans 40-02 + 40-03 + 40-04).

## RED → GREEN Cycle

**RED step (Task 1, commit `1b61655`):**

```
RUN  v4.1.6 /Users/Q284340/Agentic/km-core

 ❯ tests/unit/llm-matcher.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/llm-matcher.test.ts [ tests/unit/llm-matcher.test.ts ]
Error: Cannot find module '../../src/dedup/LLMSemanticMatcher.js' imported from /Users/Q284340/Agentic/km-core/tests/unit/llm-matcher.test.ts
```

Captured at `/tmp/40-04-task-1-red.log`. The failure is the expected forward-reference TS2307 — the source file does not yet exist.

**GREEN step (Task 2, commit `de1edf6`):**

```
RUN  v4.1.6 /Users/Q284340/Agentic/km-core

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  18:46:42
   Duration  173ms
```

Captured at `/tmp/40-04-task-2-green.log`. All 9 tests pass; `tsc --noEmit` exits 0.

## Task Commits

Each task was committed atomically in `~/Agentic/km-core/`:

1. **Task 1 (RED): Failing tests + co-located fake** — `1b61655` (`test(40-04): add failing tests + co-located fake for LLMSemanticMatcher`)
2. **Task 2 (GREEN): Matcher implementation** — `de1edf6` (`feat(40-04): implement LLMSemanticMatcher (DEDUP-01 layer 3 of 3)`)
3. **Task 3 (verification only — no commit)** — `npm run build` exit 0, `dist/dedup/LLMSemanticMatcher.{js,d.ts}` present, `npm test` → `Test Files 12 passed (12) / Tests 115 passed (115)`, `node -e "..."` confirms `threshold=0.7`.

**Plan metadata (this SUMMARY):** committed in this coding/ worktree as `docs(40-04): summary`.

## Files Created/Modified

- `~/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts` (228 LOC, created) — `LLMClient` interface + `LLMSemanticMatcherOpts` + `LLMSemanticMatcher` class implementing `LLMSemanticLayer`. SOURCE-comment header cites OKM `deduplicator.ts:421-475` + `213-218` + `451-472` + enumerated 5 deltas. Stderr-warn uses `[km-core/dedup/llm]` prefix. Zero `console.*` outside the comment block. All relative imports use `.js` suffix.
- `~/Agentic/km-core/tests/unit/_helpers/fakes-llm.ts` (47 LOC, created) — Single export `makeMockLLMClient`; three injection modes (`matches` / `raw` / `throwError`). Header comment cites the Warning #4 fix.
- `~/Agentic/km-core/tests/unit/llm-matcher.test.ts` (234 LOC, created) — 9 unit tests; imports `LLMSemanticMatcher` + `type LLMClient` from `../../src/dedup/LLMSemanticMatcher.js`, `mkEntity` from `./_helpers/fakes.js`, `makeMockLLMClient` from `./_helpers/fakes-llm.js`. The `onError: 'skip'` test spies on `process.stderr.write` and asserts the `[km-core/dedup/llm]` prefix.

## Verification

- **`cd ~/Agentic/km-core && npx tsc --noEmit` — exit 0** (fully clean).
- **`cd ~/Agentic/km-core && npx vitest run tests/unit/llm-matcher.test.ts` — `Test Files 1 passed (1) / Tests 9 passed (9)`**.
- **`cd ~/Agentic/km-core && npm run build` — exit 0; `dist/dedup/LLMSemanticMatcher.js` (7957 bytes) + `dist/dedup/LLMSemanticMatcher.d.ts` (3016 bytes) exist**.
- **`cd ~/Agentic/km-core && npm test` — `Test Files 12 passed (12) / Tests 115 passed (115)`** (zero regression on Plan 40-01's 92-test baseline; +23 tests across Wave 2: Plan 40-02 jaccard ~7, Plan 40-03 cosine ~7, Plan 40-04 LLM 9).
- **`node -e "import('./dist/dedup/LLMSemanticMatcher.js').then(m => { const c = new m.LLMSemanticMatcher({ client: { complete: async () => ({ content: '{\\"matches\\":[]}' }) } }); process.stdout.write('threshold=' + c.threshold + '\\n'); })"` → `threshold=0.7`** (default-threshold sanity check from the plan's `<verification>` block).
- **Grep acceptance checks all pass:**
  - `grep -c "implements LLMSemanticLayer" src/dedup/LLMSemanticMatcher.ts` → 1
  - `grep -c "export interface LLMClient" src/dedup/LLMSemanticMatcher.ts` → 1
  - `grep -c "this.threshold = opts.threshold ?? 0.70"` → 1
  - `grep -c "this.timeoutMs = opts.timeoutMs ?? 60_000"` → 1
  - `grep -c "this.onError = opts.onError ?? 'skip'"` → 1
  - `grep -c "firstBrace"` → 4 (declaration + 3 references in the bare-brace extraction stage; ≥1 expected)
  - `grep -c "OOM"` → 3 (in SOURCE-comment + SYSTEM_PROMPT verbatim string; ≥1 expected)
  - `grep -c "[km-core/dedup/llm]"` → 3 (header + JSDoc + stderr-write; ≥1 expected)
  - `grep -v '^//' src/dedup/LLMSemanticMatcher.ts | grep -v '^ \* ' | grep -cE 'console\.(log|info|warn|error|debug)'` → 0
  - All relative imports use `.js` suffix
  - Test file imports: 1 forward-ref to `LLMSemanticMatcher.js`, 1 to `_helpers/fakes-llm.js`, 1 to `_helpers/fakes.js`; 10 `makeMockLLMClient` references; 1 `vi.spyOn(process.stderr` site; 9 `^  test(` blocks.

## Decisions Made

See `key-decisions` in frontmatter — five decisions logged. The most consequential ones:

1. **Zero plan deviations.** The plan was executed verbatim — the OKM prompt + 5-stage unwrap port matches OKM source character-for-character, and the threshold / timeout / onError defaults match 40-RESEARCH A3 + Q5.
2. **`LLMClient` interface owned by `LLMSemanticMatcher.ts`, not by `src/dedup/types.ts`** — Warning #4 co-location. Plan 40-07 will add the re-export to `src/dedup/types.ts` per the existing TODO marker.
3. **`existingNames.length === 0` fast-return** — after the self-filter, an entity comparing against `[itself]` produces an empty existingNames array; the matcher returns no-match without issuing the LLM call. Matches RESEARCH.md Example 4 lines 482-483.

## Deviations from Plan

None — the plan executed exactly as written. The OKM prompt + 5-stage JSON unwrap were ported character-for-character; the SYSTEM_PROMPT and USER_PROMPT strings (including the "OOM" vs "Out of Memory" example) match OKM `deduplicator.ts:430-444` verbatim; the try/catch + stderr-warn idiom mirrors `deduplicator.ts:213-218`; the threshold (0.70), timeoutMs (60_000), taskType (`'deduplication_matching'`), and onError (`'skip'`) defaults all match the plan's `<action>` specification and RESEARCH.md Q5 + A3.

## Threading Notes for Downstream Plans

- **Plan 40-05 (LayeredDeduplicator)** — instantiates `LLMSemanticMatcher` as the 3rd layer in the short-circuit chain. The layer wraps the LLM client at the LayeredDeduplicator ctor; per-layer try/catch in the LayeredDeduplicator routes errors through `onError: 'skip'` by default so LLM failures don't crash the dedup chain.
- **Plan 40-07 (root barrel)** — adds `export type { LLMClient } from './LLMSemanticMatcher.js';` to `src/dedup/types.ts` (the TODO marker is already in place at Plan 40-01's `src/dedup/types.ts` lines 27-32) AND re-exports `LLMSemanticMatcher` + `LLMSemanticMatcherOpts` from `src/index.ts`.
- **Phase 43 (OKM INT-03)** — wires OKM's existing `@rapid/llm-proxy` as the `LLMClient`. Because the prompt + 5-stage unwrap are verbatim ports, OKM gets parity with its production tuning out of the box (no behavior drift).
- **Phases 41 + 42 (A INT-01 / B INT-02)** — each system supplies its own `LLMClient` implementation. The interface is provider-agnostic; `taskType` acts as a routing hint where the downstream LLM gateway supports tiers.

## OKM Source Citations

| OKM source | km-core delta |
|---|---|
| `deduplicator.ts:421-475` (`batchLLMDedup` whole method) | Refactored from batch-over-class-pool to single-entity-vs-candidates; D-44 layer contract |
| `deduplicator.ts:213-218` (try/catch + `console.warn` + empty matches fallback) | Replaced `console.warn` with `process.stderr.write('[km-core/dedup/llm] ...')`; gated by `onError === 'skip'` |
| `deduplicator.ts:430-444` (SYSTEM_PROMPT + USER_PROMPT string literals) | Ported verbatim into module-level `SYSTEM_PROMPT` / `USER_PROMPT` const arrows; "OOM" vs "Out of Memory" example preserved |
| `deduplicator.ts:446-448` (taskType / responseFormat / timeout defaults) | Ported verbatim into ctor defaults |
| `deduplicator.ts:451-472` (5-stage JSON unwrap) | Ported verbatim into private `parseDedupResponse()` function; stage order + regex anchors identical |

## Issues Encountered

None — no checkpoints, no human verification gates, no constraint violations on the source code (one false-positive on a `grep` pattern in a Bash diagnostics call, which is unrelated to the source artifact).

## TDD Gate Compliance

Plan was `tdd="true"` on Tasks 1 + 2. Gate sequence verified in `git log --grep '(40-04)' --oneline`:

1. `1b61655` — `test(40-04): add failing tests ...` (RED gate)
2. `de1edf6` — `feat(40-04): implement LLMSemanticMatcher ...` (GREEN gate)

No REFACTOR commit — the implementation matched the verbatim-port spec; no clean-up needed.

## Self-Check: PASSED

- Created files exist:
  - `/Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts` — FOUND
  - `/Users/Q284340/Agentic/km-core/tests/unit/_helpers/fakes-llm.ts` — FOUND
  - `/Users/Q284340/Agentic/km-core/tests/unit/llm-matcher.test.ts` — FOUND
- Built artifacts exist:
  - `/Users/Q284340/Agentic/km-core/dist/dedup/LLMSemanticMatcher.js` — FOUND (7957 bytes)
  - `/Users/Q284340/Agentic/km-core/dist/dedup/LLMSemanticMatcher.d.ts` — FOUND (3016 bytes)
- Commits exist in `~/Agentic/km-core/`:
  - `1b61655` (`test(40-04): add failing tests + co-located fake for LLMSemanticMatcher`) — FOUND
  - `de1edf6` (`feat(40-04): implement LLMSemanticMatcher (DEDUP-01 layer 3 of 3)`) — FOUND
- `tsc --noEmit` clean: PASSED
- `npm test` zero-regression (92/9 baseline → 115/12 after Wave 2): PASSED
- Default `threshold=0.7` verified via dist-import: PASSED

---
*Phase: 40-ingest-pipeline-layered-dedup*
*Completed: 2026-05-21*

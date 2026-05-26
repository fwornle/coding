# Phase 50 — Discussion Log

**Date:** 2026-05-26
**Mode:** discuss (default)
**Pre-state:** rich `50-CONTEXT.md` (filed 2026-05-23 by user, no decisions block) + no SPEC, no plans, no checkpoint
**Outcome:** CONTEXT.md augmented with `<decisions>`, `<canonical_refs>`, `<code_context>`, `<deferred>` blocks. Ready for `/gsd-plan-phase 50`.

---

## Areas presented

The user authored a comprehensive CONTEXT.md on 2026-05-23 covering goal, window spec (N-prompt counter, not wall-clock), detectors A+B+C, resolver prompt shape, scope (5 Must / 3 Should / 2 Could), and acceptance criteria. Five residual gray areas were identified before discussion; the user selected 4 to lock and accepted recommended options on all 4.

| # | Area | Selected? | Locked decision |
|---|------|-----------|-----------------|
| Q0 (pre-discuss) | Primitives strategy (50↔51 reuse) | yes | Land in 50, reuse in 51 → **D-Reuse** |
| Q0 (pre-discuss) | Phase 51 agent scope | yes (covered by Phase 51 CONTEXT) | All four: claude/opencode/copilot/mastra |
| Q1 | Cadence trigger order | yes | CLI → capture-time stamp → cron, three plans → **D-Cadence** |
| Q2 | Confidence / auto-apply policy | yes | Three-state (commit / commit+flag / skip+stamp) at 0.7 / 0.4 thresholds → **D-Confidence** |
| Q3 | Phase 47 boundary | yes | Keep 47 separate (writer-path fix only); 50 handles recovery → **D-47-Boundary** |
| Q4 | Shared primitive packaging | yes | `lib/lsl/window.mjs` + `lib/lsl/scan-and-convert.mjs`, plain ESM at top level → **D-Primitives** |

No areas were deferred to the planner explicitly; one (the confidence-dashboard `/health/state` integration) is locked in `<decisions>` but its implementation is flagged as an optional Plan 3 add-on inside `<deferred>`.

---

## Discussion trail

### Pre-discuss (before /gsd-discuss-phase 50)

User directive: *"fix the planning state, then do 50 and 51, then point the state at 43"*. Before launching the GSD pipeline I surfaced two cross-cutting questions:

1. **Primitives strategy for 50↔51 overlap.** Options: land in 50 / co-design first / skip 51 research. User chose **"Land in 50, reuse in 51"** (matches 51 Should #10).
2. **Phase 51 agent scope.** Options: any subset of claude/opencode/copilot/mastra. User chose **all four** (locks Phase 51's research-wave scope; not a Phase 50 decision but recorded here to motivate D-Reuse).

### Discuss-phase invocation (Q1 — Q4)

**Q1 — Cadence trigger order**
- Options presented:
  1. CLI → capture-time stamp → cron (Recommended)
  2. CLI + capture-time stamp first, cron later
  3. All three in one wave
  4. CLI + cron, skip the writer stamp
- **User selected:** Option 1
- Rationale captured in D-Cadence: lowest risk, each plan independently verifiable, intermediate state after Plan 1 is fully functional.

**Q2 — Confidence / auto-apply policy**
- Options presented:
  1. Three-state (commit / commit+flag / skip+stamp) (Recommended)
  2. Always commit + stamp confidence
  3. Conservative: skip if not confident
  4. Defer to planner
- **User selected:** Option 1
- Thresholds: ≥ 0.7 commit silently, 0.4–0.7 commit + `lsl_resolution_needs_review = true`, < 0.4 OR no antecedent skip + `lsl_resolution_skipped` stamp. Idempotency: skipped rows are not retried on next run unless `--force`.

**Q3 — Phase 47 boundary**
- Options presented:
  1. Keep 47 separate (writer-path fix only) (Recommended)
  2. Retire Phase 47 — fold into 50
  3. Phase 47 stays but executes inside Phase 50's wave
- **User selected:** Option 1
- Practical consequence: Plan 2's writer-side change is ONLY the capture-time `needs_lsl_resolution` stamp + the `_buildPriorContext` migration — neither is the image-attachment fix.

**Q4 — Shared primitive packaging**
- Options presented:
  1. `lib/lsl/` top-level, plain ESM (Recommended)
  2. `src/observations/lib/` colocate with consumers
  3. `scripts/lib/lsl.mjs` shell-friendly
  4. `@coding/lsl-tools` new internal package
- **User selected:** Option 1
- Confirmed via scout: `lib/` already hosts `adapters/`, `agent-api/`, `fallbacks/`, `integrations/`, `agent-detector.js`, `agent-registry.js` — the `lib/<category>/` pattern is established. No build step. `lib/llm/` referenced in CLAUDE.md is the Phase 999.1 target, not yet created.

---

## Codebase scout findings (informed Q4 and the canonical refs)

- `src/live-logging/ObservationWriter.js:263` — `_buildPriorContext` definition; call site at line 300. Plan 2's migration target
- `scripts/convert-transcripts.js` (10KB, 2026-04-19) — existing batch transcript→observations converter. Refactor seed for `convertTranscriptsToObservations`
- `scripts/backfill-subagent-transcripts.mjs` (5KB, 2026-05-23) — PoC directory walker. Refactor seed for `scanTranscriptsForUnconverted`
- `scripts/backfill-raw-observations.mjs` (9KB, 2026-05-19) — CLI shape template (flag set, dry-run, idempotency)
- `.data/observations/observations.db` — SQLite + WAL. JSON `metadata` column, no schema migration needed
- `lib/` existing convention validated — `lib/adapters/`, `lib/agent-api/`, `lib/fallbacks/`, `lib/integrations/` are sibling category dirs

---

## Cross-reference: pending todos

`gsd-sdk query todo.match-phase 50` returned 1 match:

- `2026-05-23-orphan-digest-observation-refs.md` (score 0.6, area "observability / data-integrity") — **reviewed, not folded.** Same broad area but different failure mode (digest→observation FK integrity, not vague-summary recovery). Recorded in `<deferred>` § Reviewed Todos.

---

## Deferred ideas surfaced

- Confidence dashboard `/health/state` badge integration (Could #10) — fully decided in D-Confidence but ships as optional Plan 3 add-on or follow-up
- Embedding-based vague-summary detector (Detector D) — possible follow-up; current A+B+C cover the documented failure cases
- Mid-phase Phase 47 retirement — if Plan 2 touches enough of `ObservationWriter.js` that the Phase 47 image-attachment fix becomes trivial, the planner MAY surface that as a deviation. Default per D-47-Boundary: keep them separate

No scope creep encountered.

---

## Anti-patterns avoided

- **Re-asking decided questions.** The user's 2026-05-23 CONTEXT.md already locked: window unit (N-prompt count), N default (3), wall-clock ceiling (24h), byte cap (30KB), detectors A+B+C, resolver prompt shape, Must/Should/Could split, acceptance criteria. None of these were re-asked.
- **Scope-grow during augment.** "Augment with decisions" was the explicit user choice; the existing body was kept verbatim. New content appended as a clearly-marked section.
- **Inventing a packaging strategy.** D-Primitives was grounded in a codebase scout (`ls lib/`) rather than guessed.

---

## Next step

`/gsd-plan-phase 50` (or `/clear` first, then plan). Phase 50 has CONTEXT.md ready; planner can act on `<decisions>` + `<canonical_refs>` + `<code_context>` without further user questions.

# Phase 50 — Context

**Title:** LSL-grounded async observation resolver — backfill ambiguous-reference and image-only rows from verbatim session logs
**Filed:** 2026-05-23
**Severity:** Medium (data quality — significant fraction of observations carry summaries that are unrecoverably vague today)
**Status:** Filed (not yet planned)

---

## Goal

Run an asynchronous resolver that consults the verbatim Live Session
Logs (LSLs) under `.specstory/history/` to rewrite observation
summaries that are unrecoverably vague when looked at in isolation —
specifically ambiguous-reference summaries ("Developer requested
implementation of some previously discussed feature") and image-only
prompt summaries (Phase 47). The LSL is the ground-truth source the
ObservationWriter can't itself recover from after a row is written.

This phase is the **ground-truth backfill tier** of the observation
pipeline. It complements two upstream fixes:

| Tier | Fix | Limitation this phase removes |
|---|---|---|
| Inline (shipped 2026-05-23, `2f4cbf7d7`) | `ObservationWriter._buildPriorContext` injects last 2 same-project Intents into the prompt | Only helps when the antecedent was itself captured as an observation; misses tool outputs, image captions, conversation that never crossed a prompt-set boundary |
| Capture (Phase 47) | Stop dropping prompt text when the message has image attachments | Only fixes future rows; ~hundreds of historical rows remain broken |
| **Async resolver (this phase)** | Read the LSL window and re-summarize | Recovers BOTH classes of broken rows from any source the LSL captured |

---

## Window specification — interaction-time, not wall-clock

A naive "±15 min wall-clock around `observation.created_at`" window is
**wrong** and must not be used. The user's prior reference may span
hours of agent-only work in a long-running task. Example: an
autonomous GSD wave runs for 6 hours executing 7 plans; the user
returns and types "do the same again". The 15-minute window contains
only agent tool-calls and no user activity; the antecedent ("the
same") is in the user's prompt from 6 hours ago.

**The resolver's window must be measured in "user-interaction time"**,
defined as the time spanning the most recent N **user→assistant
exchanges** in the LSL, regardless of wall-clock distance.

### Concrete window rule

For each candidate observation, the resolver walks backward through
LSL files (`.specstory/history/{YYYY}/{MM}/{YYYY-MM-DD}_HHMM-HHMM_*.md`)
from `observation.created_at` and collects user→assistant exchanges
into a window with these stop conditions, in order:

1. **Stop when N user prompts collected.** Default `N = 3`.
   This is the primary stop condition — it captures "the things the
   user just said" regardless of how much agent work happened in
   between.

2. **Hard wall-clock ceiling (safety net).** Default `M = 24 hours`.
   Beyond this, the antecedent is almost never useful and the LLM
   prompt grows unwieldy. The ceiling is a backstop against
   pathological LSL traversal, not the primary gate.

3. **Hard byte ceiling (prompt-size safety).** Default `B = 30 KB`
   of accumulated LSL text. If the N-prompt window is denser than
   this (very large pasted prompts, long tool outputs), trim each
   exchange's tool-call/result blocks before adding to the window.

### Why "user prompts" as the unit

- A user prompt is a clear, semantically meaningful boundary —
  every "it"/"that"/"the change" reference resolves to something
  said in or implied by a *prior user prompt* (or its
  assistant-response context), not by a randomly-chosen wall-clock
  interval.
- It correctly degrades in both directions: dense interactive
  sessions get a short wall-clock window (3 prompts in 5 min); long
  autonomous runs get a long wall-clock window (3 prompts spanning
  6 hours).
- It mirrors how humans think about "recent context": "what did I
  ask in the last few turns?", not "what happened in the last
  15 minutes?".

### Implication for tier-1 (already shipped)

The current `_buildPriorContext` uses a 30-minute wall-clock window
on observations (not LSL). It has the same naive-window weakness as
the original Phase 50 sketch and will silently miss long-running-task
references. Phase 50's window-resolution primitive (LSL walker +
N-prompt counter) should be **lifted up** and reused in
`_buildPriorContext`, replacing the 30-minute observation-time gate.
See follow-up section below.

---

## Detection (which rows get resolved)

A candidate row is one where the existing summary is unrecoverably
vague. Two complementary detectors, both cheap:

### A. Regex on the existing summary

Triggers when the Intent line matches any of:

```
/some previously discussed (feature|change|option|item|plan)/i
/prior (context|exchange|plan|step|conversation)/i
/previously (mentioned|discussed|chosen|selected|agreed)/i
/context-dependent/i
/the user's "[^"]+" instruction refers to a prior plan not shown in this exchange/i
```

### B. Capture-time hint

`ObservationWriter` already knows if `_buildPriorContext` returned an
empty block AND the current user message contains an unresolved
pronoun. When both are true, stamp
`metadata.needs_lsl_resolution = true` at write time. The resolver
preferentially scans these rows first — no regex re-scan needed.

### C. Phase 47 image-stripped rows

Detector C is structural: stored `messages[*].content` is
exclusively `[Image: source: …]` placeholders, no narrative text.
Implementation reuses the same LSL-window primitive — the LSL has
the missing user text.

---

## Resolver prompt shape

For each candidate row:

```
SYSTEM: You are rewriting a vague observation summary using the verbatim
        session log that captures the same exchange and the user's
        recent prompts. Resolve any pronominal or implicit reference
        in Intent against the LSL window. Preserve Approach, Artifacts,
        and Result unless the LSL contradicts them.

USER:   <ambiguous_summary>
          Intent: Developer requested implementation of some previously discussed feature…
          Approach: …
          Artifacts: …
          Result: …
        </ambiguous_summary>

        <lsl_window source="2026-05-22_2100-2200_c197ef.md" exchanges="3">
          [user → assistant exchanges in chronological order]
        </lsl_window>

        Rewrite the summary. Output the same 4-line Intent/Approach/Artifacts/Result
        template only. Specifically resolve any "it", "that", "the X" in Intent.
```

---

## Cadence and idempotency

- **Trigger options** (decide in plan-phase):
  1. Cron (every 15–30 min) scanning recent unresolved rows
  2. Post-write hook (debounced ~60s) on each new observation
  3. On-demand CLI (`scripts/resolve-observations-from-lsl.mjs`)
  All three should share the same core resolver function.

- **Idempotent**: skip rows where `metadata.lsl_resolved_at` is set,
  unless explicitly re-run with `--force`.

- **Audit trail**: when resolving, set:
  - `metadata.lsl_resolved_at = ISO timestamp`
  - `metadata.lsl_resolution_source = "<file>:<line-range>"`
  - `metadata.lsl_resolution_window = { prompts: N, span_ms: <actual elapsed> }`
  - keep the original `summary` content available via `metadata.pre_resolution_summary` so the rewrite is reversible.

---

## Scope

### Must

1. **LSL-window primitive**: a function `getLSLWindow(observation, { maxPrompts, maxWallClockMs, maxBytes })` that returns the N most recent user→assistant exchanges from LSL files preceding `observation.created_at`, scoped to the same project. Pure read; no DB writes.
2. **Detector A + B**: regex scan + capture-time `needs_lsl_resolution` stamp.
3. **Resolver pass**: for each candidate row, build the prompt, call the LLM proxy, parse the response, update the row with audit-trail metadata. Idempotent.
4. **CLI entry point**: `scripts/resolve-observations-from-lsl.mjs` with `--dry-run`, `--limit`, `--id`, `--since`, `--force` flags (mirror `backfill-raw-observations.mjs`).
5. **Folds in Phase 47 `Could`**: Detector C (image-only rows) uses the same primitive. The `--mode=images-only` flag scopes the run.

### Should

6. **`ObservationWriter` post-write capture-time stamp** (`needs_lsl_resolution = true`) so the resolver doesn't waste a full regex pass.
7. **Migrate `_buildPriorContext`** (the tier-1 fix from `2f4cbf7d7`) to use the same N-prompt window logic instead of 30-minute wall-clock, so the inline and async tiers agree on what "recent" means.
8. **Cron / launchd job** for periodic background runs.

### Could

9. **Confidence scoring**: when the LSL window is short or has no clear antecedent, the resolver should produce a lower-confidence rewrite and flag the row for human review rather than silently committing a guess.
10. **Quality metric exposed via `/health/state`**: count of unresolved-but-flagged rows so the dashboard can show a "summary integrity" badge.

---

## Acceptance criteria

- [ ] Running `scripts/resolve-observations-from-lsl.mjs` on the live `.observations/observations.db` rewrites the three 2026-05-23 07:33 km-core "implement it now" rows so the Intent lines name the actual referent (option 2 — per-turn progress promotion via permission-response heartbeat).
- [ ] The same script run with `--mode=images-only` rewrites row `9a3e700c-…` (the two-screenshots tmux-vs-observations question) from its current manual backfill to a verbatim-grounded rewrite, with `metadata.lsl_resolution_source` set.
- [ ] Idempotency: a second run is a no-op on already-resolved rows.
- [ ] An autonomous-task scenario (no user activity in last 4+ hours, then "do the same again") resolves correctly via the N-prompt window walker; verified by a fixture test.

---

## Related

- Phase 47 — image-attachment text loss. This phase's resolver handles Phase 47's `Could` (recovery from transcripts) so Phase 47's scope narrows to the writer-path fix.
- Inline pronoun-resolution fix `2f4cbf7d7` (2026-05-23) — same problem, different tier. This phase additionally addresses the case where the prior context was never observed.
- Phase 48 / 49 — VKB graph viewer & data integrity. Unrelated tier.

---

## Implementation Decisions Locked During Discuss (2026-05-26)

<decisions>

The body above (filed 2026-05-23) captures the design. The decisions
below resolve residual gray areas that downstream agents (researcher,
planner) need locked before they can act.

### D-Cadence: CLI → capture-time stamp → cron (three sequential plans)

Ship the resolver in three independently-verifiable plans, in this order:

- **Plan 1 — CLI + primitive.** Build the LSL-window primitive
  (`lib/lsl/window.mjs`) + resolver core + CLI entry
  `scripts/resolve-observations-from-lsl.mjs` with all flags
  (`--dry-run`, `--limit`, `--id`, `--since`, `--force`, `--mode`).
  This plan alone satisfies the four acceptance criteria — the CLI
  can backfill all historical rows on demand. Detector A (regex) +
  detector C (image-only structural) ship here.

- **Plan 2 — Capture-time stamp.** Modify
  `src/live-logging/ObservationWriter.js` to stamp
  `metadata.needs_lsl_resolution = true` when `_buildPriorContext`
  returned empty AND the user message contains an unresolved
  pronoun (detector B). Migrate `_buildPriorContext` itself to use
  the same N-prompt window logic (Should #7) — both consumers
  share `lib/lsl/window.mjs`.

- **Plan 3 — Cron / launchd.** Wire a periodic job that runs the
  Plan 1 CLI with `--since <last-run> --limit 100` every 15-30 min.
  launchd preferred (mirrors existing project conventions per
  CLAUDE.md statusline plist pattern + `reference_llm_proxy_corp_wrapper.md`).

**Why this order:** Plan 1 ships ALL the recovery capability — humans
can run it whenever they want. Plan 2 reduces the regex-scan cost on
each cron run. Plan 3 is pure ergonomics. Each plan has its own
verification gate. The intermediate state after Plan 1 is fully
functional, not a half-built feature.

**Rejected alternative:** CLI + writer change in one plan was tempting
but compounds risk (writer-path change touches a hot code path —
ObservationWriter runs on every prompt-set close).

### D-Confidence: Three-state policy (commit / commit+flag / skip+stamp)

Resolver prompt is amended (`resolver_prompt_shape` above) to require
the LLM emit `{summary, confidence: 0.0-1.0}`. Behavior by threshold:

| Confidence | Action | Metadata stamped |
|---|---|---|
| ≥ 0.7 | Commit rewrite silently | `lsl_resolved_at`, `lsl_resolution_source`, `lsl_resolution_window`, `lsl_resolution_confidence`, `pre_resolution_summary` |
| 0.4 – 0.7 | Commit rewrite + flag for review | All of above + `lsl_resolution_needs_review = true` |
| < 0.4 OR no antecedent | **Do not rewrite.** Stamp skip marker | `lsl_resolution_skipped = "low_confidence"` or `"no_antecedent"`, `lsl_resolution_attempted_at` (idempotency: same row not retried on next run unless `--force`) |

**Dashboard surfaces** (folds in Could #10): `/health/state` exposes
`observations.summary_integrity` with three counts —
`resolved_high_confidence`, `flagged_for_review`, `skipped`. Dashboard
renders a badge from this. (Out of scope for Phase 50 execute; goes
into Plan 3 as an optional add-on or deferred to a follow-up plan.)

**Rejected alternative:** "Always commit + stamp confidence" is simpler
but the user's standing preference (per project memory:
`feedback_e2e_verify.md`, `feedback_test_statusline_in_tmux.md`) is
high-evidence quality bars over speed. A silent low-confidence commit
that gets surfaced later is harder to audit than a deliberate skip.

### D-47-Boundary: Phase 47 stays separate (writer-path fix only)

Phase 47 (ObservationWriter drops user-prompt text when image
attachments present) remains in the backlog as its own phase. Its
scope is **only** the writer-path fix — preserve prompt text on
image-only messages so future rows are not stripped.

Phase 50 handles the **recovery** tier for historical rows via
detector C. The two phases are NOT merged. Two distinct ROADMAP
entries, two distinct closures.

**Practical consequence for Phase 50 planning:** Don't include the
writer-path change in Plan 2. Plan 2's writer-side change is ONLY
the capture-time `needs_lsl_resolution` stamp + the
`_buildPriorContext` migration — neither of which is the
image-attachment fix.

**Rejected alternative:** Folding 47 into 50 was tempting (one PR,
one closure) but breaks the audit trail and conflates writer-side
fixes with reader-side recovery — different blast radii, different
verification approaches.

### D-Primitives: `lib/lsl/` top-level, plain ESM

Two new files at the repo root:

- `lib/lsl/window.mjs` — exports `getLSLWindow(observation, opts)`
  per scope Must #1.
- `lib/lsl/scan-and-convert.mjs` — exports
  `scanTranscriptsForUnconverted(searchPaths, opts)` and
  `convertTranscriptsToObservations(transcripts, opts)`. Factored
  from `scripts/convert-transcripts.js` (10KB, already converts
  one transcript) + `scripts/backfill-subagent-transcripts.mjs`
  (5KB PoC seed).

Both modules are **plain ESM** (`.mjs`), no build step, no
TypeScript. Mirrors the existing `lib/<category>/` convention
established by `lib/adapters/`, `lib/agent-api/`, `lib/fallbacks/`,
`lib/integrations/`, `lib/agent-detector.js`, `lib/agent-registry.js`.

**Consumers:**

- `scripts/resolve-observations-from-lsl.mjs` (Plan 1) — imports both.
- `src/live-logging/ObservationWriter.js` (Plan 2) — imports
  `window.mjs` for the migrated `_buildPriorContext`.
- Phase 51 — imports both modules unchanged. This is the entire
  point of "land in 50, reuse in 51" (decided 2026-05-26
  pre-discuss). The sub-agent transcript paths
  (`~/.claude/projects/<encoded>/subagents/agent-*.jsonl`,
  `/private/tmp/`) are scanner config, not a code change.

**Module shape (rough):**

```javascript
// lib/lsl/window.mjs
export function getLSLWindow(observation, {
  maxPrompts = 3,        // primary stop condition
  maxWallClockMs = 24*60*60*1000,  // safety net
  maxBytes = 30 * 1024,  // prompt-size cap
  project,               // scope to same project's LSL dir
} = {}) { /* returns { exchanges, sourceFile, byteCount, windowSpanMs } */ }

// lib/lsl/scan-and-convert.mjs
export function scanTranscriptsForUnconverted(searchPaths, { since, project } = {}) {
  /* returns [{ path, mtime, projectHint, parentSession }] */
}
export function convertTranscriptsToObservations(transcripts, { dryRun, tag } = {}) {
  /* returns [{ transcriptPath, observationsWritten, skipped }] */
}
```

**Rejected alternative:** A new `@coding/lsl-tools` package was the
"most reusable" option but adds package boilerplate (package.json,
tsconfig if TS) for code that's used by exactly two callers. Defer
extraction to Phase 999.1-style submodule work if it grows.

### D-Reuse: Primitives land in Phase 50, Phase 51 imports them (pre-discuss decision)

Decided 2026-05-26 before the discuss-phase began, in response to
the "Phase 50 and 51 share two primitives" framing. Phase 51 does
NOT re-implement `getLSLWindow` or `scan-and-convert`; it imports
them from `lib/lsl/`. This is the dependency that makes Phase 50
block Phase 51.

**Consequence:** Phase 50 plan-checker MUST verify that
`lib/lsl/window.mjs` and `lib/lsl/scan-and-convert.mjs` are
exported with stable signatures, because Phase 51 will lock against
them. No breaking changes to either module after Phase 50 closes
without coordinated Phase 51 follow-up.

### Claude's Discretion

The following are NOT locked in this CONTEXT and downstream agents
have flexibility:

- The exact prompt template wording sent to the LLM (the
  `resolver_prompt_shape` body above is a sketch; the planner may
  tune phrasing for the specific LLM provider).
- Whether the LSL window walker reads files lazily or pre-loads
  hourly chunks into memory — depends on observed performance.
- Whether to use Claude Code via the proxy or Copilot for the
  resolver LLM calls. CLAUDE.md routing convention defaults to
  proxy; the planner may pick a per-task `processOverrides` config.
- Database schema migration — the new `metadata.*` fields are
  observation-level JSON, not new columns. No schema migration
  needed; the planner may add a doc-only schema comment.

</decisions>

---

## Canonical References

<canonical_refs>

**Downstream agents MUST read these before planning or implementing.**

### Phase 50 spec + this phase

- `.planning/phases/50-lsl-grounded-async-observation-resolver-backfill-ambiguous-r/50-CONTEXT.md` (this file) — full spec including the decisions block above
- `.planning/ROADMAP.md` § Phase 50 — one-line summary

### Related phases (must respect their boundaries)

- `.planning/phases/47-observationwriter-preserve-prompt-text-when-image-attachment/47-CONTEXT.md` — Phase 47 stays as the writer-path fix; Phase 50 handles recovery only (D-47-Boundary)
- `.planning/phases/51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as/51-CONTEXT.md` — Phase 51 imports `lib/lsl/window.mjs` + `lib/lsl/scan-and-convert.mjs` unchanged (D-Reuse)

### Source files Phase 50 will modify or create

- `lib/lsl/window.mjs` — NEW (D-Primitives)
- `lib/lsl/scan-and-convert.mjs` — NEW (D-Primitives)
- `scripts/resolve-observations-from-lsl.mjs` — NEW (Plan 1)
- `src/live-logging/ObservationWriter.js` § `_buildPriorContext` at line 263 — Plan 2 migrates this to N-prompt window logic (Should #7); Plan 2 also adds the `needs_lsl_resolution` capture-time stamp around the existing call site at line 300
- launchd plist (location TBD by planner) — Plan 3

### Seed scripts to factor from (during Plan 1)

- `scripts/convert-transcripts.js` (10KB, 2026-04-19) — already batch-converts one transcript to observations. The scan-and-convert primitive's `convertTranscriptsToObservations` is a generalization of this script's core loop
- `scripts/backfill-subagent-transcripts.mjs` (5KB, 2026-05-23) — proof-of-concept written during Phase 42 wave; the scan-and-convert primitive's `scanTranscriptsForUnconverted` generalizes its directory-walker
- `scripts/backfill-raw-observations.mjs` (9KB, 2026-05-19) — different bug class (stuck `[Raw]` rows) but same shape: a CLI that runs against `.data/observations/observations.db` with `--dry-run`/`--limit` flags. Use as the CLI shape template for `resolve-observations-from-lsl.mjs`

### LSL format reference

- `.specstory/history/{YYYY}/{MM}/{YYYY-MM-DD}_HHMM-HHMM_*.md` — verbatim session logs. Format is markdown with prompt-set sections (`## Prompt Set (ps_*)`) and tool-call blocks. The window walker must parse these to extract user→assistant exchanges
- Inline pronoun-resolution fix commit `2f4cbf7d7` (2026-05-23) — `src/live-logging/ObservationWriter.js _buildPriorContext` source — the existing 30-min wall-clock window logic that Plan 2 replaces

### Project conventions (from CLAUDE.md)

- `CLAUDE.md` § "Rebuilding After Code Changes" — `src/live-logging/` runs outside Docker, so Plan 2 needs no Docker rebuild
- `CLAUDE.md` § "km-core LLM proxy endpoint" — Plan 1 + Plan 3 LLM calls MUST hit `POST /api/complete` on host port 12435 (NOT port 3033). Pass `taskType: 'observation-resolution'` to route through the cheaper claude-haiku tier
- Memory `feedback_e2e_verify.md` — verify rewrites visually in the dashboard, not just via DB queries

</canonical_refs>

---

## Code Context

<code_context>

### Reusable assets

- **`src/live-logging/ObservationWriter.js`** (existing) — `_buildPriorContext` at line 263, called at line 300. Currently uses a 30-min wall-clock window on observations DB. Plan 2 migrates to `getLSLWindow` from `lib/lsl/window.mjs`
- **`scripts/convert-transcripts.js`** (existing, 10KB) — batch transcript→observations converter. Refactored in Plan 1 to expose its core loop via `convertTranscriptsToObservations` in `lib/lsl/scan-and-convert.mjs`. The CLI itself stays as a thin wrapper
- **`scripts/backfill-subagent-transcripts.mjs`** (existing, 5KB PoC) — directory walker for sub-agent transcripts. Refactored in Plan 1 to expose `scanTranscriptsForUnconverted`. Phase 51 imports it unchanged
- **`scripts/backfill-raw-observations.mjs`** (existing, 9KB) — CLI shape template (flag set, dry-run handling, idempotent commit pattern) for the new resolver CLI

### Established patterns

- **`lib/<category>/` flat ESM modules** — established by `lib/adapters/`, `lib/agent-api/`, `lib/fallbacks/`, `lib/integrations/`. No build step. New `lib/lsl/` directory fits this pattern
- **`.data/observations/observations.db` SQLite + WAL** — read/write with `better-sqlite3` or `sqlite3`. Schema: observations table with JSON `metadata` column. New fields (`lsl_resolved_at`, `lsl_resolution_*`, `needs_lsl_resolution`) are JSON keys, no schema migration
- **`POST /api/complete` on `host.docker.internal:12435`** — LLM proxy endpoint. NOT OpenAI-compatible. Body: `{process, messages, taskType?}`. Routing: `taskType` selects cheaper provider (haiku). Per-CLI process tag enables `processOverrides` in `llm-settings.json` to pin provider/model
- **Idempotent backfill scripts under `scripts/`** — existing pattern: `--dry-run`, `--limit`, `--since`, `--id`, `--force`, fail-loud error budget. Stamp completion via metadata field that prevents re-processing

### Integration points

- **ObservationWriter writer path** (Plan 2) — single function modified; existing tests in `tests/live-logging/ObservationWriter.retention-floor.test.js` provide the regression suite shape. New test file follows that pattern
- **Health coordinator `/health/state`** (Plan 3, optional add-on per D-Confidence) — coordinator already exposes computed counts. Add `observations.summary_integrity` block with three counters. Read path only; no writer-side changes
- **launchd plist** (Plan 3) — pattern already used by the rapid-llm-proxy wrapper (`_work/rapid-llm-proxy/bin/start-llm-proxy.sh`). Per `reference_llm_proxy_corp_wrapper.md`, plist lives in `~/Library/LaunchAgents/`. Cron alternative: `crontab -e` entry. Planner picks one

</code_context>

---

## Deferred Ideas

<deferred>

- **Confidence dashboard badge** (Could #10) — `/health/state` integration is fully decided in D-Confidence but ships as an optional Plan 3 add-on or a follow-up phase. Not blocking for Phase 50 closure
- **Recursive sub-agent handling** — out of scope; lives in Phase 51's Could-tier work
- **Embedding-based detector D** — possible follow-up: detect "vague summary" not by regex but by low semantic-similarity to surrounding observations. Defer; current detectors A+B+C cover the documented failure cases
- **Mid-phase Phase 47 retirement** — if Plan 2's writer-path migration touches enough of `ObservationWriter.js` to make the Phase 47 image-attachment fix trivially small, the planner MAY surface that as a deviation. Default per D-47-Boundary: keep them separate

### Reviewed Todos (not folded)

- `2026-05-23-orphan-digest-observation-refs.md` — 8 digests reference observations missing from both live SQLite and cold-store export. **Reviewed, not folded.** Same broad area (observation data quality) but a different failure mode (digest→observation FK integrity, not vague-summary recovery). Belongs in a separate phase

</deferred>

---

*Phase: 50 — lsl-grounded-async-observation-resolver*
*Decisions augmented: 2026-05-26*

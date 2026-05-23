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

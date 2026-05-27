---
id: lsl-rotation-removal-codesign
created: 2026-05-27
status: pending
priority: medium
tags: [lsl, etm, rotation, regression-followup]
discovered_in: 2026-05-27 LSL rotation regression repair attempt
---

# Co-design LSL rotation picker with prompt-set-block remover

## Background

The ETM has two coupled mechanisms that touch the same hourly LSL slot files:

1. **`_removeExistingPromptSetBlock`** (Phase 1 of `processUserPromptSetCompletion`)
   scans the slot's files for the given `ps_id` and removes any existing
   block (anchor + content up to next anchor / EOF).

2. **`getActiveSessionFilePath`** picks the file to append the new slice to.
   When the current candidate is over the size limit, it advances to a
   higher-numbered part (`-1`, `-2`, ...).

## The 2026-05-27 saga

Commit `83ff21fd5` ("size-aware rotation") added an `intendedWriteSize`
parameter to the picker so it would advance to the next part BEFORE the
append would push a file over the limit. The intent: prevent the
800KB-base-file regression (single fat slice grew base 4× past limit).

The implementation produced a runaway file-creation loop:

- Each ETM tick re-flushes a growing prompt-set (more exchanges).
- Phase 1 scrubs the ps_id from the previously-occupied part.
- The picker then advances PAST the just-scrubbed part because the
  new slice payload would still exceed the limit on the partially-full
  prior part.
- The new ps_id copy lands in a fresh `-N+1` part.
- Next tick: scrub from `-N+1`, write to `-N+2`. And so on.
- Observed: 40–60 stub part files in a single hour over ~10 minutes,
  with overlapping ps_id content across multiple parts.

Commit `590c37432` reverted the picker change. The original "single-fat-
slice → bloated file" regression is back, but file counts stay sane.

## The real fix

The picker and the prompt-set remover must agree on the active part set.
A few candidate shapes:

1. **Pre-write rewrite path**: instead of "advance to next part before
   write", REWRITE the existing part to evict the old prompt-set, then
   land the new write in the same part. Cleaner contract: the slot has
   exactly one home per active prompt-set at any time.

2. **Stable-home per prompt-set**: assign each prompt-set a "home part"
   (e.g., based on `hash(ps_id) mod K`) at first sight. Re-flushes always
   land in the same home regardless of file size pressure. Other parts
   may grow uncontrollably but never get duplicate ps_id content.

3. **Defer size-aware rotation to a finalisation step**: keep the
   pre-fix picker (which can create one bloated file per slot). Run a
   periodic compactor that re-balances the slot into ≤200KB parts when
   the slot is "settled" (no recent writes for N minutes). That's
   essentially what `scripts/backfill-lsl-rotation.mjs` does, just
   automated and scoped to the current day.

## Action

Pick an approach (probably #3 — it's the smallest change and doesn't
risk a similar coupling regression). Wire the compactor as a launchd
job similar to `com.coding.sub-agent-sweep` (every 30 min) but scoped
to slots older than 1 hour.

## Workaround until fixed

The current ETM allows individual files to grow to 2× the limit (the
"single fat slice" pattern). `scripts/backfill-lsl-rotation.mjs` can be
run manually with `--apply` to compact recent oversized slots; it has a
duplicate-anchor safety check that skips slots with cross-file ps_id
duplication (bulk-import legacy).

## Context

- ETM source: `scripts/enhanced-transcript-monitor.js`
  - `getActiveSessionFilePath` at ~line 2776
  - `_removeExistingPromptSetBlock` (called from the prompt-set flush path)
- Backfill: `scripts/backfill-lsl-rotation.mjs` (dry-run by default)
- Regression cleanup: `2026-05-27_2200-2300_c197ef.md` was consolidated
  from 59 runaway parts back to 1 file (2 unique ps_ids retained); the
  other 57 -N files were deleted.

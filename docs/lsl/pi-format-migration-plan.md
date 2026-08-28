# LSL → pi session format migration + dashboard Sessions tab

**Status:** plan, not yet executed
**Scope:** replace the *serialization format* of LSL tranche files with pi's
session JSONL. Rotation, hourly tranching, filename structure, redirect
routing and the 5-layer classifier are **out of scope and unchanged**.

---

## 1. Verdict on the prior research

The earlier pass (sonnet/pi) got the map roughly right but four load-bearing
claims are wrong, and they were the ones arguing *against* doing this.

| Claim | Reality |
|---|---|
| "pi's HTML export is only reachable via internal `dist/core/...`, an unstable API" | `pi --export <in.jsonl> [out.html]` is a **first-class documented CLI flag** (`dist/cli/args.js:117`, help text line 288). No library import, no `exports`-map problem. Verified working. |
| "The /share flow hard-depends on `gh` CLI + a real gist — unacceptable" | True of `/share`, irrelevant to `--export`. `--export` is offline, unauthenticated, and emits a **fully self-contained** file (0 external `http` refs, verified). |
| "Changing the storage format means rewriting every adapter to synthesize parentId chains — high blast radius for no benefit" | ETM already normalizes all agents into one internal `exchange` object *before* formatting. The change lands at **one serializer boundary** (`formatExchangeForLogging` + the flush loop), not per-adapter. |
| "…for no benefit, since LSL markdown already round-trips fine" | There is a concrete benefit. `_removeExistingPromptSetBlock` does **regex block surgery on markdown text** to make re-flushes idempotent, and the code comments record that this design already caused a runaway-file regression which forced size-aware rotation to be reverted (`enhanced-transcript-monitor.js:3390`, `:3874`). In JSONL that operation becomes a line filter on a `promptSetId` field. |

Two things the prior pass missed entirely, both of which make this cheaper
than it looks:

- **`TranscriptNormalizer.parseSpecstory()` is already a multi-format
  dispatcher** (`src/live-logging/TranscriptNormalizer.js:336`), with
  `isLslTrancheFormat()` selecting between the ETM tranche format and the
  legacy `### Human:` specstory format. A pi branch is the *designed*
  extension point. **Consequence: the backfill is not a cutover.** Old `.md`
  keeps parsing while new `.jsonl` is written, so writer and backfill ship
  independently.
- **pi's schema has sanctioned extension points for exactly our metadata**:
  `SessionHeader.parentSession`, `SessionInfoEntry`, `LabelEntry`, and
  `CustomEntry{customType,data}` (`dist/core/session-manager.d.ts`). We do not
  need to invent side-car files for prompt-set ids or classification.

## 2. What was verified empirically (not inferred)

- `pi` 0.84.2 at `/opt/homebrew/bin/pi`; session format **version 3**.
- `pi --export` on a real session from `.observations/pi-sessions/` → exit 0,
  270 KB HTML, **zero** external `src=`/`href=` http references.
- A **synthetic LSL-shaped** session — `parentSession` set to a sibling
  tranche file, `session_info`, two `custom` entries (`lsl.tranche`,
  `lsl.promptSet`), a `label`, and a user/assistant/toolResult triple —
  exported cleanly and rendered correctly (bash tool call shown natively with
  its output, token/cost summary computed from `usage`).
- **Multi-branch topology renders in full.** Two sibling prompt-sets hung off
  one spine entry: all four markers present in the DOM. The renderer walks
  `entries` in file order, not the branch to `leafId`. This is what makes the
  "spine + per-prompt-set subtree" design safe.
- Session data is embedded base64 in `<script id="session-data">` and rendered
  client-side; **`custom` entries survive verbatim but are not displayed**
  (they are classed as settings entries, `template.js:388`).
- The export `<h1>` is `Session: <uuid>` — it does **not** use
  `session_info.name`. Our own viewer chrome must supply the human title.
- No `--theme` flag on the export CLI path; theme comes from pi settings.

**Corpus scale:** `coding` has **23,491** `.md` LSL files / **2.6 GB** under
`.specstory/history/2026`. Other projects with nested LSL repos:
agentic-ai-nano 307, curriculum-alignment 63, ui-template 63, km-core 37,
balance 11, timeline 11.

## 3. Target format

One hourly tranche file = one pi session file. Filename base is unchanged;
only the extension moves `.md` → `.jsonl`
(`2026-08-26_1100-1200_c197ef.jsonl`, `…-1_c197ef.jsonl` for rotated parts,
`…_from-rec.jsonl` for redirects).

```
{"type":"session","version":3,"id":<uuid>,"timestamp":<tranche start>,
 "cwd":<target project>,"parentSession":<previous tranche/part basename>}
{"type":"session_info",...,"name":"WORK SESSION (1100-1200) — coding"}
{"type":"custom",...,"customType":"lsl.tranche","data":{
   timeWindow, agent, sourceProject, redirected, userHash, generatedAt}}
  ← the spine entry; every prompt set parents off this
{"type":"custom",...,"customType":"lsl.promptSet","data":{
   promptSetId, sliceIdx, totalSlices, classification, toolCalls, durationMs}}
{"type":"model_change",...}                       ← provider/model per set
{"type":"message",...}  role=user       ← the prompt
{"type":"message",...}  role=assistant  ← text + toolCall blocks
{"type":"message",...}  role=toolResult ← content + isError
{"type":"label",...,"targetId":<user msg id>,"label":"ps_<id>"}
```

Design rules that fall out of the verification:

1. **Spine, not chain.** Each prompt set's first entry has
   `parentId = <spine entry id>`; entries *within* a set chain linearly.
   Deleting a prompt set is then removing a self-contained subtree — no
   re-linking, which is precisely what makes the idempotent re-flush safe.
2. **`custom` for machine-readable, `session_info`/`label` for visible.**
   `custom` payloads are preserved but not rendered. Do **not** put anything
   the human must see in a bare `custom` entry. Avoid `custom_message` for
   metadata: it *does* enter LLM context via `buildSessionContext`, which
   would poison a future `pi --resume` of an archived tranche.
3. **Cross-tranche prompt sets keep the same `promptSetId`** across slices, as
   today, so `grep -l ps_X *.jsonl` still reconstructs a full set.
4. Redaction (`ConfigurableRedactor`) applies to text block contents, same as
   today — it moves from "before markdown interpolation" to "before JSON
   serialization". Note this is a **behaviour improvement**: JSON escaping
   removes the current risk of tool output containing ``` breaking the fence.

## 4. Plan

### Phase 0 — spike (½ day, throwaway)

- `scripts/spike/lsl-md-to-pi.mjs`: convert 20 sampled `.md` tranches
  (single-slice, multi-slice, redirected, rotated part, image-bearing,
  redaction-marked) to the format above; run `pi --export` on each; screenshot
  three via `gsd-browser`.
- **Gate:** all 20 export exit-0 and render their user prompt + tool calls. If
  any category fails, the format spec changes before any writer is touched.

### Phase 1 — the serializer (the actual change)

New `src/live-logging/PiSessionWriter.js`, owning *only* format:

- `buildTrancheHeader(tranche, meta)` → header + `session_info` + spine.
- `buildPromptSetEntries(promptSetId, exchanges, spineId, meta)` → the entry
  array for one slice.
- `removePromptSet(lines, promptSetId)` → line filter replacing
  `_removeExistingPromptSetBlock`'s regex surgery.
- `appendEntries(file, entries)` → newline-delimited append.

Wire into `enhanced-transcript-monitor.js`:

- `formatExchangeForLogging` / `formatToolCallContent` / the two
  `formatTextExchange` variants (≈ lines 3960–4200) become entry builders.
- The flush loop (≈ 3830–3890) emits entries instead of concatenating
  markdown. Tranche routing, slicing, the lockfile, and
  `checkFileRotation`'s size test are **untouched** — they operate on byte
  counts and file paths, both format-agnostic.
- `getActiveSessionFilePath` and the `_removeExistingPromptSetBlock` day-wide
  scan switch their `.md` suffix filter to `.jsonl`.

Same treatment, same helpers, for `scripts/write-sub-agent-lsl.mjs`.

**Guard rail (memory: `feedback_lsl_rotation_coupling`):**
`getActiveSessionFilePath` and `_removeExistingPromptSetBlock` are coupled —
changing the picker alone previously produced 40+ stub files/hour. They must
change in one commit, with a stub-count check after.

**Acceptance:** run a live agent turn; assert exactly one `.jsonl` written,
`pi --export` on it exits 0, re-flushing the same prompt set leaves the file
byte-identical, and `.logs/etm.log` shows no `[STALL-DETECT]`.

### Phase 2 — readers

- `TranscriptNormalizer.parseSpecstory()`: add a `.jsonl`/`{"type":"session"`
  detection branch → `parsePiSession()` producing the same
  `MastraDBMessage[]`. **Keep both markdown parsers.** This is what makes
  Phase 3 optional and reversible.
- `AdaptiveTranscriptFormatDetector.js`: register the new format.
- Sweep the format-aware consumers found by grep and give each the new branch:
  `scripts/lsl-dedupe.mjs`, `scripts/split-lsl-files.cjs`,
  `scripts/classification-logger.js`, `scripts/batch-lsl-processor.js`,
  `src/live-logging/SpecstoryBatchConverter.js`,
  `integrations/semantic-analysis/src/agents/vibe-history-agent.ts`,
  and the `/sl` skill.
- `LSLFileManager.isValueableLSLFile()` currently judges markdown; it needs a
  JSONL notion of "valuable" (entry count / has ≥1 user message).

**Acceptance:** `parseSpecstory` over a mixed directory yields identical
message counts for a `.md` tranche and its `.jsonl` conversion.
Per `feedback_acceptance_grep_word_boundary`: the "no markdown-only assumption
left" gate is a `\.md['"\`]` grep over the consumer list, not one case variant.

### Phase 3 — backfill (`scripts/backfill-lsl-to-pi.mjs`)

```
node scripts/backfill-lsl-to-pi.mjs \
  [--project <path>|--all-history-repos] [--year 2026] [--month 08] \
  [--dry-run] [--verify] [--keep-md] [--commit] [--jobs N]
```

- `--dry-run` is the **default**; writing requires an explicit `--write`.
- Discovers targets by scanning `~/Agentic/*/.specstory/history/.git` (7 repos
  today) rather than a hardcoded list.
- Per file: parse via `TranscriptNormalizer` (so backfill and runtime share
  one parser and cannot drift), emit `.jsonl`, then `--verify` runs
  `pi --export` to `/dev/null` and requires exit 0 plus a user-message count
  match. Any failure quarantines that file to `.specstory/quarantine/` and
  leaves the `.md` in place.
- Default is **replace** (`git rm` the `.md`, add the `.jsonl`).
  Rationale: `--keep-md` would take `coding` from 2.6 GB to ~5 GB in a repo
  that is already a 2.6 GB nested git repo.
- `--commit` writes one commit per `YYYY/MM` directory, not one per file, and
  per project — so a bad batch reverts cleanly.
- Resumable: skips a `.md` whose sibling `.jsonl` exists and verifies.

**Do this before running it:** tag the current HEAD of each history repo
(`pre-pi-format`) and confirm each has a pushed remote. This rewrites 23,491
files; the tag is the only cheap way back.

**Acceptance:** on a *copy* of `.specstory/history/2026/08`, convert, then
diff observation extraction (`parseSpecstory` message counts + prompt-set ids)
before vs after — must be identical. Only then run for real.

### Phase 4 — dashboard "Sessions" tab

Recommended split, and the reason for it: **we own navigation, pi owns
rendering.** Reimplementing pi's tool renderers (bash/read/edit/diff/ANSI —
~1000 lines of `template.js`) would be re-derived work that silently rots as
pi evolves.

- **Backend** (`integrations/system-health-dashboard/server.js`, following the
  `/api/observations` handler pattern at `:529`):
  - `GET /api/lsl/sessions` — list tranches across projects; from the header +
    `lsl.tranche` custom entry: project, agent, window, prompt-set count,
    tokens, size. Cheap: reads only the first ~4 lines of each file.
  - `GET /api/lsl/sessions/:id/entries` — parsed JSON for the React shell.
  - `GET /api/lsl/sessions/:id/export.html` — cached `pi --export` output,
    regenerated on mtime change, written under `.data/lsl-html/`.
  - `GET /api/lsl/promptset/:psId` — the cross-tranche stitch: every slice of
    one prompt set, in order. This is the thing markdown could only ever do
    with `grep -l`.
- **Frontend**: `src/pages/lsl-sessions.tsx` + nav entry in `nav-bar.tsx`
  **at index 1, before Observations** (`nav-bar.tsx:51`). React shell for the
  project/agent/date filters, tranche timeline and prompt-set index;
  `<iframe>` of the cached pi export for the transcript body.
- Non-pi agents need nothing special — after Phase 1 *all* agents write pi
  format, which is the whole point of doing the storage change rather than
  just the viewer. The prior research's "scope the tab to pi-only sessions
  initially" fallback is unnecessary.
- **Verify with `gsd-browser` against :3032** and add
  `tests/e2e/dashboard/lsl-sessions.spec.ts` (memory: `feedback_e2e_verify`,
  `feedback_dashboard_screenshots_gsd_browser`).
- Dashboard is bind-mounted: `npm run build` then
  `supervisorctl restart web-services:health-dashboard-frontend` for the UI;
  full `docker-compose restart coding-services` for `server.js`.

## 5. Open decisions

1. **Extension `.md` → `.jsonl`** — recommended. A `.md` file containing JSONL
   breaks every markdown viewer and the GitHub rendering of the history repos.
   Cost: git sees delete+add for 23k files.
2. **Backfill replaces vs. keeps `.md`** — replace recommended (size, above).
3. **Backfill breadth** — all 7 history repos, or `coding` first and the rest
   after a soak? Recommended: `coding`'s current month first, soak one week,
   then the rest.
4. **`.observations/pi-sessions/`** — pi's own native sessions now overlap
   with LSL tranches for pi runs. Decide whether ETM keeps deriving tranches
   from them (consistent hourly view, some duplication) or links to them.
   Recommended: keep deriving; the tranche is a different unit than a session.

---

# Phase 0 results (executed) — the format spec changed

The 20-file gate **failed as designed**, and the failures were worth more than
the successes. 6 of 21 sampled files produced zero prompt sets. Root causes,
all quantified over the full 2026 corpus (18,482 files), not the sample:

## Finding 1 — LSL is three dialects, not one

| Dialect | Marker | Files |
|---|---|---|
| A — ETM tranche (current) | `# WORK SESSION (HHMM-HHMM)` | 6,779 |
| B — legacy Claude Code log | `# Claude Code Session Log`, `## Prompt Set 1 (ps_N)` | 179 |
| C — sub-agent | YAML frontmatter + `# Sub-agent session — …`, no `## Prompt Set` heading | 800 |

Dialect B numbers its heading (`Prompt Set 1 (ps_…)`), which defeats the
`^##\s+Prompt Set\s*\(ps_\d+\)` anchor used by both the spike **and the
production `TranscriptNormalizer.isLslTrancheFormat()`**. Dialect C anchors
prompt sets with a bare `<a name="ps_N">` followed directly by
`**User Message:**`. Both need explicit parser branches.

## Finding 2 — 57% of files are headerless fragments, split mid-token

The remaining **10,569 files (57%)** carry none of the three markers. All
10,569 are rotated part files, and none has an H1 or a prompt-set anchor in
its head. Verified concretely: part 186 of one chain ends mid-`**Input:**`
JSON fence and part 187 opens with that exact continuation. **Parts split
mid-token, not at block boundaries.**

Consequences — this invalidates the per-file backfill in §4 Phase 3:

- A part file is **not** an independent document and cannot be parsed alone.
  The backfill must operate on **chains**, keyed by
  `(date, window, hash, redirect-suffix)`, concatenated in part order.
- ~~**Every** file in 2026 is suffixed `-N_`; there are **zero** unsuffixed
  files.~~ **WRONG — corrected during Phase 3.** That check used a `find` with
  negated `-name` patterns that did not do what it looked like it did. Both
  forms coexist: `2026-08-02_1300-1400_c197ef.md` (320 KB, the base tranche)
  sits alongside `2026-08-02_1300-1400-1_c197ef.md` (104 KB, its first
  rotation). The **unsuffixed file is part 0**, not part 1 — see
  `getActiveSessionFilePath()`, which writes the base file first and only then
  starts `-1`. Defaulting it to 1 collides with the real `-1_` part, and a
  chain holding both emits one part's entries into *both* files. Locked by
  parser test 1b.
- Chains are **gapped**. One sampled chain has 198 files but a max part index
  of 293 — `LSLFileManager.cleanupLowValueLSLFiles()` deleted 95 mid-chain
  parts. A gap means a block whose continuation no longer exists.
- 11,797 chains vs 7,758 header-bearing files ⇒ roughly **4,000 chains have
  lost their part-1 entirely** and can only take metadata from the filename.
- Chains are large: one concatenates to 21 MB.

## Revised Phase 3 (supersedes §4 Phase 3)

1. **Group into chains** by `(date, window, hash, redirect-suffix)`; sort
   parts numerically.
2. **Concatenate** the chain, recording each part's byte range.
3. **Parse once** over the concatenation, with a dialect branch selected from
   the header (or from the filename when the chain has no header). Tag each
   parsed block with the part it *started* in.
4. **Emit one `.jsonl` per surviving part**, containing that part's blocks —
   filenames and the 1:1 file mapping are preserved, as required. Each part's
   `session` header sets `parentSession` to the previous surviving part, so
   the fragmentation becomes explicit and navigable, which markdown never was.
5. **Gaps**: a block cut by a missing part is emitted truncated with
   `lsl.truncated: {reason:'missing-part', afterPart:N}` on the toolResult, not
   dropped and not quarantined — the data loss already happened at cleanup
   time; the marker records it honestly.

The 1:1-file and same-basename guarantees are unchanged. Only the *parse unit*
becomes the chain.

## Finding 3 — the corpus is already lossy

`formatToolCallContent` truncates tool output to **500 chars** before writing
(`enhanced-transcript-monitor.js:4011`). The backfill cannot recover what was
never written. The new writer should revisit that cap separately: JSON
escaping removes the fence-breaking hazard that motivated it.

## Correction to §4 Phase 3 as originally written

The original plan said the backfill should parse via `TranscriptNormalizer` so
runtime and backfill "share one parser and cannot drift". That was wrong:
`parseLslTranche()` is **lossy by design** — it collapses every tool call into
a 4000-char synthesis for observation extraction. Faithful conversion needs a
separate parser. `TranscriptNormalizer` remains the *equivalence check*
(message counts before vs after), not the conversion path.

## Phase 0 verdict: PASSED (after two parser corrections the gate caught)

Full 2026 corpus converted by `scripts/spike/lsl-chain.mjs`: **2,679 chains →
16,215 part files, 112,460 prompt sets, 1.61M tool results, zero empty chains,
94 seconds, 2.5 GB out vs 2.6 GB in** (format change is size-neutral).
`pi --export` verified on 44 stratified/random outputs including >2 MB files:
**44/44 exit 0**. Rendering spot-checked in-browser for all three dialects.

Two bugs the gate caught, both of which would have silently corrupted the
whole backfill had we gone straight to writing code:

1. **Over-eager `###` splitting.** August has 36,376 `### ` headings but only
   19,996 real exchange headings — **45% are markdown headings inside
   assistant prose** (`### Step 1: …`). Splitting on every h3 invented ~16k
   phantom tool calls per month; a screenshot showed them as entries named
   `1. Docker Copilot Provider Fix` with `{}` arguments. Fixed by requiring the
   writer's actual grammar: `### <tool> - YYYY-MM-DD HH:MM:SS UTC` for
   dialects A/B-tool, bare `### User`/`### Assistant` for dialect B.
2. **Anchoring on the heading instead of the anchor.** August has 2,525
   `<a name="ps_N">` anchors but only 1,865 `## Prompt Set` headings — **521
   anchors have no heading**, because `_removeExistingPromptSetBlock` strips a
   block body and can leave the bare anchor behind. Heading-anchoring dropped
   26% of prompt sets and the 16% of tool calls inside them. Fixed by anchoring
   on `<a name="ps_N">` for every dialect and treating the heading as optional
   metadata.

**Post-fix equivalence (August, ground truth = the concatenated chain text):**
prompt sets **2,525/2,525 (100%)**; tool calls **19,760/19,771 (99.94%)**.
The residual 11 are bidirectional (±) and occur only in gapped chains where
`cleanupLowValueLSLFiles()` destroyed mid-chain parts — e.g.
`2026-08-19_0800-0900` retains 10 of 19 parts and is missing parts 1–8
*including its header*. Those blocks are emitted flagged
`details.lslTruncated`, not dropped and not silently rounded away.

### One more Phase 3 requirement this surfaced

16,215 `.jsonl` are emitted from 18,482 `.md`. The **2,267 files (12%) that
emit nothing are parts in which no block starts** — their bytes are preserved,
attributed to the part where the containing block began. The backfill must
write a `chain-map.json` recording that absorption so a missing `.jsonl` for a
given `.md` is provably "absorbed into part N", not "lost". Do **not** paper
over it by emitting empty session files.

---

# Execution log

## Phase 1 — writer (done, `a730d141f`)

Both writers emit pi session JSONL. Rotation, tranching, filenames, redirect
routing and the classifier untouched. Three capabilities markdown could not
express are now free: `parentSession` chaining of rotation parts, prompt-set
removal as a subtree filter instead of regex byte-range surgery, and
JSON-escaped tool output (no fence-break hazard).

**Idempotent re-flush now actually holds** — ids are seeded per
(filename, promptSetId), so remove-then-re-append is byte-identical.

**Pre-existing data-loss path found, deliberately NOT fixed** (rotation policy
is out of scope): in the rotation branch, `createSessionFileWithContent()`
writes only when the target does not exist, and the call sits inside the `else`
of an existence check — so the slice is silently dropped. Present in the
markdown code today. Documented in place; worth its own change.

## Phase 2 — readers (done, `047d49f36`)

Both formats supported permanently, dispatching on CONTENT not filename.

**The parity acceptance in §4 Phase 2 failed, in the good direction.** Over 200
August chains the pi path is a strict SUPERSET of the markdown path in
**200/200**, recovering **54% more messages** (3,759 vs 2,436). The markdown
parser was under-reporting three ways: heading-anchored prompt sets (misses the
521 heading-less anchors), `**User Request:**` only (skips sets whose prompt is
in a `**User Message:**` block), and first-user-turn-only per set. Expect
richer observation input from here.

**`LSLFileManager` was the dangerous edit.** `cleanupLowValueLSLFiles()` deletes
what `isValueableLSLFile()` rejects, and the markdown heuristics return zero on
JSONL — admitting `.jsonl` to the candidate filter without a format branch
would have deleted every file the new writer produces. One edit, guarded by a
test.

`split-lsl-files` stays markdown-only on purpose: slicing JSONL text emits
headerless fragments, the exact orphan-part problem this migration removes.
`AdaptiveTranscriptFormatDetector` needed nothing (it learns agent transcript
formats, not LSL).

## Phase 3 — backfill

`scripts/backfill-lsl-to-pi.mjs`. Chain-unit, `--dry-run` by default,
verify-before-remove, quarantine on failure, resumable, per-YYYY/MM commits,
`pre-pi-format` tag per repo before any write.

**Design note — whole sets stay in one part file.** Entries for a prompt set are
attributed to the part holding its `<a name>` anchor, not spread across parts by
block. Splitting by block would preserve the original byte distribution but
leave `parentId` references dangling across file boundaries, breaking pi's tree
rendering. Keeping sets whole is what makes each part file independently valid.
The cost is that a part in which no set STARTS emits nothing; those are recorded
in `chain-map.json` as `absorbedInto`, and test 4 asserts
`emitted + absorbed == parts` so a source file can never be merely absent.


## Phase 3 execution — two bugs the ground-truth check caught

Both were silent, both would have corrupted the corpus, and neither is visible
without comparing converted output against counts taken from the source.

1. **Part-index collision (content duplication).** See the correction above.
   Symptom: chains reporting `parts=1,1`, emitting 27,537 tool results against
   19,764 in the source — a 39% over-count, because one part's entries were
   written into two files.

2. **`logs/classification` pulled into transcript chains.**
   `.specstory/history/` is not only transcripts: `logs/classification/` holds
   **952 markdown summaries whose filenames are byte-identical to the
   transcripts they describe**, and `docs/` holds documentation. A recursive
   walk therefore grouped a summary and its transcript into one chain,
   doubling every prompt set — and with `--write` would have converted and
   **deleted the summaries**. The walker is now scoped to the `YYYY/` trees
   only. Locked by backfill test 5c.

**Post-fix, August 2026:** 342 md → 341 jsonl, 1 absorbed, prompt sets
**2,524/2,524 (100%)**, tool calls **19,753/19,764 (99.94%)** — exactly the
parser's own ground truth, with the residual 11 being the known gapped-chain
artifact.

## One more safety rule added in Phase 3

**Markdown that git cannot restore is never deleted.** The `pre-pi-format` tag
only protects *committed* content. `km-core`'s history repo has its entire
`2026/` tree **untracked** with no `origin/main` ref, so a naive unlink would
have destroyed 37 files with no way back. The backfill now checks each file is
tracked AND unmodified before removing it, keeps it otherwise, and reports the
count. `--force-delete-unrecoverable` overrides. Locked by backfill test 5b.

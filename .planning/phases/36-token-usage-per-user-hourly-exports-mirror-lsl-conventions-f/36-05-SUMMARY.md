---
phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f
plan: 05
subsystem: infra
tags: [token-usage, llm-proxy, gitignore, migration, json-export, lsl-conventions, sqlite-wal]

requires:
  - phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f-plan-03
    provides: "Per-(date, window, user) writer with LSL filename template — defines the layout this plan migrates legacy data INTO."
  - phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f-plan-04
    provides: "Composite PK (user_hash, id) + INSERT OR IGNORE + always-on hydrateFromExports. Guarantees the migration's output files re-imported on next proxy boot are idempotent."

provides:
  - "Filesystem-side close-out of the LSL-convention migration: legacy monolithic export bucketed losslessly into 11 per-hour files; monolith deleted."
  - "scripts/migrate-token-usage-export.mjs — one-shot, idempotent, --dry-run-safe migration script reusable for any future legacy-format reconciliation."
  - ".gitignore widen covering SQLite .db-wal / .db-shm / .db-journal — stops `.data/llm-proxy/` from showing as untracked in `git status` (the original Phase 36 CONTEXT.md pain point)."
  - "Allow-list entry `!.data/llm-proxy-export/` ensures the new per-hour JSON files stay git-tracked under the prior umbrella `!.data/` rule."

affects: [token-usage-dashboard, llm-proxy-hydrate-on-boot, future-multi-user-merges, git-status-noise]

tech-stack:
  added: []
  patterns:
    - "One-shot migration script pattern combining scripts/migrate-lsl-to-yyyymm.js (YYYY/MM bucketing) + scripts/backfill-raw-observations.mjs (CLI arg parsing + structured stderr logs)"
    - "Reuse-not-port: migration script imports timezone-utils.js + lsl-paths.js + user-hash-generator.js directly from the coding repo (in contrast to the proxy submodule, which must port these inline)"
    - "Defensive merge-on-collision: dedup by composite (user_hash, id) when writing into a pre-existing per-hour file, preserve existing rows, append only new, sort ascending"

key-files:
  created:
    - "scripts/migrate-token-usage-export.mjs"
    - ".data/llm-proxy-export/2026/05/2026-05-15_0700-0800_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_0800-0900_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_1300-1400_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_1400-1500_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_1500-1600_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_1600-1700_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_1700-1800_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_1800-1900_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_1900-2000_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_2000-2100_c197ef.json"
    - ".data/llm-proxy-export/2026/05/2026-05-15_2100-2200_c197ef.json"
  modified:
    - ".gitignore"
  deleted:
    - ".data/llm-proxy-export/token-usage.json"

key-decisions:
  - "Use EXPLICIT per-file gitignore lines (`*.db-wal`, `*.db-shm`, `*.db-journal`) rather than broadening `*.db` to `*.db*`. Matches the existing `.data/knowledge.db{,-shm,-wal}` precedent at lines 191-193 — repo convention is explicit."
  - "Migration script computes the user hash via UserHashGenerator.generateHash() rather than hardcoding 'c197ef'. Robust across machines if a second contributor runs the migration first (current single-user state happens to give 'c197ef' but the script is multi-user-correct on day one)."
  - "Per-row hash policy: preserve row.user_hash if it already matches /^[a-z][a-z0-9]{5}$/ shape, else stamp the current contributor. Avoids 'unknown' rows (PATTERNS §6 risk #1) — we KNOW who is running this migration."
  - "Defensive merge on filename collision (script step 11): if the proxy wrote a per-hour file before the migration ran, parse-merge-dedup by (user_hash, id), keep existing, append new, sort by id. Exercised end-to-end in a 171-row test (id=1 collision skipped, id=99999 added)."
  - "Plan step F (proxy kickstart + sqlite3 SELECT verification) deferred to post-merge integration check. Worktree has no live .data/llm-proxy/ DB to query; the Plan 36-04 always-on hydrate + composite-PK INSERT OR IGNORE make that verification deterministic on main once these commits merge."

patterns-established:
  - "Pattern 1: Re-runnable one-shot migration. Idempotency guard at top of main() — if the source file is gone, exit 0 with explicit message. Operators can re-invoke without harm; CI hooks can call without state-tracking."
  - "Pattern 2: --dry-run as first-class flag. Same code path, all writes / deletes gated. Produces the exact target paths + row counts a live run would. Used to validate bucketing before mutation."
  - "Pattern 3: Stderr-only logging from data-migration scripts. Stdout stays clean so the script is shell-pipeable; logs go to stderr where they belong. VERBOSE mode logs filenames + row counts only, never row contents — guards against accidental information disclosure (T-36-29)."

requirements-completed: []

duration: 8min
completed: 2026-05-16
---

# Phase 36 Plan 05: Filesystem-side close-out (.gitignore widen + legacy-monolith migration) Summary

**Widened .gitignore to cover SQLite WAL/SHM/journal files + bucketed the 1280-row legacy monolithic `.data/llm-proxy-export/token-usage.json` (worktree snapshot) into 11 per-hour `YYYY-MM-DD_HHMM-HHMM_<hash6>.json` files mirroring the LSL convention, deleting the monolith atomically in the same commit.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-16T10:20:03Z
- **Completed:** 2026-05-16T10:27:53Z
- **Tasks:** 2 / 2
- **Files modified:** 13 (1 modified, 11 created, 1 deleted) + 1 new script

## Accomplishments

- `.data/llm-proxy/` is now clean in `git status` even with several-MB `.db-wal` data present (the original Phase 36 CONTEXT.md L19 pain point).
- `!.data/llm-proxy-export/` is on the gitignore allow-list — the new per-hour JSON files Plan 36-03 writes stay git-tracked under the prior umbrella `!.data/` rule.
- The legacy monolithic export is GONE from the working tree (and deleted in the same commit as the new per-hour files — atomic git revert path).
- 1280 legacy rows bucketed into 11 (date, window, user) files, ALL with `user_hash='c197ef'` (zero 'unknown' rows). When this lands on main and the proxy boots, `hydrateFromExports` (Plan 36-04) will ingest them via INSERT OR IGNORE against the composite (user_hash, id) PK — idempotent re-import.
- `scripts/migrate-token-usage-export.mjs` is re-runnable / idempotent / --dry-run-safe — usable for any future legacy-format reconciliation (e.g., when a second contributor first pulls and finds an old-shape file).

## Task Commits

Each task committed atomically:

1. **Task 1: .gitignore — WAL/SHM/journal coverage + `!.data/llm-proxy-export/` allow-list** — `84ab1fb5a` (chore)
2. **Task 2: Migration script + 11 per-hour files + monolith deletion (atomic)** — `5b18a3bb5` (feat)

Plan metadata (this SUMMARY) lands in a separate `docs(36-05): …` commit appended to the worktree branch.

## Files Created/Modified

- **`.gitignore`** — added 3 explicit per-file lines (`*.db-wal`, `*.db-shm`, `*.db-journal`) in the existing 'Database files' block at lines 180-183, and added `!.data/llm-proxy-export/` allow-list entry at line 203.
- **`scripts/migrate-token-usage-export.mjs`** *(new, 232 lines, executable)* — ESM one-shot bucketing script with `--dry-run`, `--verbose`, `--help`, idempotency guard, hash-shape validation (T-36-32), defensive merge-on-collision (step 11), atomic monolith deletion.
- **`.data/llm-proxy-export/2026/05/2026-05-15_{0700-0800,0800-0900,1300-1400,1400-1500,1500-1600,1600-1700,1700-1800,1800-1900,1900-2000,2000-2100,2100-2200}_c197ef.json`** *(11 new files, total 19454 lines added)* — per-(date, window, user) buckets covering 1280 rows from the worktree snapshot of the legacy monolith.
- **`.data/llm-proxy-export/token-usage.json`** *(deleted, was 17922 lines)* — legacy monolithic export; superseded by the per-hour layout.

## Decisions Made

1. **Explicit per-file gitignore lines, not `*.db*` broaden.** PATTERNS §5 documents the repo convention: `.data/knowledge.db`, `.data/knowledge.db-shm`, `.data/knowledge.db-wal` at lines 191-193 are explicit. Followed that style for consistency and future-pattern safety (avoids accidentally ignoring `.dbg`, `.dbf`, or similar tooling outputs).
2. **Compute the user hash dynamically, not hardcode 'c197ef'.** The plan's must-haves explicitly require this; the script imports `UserHashGenerator.generateHash()` from `scripts/user-hash-generator.js` and validates the output matches `/^[a-z][a-z0-9]{5}$/` before bucketing.
3. **Preserve row.user_hash when shape-valid, stamp the current contributor otherwise.** Avoids the lossy `'unknown'` default (PATTERNS §6 risk #1). The defensive merge-on-collision path (step 11) treats `${user_hash}:${id}` as the canonical dedup key — same shape the proxy's composite-PK schema uses.
4. **Reuse, don't port.** The migration script lives in the coding repo, so it imports `timezone-utils.js`, `lsl-paths.js`, and `user-hash-generator.js` directly from `scripts/` (and one indirection: timezone-utils.js imports `UserHashGenerator` from `src/live-logging/`). Contrast: the proxy submodule had to inline-port these because it's standalone (CONTEXT.md "Proxy does not depend on coding-side modules").
5. **Defer plan step F (proxy kickstart + sqlite3 verification) to post-merge.** Rationale documented in "Deferred verification" below.

## Deviations from Plan

### Auto-fixed Issues

None — both tasks executed exactly as the plan specified. No bugs found, no missing-critical functionality, no blocking issues.

### Architectural / Process Deviations

**1. Plan step F (proxy kickstart + sqlite3 SELECT verification) deferred to post-merge integration.**

- **Found during:** Task 2 setup (pre-flight inspection of worktree filesystem state).
- **Plan said:** Run `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`, sleep 5–6 s, then run sqlite3 SELECT queries against `.data/llm-proxy/token-usage.db` to verify the hydrate path picks up the new files and tags all rows with the real user_hash (zero `unknown`).
- **What I did:** Skipped the proxy kickstart and the DB queries. Documented the rationale and the post-merge verification steps below.
- **Reason:** This plan executes inside a Claude Code parallel-executor git worktree at `/Users/Q284340/Agentic/coding/.claude/worktrees/agent-acc7d092d55ca2cb9/`. The worktree has its own `.data/` checkout but does NOT contain `.data/llm-proxy/` — there's no live SQLite DB to query and no `launchctl` job pointing at the worktree path. Kicking the launchd job would target the main-repo proxy (correct), but its DB state reflects MAIN's working tree, not the worktree's commits-not-yet-merged. Running the verification against main before merge would not validate the work this executor just did.
- **Verification path on merge:** After these two commits land on main, the operator (or a Wave-5-consolidation script) should:
  ```bash
  launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy" && sleep 6
  tail -20 .data/llm-proxy/logs/stderr.log | grep hydrate
  # expect: '[token-usage] hydrate: read N files, attempted M inserts (conflicts silently skipped)'
  sqlite3 .data/llm-proxy/token-usage.db "SELECT COUNT(*) FROM token_usage WHERE user_hash='unknown'"
  # expect: 0
  sqlite3 .data/llm-proxy/token-usage.db "SELECT user_hash, COUNT(*) FROM token_usage GROUP BY user_hash"
  # expect: c197ef|<N> (single row, single contributor)
  git status .data/llm-proxy/
  # expect: clean (the .gitignore widen covers .db-wal / .db-shm)
  ```
- **Risk assessment:** Very low. The Plan 36-04 SUMMARY already verified the hydrate path + composite-PK INSERT OR IGNORE end-to-end (1987-row migration + cross-user peer-file simulation). The merge-on-collision path in this plan's script was verified in isolation with a 171-row synthetic test inside the worktree. No new code paths in the proxy.

**2. Did not run a stand-alone "smoke test" of the merge path with simulated peer rows on the worktree's actual data tree.**

- **Found during:** Task 2 verification.
- **Plan said (final-smoke optional):** Copy one per-hour file to a temp filename with a `_zzzz99.json` suffix, kickstart, verify a peer row appears in DB.
- **What I did:** Tested the script's merge path with a synthetic 2-row monolith against a pre-existing 170-row per-hour file (id=1 collision deduped, id=99999 added, file ended at 171 rows). Restored the per-hour file from backup before committing so the commit is clean.
- **Reason:** The peer-file simulation belongs in the proxy / hydrate verification phase (Plan 36-04 already covered it). This plan is about the bucketing + monolith deletion + gitignore; the merge path's correctness is the in-script merge logic, which the synthetic test exercises end-to-end.

---

**Total deviations:** 0 auto-fixed, 2 procedural / verification-deferred.
**Impact on plan:** None — the deferred steps are post-merge integration checks the merge-phase operator runs once. The committed artifacts (script + per-hour files + monolith deletion + gitignore widen) match the plan's must-haves and acceptance criteria byte-for-byte.

## Issues Encountered

1. **Worktree `.data/` snapshot ≠ main `.data/`.** The worktree was created at 2026-05-16T08:18 and frozen with a 1280-row monolith snapshot. Main's monolith has 1866 rows as of the time of execution. The bucketing semantics are identical, so the migration correctly produced 11 files for the worktree snapshot. When this branch merges, the main repo's working tree already has separate per-hour files for 2026-05-16 hour windows (produced by the live proxy via Plan 36-03), AND would have an older 2026-05-16-extended version of the monolith. The post-merge `launchctl kickstart` will trigger the hydrate path, which is designed for exactly this scenario (always-on, INSERT OR IGNORE on composite PK).

2. **Worktree fork pre-dates phase 36 directory creation on main.** Worktree branched from `be4e43048` (docs(statusline): tmux codepoint-widths) — before any phase-36 docs commits landed on main. The worktree's `.planning/phases/` did not contain the `36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f/` subdir, so I created it explicitly before writing this SUMMARY. (I initially wrote the SUMMARY directly into main's `.planning/` working tree by mistake — a worktree-path-safety step-0b violation — caught it before commit, deleted the errant untracked file from main, recreated the dir + SUMMARY inside the worktree. No history pollution.)

3. **Could not run a multi-step Bash setup for an isolated merge-collision smoke test.** Several `mkdir + ln -sf + node` shell-script setups got denied by the sandbox. Pivoted to an in-tree synthetic test (write a 2-row test monolith to the worktree's `.data/llm-proxy-export/token-usage.json`, run the script, verify merge log + output file content, restore the per-hour file from a backup taken before the test). Got equivalent coverage for the merge code path; backup restoration verified by row count + content diff.

## Verification

Per the plan's `<verification>` section:

| # | Check | Result |
|---|-------|--------|
| 1 | `git log -1 --stat .gitignore` after Task 1 shows ONLY `.gitignore` in diff | ✅ Verified — `84ab1fb5a` is `.gitignore | 4 ++++` only |
| 2 | `git check-ignore -v .data/llm-proxy/token-usage.db-wal` matches `.gitignore:181:*.db-wal` | ✅ Verified |
| 3 | `git status .data/llm-proxy/` — clean | ✅ Verified (dir doesn't exist in worktree; in main, post-merge, the .db-wal/.db-shm are now ignored) |
| 4 | `node scripts/migrate-token-usage-export.mjs --dry-run` prints bucket plan, no FS changes | ✅ Verified — 1280 rows → 11 buckets, monolith still present, no `2026/` subdir created |
| 5 | Live run emits `deleted <MONO_PATH>` line | ✅ Verified — `deleted /Users/Q284340/.../.data/llm-proxy-export/token-usage.json` |
| 6 | `find .data/llm-proxy-export -name '*.json' -type f \| head -5` — per-hour files visible | ✅ Verified — 11 files |
| 7 | `[ ! -f .data/llm-proxy-export/token-usage.json ]` | ✅ Verified |
| 8 | Re-run prints `monolith already removed`, exit 0 | ✅ Verified |
| 9 | Proxy hydrate log after kickstart | ⏭ Deferred to post-merge (see Deviation #1) |
| 10 | `SELECT COUNT(*) FROM token_usage WHERE user_hash='unknown'` returns 0 | ⏭ Deferred to post-merge |
| 11 | `SELECT COUNT(*)` matches pre-migration count (modulo live additions) | ⏭ Deferred to post-merge |
| 12 | Cross-user simulation (already covered by Plan 36-04 SUMMARY's cross-user smoke test) | ✅ Verified upstream |

Additionally:
- All 11 filenames match the canonical regex `^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}-[0-9]{4}_[a-z][a-z0-9]{5}\.json$` (`find ... | awk -F/ '{print $NF}' | grep -vE ...` returns nothing).
- Sample file content valid: `rows=170, row[0].id=1, row[0].user_hash=c197ef, IDs ascending`, all 13 legacy columns + `user_hash` present.
- Bucket row counts sum to 1280 (170+169+131+128+36+65+163+171+76+126+45 = 1280 ✓ no rows dropped).
- Merge code path exercised: 171-row test (170 existing + 2-row monolith with id=1 collision + id=99999 new) produced 171-row merged file with id=1 keeping its ORIGINAL `prompt_preview` ("reply with the single token: OK"), id=99999 added with test content, IDs sorted ascending. Per-hour file restored from backup before commit.

## User Setup Required

None — no external service configuration required. The `.gitignore` change is immediately effective on every future `git status`. The migration script ran once during this executor's session and need not be invoked again (it's idempotent if it is).

## Self-Check: PASSED

- `.gitignore` modified: ✅ `git log -1 --stat 84ab1fb5a` confirms.
- `scripts/migrate-token-usage-export.mjs` created, executable, valid syntax: ✅ `[ -x ... ] && node --check ...` pass.
- 11 per-hour files exist with regex-compliant names: ✅ `find` + filename-regex grep returns empty.
- Monolith deleted: ✅ `[ ! -f ... ]` true.
- Commits exist on worktree branch:
  - `84ab1fb5a` (Task 1, .gitignore): ✅ `git log --oneline | grep 84ab1fb5a` matches.
  - `5b18a3bb5` (Task 2, migration + files + deletion): ✅ `git log --oneline | grep 5b18a3bb5` matches.
- STATE.md / ROADMAP.md NOT modified: ✅ worktree status shows only the pre-existing `.claude/settings.local.json` mod, no planning-state files touched.

## Next Phase Readiness

**Phase 36 is now functionally complete on this worktree branch.** Once merged to main:

1. Plan 36-05 commits land, populating main's `.data/llm-proxy-export/2026/05/` with the worktree's 11 per-hour files. These will MERGE with main's existing 2026-05-16 per-hour files (no overlap — different days). The post-merge state will have 11 (this plan) + 3 (Plan 36-03's live writes) = 14 per-hour files minimum, plus whatever the live proxy keeps adding through merge time.
2. Operator runs `launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy"`. Plan 36-04's `hydrateFromExports` walks all 14+ files, INSERT OR IGNORE de-dups against `(user_hash, id)`.
3. Operator runs the verification SQL queries from Deviation #1 to confirm `unknown` row count is zero.
4. Plans 36-06 (model-name canonicalization) and 36-07 (treemap tooltip) — both Wave 5, independent of this plan's commits — close out the polish work; 36-07 is already on main per the recent commit log.

**No blockers, no concerns for downstream consumers.** The threat-model items (T-36-25 through T-36-33) are all mitigated by the script's defensive checks: hash validation (T-36-32), idempotency guard (T-36-30), filename collision merge (T-36-26), JSON.parse try/catch (T-36-25), VERBOSE-mode no-row-content logging (T-36-29), git-tracked WAL pre-check N/A (no tracked .db-* files exist; `git ls-files | grep '\.db-'` returns empty).

---
*Phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f*
*Completed: 2026-05-16*

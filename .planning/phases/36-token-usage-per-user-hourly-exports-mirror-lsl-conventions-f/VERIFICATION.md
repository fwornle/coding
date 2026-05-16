---
phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f
verified: 2026-05-16T12:50:00Z
status: passed
score: 9/9
overrides_applied: 0
---

# Phase 36: Token-Usage Per-User Hourly Exports — Verification Report

**Phase Goal:** Mirror the LSL filesystem convention for token-usage exports: one file per user per hour-window, organized under YYYY/MM/, recursively merged on read. Eliminates the merge-conflict surface of the monolithic `token-usage.json` and enables cross-user merge after `git pull`.

**Verified:** 2026-05-16T12:50:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Coordinator publishes `lsl_meta.current_window` as HHMM-HHMM | VERIFIED | `curl http://127.0.0.1:3034/health/state` returns `lsl_meta.current_window: '1200-1300'`; regex `^\d{4}-\d{4}$` matches |
| 2 | Wrapper exports `LLM_PROXY_USER_HASH=c197ef` and `LSL_TIMEZONE=Europe/Berlin` in launchd-spawned proxy env | VERIFIED | `ps eww 95945 | tr ' ' '\n' | grep -E 'LLM_PROXY_USER_HASH\|LSL_TIMEZONE'` returns both; PID 95945 is the live launchd-managed proxy |
| 3 | Per-hour files exist under `.data/llm-proxy-export/YYYY/MM/YYYY-MM-DD_HHMM-HHMM_<hash6>.json` | VERIFIED | 14 files found; 11 from 2026-05-15 (migrated from monolith), 3 from 2026-05-16 (live proxy writes) |
| 4 | Schema has composite PRIMARY KEY (user_hash, id) and `model_raw` column | VERIFIED | `PRAGMA table_info` shows `user_hash pk=1`, `id pk=2`; `.schema` confirms `PRIMARY KEY (user_hash, id)`; `model_raw TEXT` column present at position 13 |
| 5 | `hydrateFromExports` runs on every proxy init; log prints `read N files, attempted M inserts` | VERIFIED | After kickstart: `[token-usage] hydrate: read 14 files, attempted 1643 inserts (conflicts silently skipped)` — matches all 14 on-disk files; 1643 matches actual row sum across files |
| 6 | Model canonicalization active; `COUNT(DISTINCT model) WHERE model LIKE 'claude-%'` ≤ 4; `model_raw` preserves originals | VERIFIED | Query returns 3 (claude-sonnet-4.6: 1048, claude-haiku-4.5: 546, claude-sonnet-4.5: 456); 2051 rows have `model_raw IS NOT NULL`; 5 distinct original spellings observed in sample |
| 7 | `.gitignore` covers `.db-wal` and `.db-shm`; `git check-ignore` matches `.gitignore:181` and `.gitignore:182` | VERIFIED | `git check-ignore -v .data/llm-proxy/token-usage.db-wal` → `.gitignore:181:*.db-wal`; same for `.db-shm` at line 182; `.db-journal` added at line 183 |
| 8 | Legacy monolith `.data/llm-proxy-export/token-usage.json` does NOT exist | VERIFIED | `test -f .data/llm-proxy-export/token-usage.json` returns false |
| 9 | `scripts/migrate-token-usage-export.mjs` exists, is executable, and prints `monolith already removed` on re-run | VERIFIED | File exists at 8781 bytes, mode `-rwxr-xr-x`; re-run output: `[migrate-token-usage] monolith already removed — nothing to do`; exit 0 |

**Score:** 9/9 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/health-coordinator.js` | Imports `getTimeWindow`/`utcToLocalTime`; `lsl_meta.current_window` populated per tick | VERIFIED | Lines 46, 195, 1178, 1181 — import + slot init + populate + error fallback |
| `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` | Exports `LLM_PROXY_USER_HASH` and `LSL_TIMEZONE` before `exec node` | VERIFIED | Lines 160-164 (hash export with fallback), line 169 (timezone export); live env confirmed via `ps eww` |
| `_work/rapid-llm-proxy/src/token-usage.ts` | `exportToHourFile`, `hydrateFromExports`, composite PK schema, `model_raw` column | VERIFIED | All functions present; composite PK at line 372; `hydrateFromExports` at line 537; `model_raw` ALTER at initTokenDb |
| `_work/rapid-llm-proxy/proxy-bridge/server.mjs` | `canonicalizeModelName`, `MODEL_CANONICAL_MAP`, `logTokenCall` wired with canonical model + `model_raw` | VERIFIED | Lines 91-116 (map + function); lines 1265-1266 (`model: canonicalize...`, `model_raw: result.model`) |
| `scripts/migrate-token-usage-export.mjs` | One-shot bucketing script; idempotent; `--dry-run` safe | VERIFIED | 8781 bytes, 232 lines, executable; idempotency confirmed by re-run |
| `.data/llm-proxy-export/2026/05/*.json` (14 files) | Per-hour files from migration (11) and live proxy (3) | VERIFIED | All 14 match `YYYY-MM-DD_HHMM-HHMM_c197ef.json` naming pattern |
| `integrations/system-health-dashboard/src/pages/token-usage.tsx` | `TreemapTooltip` component + `<Tooltip>` wired as Treemap child + SVG `<title>` fallback | VERIFIED | `TreemapTooltip` defined at line 153, used at line 388; `<title>` element present |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `health-coordinator.js` | `timezone-utils.js:getTimeWindow` | `import { getTimeWindow, utcToLocalTime }` at line 46 | WIRED | Live `/health/state` returns valid `1200-1300` window |
| `start-llm-proxy.sh` | `scripts/user-hash-generator.js` | `USER_HASH_SCRIPT` env var + `node -e "import(...).then(m => m.default.generateHash())"` | WIRED | Live env `LLM_PROXY_USER_HASH=c197ef` confirmed in proxy process |
| `token-usage.ts:hydrateFromExports` | `.data/llm-proxy-export/**/*.json` | `walk(baseDir)` recursive scan | WIRED | Live boot read 14 files, 1643 row attempts |
| `server.mjs:logTokenCall` | `token-usage.ts:logCall` | `import { logCall as logTokenCall }` from `dist/token-usage.js` | WIRED | `model: canonicalizeModelName(result.model)` + `model_raw: result.model` at lines 1265-1266 |
| `token-usage.tsx:Treemap` | `TreemapTooltip` | `<Tooltip content={<TreemapTooltip />} />` as child at line 388 | WIRED | Confirmed by 36-07 Playwright E2E (SUMMARY) + grep |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `health-coordinator.js:lsl_meta.current_window` | `currentState.lsl_meta.current_window` | `getTimeWindow(utcToLocalTime(new Date()))` per 5s tick | Yes — clock-derived, confirmed live | FLOWING |
| `token-usage.ts:hydrateFromExports` | `found[]` (file list) | `walk(baseDir)` + `fs.readdirSync` | Yes — 14 files, 1643 rows on last boot | FLOWING |
| `server.mjs:logTokenCall` | `model` / `model_raw` | `canonicalizeModelName(result.model)` / `result.model` | Yes — live DB shows 2051 rows with `model_raw`, 3 canonical models | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `/health/state` returns HHMM-HHMM window | `curl -s http://127.0.0.1:3034/health/state \| python3 -c "...re.match(r'^\d{4}-\d{4}$', w)"` | `1200-1300` — format valid | PASS |
| launchd proxy env has user hash | `ps eww <PID> \| grep LLM_PROXY_USER_HASH` | `LLM_PROXY_USER_HASH=c197ef` | PASS |
| Hydrate reads all export files on boot | `launchctl kickstart` + grep stderr.log | `read 14 files, attempted 1643 inserts` | PASS |
| Composite PK schema | `sqlite3 .schema token_usage \| grep PRIMARY` | `PRIMARY KEY (user_hash, id)` | PASS |
| Model canonicalization reduces fragmentation | `SELECT COUNT(DISTINCT model) FROM token_usage WHERE model LIKE 'claude-%'` | 3 (≤ 4 invariant) | PASS |
| Monolith deleted | `test -f .data/llm-proxy-export/token-usage.json` | false | PASS |
| Migration script idempotent | `node scripts/migrate-token-usage-export.mjs 2>&1` | `monolith already removed` | PASS |

---

## Commit Verification

| Repo | Commits | Status |
|------|---------|--------|
| coding | `715718db1`, `8b0b011a7`, `6b333cec6`, `e0d213db1`, `14ca2de67`, `c781a10ff`, `89dbfdc85`, `eb88d80f7`, `95739e9f1`, `7c425c716`, `a4d09514d`, `aa15e72db` | All confirmed on main via `git log --oneline` |
| rapid-llm-proxy | `9762ec8`, `d9d6438`, `80beb5a`, `89c9a0f` | All confirmed on main via `git log --oneline` |

---

## Anti-Patterns Found

No `TBD`, `FIXME`, or `XXX` debt markers in any modified file (`health-coordinator.js`, `token-usage.ts`, `server.mjs`, `migrate-token-usage-export.mjs`, `start-llm-proxy.sh`, `token-usage.tsx`). No `TODO` markers remaining in `token-usage.ts` (the `// TODO(36-04)` defensive fallback was cleaned up as designed in Plan 36-04).

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| None | — | — | Clean |

---

## Notable Observations (Non-Blocking)

**1. `.data/llm-proxy/` shows as `??` in `git status` due to pre-existing `llm-settings.json`.**

The `.data/llm-proxy/` directory continues to show as `?? .data/llm-proxy/` in git status. This is caused by `llm-settings.json` inside the directory, which has never been git-tracked and is not covered by `.gitignore`. This is a **pre-existing condition** that predates Phase 36: CONTEXT.md explicitly documented the problem as `.db-wal` and `.db-shm` being untracked, and those files are now covered by Phase 36's `.gitignore` additions (lines 181-183). The `llm-settings.json` noise is outside Phase 36's scope and existed before any Phase 36 commits landed.

**2. Today's per-hour export files show as `??` in `git status`.**

Files `2026-05-16_1000-1100_c197ef.json`, `_1100-1200`, and `_1200-1300` are untracked. This is **expected and correct**: the `!.data/llm-proxy-export/` allow-list rule means git can track them, but they need a manual `git add` + commit to be shared across users. The LSL convention works the same way — files accumulate locally and get pushed periodically for cross-user merge.

**3. Hydrate "read 4 files" in earlier log entries (now resolved).**

The last three log entries before the verification kickstart showed `read 4 files, attempted 2203 inserts`. This reflected boots that occurred before the May-15 migration files were written to the working directory (they were committed at ~12:36, three minutes after the last proxy kickstart at 12:33). After the verification kickstart, hydrate correctly reported `read 14 files, attempted 1643 inserts`, confirming all 14 on-disk files are picked up. The discrepancy was a timing artifact, not a code defect.

**4. Notable accepted deviation in Plan 36-04 (composite-PK rebuild).**

Plan 36-04 discovered at execution time that SQLite rejects `ON CONFLICT(user_hash, id) DO NOTHING` when `id` is `INTEGER PRIMARY KEY` (ROWID-aliased). The user authorised a full composite-PK rebuild: `id INTEGER NOT NULL` + `user_hash TEXT NOT NULL DEFAULT 'unknown'` + `PRIMARY KEY (user_hash, id)`, with JS-managed `handle.nextLocalId()` replacing AUTOINCREMENT. `INSERT OR IGNORE` matches the composite PK auto-index and is behaviourally equivalent to the planned `ON CONFLICT ... DO NOTHING`. All acceptance criteria met via this path.

---

## Human Verification Required

**None.** All invariants verified programmatically via live service calls, sqlite3 queries, file system checks, and process inspection.

The 36-07 treemap tooltip was verified by Playwright E2E during plan execution (screenshots at `/tmp/36-07-tooltip-small.png` and `/tmp/36-07-tooltip-large.png`). Visual verification of the tooltip UI is not repeated here — the automated grep checks confirm the component is wired and the dashboard returns HTTP 200.

---

## Gaps Summary

No gaps. All 9 phase invariants verified against live processes and on-disk artifacts.

---

_Verified: 2026-05-16T12:50:00Z_
_Verifier: Claude (gsd-verifier)_

---
phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f
plan: 06
status: complete
completed_at: 2026-05-16
---

# Plan 36-06 Summary

## Objective

Eliminate model-name fragmentation in the token-usage dashboard. Each
provider (claude-code CLI, Copilot, Anthropic API) returned its own
spelling — dash-version, dot-version, title-case, dated-snapshot, bare
alias — so the "By Model" panel showed 8 rows for what is really 3
Claude models. Canonicalize at the persistence boundary; preserve raw
spelling per row for forensic debugging.

## Tasks completed

| Task | Status | Commit |
|------|--------|--------|
| Task 1: canonicalizeModelName + MODEL_CANONICAL_MAP + logTokenCall wiring | ✅ | `89c9a0f` (rapid-llm-proxy main) |
| Task 2: model_raw column + insertStmt rebuild + backfillCanonicalModelNames + server.mjs boot-time call | ✅ | same atomic commit |

Both tasks landed atomically in one commit on rapid-llm-proxy because
they share file changes that can't safely exist in intermediate states
(canonicalizer defined but backfill not wired, or backfill imported but
column not added).

## What changed

### `_work/rapid-llm-proxy/proxy-bridge/server.mjs`

- **MODEL_CANONICAL_MAP** (17 entries covering Sonnet 4.6 / Haiku 4.5
  / Opus 4.6 families; case-insensitive keys; older 4.5-family rows
  deliberately omitted — they're their own canonical).
- **`canonicalizeModelName(raw)`** pure function. Guards on non-string
  input (returns raw); lowercases + trims before map lookup;
  unrecognized names pass through unchanged.
- **Placement**: defined ABOVE the `_tokenDb` init block so the
  boot-time backfill call can pass the function without hitting a TDZ
  on `const MODEL_CANONICAL_MAP`. (First placement attempt put it after
  `resolveGroqModel` at line 414, which TDZ'd on the line 76 backfill;
  moved up during execution.)
- **Boot-time backfill** wired right after `initTokenDb()` (which itself
  runs `hydrateFromExports`), so peer rows imported in the same boot
  are normalised in the same pass:
  ```javascript
  const bf = backfillCanonicalModelNames(_tokenDb, canonicalizeModelName);
  log(`token-usage model canonicalization backfill: scanned=${bf.scanned} rewritten=${bf.rewritten}`);
  ```
- **logTokenCall call site** at the persistence boundary:
  - `model: canonicalizeModelName(result.model) || 'unknown'`
  - `model_raw: result.model || 'unknown'` (new field)
- **Debug log** when canonicalization rewrote the spelling:
  `canonicalized: <raw> → <canonical>`. Useful for the first few hours
  after rollout to confirm map coverage.
- **Provider-side `result.model`** in `completeClaudeCode` /
  `completeCopilot` / `completeAnthropic` UNCHANGED — raw upstream
  strings preserved at source so `model_raw` has truth.

### `_work/rapid-llm-proxy/src/token-usage.ts`

- **`TokenUsageRow`** gains optional `model_raw?: string`. logCall
  defaults `row.model_raw ?? row.model` so older callers that don't
  pass it silently store the canonical name as raw.
- **`initTokenDb`** adds a second PRAGMA-guarded ALTER after the 36-04
  composite-PK rebuild:
  ```sql
  ALTER TABLE token_usage ADD COLUMN model_raw TEXT
  ```
  No index, no UNIQUE — `model_raw` is for forensics only, never for
  joins or filters.
- **`insertStmt`** re-prepared to 14 bind positions (added `model_raw`
  last). logCall extends the `run(...)` call by one positional arg:
  `row.model_raw ?? row.model`.
- **New exported `backfillCanonicalModelNames(handle, canonicalizer)`**:
  walks rows where `model_raw IS NULL` (= pre-36-06 rows), applies the
  supplied canonicalizer to `model`, and records the original spelling
  in `model_raw`. Single transaction; idempotent via the `IS NULL`
  filter (subsequent boots find 0 rows to scan). Returns
  `{ scanned, rewritten }` so the caller can log a meaningful
  summary.

## Verification

```bash
$ cd _work/rapid-llm-proxy && npm run build 2>&1 | tail -3
> @rapid/llm-proxy@2.0.0 build
> tsc --declaration
(no errors)

$ launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy" && sleep 6

$ grep "model canonicalization backfill" .data/llm-proxy/logs/stdout.log | tail -2
[llm-proxy] token-usage model canonicalization backfill: scanned=2033 rewritten=1027

$ launchctl kickstart -k ... && sleep 6   # second boot
$ grep "model canonicalization backfill" .data/llm-proxy/logs/stdout.log | tail -1
[llm-proxy] token-usage model canonicalization backfill: scanned=0 rewritten=0
```

### Before / after distribution

```
$ sqlite3 .data/llm-proxy/token-usage.db "SELECT model, COUNT(*) FROM token_usage GROUP BY model ORDER BY COUNT(*) DESC"
# BEFORE:
claude-sonnet-4.5            | 456
claude-sonnet-4.6            | 365
Claude Haiku 4.5             | 338
Claude Sonnet 4.6            | 294
sonnet                       | 259
claude-haiku-4.5             | 184
claude-sonnet-4-6            | 119
claude-haiku-4-5-20251001    |  17

# AFTER:
claude-sonnet-4.6            | 1037   (= 365 + 294 + 259 + 119)
claude-haiku-4.5             |  539   (= 338 + 184 + 17)
claude-sonnet-4.5            |  456   (older — deliberately left alone)
```

### Rewrite-count breakdown

The 1027 rewrites match exactly:
- 294 `Claude Sonnet 4.6` → `claude-sonnet-4.6` (Anthropic title-case)
- 338 `Claude Haiku 4.5` → `claude-haiku-4.5` (Anthropic title-case)
- 119 `claude-sonnet-4-6` → `claude-sonnet-4.6` (CLI dash-version)
- 259 `sonnet` → `claude-sonnet-4.6` (CLI bare alias)
- 17 `claude-haiku-4-5-20251001` → `claude-haiku-4.5` (Copilot dated)
- Total: 1027 ✓

The other 1006 rows (2033 scanned − 1027 rewritten) had `model` values
that were already canonical (`claude-sonnet-4.6`, `claude-haiku-4.5`,
`claude-sonnet-4.5`, plus the `fake-peer` row from the 36-04 cross-user
simulation) — counted in `scanned`, not in `rewritten`.

### model_raw preservation (sample)

```
$ sqlite3 .data/llm-proxy/token-usage.db "SELECT model, model_raw, COUNT(*) FROM token_usage WHERE model_raw IS NOT NULL GROUP BY model, model_raw ORDER BY COUNT(*) DESC LIMIT 10"
model              model_raw                  COUNT(*)
-----------------  -------------------------  --------
claude-sonnet-4.5  claude-sonnet-4.5          456
claude-sonnet-4.6  claude-sonnet-4.6          365
claude-haiku-4.5   Claude Haiku 4.5           338
claude-sonnet-4.6  Claude Sonnet 4.6          294
claude-sonnet-4.6  sonnet                     259
claude-haiku-4.5   claude-haiku-4.5           184
claude-sonnet-4.6  claude-sonnet-4-6          119
claude-haiku-4.5   claude-haiku-4-5-20251001   17
```

Eight original spellings preserved per row — debugging "which dated
snapshot did Copilot serve?" remains possible.

## Files modified

- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (+66/-2 lines)
- `_work/rapid-llm-proxy/src/token-usage.ts` (+58/-5 lines)
- `_work/rapid-llm-proxy/dist/token-usage.d.ts.map` (regenerated)
- All in commit `89c9a0f` on rapid-llm-proxy `main`

No edits to `STATE.md`, `ROADMAP.md`, `bin/coding`, `install.sh`, or any
launchd plist.

## Issues encountered

1. **TDZ on MODEL_CANONICAL_MAP** — first placement put the
   `canonicalizeModelName` function and `MODEL_CANONICAL_MAP` const
   after `resolveGroqModel` (line ~414), but the boot-time backfill at
   line 76 calls `canonicalizeModelName` synchronously at module load.
   `const` declarations are hoisted but in TDZ until their initializer
   runs, so the call at line 76 would have thrown `ReferenceError:
   Cannot access 'MODEL_CANONICAL_MAP' before initialization`. Caught
   pre-build via inspection; moved the block above `_tokenDb` init.
2. **Sub-agent sandbox limitation** — subagents cannot write to
   `_work/rapid-llm-proxy/src/` or `_work/rapid-llm-proxy/proxy-bridge/`.
   Orchestrator executed inline (same as 36-03 and 36-04).

## Downstream consumers

- **Dashboard "By Model" panel** at `http://localhost:3032/token-usage`
  collapses from 8 Claude rows to 3 (4.6 family / 4.5 Haiku family /
  older 4.5 Sonnet kept distinct). The panel uses `getSummary` →
  `by_model` which groups by the canonical `model` column.
- **Treemap hover tooltip** (Plan 36-07, already shipped) renders the
  canonical model name; raw spellings are no longer visible in any
  user-facing surface but remain queryable via `model_raw`.

## Success criteria

- ✅ `canonicalizeModelName` function in server.mjs, called once at
  `logTokenCall`
- ✅ `model_raw` column live; raw upstream identifier preserved per row
- ✅ One-time backfill rewrote 1027 pre-existing rows; idempotent on
  re-run (`scanned=0 rewritten=0`)
- ✅ Dashboard "By Model" panel shows 3 Claude family rows (4.6 / 4.5
  Haiku / 4.5 Sonnet) instead of 8
- ✅ Provider-response handling
  (completeClaudeCode / completeCopilot / completeAnthropic) UNCHANGED
- ✅ `npm run build` exits 0; `launchctl kickstart` clean boot

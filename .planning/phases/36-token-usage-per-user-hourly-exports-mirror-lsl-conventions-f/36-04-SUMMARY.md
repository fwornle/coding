---
phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f
plan: 04
status: complete
completed_at: 2026-05-16
---

# Plan 36-04 Summary

## Objective

Add a `user_hash` column + composite-key dedup to the SQLite schema,
retag pre-existing rows with the real USER_HASH, replace the cold-start
`restoreFromJsonIfEmpty` with always-on `hydrateFromExports` that walks
all per-hour files, and update the proxy's insertStmt + logCall so new
rows bind user_hash. End result: a peer's git-pushed
`..._<other-hash>.json` becomes visible in this machine's local DB
after the next proxy boot.

## Tasks completed

| Task | Status | Commit |
|------|--------|--------|
| Task 1: schema migration (composite PK rebuild + WAL checkpoint + insertStmt rebuild + logCall bind) | ✅ | `80beb5a` (rapid-llm-proxy main) |
| Task 2: hydrateFromExports + cleanup 36-03 defensive fallback | ✅ | `80beb5a` (same atomic commit) |

The two plan tasks landed atomically in one commit on rapid-llm-proxy
because they share the same file (`src/token-usage.ts`) and any
intermediate state (column added but hydrate still using old code)
would crash the proxy.

## What changed in `_work/rapid-llm-proxy/src/token-usage.ts`

### Schema migration (composite PK rebuild)

**Plan defect discovered during execution:** the plan asked for
`ALTER TABLE token_usage ADD COLUMN user_hash` + `CREATE UNIQUE INDEX
idx_token_usage_user_id ON token_usage(user_hash, id)` +
`ON CONFLICT(user_hash, id) DO NOTHING` in hydrate. SQLite **refuses
the ON CONFLICT clause** at prepare-time when `id` is `INTEGER
PRIMARY KEY` (id is aliased to ROWID, and composite UNIQUE INDEXes
containing ROWID-aliased columns aren't valid conflict targets).
Verified empirically with a minimal repro:

```sql
CREATE TABLE t (id INTEGER PRIMARY KEY, user_hash TEXT);
CREATE UNIQUE INDEX i ON t(user_hash, id);
INSERT INTO t ... ON CONFLICT(user_hash, id) DO NOTHING;
-- Parse error near line N: ON CONFLICT clause does not match any
-- PRIMARY KEY or UNIQUE constraint
```

The plan's stated invariant *"two users' id=1 rows coexist"* also can't
hold under `INTEGER PRIMARY KEY` — id alone is unique. User chose the
composite PK rebuild path. Implementation:

1. Canonical `CREATE TABLE IF NOT EXISTS token_usage` now declares
   `id INTEGER NOT NULL` + `user_hash TEXT NOT NULL DEFAULT 'unknown'`
   + `PRIMARY KEY (user_hash, id)`. AUTOINCREMENT is forbidden with
   composite PK.
2. Migration block detects legacy schemas via `PRAGMA table_info`
   (`id.pk === 1` with no `user_hash` in PK) and runs a one-shot
   table rebuild:
   - `CREATE TABLE __token_usage_pkrebuild` with the new schema
   - `INSERT INTO ... SELECT FROM token_usage` with retag-in-COPY
     (`CASE WHEN user_hash IN ('unknown', NULL) THEN ? ELSE
     user_hash END` bound to USER_HASH)
   - `DROP TABLE token_usage`
   - `ALTER TABLE __token_usage_pkrebuild RENAME TO token_usage`
   - Recreate the three secondary indexes (timestamp, process,
     provider)
   - All wrapped in `BEGIN`/`COMMIT`; ROLLBACK on error
3. `wal_checkpoint(TRUNCATE)` immediately after — verified .db-wal
   shrunk to 0 bytes post-migration.

### Per-user id counter

`AUTOINCREMENT` is forbidden with composite PK, so per-machine id
assignment moves into JS. `handle.nextLocalId()` reads
`MAX(id) + 1 WHERE user_hash = USER_HASH` once at init (seeded
**after** hydrate runs so peer-imports tagged with USER_HASH from the
legacy monolithic file don't get overwritten by the first post-init
logCall picking the same id) and increments monotonically per
logCall. Single-threaded better-sqlite3 guarantees no race.

`TokenUsageDb` interface gained a `nextLocalId: () => number` method.

### insertStmt rebuild

Now binds 13 columns (added `id` at position 1 and `user_hash` at
position 13). logCall:

```typescript
handle.insertStmt.run(
  handle.nextLocalId(),
  row.timestamp, …, row.tokens_estimated,
  USER_HASH
);
```

### hydrateFromExports (replaces restoreFromJsonIfEmpty)

- Runs on **every** proxy init (drops the old `count > 0 → return`
  early-exit — THE BUG that prevented cross-user pull-then-boot).
- Walks `<baseDir>/**/*.json` via inline port of
  `scripts/lsl-paths.js:lslListAll()`. Skips dot-dirs and node_modules.
- Filename regex `/_([a-z][a-z0-9]{5})\.json$/` extracts the 6-char
  hash from each filename. Legacy `token-usage.json` (no suffix) gets
  the local USER_HASH; Task 1's retag-in-COPY pre-aligned its DB rows
  so INSERT OR IGNORE handles dedup without duplicating.
- Per-row tagging: if the row's own `user_hash` field is a valid hash
  shape, use it; else fall back to the filename hash.
- Batched via `db.transaction(...)` for the ~10-100× speedup over
  per-row `.run()`.
- `INSERT OR IGNORE INTO token_usage ...` matches the composite PK's
  auto-index — equivalent in behaviour to `ON CONFLICT(user_hash, id)
  DO NOTHING` but works under SQLite's parser rules.
- Logs once at the end: `[token-usage] hydrate: read N files,
  attempted M inserts (conflicts silently skipped)`.

### Cleanup

Plan 36-03's defensive `// TODO(36-04)` try/catch fallback inside
`exportToHourFile` is removed — the SELECT now reads `user_hash`
unconditionally. The function declaration `function
restoreFromJsonIfEmpty` is gone (only mentioned in the new function's
JSDoc as historical context).

## Verification

```bash
$ launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy" && sleep 5
$ tail -5 .data/llm-proxy/logs/stderr.log | grep -E "(token-usage|migration|hydrate)"
[token-usage] schema migration: composite PRIMARY KEY (user_hash, id) active, copied 1987 rows
[token-usage] hydrate: read 5 files, attempted 2165 inserts (conflicts silently skipped)

$ sqlite3 .data/llm-proxy/token-usage.db ".schema token_usage" | head -3
CREATE TABLE IF NOT EXISTS "token_usage" (
          id              INTEGER NOT NULL,
          ...
          PRIMARY KEY (user_hash, id)

$ ls -la .data/llm-proxy/token-usage.db-wal
-rw-r--r-- ... 0 ...    # WAL truncated

$ sqlite3 .data/llm-proxy/token-usage.db "SELECT user_hash, COUNT(*) FROM token_usage GROUP BY user_hash"
c197ef|1989
```

### Cross-user simulation (acceptance criterion)

```bash
$ cat > .data/llm-proxy-export/2026/05/2026-05-16_1000-1100_zzzz99.json <<JSON
[{"id":99999,"timestamp":"2026-05-16T08:30:00.000Z","provider":"fake-peer",...,"user_hash":"zzzz99"}]
JSON
$ launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy" && sleep 5
$ sqlite3 .data/llm-proxy/token-usage.db "SELECT user_hash, COUNT(*) FROM token_usage GROUP BY user_hash"
c197ef|1993
zzzz99|1                                                  # peer row landed ✅
$ launchctl kickstart -k ... && sleep 5                   # second boot
$ sqlite3 ... "SELECT COUNT(*) FROM token_usage WHERE user_hash='zzzz99'"
1                                                         # idempotent ✅
```

Both peers' rows coexist; INSERT OR IGNORE silently blocks duplicate
inserts on subsequent boots.

## Files modified

- `_work/rapid-llm-proxy/src/token-usage.ts` (+231/-75 lines,
  commit `80beb5a` on rapid-llm-proxy `main`)
- `_work/rapid-llm-proxy/dist/token-usage.d.ts.map` (regenerated by tsc)

No edits to `STATE.md`, `ROADMAP.md`, `bin/coding`, `install.sh`, any
launchd plist, or `proxy-bridge/server.mjs` (server.mjs's imports of
`initTokenDb, logCall, getSummary, getRecent` are unchanged).

## Deviations from plan action-steps

| Plan said | I did | Reason |
|-----------|-------|--------|
| `ALTER TABLE … ADD COLUMN user_hash` | Full table rebuild (CREATE/COPY/DROP/RENAME) | SQLite can't ALTER PRIMARY KEY in place |
| `CREATE UNIQUE INDEX idx_token_usage_user_id` | Composite PK provides equivalent uniqueness via SQLite auto-index `sqlite_autoindex_token_usage_1` | Named index would be redundant; composite PK is the canonical dedup mechanism |
| `ON CONFLICT(user_hash, id) DO NOTHING` | `INSERT OR IGNORE` | SQLite refuses the ON CONFLICT clause while `id` was `INTEGER PRIMARY KEY` (ROWID-aliased); after composite-PK rebuild, INSERT OR IGNORE matches the new PK shape |
| Separate `UPDATE … SET user_hash = ?` retag | Retag folded into the COPY's SELECT (`CASE WHEN`) | Composite-PK rebuild already does a full COPY; rolling retag into it is one less statement |
| Keep `INTEGER PRIMARY KEY AUTOINCREMENT` | Drop AUTOINCREMENT; JS-managed `handle.nextLocalId()` | Required because composite PK + AUTOINCREMENT is forbidden by SQLite |

Plan-defect details surfaced as a checkpoint to the user; user
authorised the composite-PK migration path.

## Issues encountered

1. **Plan defect — `INTEGER PRIMARY KEY` + composite UNIQUE INDEX**:
   the plan assumed `ON CONFLICT(user_hash, id)` would work with a
   UNIQUE INDEX on `(user_hash, id)` while `id` was still the table's
   primary key. SQLite parser rejected the clause at prepare-time.
   Surfaced as a checkpoint; user chose the composite-PK rebuild path.
2. **First migration attempt** (the originally-planned ALTER-only
   path) ran successfully and retagged 1897 rows from 'unknown' to
   USER_HASH on disk before hydrate failed. The composite-PK rebuild
   on the second attempt picked up 1987 rows (90 more accumulated
   between attempts) and converted the schema. Old retag survived
   because the rebuild's SELECT preserved `user_hash` for rows that
   weren't 'unknown'.
3. **`sub-agent` sandbox limitation**: subagents cannot write to
   `_work/rapid-llm-proxy/src/`. The orchestrator executed this plan
   inline (same as 36-03).

## Downstream consumers

- Plan 36-05: one-shot migration of the legacy monolithic
  `.data/llm-proxy-export/token-usage.json` into per-hour files,
  then delete the monolith. Implementation can rely on:
  - The DB now having every row tagged with the right user_hash
    (via 36-04's retag-in-COPY).
  - hydrate handling re-imports idempotently (via composite PK +
    INSERT OR IGNORE).
- Dashboard SQL: grep gate confirmed no `WHERE id = ?` SQL in the
  proxy source — dashboard queries using bare `id` would conflate
  across peers, but no such queries exist.

## Success criteria

- ✅ `user_hash` column present + composite PRIMARY KEY (user_hash, id)
- ✅ Pre-existing rows tagged with real USER_HASH (zero `unknown` rows
  for the local user)
- ✅ `insertStmt` rebuilt; logCall passes both id and USER_HASH
- ✅ Migration is idempotent; second boot is silent (no migration log
  line)
- ✅ WAL truncated to 0 bytes post-migration
- ✅ `hydrateFromExports` runs every boot; `restoreFromJsonIfEmpty`
  declaration deleted
- ✅ Cross-user simulation: peer file ingested; idempotent re-boot
- ✅ Plan 36-03's defensive fallback removed

---
id: opencode-schema-migration-update
created: 2026-05-27
status: completed
completed: 2026-05-27T22:00:00Z
priority: medium
tags: [opencode, sub-agent-live, schema-drift]
discovered_in: phase-51, plan-51-16 HUMAN-UAT
resolved_by: commit c52930a6b — "fix(opencode-adapter): switch schema-version guard from MAX(id) to column-presence contract"
---

## Resolution (2026-05-27)

Root cause confirmed: OpenCode upgraded the host schema such that the
`__drizzle_migrations.id` column (SERIAL) is no longer populated — every
row has empty `id`; `hash` is the new primary key. The adapter's
`MAX(id) AS m FROM __drizzle_migrations` returned NULL, failing the
SUPPORTED_MIGRATIONS=[1,2,3,4] allowlist on every host with the upgrade.

Fix landed in commit `c52930a6b`: replaced the migration-id allowlist
with a column-presence contract check on the tables the adapter actually
reads (session/message/part). Robust to all future __drizzle_migrations
schema drift; fails only when the real read contract is broken.
SUPPORTED_MIGRATIONS kept exported as a historical breadcrumb.

Tests rewritten/added across 2 suites (27/27 pass). End-to-end verified
on host: `checkSchemaVersion` passes against
`~/.local/share/opencode/opencode.db`; live-opencode daemon (PID 15561)
boots clean, writes observations ("Summary received (843 chars) via
claude-haiku-4-5"). Sub-agent observation count moved 5 → 11.

Phase 51 AC #4 (agent-agnostic) now satisfied for claude + opencode +
copilot — previously opencode was permanently deferred per Test 1.A on
this host.

# Update opencode-sqlite adapter for new schema migration

The live-opencode daemon is in a tight respawn loop on this host:

```
[live-opencode] fatal: unsupported opencode schema migration=null; supported=1,2,3,4
```

This is the fail-fast guard from Plan 51-13 working as designed — OpenCode upgraded
its schema and the adapter has not been updated.

## Action

1. Captured schema state on this host (2026-05-27):
   - `PRAGMA user_version` returns `0` (adapter reads as `null` → fails `SUPPORTED_MIGRATIONS=[1,2,3,4]` check)
   - `session` table now carries new columns: `workspace_id`, `path`, `agent`, `model`,
     `cost`, `tokens_input`, `tokens_output`, `tokens_reasoning`,
     `tokens_cache_read`, `tokens_cache_write` (added via inline ALTER TABLE — schema text shows them after the original block)
   - Core columns the adapter relies on (`id`, `project_id`, `parent_id`, `directory`,
     `time_created`, `time_updated`) are unchanged.
2. Decide how to detect this migration since `user_version=0` is ambiguous:
   - Option A: gate on column presence via `PRAGMA table_info(session)` (look for `workspace_id`)
   - Option B: pin on an OpenCode version stamp if one exists elsewhere in the DB
3. Audit `lib/lsl/adapters/opencode-sqlite.mjs` SELECT queries — they appear compatible
   since the adapter only touches unchanged columns.
4. Once detection is in, re-load the launchd job:
   ```bash
   bash scripts/install-sub-agent-launchd.sh
   launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-opencode
   ```

## Workaround applied 2026-05-27

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.coding.sub-agent-live-opencode.plist
```

Plist stays installed but is unloaded — stops the 60s respawn loop. Claude + Copilot
live tiers continue to function (AC #4 satisfied at "claude minimum" per CONTEXT.md).

## Context

- Discovered during Phase 51 Plan 51-16 HUMAN-UAT (Test 1).
- Plan 51-13 CR-01 (limit plumb-through) and CR-02 (registry_rows heartbeat) still
  apply to whatever migration the adapter gets updated to.
- D-Reuse gate: do not add new npm packages.

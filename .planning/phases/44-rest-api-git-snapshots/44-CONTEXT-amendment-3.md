---
phase: 44-rest-api-git-snapshots
type: context-amendment
amends: 44-CONTEXT.md
date: 2026-06-04
trigger: Plan 44-15 SC#2 path-routing decision (S-1 path amendment)
status: locked
---

# 44-CONTEXT amendment 3 — S-1 path amendment (snapshot dir ratification)

## Why this amendment exists

CONTEXT § S-1 (lines 24, 68, 166) names `.data/exports/` as the snapshot dir
contract:

> S-1 Whole-directory atomic snapshot. `POST /api/v1/snapshots {label}` git-commits
> the entire `.data/exports/` dir + tags it `snapshot/<label>-<UTC-timestamp>`.

But the live code routes the GraphKMStore (and therefore SnapshotManager) at
`.data/knowledge-graph/exports/` — not `.data/exports/`. This drift was
introduced before Phase 44 by the km-core landing in Phase 41 (commits
`87bc2f567` / `fd35c5350`): GraphKMStore's `exportDir` option was passed
`KG_EXPORT_DIR = path.join(REPO_ROOT, '.data', 'knowledge-graph', 'exports')`
on both A (`scripts/observations-api-server.mjs:1159`) and B
(`integrations/mcp-server-semantic-analysis/src/sse-server.ts:53,79`), and the
`obs-api` SnapshotManager construction at A's line 1208 / B's equivalent
inherits that path verbatim.

Plan 44-11 SC#2 verification surfaced the drift via a literal SnapshotManager
error: `git add -A -- ".data/knowledge-graph/exports/"` → "paths are ignored
by one of your .gitignore files: .data/knowledge-graph/exports". The drift was
invisible until SnapshotManager was first exercised end-to-end against the
running services — Plan 44-07 verified `/api/v1` mount but did not run
snapshot/restore.

## The amendment — ratify the live path

The canonical snapshot dir for Phase 44 + Phase 45 is:

```
.data/knowledge-graph/exports/
```

Not `.data/exports/`. The original CONTEXT § S-1 text is superseded on this
specific point. All other CONTEXT § S-1 semantics (whole-directory atomic
commit, `snapshot/<label>-<UTC-timestamp>` tag format, OKB_SNAPSHOT=1 bypass,
hard-reset restore + restartRequired signal) remain in force unchanged.

## Why ratify rather than refactor

Refactoring back to `.data/exports/` literally would touch ≥4 km-core
consumer sites:

- `scripts/observations-api-server.mjs:1159` (KG_EXPORT_DIR)
- `integrations/mcp-server-semantic-analysis/src/sse-server.ts:53,79`
- `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts:552`
- (C / OKM) the OKM-internal km-core wiring inherits the same path convention

…plus the data migration: the live `.data/knowledge-graph/exports/` files
(general.json, coding.json) would need to be moved and all running services
restarted in lockstep. The cost is high; the benefit (matching one CONTEXT
phrase) is low.

The simpler, lower-risk fix is the gitignore exception applied in Plan 44-15
Task 1: un-ignore `.data/knowledge-graph/exports/` so SnapshotManager's
`git add -A` succeeds on the actual live path. This preserves Pitfall 1's
OKB-baseline guard (re-verified `exit=0` post-amendment) and keeps the
single-source-of-truth for the exports path inside the running services'
wiring rather than fragmenting it across CONTEXT and code.

## Migration note for future planners

If a future plan ever needs to move the snapshot dir back to `.data/exports/`
(e.g., for cleaner project structure, or to align with a `.data/` reorg),
the touch sites are:

1. `scripts/observations-api-server.mjs:1159` — `KG_EXPORT_DIR` const
2. `integrations/mcp-server-semantic-analysis/src/sse-server.ts:53` —
   `exportDir` option to GraphKMStore
3. `integrations/mcp-server-semantic-analysis/src/sse-server.ts:79` —
   `snapshotDir` option to SnapshotManager
4. `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts:552` —
   internal export dir reference
5. (C) OKM's km-core wiring (out-of-tree, contact OKM maintainers)
6. `.gitignore` — remove the `!.data/knowledge-graph/exports/` exceptions
   added in Plan 44-15 (lines 209-210) and either un-ignore `.data/exports/`
   (already tracked, no rule needed) or document the new tracked location.
7. Live data move: `mv .data/knowledge-graph/exports/* .data/exports/` on
   each system, coordinated with a snapshot commit so history isn't lost.

## Provenance

- Plan 44-11 SC#2 verification revealed the drift (44-11-SUMMARY.md SC#2
  section captures the literal error)
- Plan 44-15 Task 1 ratified the live path by adding gitignore un-ignore
  exceptions for `.data/knowledge-graph/exports/`
- A's snapshot create + restore round-trip in Plan 44-15 Task 1
  validates the contract works end-to-end on the live path

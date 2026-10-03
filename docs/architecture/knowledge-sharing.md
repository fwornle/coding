# Persisting and sharing knowledge

What `coding` learns in a repo is persisted **in that repo's learning
checkout** (`<repo>/.coding/`, see [teams.md](teams.md)) and shared with
teammates **by git**. There is still one live store per machine (obs-api owns
km-core's LevelDB); the repo is the unit of persistence and sharing.

## Where the knowledge graph is written

`lib/kb/layout.mjs` gives km-core an *export layout*: one JSON file per
**project** (`metadata.project`, else the legacy `metadata.team`, else
`general`).

| Project has… | File |
|---|---|
| a `.coding/` that the outer repo ignores (linked **or** skipped) | `<repo>/.coding/kb/knowledge-graph/<project>.json` |
| a shared clone of a teammate's repo (T5) | read from `<data home>/var/shared/<X>/kb/…`, **never written** |
| neither (no checkout here; the tools repo until T7) | `<data home>/kb/knowledge-graph/exports/projects/<project>.json` |

A repo that has a `.coding/` but was never launched since T3 does not ignore it
yet, so it gets no file there (it would show up in the user's own `git status`).

Observations, digests and insights are km-core entities, so they travel in the
same file. `ObservationExporter` additionally writes a per-project slice of its
cold archive to `<repo>/.coding/kb/observation-export/`; the combined files in
the data home stay as they are (the dashboard's cold store reads them).

Two layout modes:

- **owner** — obs-api, the only process that writes into repos.
- **local** — the container's stores (semantic-analysis). They read every file
  but write only `exports/general.json` in the data home (`/workspace` is
  mounted read-only). Reading everything matters: a store that never sees the
  owner's tombstones would keep re-exporting what the owner deleted.

## Hydrate is a merge

`km-core/src/store/merge.ts` merges LevelDB and every file the layout names:

- entities by id — the copy with the newest `updatedAt` wins (ties: LevelDB /
  the live graph);
- relations by `(from, type, to)` — the graphology edge key is per process and
  collides across machines;
- deletions as **tombstones** (`attributes.kmTombstones`, kept 90 days): a
  tombstone beats every copy not edited after it;
- a relation to an entity this machine does not have (another project, not
  checked out here) is kept aside and written back to the file it came from —
  dropping it would delete it for the teammate who has both ends.

This replaces "JSON wins only if it has more nodes than LevelDB".

Files are written in canonical order (sorted by key) and only when their
content changed, so two machines holding the same graph produce identical
files and git sees no change.

**A file changed under the store** (a `git pull` merged a teammate's version)
is never overwritten: the exporter notices the file is not what it last wrote,
skips it, and the store merges it in (`reloadSources()`) before the next write.

## Sync (D3)

`lib/history/sync.mjs`, CLI `coding sync`:

| When | What | Who |
|---|---|---|
| session start | commit local changes, then **pull** (+ refresh shared clones); obs-api `POST /api/kb/reload` when HEAD moved | launcher (`pull_learning_repo`, background) |
| session end | **local commit** | launcher exit trap |
| every 30 min | **local commit** of every checkout; refresh `var/sync-state.json` | health coordinator |
| on request | commit, list what would be pushed, ask, **push** | `coding sync --push` (`--yes` skips the question) |

Nothing else ever pushes. The status line shows `[P:n]` when `n` learning
checkouts have commits nobody pushed yet (read from `sync-state.json`, never
git).

Conflicts: each checkout registers a git merge driver for `kb/**/*.json`
(`.gitattributes` + local `merge.coding-kb.driver` →
`lib/kb/merge-driver.mjs`), which merges a graph file with the same rule as
hydrate and an observation-export file by row id. Anything else that still
conflicts aborts the merge, leaves the checkout as it was, and is reported.

Shared clones are pull-only: local changes in them are discarded before a pull.

## Commands

```bash
coding sync                 # status of every learning checkout
coding sync pull --repo .   # what the launcher runs
coding sync commit          # local commit everywhere
coding sync --push          # asks, then pushes
curl -s localhost:12436/api/kb/layout | jq   # which project is written where
curl -s -X POST localhost:12436/api/kb/reload # merge pulled files into the live graph
```

## Not yet

- Token usage and measurements are not tagged by project (needs a `project`
  column in the proxy's `token_usage` and every capture path to send it).
- Entities that arrive by reload are not embedded into Qdrant until the next
  backfill (T6 indexes `team`/`project` payloads anyway).

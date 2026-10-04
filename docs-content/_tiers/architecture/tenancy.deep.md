## Decisions behind the design

| # | Decision |
|---|---|
| D1 | Learned data lives in a nested checkout `<repo>/.coding/` (the `<repo>-history` repo) with `history/` and `kb/`. `<repo>/.specstory/history` is a relative symlink into it. |
| D3 | Pull automatically at session start, commit locally automatically, **push only on confirmation**. |
| D6 | **One live store per machine** — obs-api is the single owner of km-core's LevelDB, one Qdrant. The repo is the unit of persistence and sharing; a team is a set of repos; every filter maps repo → team. No per-team or per-repo live stores. |
| D7 | The scope (`~/.coding/scope`) names only this machine's runtime home `~/.coding/data/<scope>/`. It is not what is persisted or shared. |

## Files

| Path | Written by | Holds |
|---|---|---|
| `~/.coding/repos.yaml` | launcher (`lib/history/repo-link.mjs`) | `repo path → { remote } \| { skip: true }` |
| `~/.coding/teams.yaml` | Dashboard → Teams (`lib/teams/config.cjs writeUserTeams`) | your teams, memberships, `active:` |
| `~/.coding/features.yaml` | `install.sh`, `coding-features`, Dashboard → Features | the installed tier / feature switches |
| `<repo>/.coding/history/<yyyy>/<mm>/*.jsonl` | the session logger (ETM) | live session logs |
| `<repo>/.coding/kb/knowledge-graph/<project>.json` | obs-api only (`lib/kb/layout.mjs`, mode `owner`) | the project's entities, relations, tombstones |
| `<repo>/.coding/kb/observation-export/*.json` | obs-api (`ObservationExporter`) | per-project slice of the observation cold archive, merged by row id |
| `<repo>/.coding/kb/usage/<user_hash>.json` | obs-api hourly (`lib/usage/project-usage.mjs`) | this user's token usage for the project, daily + per task |
| `<data home>/var/projects.json` | `lib/teams/discover.mjs` | discovered repos (TTL 10 min) |
| `<data home>/var/sync-state.json` | coordinator, `coding sync` | unpushed commits per checkout (the status line's `[P:n]`) |
| `<data home>/var/shared/<X>/` | `lib/teams/shared.mjs` | pull-only clones of teammates' learning repos |

A project with no checkout on this machine is exported to
`<data home>/kb/knowledge-graph/exports/projects/<project>.json`. The container's stores
(semantic-analysis) read every file but write only `exports/general.json` (mode `local`) —
`/workspace` is mounted read-only.

## The launch step

`scripts/agent-common-setup.sh` → `ensure_private_history_repo` →
`node lib/history/repo-link.mjs ensure <repo>`, then `pull_learning_repo` (background).

| Remote state (`remoteState`) | Action |
|---|---|
| `public` | refused |
| `populated` | `cloneInto` — tracked files win, untracked local files are kept |
| `absent` | `gh repo create --private` (or `git init --bare` for a local path), push the skeleton |
| `empty` | init + push the skeleton |
| `unknown` (no gh, ls-remote failed) | clone attempted, else init |

Environment: `LSL_HISTORY_AUTO=yes|no`, `LSL_HISTORY_REMOTE_TEMPLATE` (with `{project}`).
The default remote is `https://bmw.ghe.com/<gh user>/<repo>-history.git` (gh's `hosts.yml`),
else derived from the outer repo's `bmw.ghe.com` origin.

## Hydrate is a union merge

`lib/km-core/src/store/merge.ts`, used at startup, on `POST /api/kb/reload`, by the git merge
driver (`lib/kb/merge-driver.mjs`) and by the embedding backfill:

- entities by id — newest `updatedAt` wins (ties: the live graph);
- relations by `(from, type, to)` — graphology edge keys collide across machines;
- deletions as tombstones in `attributes.kmTombstones`, kept 90 days — a tombstone beats every
  copy not edited after it;
- a relation to an entity this machine does not have is kept aside and written back to its
  file, so it is not deleted for the teammate who has both ends.

Files are canonical (sorted) and rewritten only when their content changed. A file that changed
under the store (a pull) is merged in before the next write, never overwritten.

## Vectors

Embeddings are made on write. What arrives by git is embedded by the backfill obs-api runs
60 s after startup and after every reload that changed the graph
(`lib/kb/embed-index.mjs` → `dist/embedding/backfill.js`, idempotent over content hash and
preview version). The same pass deletes the `kg_entities` points of tombstoned entities by
exact id (`src/embedding/tombstones.ts`). Injection is hybrid — Qdrant plus a keyword search
over the live store — so a pulled insight is findable even before it is embedded.

## Team configuration

| Layer | File | Holds |
|---|---|---|
| 1 | `config/teams/<id>.json` | ontology + validation (read directly by semantic-analysis) |
| 2 | `config/teams.yaml` | shipped labels and kinds — **no** memberships |
| 3 | `~/.coding/teams.yaml` | yours: membership, own teams, `active:` |
| 4 | `CODING_TEAMS=a,b` | env override of the selection |

```yaml
teams:
  raas:
    label: RaaS
    kind: team                                   # team | project
    repos:
      - ~/src/rapid-automations                  # a local checkout
      - https://bmw.ghe.com/me/x-history.git     # a learning repo, cloned when not here
      - { path: ~/src/x2, id: x }                # names the project id stamped there
    include: ['rapid-*']                         # directory-name globs
active: [raas]                                   # empty / absent = all teams
discovery:
  roots: ['~']
  depth: 4
```

A team with neither `repos` nor `include` contains the repo whose directory is named like the
team — what `metadata.team` always meant.

## Filtering

`lib/teams/scope.mjs` `projectsOfTeams(teams)` → project ids; matching is case-insensitive on
`metadata.project`, then the legacy `metadata.team`.

- **obs-api** — `?teams=a,b` on `/api/v1/entities`, `/api/coding/{observations,digests,insights}`
  and `/api/coding/lsl/sessions`, applied before pagination. `/api/teams` returns each team's
  resolved `projects` and the `active` selection.
- **Viewer** — one graph fetch, filtered client-side by both canvases, the rail counts and the
  History sidebar; the LSL strip asks the server. The Teams rail starts from the dashboard's
  `active` selection and writes changes back; it redraws only when the selection changed.
- **Injection** — `/api/retrieve` takes `teams` / `context.teams` (hooks forward
  `CODING_TEAMS`), else the teams of the repo at `context.cwd`, else that repo's own project.
  Qdrant is queried with a `project` `match.any` filter on all four collections and every hit
  is checked again afterwards. Only a session outside every repo is unfiltered.

## APIs

| Endpoint | Where | Does |
|---|---|---|
| `GET/PUT /teams`, `POST /teams/discover`, `POST /teams/sync` | coordinator `:3034` | team config, rescan, clone missing shared repos |
| `/api/teams-config` | dashboard `:3032` | reverse proxy of the above |
| `GET /api/teams` | obs-api `:12436` | teams with resolved projects (for the viewer) |
| `GET /api/kb/layout` | obs-api | which project is written to which file |
| `POST /api/kb/reload` | obs-api | merge changed files into the live store |

## Commands

```bash
coding sync                    # status of every learning checkout
coding sync pull --repo .      # what the launcher runs
coding sync commit             # local commit everywhere
coding sync --push [--yes]     # asks, then pushes
node lib/history/repo-link.mjs ensure <repo> [--remote <url>] [--no-ask]
curl -s localhost:12436/api/kb/layout | jq
curl -s -X POST localhost:12436/api/kb/reload
```

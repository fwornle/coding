# Teams and discovery

A **team is a set of repos**. There is one live knowledge store per machine; the
repo is the unit of persistence (`<repo>/.coding/`, see
[LSL — per-repo learning repo](../lsl/README.md#per-repo-learning-repo)), and every
team filter maps repo → team at read time. An entity's `metadata.project` (and the
legacy `metadata.team`) names its **repo**; team membership is derived, never stamped,
so a repo can belong to several teams and can move between teams without rewriting
the graph.

## Configuration

| layer | file | holds |
|---|---|---|
| 1 | `config/teams/<id>.json` | ontology + validation config (read directly by semantic-analysis) |
| 2 | `config/teams.yaml` | shipped labels, kinds, membership defaults — ships with **no** memberships |
| 3 | `~/.coding/teams.yaml` | this user: membership, own teams, `active:` (written by the dashboard) |
| 4 | `CODING_TEAMS=a,b` | env override of the active selection |

Later layers win per team, per field. A team entry:

```yaml
teams:
  raas:
    label: RaaS
    kind: team                 # team | project
    repos:
      - ~/src/rapid-automations                    # a local checkout
      - https://bmw.ghe.com/me/x-history.git       # a learning repo, cloned when not here
      - { path: ~/src/x2, id: x }                  # names the project id stamped there
    include: ['rapid-*']                          # directory-name globs
active: [raas]                                     # empty / absent = all teams
discovery:
  roots: ['~']
  depth: 4
  ttlMinutes: 10
```

A team with neither `repos` nor `include` contains the repo whose directory name is
its id — what `metadata.team` always meant — so a machine without `teams.yaml` behaves
exactly as before.

Implementation: `lib/teams/config.cjs` — `loadTeams()`, `teamsOf(repoPath)`,
`projectIdFor(repoPath)`, `isActiveRepo(repoPath)`, `writeUserTeams(patch)`. The ETM
(`project` on every observation) and `lib/attribution/repo-router.mjs` stamp through
`projectIdFor`.

## Discovery

`lib/teams/discover.mjs` is the one scanner: git repos carrying `.coding/` or
`.specstory/history`, under the configured roots (default `$HOME`), skipping dot-dirs
and the ignore list, never through symlinks, not descending into a classified repo.
About 250 ms for `$HOME` at depth 4. The result is cached in
`<data home>/var/projects.json`.

It replaced three scanners that each saw a different set of projects: the
coordinator's ETM candidate walk (two levels of `~/Agentic`), the dashboard's LSL
Sessions list and its workflow-reports list (one level of siblings). The scan runs on
the **host**; inside the `coding-services` container `discoveredProjects()` reads the
cache through the data-home mount and maps `$HOME/Agentic/…` onto `/workspace/…`
(repos outside `~/Agentic` are not mounted there). With no cache it falls back to the
old sibling scan.

## Shared learning repos

A `repos:` entry that is only a history remote — a teammate's `X-history` for a
project not checked out here — is cloned under `<data home>/var/shared/<X>/`
(`lib/teams/shared.mjs`). Clone-only here; `coding sync pull` refreshes them (read-only — see
[knowledge-sharing.md](knowledge-sharing.md)).

## API and dashboard

The health coordinator (host, `:3034`) serves `GET/PUT /teams`, `POST /teams/discover`
and `POST /teams/sync`; the dashboard reverse-proxies them as `/api/teams-config`
(not `/api/teams`, which obs-api serves for the viewer). The dashboard's **Teams** tab
(people icon, next to Features; shown while `lsl` is on) lists the discovered repos
against the teams, edits membership, creates and deletes your own teams, sets the
active selection and clones missing shared repos. It writes `~/.coding/teams.yaml`
only.

Tests: `tests/teams/config.test.mjs`, `tests/teams/discover.test.mjs`.

## Filtering by team

Every team filter resolves through `lib/teams/scope.mjs`: a selection of team ids
becomes the project ids of their repos (an id that is no team is taken as a project id),
compared case-insensitively with `metadata.project`, else `metadata.team`.

- **obs-api**: `?teams=a,b` on `/api/v1/entities`, `/api/coding/{observations,digests,insights}`
  and `/api/coding/lsl/sessions` (which walks every discovered repo's transcripts), applied
  before pagination. `/api/teams` lists each team's resolved `projects`.
- **Viewer**: selecting a team admits its repos' entities on both canvases, in the rail
  counts and in the History sidebar; the LSL strip asks the server.
- **Injection**: `/api/retrieve` uses `teams` / `context.teams` (hooks forward
  `CODING_TEAMS`), else the teams the session's repo is a member of (`context.cwd`), else —
  a repo in no team — that repo's own project. The active selection is NOT used: it is
  what you look at in the viewer, not what a session in some repo should know. Qdrant is
  queried with a `project` filter and every candidate is re-checked, so nothing from
  another team is injected. Only a session outside every repo is unfiltered.

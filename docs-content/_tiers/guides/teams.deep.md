## How the selection stays in sync

One writer: the health coordinator (`:3034`, `PUT /teams`) owns `~/.coding/teams.yaml`. Both
front-ends go through it.

| From | Path | Reads back |
|---|---|---|
| Dashboard → Teams | `/api/teams-config` on the dashboard, reverse-proxied to the coordinator | refetches on window focus and every 15 s; its store assigns only fields that changed |
| Viewer Teams rail | `PUT /api/teams/active` on obs-api (debounced), forwarded to the coordinator | polls `GET /api/teams` every 15 s |

The viewer remembers what it last wrote, so reading its own write back is not mistaken for a
dashboard change, and a poll answer that started before a click (or while the click's write was
pending) is ignored. A poll that brings nothing new writes nothing into the store — which is
why the graph does not redraw while you look at it.

## Discovery

`lib/teams/discover.mjs`: roots `discovery.roots` (default `~`), depth 4, skipping dot-dirs,
symlinks and an ignore list, never descending into a repo it has classified. A repo counts
when it is a git repo with `.coding/` or `.specstory/history`. The result is cached in
`<data home>/var/projects.json` for 10 minutes; **Rescan** (`POST /teams/discover`) refreshes
it now. Inside the `coding-services` container the cache is read through the data-home mount
and `$HOME/Agentic/…` is mapped to `/workspace/…`.

## The learning-repo column

It shows the remote recorded in `~/.coding/repos.yaml` for each repo; `—` means the first
`coding` launch there has not happened yet (or was unattended, so nothing was decided). To
change a recorded remote, edit `repos.yaml` and point the checkout at it:

```bash
git -C <repo>/.coding remote set-url origin <url>
coding sync --push --repo <repo>
```

## Shared learning repos

A `repos:` entry that is only a remote is listed under **Shared learning repos** with its state
(`local` = you have the checkout, `shared` = cloned, `missing`). **Clone N missing** calls
`POST /teams/sync`, which clones into `<data home>/var/shared/<X>/` (`lib/teams/shared.mjs`).
Shared clones are pull-only: `coding sync pull` discards local changes in them first, and
obs-api reads them but never writes there.

## Endpoints

| Endpoint | Server | Does |
|---|---|---|
| `GET /teams` · `PUT /teams` | coordinator `:3034` | read / patch `~/.coding/teams.yaml` (`teams`, `active`) |
| `POST /teams/discover` | coordinator | rescan repos |
| `POST /teams/sync` | coordinator | clone missing shared repos |
| `/api/teams-config/*` | dashboard `:3032` | proxy of the three above |
| `GET /api/teams` | obs-api `:12436` | teams with resolved `projects` and `active` (the viewer's source) |
| `PUT /api/teams/active` | obs-api | the viewer's write path, forwarded to the coordinator |
| `?teams=a,b` | obs-api read routes | filter entities, observations, digests, insights, LSL sessions |

## Status line

`[P:n]` appears while `n` learning checkouts have local commits nobody pushed. It reads
`<data home>/var/sync-state.json`, which the coordinator refreshes every 30 minutes and every
`coding sync` rewrites — never git directly, so the status line stays fast.

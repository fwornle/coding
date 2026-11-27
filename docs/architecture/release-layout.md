# Release layout

Where the code of an installation lives, as opposed to its data
(`lib/paths/data-home.cjs`, `~/.coding/data/`). Implementation:
`lib/install/layout.cjs`, with a bash mirror in `scripts/lib/code-root.sh`.

| path | what it is |
|---|---|
| `~/.coding/install.json` | `{channel, version, source, previous, activatedAt}` |
| `~/.coding/releases/<version>/` | one unpacked release; its `release.json` is written last |
| `~/.coding/releases/current` | relative symlink to the active version (a junction on Windows) |

## Two channels

| channel | code lives in | registered against |
|---|---|---|
| `release` | `~/.coding/releases/<version>/` | `~/.coding/releases/current` |
| `dev` | a git checkout (the developer's) | the checkout itself |

With no `install.json` the install is `dev`, using the checkout the code runs
from. A machine that never installed a release behaves as it did before this
layout existed.

## Why `current`

Launchd plists, systemd units, scheduled tasks, the shell rc's `CODING_REPO` and
the compose bind mounts all store a path. If that path named a version, every
update would have to register all of them again, and pruning an old release would
break whatever still pointed at it. Because they name `current`, an update is:
unpack the new release beside the old one, flip the link, restart.

- **Atomic flip**: the new link is created under a temporary name and renamed
  over `current`, so `current` always exists. (Windows cannot rename over a
  junction, so there it is removed first.)
- **Rollback**: `install.json` records `previous`, and `coding releases rollback`
  flips back to it.
- **Data is never inside a release**: `~/.coding/data`, `features.yaml`,
  `teams.yaml` and `install.json` sit outside `releases/`, so a flip cannot change
  them (asserted in `tests/install/layout.test.mjs`).

## What persists `current`

`coding_code_root DIR` (bash) and `stableRoot(dir)` (node) map the folder the
code was started from to the path that should be stored: if `current` resolves
to that folder, the `current` path; otherwise the folder unchanged (a dev
checkout, or an older release started on purpose). Callers:

- `bin/coding` exports `CODING_REPO` / `CODING_TOOLS_PATH` as that root
- `launchd_repo_root` (`scripts/lib/launchd-plist.sh`) and therefore
  `scripts/install-launchd-daemons.sh` and the proxy plist in `install.sh`
- `scripts/install-systemd-daemons.sh`
- `scripts/install-claude-ctx-sweeper-schtasks.sh`

## `coding releases`

```
coding releases [status] [--json]   channel, version, previous, installed releases
coding releases list [--json]
coding releases root                the root to register daemons against
coding releases use <version>       flip current
coding releases rollback            flip back to previous
coding releases adopt <dir>         install an unpacked release tree (needs release.json)
coding releases remove <version> [--force]
```

`adopt` copies into `<version>.<pid>.partial` and renames it into place, so a
folder that has the version's name is always complete. `use` refuses a folder
without a matching `release.json`. `remove` refuses `current`, and refuses
`previous` unless `--force` is given.

A flip changes what the **next** start runs; running daemons keep their code
until restarted. `coding update` (P4) runs the flip, `apply-features` and the
restarts as one step. Containers bind-mount the resolved path when they are
created, so they need recreating, not just restarting.

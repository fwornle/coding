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

## Publishing a release

Decided 2026-11-27: GitHub only (`github.com/fwornle/coding`), images on GHCR,
release numbers start at 8.0.0 (the `v7.x` tags were milestones), and updates
notify and install on one click.

To release, bump `version` in `package.json` and merge to main.
`.github/workflows/release.yml` sees a version that has no GitHub release yet and
runs:

| job | what it does |
|---|---|
| `tarball` | `scripts/release/build-tarball.mjs` builds `coding-<version>.tar.gz` plus `.sha256`, then a smoke test installs it as a release folder and runs `coding` from `current` |
| `install-test` | `scripts/test-install-linux.sh --release <tarball> direct arch` runs a full `install.sh --ci` on a clean Ubuntu, with no submodule fetched |
| `lite` | `cross-platform-lite` on ubuntu, macOS and Windows |
| `images` | builds `coding-services` for linux/amd64 and linux/arm64 on native runners, pushed **untagged** |
| `publish` | only after all of the above: tags the images `:<version>` and `:latest` and creates the GitHub release `v<version>` with the tarball, checksum and notes |

A push to a `feat/release-*` branch runs every job except `publish`; that's how
the pipeline itself is changed.

**The tarball** holds every file tracked at HEAD, minus a developer-only
exclusion list (`EXCLUDE` in the builder; each entry says why it's there). Every
submodule is vendored at the SHA the superproject pins, so installing needs no git
and no submodule clone. `install.sh` checks `submodule_vendored` and skips fetching.
`node_modules` is not bundled: its native builds differ per OS and architecture.

**The notes** (`scripts/release/notes.mjs`) list the conventional commits since the
previous `v8+` release; the first release counts from the last milestone tag.
Breaking changes come first, then features, fixes and performance, and long lists
are capped.

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

## Installing a release

```
curl -fsSL https://github.com/fwornle/coding/releases/latest/download/coding-install.sh | bash
```

`coding-install.sh` is `scripts/release/bootstrap.sh`. Every release attaches it
under that same name, so `latest/download/coding-install.sh` is always the newest
one. It does only what has to happen before any of coding's own code is on the
machine:

1. checks curl, tar, a sha256 tool and Node.js >= 22
2. finds the latest release from the `releases/latest` redirect (`CODING_VERSION`
   pins one)
3. downloads the tarball and checksum, verifies them, unpacks with
   `scripts/releases.mjs adopt` and switches `current` to it
4. runs **that release's** `install.sh` through `current`, passing on its options
   (`--features=<tier>`, `--ci`, and so on), and gives it the terminal when it was
   started from a pipe, so the tier menu can still ask

The installer itself stays where it was. The tier menu, prerequisites, service
registration and image pulls all live in the release's `install.sh`, and
`coding update` re-runs the parts a new release needs (`--update=build|register`).
Because the installer runs from `current`, everything it stores names `current`:
the shell rc, `~/bin/coding`, agent settings and daemons.

To check an install, run `bash ~/.coding/releases/current/scripts/release/verify-install.sh`
(`--tier <name>`, `--offline`) on macOS, Linux or WSL as the user who installed. It
checks the layout, the install record, `~/bin/coding`, the shell rc, that no stored
path names a version folder (agent settings, MCP config, launchd plists, systemd
units), the tier, the daemons, and `coding update --check`. It prints one
`VERIFY pass|fail` line per check and exits 1 on any failure.

Checked by `scripts/test-install-linux.sh --release <tgz> bootstrap`, which runs
one clean Ubuntu container per tier through `scripts/release/bootstrap-e2e.sh`.
That test calls the same `verify-install.sh`, and so does the update test after
its update.
The release workflow gates on the harness and learning tiers.

## `coding update`

```
coding update             install the latest release beside this one and switch to it
coding update --check     report whether a newer release exists; install nothing
coding update --rollback  switch back to the previous release and restart
coding update --pull      dev checkout only: git pull --ff-only + submodule update
```

Implementation: `lib/install/update.mjs`. Steps on the release channel, in order:

| step | what | if it fails |
|---|---|---|
| 1 | read the redirect of `github.com/fwornle/coding/releases/latest` (not the API: 60 anonymous calls an hour per IP, used up behind a shared corporate egress); `curl`, so the proxy variables apply | exit 1, nothing changed |
| 2 | download the tarball and `.sha256`, verify, unpack, `adopt` as `releases/<ver>` | nothing switched |
| 3 | carry the machine files (`CARRY`: `.env`, `.npmrc`, `.coding`, `.data`) from `current`; anything the new release ships wins | nothing switched |
| 4 | `<ver>/install.sh --update=build`: npm installs and builds inside the new folder only | nothing switched |
| 5 | when a Docker feature is on: `docker pull ghcr.io/fwornle/coding-services:<ver>`, tagged as the name compose uses for the built image | nothing switched |
| 6 | switch `current` | |
| 7 | `current/install.sh --update=register`: MCP config, agent settings, hooks, daemons, `.activate`, run through `current` so every stored path names it | switch back, restart |
| 8 | `apply-features`, restart the installed daemons, recreate the `coding-services` container | switch back, restart |

`install.sh --update=…` runs a fixed subset of the installer (`run_update_phase`).
It never runs the one-time or prompting steps, and never the ones that are
destructive when unattended: cleanup of stale global artifacts, API admin keys,
history repo setup, plantuml, gsd-browser, the docs toolchain, the local LLM, the
LLM proxy, the shell rc and `~/bin`. The first install already set those up
against `current`.

On a dev checkout, `coding update` changes nothing. It prints the git commands,
and `--pull` runs them.

Checks: `tests/install/update.test.mjs` (order of steps, what each failure
leaves behind, data and the previous release survive), and
`scripts/release/update-e2e.sh` run through `scripts/test-install-linux.sh
--release A --update-to B update` on a clean Ubuntu. The release workflow runs
the latter as a gate, updating to a next-patch tarball built from the same commit.

## Release notification

When a newer release is out, the status line and the dashboard say so. Both are
display only and fail open.

- **Check**: `lib/install/release-check.mjs`, run by the health coordinator (:3034)
  a minute after it starts and then every 6 hours. It reads the `releases/latest`
  redirect (see above) and writes `~/.coding/release-check.json`. Dev checkouts
  are never checked, and `CODING_UPDATE_CHECK=off` switches the check off. A failed
  check records `error`, but keeps a known update for the same installed version.
- **Status line**: `[⬆ 8.0.1]`, read from that file only, so the status line never
  touches the network. Clicking it runs `coding update` in a tmux popup
  (`bin/statusline-click`, tag `update`).
- **Dashboard**: a banner (`release-banner.tsx`) with the version, the release notes
  (the `coding-<ver>-notes.md` asset the release workflow attaches), a link to the
  release page and an **Update** button. It can be dismissed until the next release.
- **Coordinator routes** (local only; the dashboard proxies them under `/api/release`):

| route | what |
|---|---|
| `GET /release[?refresh=1]` | the last check (or a fresh one), plus `update` status |
| `GET /release/notes` | the available release's notes as markdown, or 204 |
| `POST /release/update` | starts `coding update` from `releases/current`, detached; 409 when nothing is newer, a dev checkout, or one is already running |
| `GET /release/update` | `{running, exit, log}`: a pid file plus an `UPDATE_EXIT=` marker in `~/.coding/update.log`, so the status survives the coordinator restart the update itself causes |

# Cross-platform CI

The cross-platform workflow is **live**. It runs on every pull request and can be
triggered manually from the **Actions** tab.

- Workflow: [`.github/workflows/cross-platform-lite.yml`](../../.github/workflows/cross-platform-lite.yml)

> This directory used to hold a second copy of the workflow, plus instructions to
> "copy it into `.github/workflows/` to enable it". It had been active since
> `6b464a8a1`, and the copy here had already drifted from the live file —
> different triggers, different echo text. The duplicate is gone: there is now
> one workflow file, and it is the one that runs.

## Jobs

| Job | Runs on | What it proves |
|---|---|---|
| `portability` | ubuntu, macOS, windows (Git Bash) | every tracked `*.sh` is valid bash; `install.sh` detects the OS; `--ci` gates warn-and-continue instead of aborting; `test-coding.sh --ci` exits 0 |
| `dry-run-is-inert` | ubuntu | `install.sh --ci --dry-run` exits 0 and mutates **nothing** — neither the working tree nor `$HOME` |
| `real-install` | ubuntu | an actual `./install.sh --ci` completes, then `bin/coding --help` works, and shared agent configs are byte-identical afterwards |

`real-install` is the job that would have caught the original corporate-Ubuntu
failure. Before it existed, CI only *sourced* `install.sh` and called
`detect_platform` / `check_dependencies` / `detect_agents` — so
`install_node_dependencies` was unreachable on every OS, and the npm and proxy
paths were never executed anywhere. Sourcing also leaves `set -euo pipefail`
inactive, so it tested different shell semantics than a real run.

## What "lite" still means

| Proven here | NOT proven here |
|---|---|
| Shell portability across 3 OSes | A full working service stack |
| OS detection | Docker image builds |
| Unattended gates warn-and-continue | Agent CLI auth (claude / gh copilot) |
| A real install completes on Linux | Private submodules (`cc-github.bmwgroup.net`) |
| A default install leaves `$HOME` untouched | Behaviour behind a corporate proxy |

Docker, the agent CLIs and the private submodules do not exist on public hosted
runners. Two gaps are covered elsewhere rather than here:

- **Corporate-proxy behaviour** — `scripts/test-install-linux.sh` runs a real
  `./install.sh` in an Ubuntu 24.04 container across three network shapes
  (direct, proxy-only via a squid sidecar with egress blocked, and no-egress).
  It runs from a developer machine, including macOS, and is the laptop-reproducible
  analogue of the box that originally failed.
- **Full stack** — register self-hosted runners with Docker, an authenticated
  agent CLI and submodule access, then run `install.sh --yes` followed by
  `scripts/test-coding.sh`.

## Unattended flags (used by CI, usable by any automation)

- `install.sh --ci` (or `CI=true`) — non-interactive; declines optional system
  changes; downgrades missing Docker / agent CLI / core-dep gates from fatal to
  warnings so a portability run completes with a summary.
- `install.sh --yes` (or `CODING_INSTALL_YES=1`) — non-interactive; auto-approves
  system changes; keeps hard requirements hard (for a fully-provisioned box).
  Note this does **not** extend to agent scope or background services: those
  need `CODING_INSTALL_GLOBAL_AGENTS=1` / `CODING_INSTALL_SYSTEM_SERVICES=1`.
  See [Host impact and install scope](../install-scope-and-host-impact.md).
- `install.sh --dry-run` — prints the mutation manifest and exits 0, touching
  nothing at all (not even the install log).
- `test-coding.sh --ci` (or `CI=true`) — runs every check but records
  unsatisfied ones as non-fatal `[CI-SKIP]`, so a healthy headless runner isn't
  marked failed. The requirement-7 check is deliberately exempt: a global write
  is a real regression, not an unsatisfied precondition, so it fails hard even
  under `--ci`.

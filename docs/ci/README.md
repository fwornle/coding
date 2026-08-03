# Cross-platform CI (ready-to-enable, not yet active)

This directory holds a **ready-to-enable** GitHub Actions workflow for validating
that the coding tools install/test scripts are portable across macOS, Linux, and
Windows. It is intentionally **not** under `.github/workflows/` yet, so nothing
runs until you opt in.

## Files

- [`cross-platform-lite.yml`](./cross-platform-lite.yml) — a 3-OS matrix
  (`ubuntu-latest`, `macos-latest`, `windows-latest`) that runs a **lite**
  portability check.

## Enable it

Copy the workflow into the active workflows directory on the **public** remote
(`github.com/fwornle/coding`), whose hosted runners include real Windows/Linux/mac:

```bash
cp docs/ci/cross-platform-lite.yml .github/workflows/cross-platform-lite.yml
git add .github/workflows/cross-platform-lite.yml
git commit -m "ci: enable cross-platform lite matrix"
git push origin main
```

Then run it manually from the **Actions** tab (it ships with `workflow_dispatch`
only). Once you're happy, uncomment the `push:` / `pull_request:` triggers in the
workflow to run it automatically.

## What "lite" means

| Proven by lite CI | NOT proven by lite CI |
|---|---|
| Every tracked `*.sh` is valid bash on all 3 OSes | A full working service stack |
| `install.sh` detects the OS correctly | Docker image builds |
| `install.sh --ci` gates warn-and-continue (no abort) when infra is absent | Agent CLI auth (claude / gh copilot) |
| `test-coding.sh --ci` runs end-to-end and exits 0 | Private submodules (`cc-github.bmwgroup.net`) |

The lite path deliberately skips Docker, the agent CLI, and private submodules —
none of which exist on public hosted runners. For **full-stack** CI (real
install + full `test-coding.sh`), register **self-hosted runners** that have
Docker, an authenticated agent CLI, and submodule access, then run
`install.sh --yes` followed by `scripts/test-coding.sh`.

## Unattended flags (used by CI, usable by any automation)

- `install.sh --ci` (or `CI=true`) — non-interactive; declines optional system
  changes; downgrades missing Docker / agent CLI / core-dep gates from fatal to
  warnings so a portability run completes with a summary.
- `install.sh --yes` (or `CODING_INSTALL_YES=1`) — non-interactive; auto-approves
  system changes; keeps hard requirements hard (for a fully-provisioned box).
- `test-coding.sh --ci` (or `CI=true`) — runs every check but records
  unsatisfied ones as non-fatal `[CI-SKIP]`, so a healthy headless runner isn't
  marked failed.

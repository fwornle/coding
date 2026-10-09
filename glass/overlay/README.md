# glass

Token measurement and context-window insight for coding agents (GitHub Copilot CLI,
OpenCode, pi, Claude Code).

**This repository is generated — do not edit it by hand.** Its content is extracted
from `coding` and `rapid-llm-proxy` by `scripts/glass/extract.mjs` (manifest:
`glass/manifest.yaml` in coding). `EXTRACTED.json` names the source commits and the
checksum of every file. Changes go into coding or the proxy, then a new extraction.

## Install

Needs Node ≥ 22.13 — nothing else: no build step, no install scripts, and the two
dependencies are bundled in the tarball, so no npm registry access is needed.

```sh
gh release download --repo bmw.ghe.com/AIMAAD/glass --pattern 'glass-*.tgz'
npm install -g ./glass-*.tgz
glass doctor
```

Then put `glass` in front of the agent: `glass claude`, `glass copilot`, `glass opencode`,
`glass pi` (arguments pass through). `glass ui` opens the token and context view.

## Uninstall

```sh
glass uninstall      # stops the daemon, deletes ~/.glass (asks first)
npm rm -g glass
```

Everything glass writes lives in `~/.glass`; nothing is left outside it. CI checks
exactly this on Linux and Windows (`tests/install-check.mjs`: install → one measured
run per agent → uninstall → HOME unchanged).

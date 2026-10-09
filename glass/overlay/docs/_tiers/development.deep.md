## The pipeline

![Release pipeline](images/release-pipeline.png)

| Step | What happens |
|---|---|
| select | An explicit file list from `coding` and `rapid-llm-proxy` (`glass/manifest.yaml`) |
| compile | The proxy's TypeScript files, with its own compiler settings |
| rewrite | A few declarative rules (proxy paths, default port) |
| overlay | glass-only files from `coding/glass/overlay/`: CLI, daemon, tests, README, these docs, CI workflows |
| build | The reduced UI, built once into `ui/` |
| verify | Imports closed, no forbidden dependency, a smoke run on the Node floor |
| publish | A fresh branch `extract/<coding>-<proxy>` and a pull request into `main` |

`EXTRACTED.json` records the source commits and the checksum of every file. CI fails when
the tree differs from it (`tests/provenance.test.mjs`), so hand edits cannot slip in.

## CI on every pull request

| Check | |
|---|---|
| `glass tests` | Daemon, interception, CLI and status-line tests; provenance; the install check (pack → install offline → one measured run per agent → uninstall → home directory unchanged) — Ubuntu and Windows, Node 22.13.0 and 22.x |
| `glass docs` | `mkdocs build --strict` of this site |
| Wiz | IaC, Secret and Vulnerability scans (required by the AIMAAD org) |

## Releases

`release.yml` runs on every merge into `main`. When `package.json` carries a version that
has no release yet, it packs the tarball, runs the install check on it and creates the
GitHub release `v<version>` with the tarball attached.

## Documentation

These pages are Markdown under `docs/` with `mkdocs.yml`, built with MkDocs Material.
Every page has two tabs: **⚡ Quick** (inline in the page) and **📚 Deep Dive** (a
partial under `docs/_tiers/`). Diagrams: PlantUML sources in `docs/puml/` rendered to
`docs/images/`, Mermaid inline. `docs.yml` builds the site on every pull request that
touches the docs and publishes it to
[aimaad-glass.pages.bmw.ghe.com](https://aimaad-glass.pages.bmw.ghe.com/) when such a
change reaches `main`.

Build locally:

```sh
pip install "mkdocs<2" mkdocs-material mkdocs-minify-plugin
mkdocs serve
```

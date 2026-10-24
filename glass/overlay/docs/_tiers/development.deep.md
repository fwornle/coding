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
| target | `--target <name>` (one per repository): a target's own files, its rewrites (repository, docs site, license), and a scan that fails on any corporate name left in the public tree |
| publish | A fresh branch `extract/<coding>-<proxy>` and a pull request into `main` — only to the target's own repository |

The proxy checkout is `RAPID_LLM_PROXY_DIR`, else `_work/rapid-llm-proxy` next to the
`coding` checkout. Run from a linked git worktree of `coding` (for example
`.claude/worktrees/glass-docs`), that is the main checkout's sibling, so the extractor
works from a worktree without setting anything.

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

## Copilot rates and organisation settings

**Rates.** GitHub's per-model Copilot rates live in coding's `lib/cost/copilot-pricing.mjs`,
one table shared by the status line, the Cost tab and coding's own dashboard:

- a **calibrated** table, fitted per model from an itemized Copilot consumption sheet
  against the tokens the proxy recorded over the same days;
- GitHub's **rate card** as the fallback for every model without enough evidence
  (included models at 0).

To recalibrate when GitHub changes a rate, run in coding, on a machine whose token
database covers the sheet's period:

```bash
node scripts/cost/calibrate-copilot-prices.mjs --sheet=<…_consumption_source.json>
```

It prints, per model, the fitted price level and cache-write share, the fit quality and
the sheet's dollars against the fit, then each month's billed against predicted total —
a stale table shows up as a drifting month. Models with fewer than `--min-days` (default
5) billed days are left to the rate card. `--json` prints the table to paste into
`CALIBRATED_COPILOT_PRICES`; commit it in coding and the next extract ships it.

**Organisation settings.** A contract discount, its name, an FX rate — anything only one
organisation's users should get — never goes into coding, which is public. A target in
`glass/manifest.yaml` can name a `private_overlay`: a directory outside the repository
whose files are copied into that target's tree only, after its own overlay:

```yaml
targets:
  internal:
    remote: git.example.com/org/glass
    private_overlay: ~/.coding/glass-private/internal
```

with `config/cost-defaults.json` inside it (same shape as `~/.glass/cost.json`, see
[How cost is calculated](token-usage.md#how-cost-is-calculated)). Declared means required:
if the directory is missing the extract fails rather than publishing a build without it.
Keep the directory in a private repository on your organisation's git host and clone it
to the declared path on every machine that publishes.

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

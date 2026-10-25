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

**Code and data.** The code holds only public data: GitHub's per-model Copilot **rate
card** (coding's `lib/cost/copilot-pricing.mjs`, included models at 0) and the reading of
billing rules (`lib/cost/billing-rules.mjs`), shared by the status line, the Cost tab and
coding's own dashboard. Everything that comes from an organisation's bill — its contract
discount, the Copilot rates measured on its usage, dated discounts by model or model
family, rate changes, its FX — is a **cost file** (shape and precedence:
[Billing that changes over time](token-usage.md#billing-that-changes-over-time)). A change
in billing is an edit of that file and a new build; no code changes.

**Measuring the rates.** To fit Copilot rates from an itemized usage sheet, run in coding,
on a machine whose token database covers the sheet's period:

```bash
node scripts/cost/calibrate-copilot-prices.mjs --sheet=<…_consumption_source.json> \
  --into=~/.coding/glass-private/internal/config/cost-defaults.json
```

It prints, per model, the fitted price level and cache-write share, the fit quality and
the sheet's dollars against the fit, then each month's billed against predicted total —
a stale table shows up as a drifting month. Models with fewer than `--min-days` (default
5) billed days are left to the rate card. `--into` merges the rates into the cost file's
`copilotPrices`, keeping its other keys.

When GitHub changes a model's rate mid-sheet, one fit over the whole sheet averages the
two rates, and every day after the change drifts the same way whatever its cache share.
Fit each regime on its own: the old one with `--since=<first day> --until=<last day of the
old rate>` (written as a dated `periods` entry), the new one with `--since=<first day of
the new rate>`. If the new rate matches the rate card, the model needs no row at all.

**Organisation settings.** The cost file, and anything else only one organisation's users
should get, never goes into coding, which is public. A target in
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

# coding releases — plan

Living plan, followed across many sessions. **Update the Status column and the
Session log at the end of every session.** Start a session by reading this file,
then `/sl`.

Builds on `per-repo-tenancy.md` (tiers, data home, per-repo learning repos) and
borrows the release path proven by glass (`.planning/glass.md`,
`scripts/glass/extract.mjs`, `glass/overlay/lib/glass/update.mjs`).

---

## Target (user's words, condensed)

1. `coding` is a **fully composable** set of functionalities: every part a user
   might want or not can be selected, activated and deactivated — from the
   dashboard (Features tab) as well as the CLI.
2. Like glass, a user installs a **release**, not the development checkout. The
   release is derived from the development repo(s), not a rewrite.
3. **`coding update`** pulls and installs the latest release.
4. An **automatic notification** whenever a newer release is out (status line +
   dashboard).

## Findings (2026-11-27)

What already exists:

- One feature resolver: built-ins (`lib/features/catalogue.cjs`) →
  `config/feature-profiles.yaml` (tiers `harness → learning → learning-perf →
  everything`, dev `full`, `minimal`) → `~/.coding/features.yaml` →
  `CODING_FEATURE_<ID>`. Dependents auto-disable with a reason string; the
  dashboard Features tab and `coding-features` write through
  `lib/features/write.mjs`.
- Apply tiers `live` / `apply` (`scripts/apply-features.mjs` diffs daemons and
  container programs) / `session` (hooks via `--settings`).
- Drift tests: `tests/features/*` fail when `lib/features/daemons.mjs`,
  `scripts/apply-features.mjs`, `docker/entrypoint.sh` and
  `docs/architecture/features.md` disagree.
- Code and data are already separated: `lib/paths/data-home.cjs` →
  `~/.coding/` (features, teams, repos, guard, box, data).

What is NOT selectable today:

| part | today |
|---|---|
| Box mode (`--box` / `--strict-box` / `--no-box`) | CLI flag or env only; default computed in `bin/coding` (`box_default_feature`: box iff `constraints` on). Not in `features.yaml`, not in the dashboard. |
| Agents (claude, copilot, opencode, pi) | every `config/agents/*.sh` always available; no choice of which to install / offer. |
| Cluster tab | ungated (`integrations/system-health-dashboard/src/components/nav-bar.tsx`, "No feature"). |
| Teams / KB sharing / `coding sync` | always present; rides along with `lsl` / `knowledge` without its own switch. |
| Job-class labelling + gate publishing | inside `llm-proxy`, its own on/off in the Classes card, not on the Features tab. |
| Network/proxy detection, guard daemon, egress lockdown | core or folded into `constraints`; "core" is not written down as a list. |

Distribution today:

- `git clone` of the full development repo (577 MB `.git`), 6 submodules
  (incl. third-party serena), `install.sh` = 5,583 lines.
- The services image is built locally (`docker/docker-compose.yml` `build:`),
  3–5 min.
- `package.json` says `2.0.0`; the `v7.x` tags are milestones, not releases.
- No `coding update`, no release check.

What glass has that coding lacks: manifest + `extract.mjs` with a closed import
graph and smoke run → extract PR to two targets (`glass/targets/{bmw,public}`) →
CI releases on a version bump (`glass/overlay/.github/workflows/release.yml`) →
`glass update` → a release check in the daemon (`UPDATE_CHECK_MS`) → status-line
badge `⬆ glass x.y.z available`.

## Approach

**One release tarball with every feature in it; composition stays at runtime.**
Do not split the download per feature.

- glass needs a hand-written manifest because it takes ~12% of the code. coding
  ships ~95% of itself, so the useful part is an **exclusion** list of
  developer-only paths (`.planning/`, `tests/`, `glass/`, kgbench fixtures,
  `.coding/` history and kb data, docs sources if the docs site is published
  separately) — not an inclusion list of every file.
- The only download worth making selective is the **Docker images**, and that is
  free: pull only the images the enabled features need.
- Submodules are vendored into the tarball at their pinned SHAs, so an install
  needs neither git nor submodules (the same idea as glass bundling its deps).

## Decisions (2026-11-27, user)

1. **Targets** — GitHub only (`github.com/fwornle/coding`).
2. **Image registry** — GHCR (`ghcr.io/fwornle/coding-services`).
3. **Version numbering** — releases start fresh at **8.0.0**; `v7.x` stay milestones.
4. **Update approval** — notify + one click.

---

## Phases

Order: **P1 → P2 → P3 → P4 → P5 → P6.** P1 can ship on its own; P2 + P3 are
the foundation; P4/P5 are small once those exist; P6 is the largest and
riskiest. Each phase ends green on `npm test` with its own acceptance checks;
commit per phase on a topic branch, `merge --no-ff` to main, push (sole
developer — no PRs in coding).

### P1 — Close the composability gaps  `status: done`

- [x] **Run mode** setting `run: auto | box | strict-box | host` in
  `features.yaml`, the Features tab ("Run agents in") and `coding-features run`.
  `auto` = box iff `constraints` on (the rule moved out of `bin/coding`, which
  now asks `coding-features run`). An explicit box with `constraints` off
  resolves to host with a warning (the box runs under the guard). CLI flags
  stay one-off overrides and still go to the guard audit log.
- [x] **Agents** list `agents: [...]` (Features tab "Offered agents",
  `coding-features agents [set a,b|all]`). The launcher refuses an agent left
  out; plain `coding` → claude while offered, else the first offered.
  `config/agents/*.sh` stays the registry. **Installer side not done** — the
  installer still sets up every agent; moves to P6.
- [x] **Cluster** → feature `cluster` (requires `observations`: obs-api serves
  `/api/cluster` + `/api/routing`; apply tier `live`, asked per request, fails
  open). In `everything` and `full`.
- [x] **Teams** → feature `teams` (decided 2026-11-27). Scope: the sharing
  layer only — Teams tab + `/teams` discovery, teammates' shared clones
  (`<data home>/var/shared`), team filters in retrieval (`lib/teams/scope.mjs`
  → own project when off), job-class gate publishing to the team. NOT the
  repo→project mapping (attribution, kb layout: core) and NOT `coding sync` of
  your own learning repo (that is `lsl`'s plumbing).
- [x] **Job-class labelling** stays under `llm-proxy`, with its on/off on the
  Features tab (LLM Proxy row). Proxy side merged as
  adpnext-apps/rapid-llm-proxy#103 (81ce522): gitignored
  `config/llm-routing.machine.yaml` (only `job_classes.enabled`) +
  `GET/PUT /api/job-classes/enabled`. Verified end to end.
- [x] **Core** written down: `lib/features/surfaces.cjs` (`CORE`, `CLIS`,
  `ROUTES`) + the "Core" section of `docs/architecture/features.md`;
  `tests/features/surface-registry.test.mjs` fails on an unmapped `bin/*` or
  route, a mapping that disagrees with the code's gate, or a core item missing
  from the docs. It caught the ungated `/performance/timeline/:taskId` (now
  gated). Open: `bin/ckb` is a broken tracked symlink — delete or restore.
- Accept: every dashboard tab and every `bin/*` CLI maps to a feature or to
  core (test asserts it); run mode and agents round-trip through the dashboard
  and `coding-features`.

### P2 — Separate the code from the install (release layout)  `status: done`

- [x] Releases install into versioned folders `~/.coding/releases/<ver>/` plus
  a relative `current` symlink (junction on Windows) — flip by rename(2) over
  `current` (atomic), `previous` recorded for one-step rollback.
  `lib/install/layout.cjs`; a folder counts only once its `release.json`
  (written last; P3's tarball must carry it) names the same version.
- [x] `~/.coding/install.json`: `{channel: release|dev, version, source,
  previous, activatedAt}`; malformed → throws (start paths fail closed),
  `status()` reports it (display fails open).
- [x] A developer checkout stays a git checkout: no install.json = implicit
  `dev` of the checkout the code runs from — this machine is unchanged.
- [x] `bin/coding` exports `CODING_REPO`/`CODING_TOOLS_PATH` as the stable root
  (`scripts/lib/code-root.sh` `coding_code_root`, bash mirror of
  `stableRoot()`): a release started through `current` exports `current`, a dev
  checkout or an explicitly started older release keeps its own path. Same
  helper in `launchd_repo_root`, the systemd installer and the schtasks
  installer, so a plist/unit/task names `current`, never a version folder.
- [x] `coding releases status|list|root|use|rollback|adopt|remove`
  (`scripts/releases.mjs`); `adopt` copies to `<ver>.<pid>.partial` and renames.
  Docs: `docs/architecture/release-layout.md`.
- Accept: met. `tests/install/layout.test.mjs` (14): two releases side by side,
  flip + rollback switch what a started process runs, `~/.coding` outside
  `releases/` byte-identical across flips, plist rendered from a release names
  `current`, bash and node roots agree. Live: a throwaway launchd job
  registered once against `current` ran 8.0.0 → 8.1.0 → 8.0.0 across
  `use`/`rollback` + `kickstart -k`, then was booted out.
- Left for P4: containers bind-mount the resolved path at creation → an update
  must recreate them; gitignored machine files inside the code tree (e.g. the
  proxy's `config/llm-routing.machine.yaml`) must be carried across a flip or
  moved to the data home; the shell rc's `CODING_REPO` is still written by
  install.sh as the checkout (P6).

### P3 — Release pipeline  `status: built, awaiting first publish`

- [x] Version bump merged to `main` → CI builds the tarball
  (`scripts/release/build-tarball.mjs`: tracked files minus `EXCLUDE`, submodules
  vendored at pinned SHAs via `git archive`, `release.json` last; 18.6 MB).
  `install.sh` skips fetching a vendored submodule (`submodule_vendored`).
- [x] CI builds the service image for amd64 + arm64 (native arm runner), pushes
  by digest; tags `:<ver>` + `:latest` only after the gates.
- [x] Gates: tarball smoke (adopt → use → run `coding` from `current`),
  `scripts/test-install-linux.sh --release <tgz> direct arch`, and
  `cross-platform-lite` (now `workflow_call`).
- [x] Release notes (`scripts/release/notes.mjs`), first release since `v7.6`.
- [x] `package.json` → 8.0.0. `.github/workflows/release.yml`; `feat/release-*`
  pushes are dry runs.
- Accept: pending the first real publish (merging to main publishes v8.0.0).
  After it, the GHCR package may need setting to public once (Package settings).

### P4 — `coding update`  `status: done`

- [x] Release channel (`lib/install/update.mjs`, `coding update`): latest via
  the `releases/latest` redirect (curl; NOT the API — its 60/h anonymous limit
  was already exhausted on the corporate egress IP) → download + sha256 → adopt beside → carry `.env`,
  `.npmrc`, `.coding`, `.data` (shipped entries win) → `install.sh
  --update=build` in the new folder → pull + tag the GHCR image when a Docker
  feature is on → flip → `current/install.sh --update=register` (stored paths
  name `current`) → apply-features + daemon restarts + container recreate.
  Failure before the flip: nothing switched; after: flips back and restarts.
  `--rollback` flips back and restarts.
- [x] `install.sh --update=build|register` (`run_update_phase`): a fixed subset;
  never the prompting/destructive/one-time steps (audit of every main() step,
  2026-11-27: `cleanup_stale_global_artifacts` deletes by default under NI,
  `setup_api_admin_keys` reads stdin even with `--yes`, the script ignores an
  inherited `CODING_REPO` and uses its own logical location).
- [x] Dev channel: prints the git commands; `--pull` runs them.
- [x] `--check` reports only.
- Accept: met on Linux — `update-e2e.sh` in the install-test container: 8.0.0
  installed as a release → `coding update` to 8.0.1 (build + register ran, deps
  in 8.0.1, `.env` carried, `.activate` names `current`, features.yaml
  unchanged, no version path stored) → rollback to 8.0.0: 13/13. Release CI now
  gates on it. macOS: the launchd flip/restart was proven in P2; a full macOS
  update runs with the first real 8.0.x → 8.0.y release.
- Not done: the LLM proxy (separate repo) is not updated by `coding update`;
  `initialize_knowledge_databases` and the `.data` carry are a stopgap until
  that data moves to the data home.

### P5 — Release notification  `status: done`

- [x] The health coordinator (:3034) checks for a newer release a minute after
  start, then every 6 h (`lib/install/release-check.mjs`, the same unmetered
  redirect as `coding update`) → `~/.coding/release-check.json`. Display only,
  fails open (error recorded, a known update kept). Dev: never checked.
  `CODING_UPDATE_CHECK=off`.
- [x] Status line `[⬆ x.y.z]` (reads the file only); click → `coding update`
  in a tmux popup (tag `update`).
- [x] Dashboard banner (`release-banner.tsx`): version, notes (new
  `coding-<v>-notes.md` release asset; attached to v8.0.0 by hand), GitHub link,
  **Update** → coordinator `POST /release/update` (detached, pid file +
  `UPDATE_EXIT=` marker so the status survives the coordinator restart),
  progress log, "reload". Dismissible per release.
- Accept: met, with the release state faked (this machine is a dev checkout):
  banner shown → notes → Update → "installed — reload" (gsd-browser with mocked
  /api/release*, screenshots); status line rendered by the exact tmux command
  shows the clickable badge, the click routes to the popup, and the badge goes
  away with the real state; no network → `error`, no badge
  (`tests/install/release-check.test.mjs`, 10). The real dev state shows no
  banner and no badge.
- Found on the way: `server.js` is a single-file bind mount — replacing it
  orphaned the mount (ENOENT, dashboard API down) until `docker restart
  coding-services`; the shared `Alert` sizes its icon column with `--spacing`,
  undefined in this dashboard (801px column) — the banner keeps its icon in
  the title; `notes.mjs` picked the milestone by `git describe` distance (v7.3
  for 8.0.0) — now the highest `v*` merged into HEAD.

### P6 — Installer becomes a thin bootstrap  `status: done (Linux); macOS fresh user + WSL pending the user`

- [x] `coding-install.sh` (`scripts/release/bootstrap.sh`, attached to every
  release under that fixed name → `releases/latest/download/coding-install.sh`):
  prerequisites (curl, tar, sha256, Node ≥ 22) → latest via the redirect (or
  `CODING_VERSION`) → download + verify → `adopt` + `use` → `exec` the
  release's own `install.sh` through `current` with the options passed on
  (tier menu, prerequisites, service registration, image pull stay there);
  given /dev/tty when piped from curl.
- [x] Scope decision (2026-11-27): the "rest of install.sh moves into steps of
  `coding update`" is already met by `install.sh --update=build|register`
  (P4), which reuses the installer's own functions — moving 5.5k lines into
  another file would be churn without a behaviour change. Not done.
- [x] Fresh-machine test per tier (`scripts/release/bootstrap-e2e.sh`, harness
  shape `bootstrap`): clean Ubuntu per tier, release from a file:// server →
  installer exit 0, `current`, release-channel install.json, deps, no
  submodule fetch, `~/bin/coding` → current, shell rc (or, under `--ci`
  without consent, the suggested export) names current, no version path
  stored, `coding releases status` root = current, features.yaml = tier.
  41/41 across harness, learning, learning-perf, everything. Release CI gates
  on harness + learning.
- [ ] Accept, remaining (needs the user): fresh macOS user account and WSL
  install from a release (`curl … | bash`), per tier. Closes T8 of
  `per-repo-tenancy.md` with a release as the input.

---

## Session log

- **2026-11-28 (8.0.1)** — `scripts/release/verify-install.sh` (macOS/Linux/WSL,
  `VERIFY pass|fail` lines; the bootstrap and update container tests call it:
  51/51). Version 8.0.1 — the first release with `coding update`, the release
  notification and `coding-install.sh`. glass checked against main: both
  targets extract, glass suite 192/0 fail, install-check passes. Next: the
  user's macOS fresh-user + WSL runs (P6 accept).

- **2026-11-27 (P6 done on Linux)** — `coding-install.sh` bootstrap, published
  per release; fresh-machine e2e 41/41 over all four tiers (first run 37/41:
  under `--ci` the installer rightly declines the shell rc without consent —
  the check now accepts that when the suggested export names `current`).
  Remaining: macOS fresh user + WSL by the user.

- **2026-11-27 (P5 done)** — release check + coordinator routes + status line
  badge + dashboard banner; verified with faked state in the browser and via
  the tmux status command. v8.0.0 got its notes asset. Next: P6 (thin
  bootstrap installer), and the first real 8.0.x → 8.0.y update on macOS.

- **2026-11-27 (P3 published, P4 done)** — dry run green, merged, v8.0.0
  publish run started. P4: `coding update` + install.sh update phases + e2e
  (13/13 on Ubuntu after two fixes: `.dockerignore` dropped `*.tgz` from the
  harness image; `cpSync` threw EEXIST on a shipped symlink in `.data`).

- **2026-11-27 (P3 built)** — decisions recorded. Tarball builder + notes +
  vendored-submodule install path + release workflow + tests (8). Local:
  tarball smoke passes; release install test run. Dry run on
  `feat/release-pipeline`. Merging to main = publishing v8.0.0 (asked first).

- **2026-11-27 (P2 done)** — deleted the broken `bin/ckb` symlink (registry,
  docs, test updated). Release layout + install record + stable code root +
  `coding releases` CLI; 14 tests; live launchd flip/rollback probe. Branch
  `feat/release-layout`. Next: P3 — still needs the four open decisions.

- **2026-11-27 (P1 done)** — proxy PR #103 merged after green checks, proxy
  restarted; labelling toggled off and back to "follow the team" from the
  Features tab (UI → endpoint → live tagger → gitignored file → removed).
  Surface registry + core list + drift test. P1 complete. Next: P2 (release
  layout) — the four open decisions above still need answers before P3.

- **2026-11-27 (P1, slice 3)** — `teams` feature (requires `lsl`, live; in
  learning, learning-perf, everything, full): Teams tab/icon gated; `sync.mjs`
  skips shared clones and gate republishing when off (resolves closed);
  injection → `retrievalScope()` returns `{teams, projects}`, off = own project
  as a PROJECT list (a project named like a team — `coding` — expanded to the
  team's four repos until this was caught live). Labelling sub-switch on the
  LLM Proxy row; proxy PR #103 opened (merge was not authorised — left to the
  user). Verified live: teams off → icon gone, injection `['coding']`; on →
  four team projects; features.yaml restored. Known gap: working memory passes
  projects back as `?teams=`, so a project named like a team still expands
  there. Next: P1 core list + coverage test.

- **2026-11-27 (P1, slice 2)** — `cluster` feature: catalogue + profiles
  (`everything`, `full`) + installer fail-open list; obs-api routes gated per
  request; nav tab + gated route; FeatureId type (+ the missing
  `lsl-redirect`); docs. Verified live: toggled off on the Features tab → tab
  gone, `/api/cluster` `{disabled: true}`, `/cluster` explains; back on;
  `~/.coding/features.yaml` restored byte-identical. Teams and job-class
  labelling scoped (see P1 items). Next: `teams`.

- **2026-11-27 (P1, slice 1)** — run mode + agents settings: resolver
  (`settings` in the resolved state), `setSettings()` writer (validates agents
  before writing), CLI verbs, `bin/coding` (box default from `run`, agent
  gate), coordinator `PUT /features {settings}`, dashboard "Agents" card,
  `docs/architecture/features.md` section. Tests: resolve + write-settings +
  launcher (gate tested under `set -e` — the first version died silently there).
  Verified in the browser (draft, blocking, save round-trip) and with
  `bin/coding --dry-run`. Found, not fixed: dashboard writes are not audited
  (coordinator has no `CODING_REPO`, so `features-audit.log` is skipped); a
  nested launch inherits `CODING_BOX*` from the parent session. Next: gate
  Cluster, Teams/sync, job-classes; then the core list.

- **2026-11-27** — Plan written from a survey of the feature system, the
  launcher's box handling, dashboard tab gating, install/distribution and the
  glass release path. No code yet. Next: answer the four open decisions, then P1.

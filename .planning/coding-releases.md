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

## Open decisions (need the user)

1. **Targets** — release only from `github.com/fwornle/coding`, or also
   `bmw.ghe.com` like glass (reuse the `targets/` split for content and repo
   names)?
2. **Image registry** — GHCR (public) or the GHE registry? Decides whether a
   corporate machine pulls without the proxy.
3. **Version numbering** — continue from the `v7.x` milestone tags (e.g.
   `8.0.0`), or start releases on their own line, separate from milestones?
4. **Update approval** — automatic, or notify and update on one click?
   Recommendation: notify + one click, like glass.

---

## Phases

Order: **P1 → P2 → P3 → P4 → P5 → P6.** P1 can ship on its own; P2 + P3 are
the foundation; P4/P5 are small once those exist; P6 is the largest and
riskiest. Each phase ends green on `npm test` with its own acceptance checks;
commit per phase on a topic branch, `merge --no-ff` to main, push (sole
developer — no PRs in coding).

### P1 — Close the composability gaps  `status: not started`

- [ ] **Run mode** setting `box | strict-box | host` in `features.yaml` and on
  the Features tab. Requires Docker. `constraints` on makes `box` the
  *default* (moves the rule out of `bin/coding`'s `box_default_feature`); the
  CLI flags stay as one-off overrides and still go to the guard audit log.
- [ ] **Agents** as an enabled-agents list; the launcher and installer offer
  only those (`config/agents/*.sh` stays the registry).
- [ ] Gate **Cluster**, **Teams / sync** and **job-classes** — a feature each,
  or explicit sub-switches of an existing one.
- [ ] Write **core** down as a list in `docs/architecture/features.md`, and let
  the drift tests cover it.
- Accept: every dashboard tab and every `bin/*` CLI maps to a feature or to
  core (test asserts it); run mode and agents round-trip through the dashboard
  and `coding-features`.

### P2 — Separate the code from the install (release layout)  `status: not started`

- [ ] Releases install into versioned folders `~/.coding/releases/<ver>/` plus
  a `current` symlink — atomic switch, one-step rollback.
- [ ] `~/.coding/install.json`: `{channel: release|dev, version, source}`.
- [ ] A developer checkout stays a git checkout (`channel: dev`).
- [ ] `bin/coding` resolves its code root from `install.json` instead of its own
  location; daemons registered against `current`, not a versioned path.
- Accept: two release folders side by side, flipping `current` switches the
  running version after an `apply-features` + daemon restart; data in
  `~/.coding/` is untouched by the flip.

### P3 — Release pipeline  `status: not started`

- [ ] Version bump merged to `main` → CI builds the tarball (exclusion list,
  submodules vendored at pinned SHAs).
- [ ] CI builds and pushes the service images to the chosen registry, tagged
  with the release version.
- [ ] Gate on `docker/Dockerfile.install-test` + `cross-platform-lite` before
  publishing.
- [ ] Release notes from the conventional commits since the last release.
- Accept: a version bump produces a release with the tarball + images; an
  install from that tarball passes the install test on macOS and Linux.

### P4 — `coding update`  `status: not started`

- [ ] Release channel: download → verify → unpack beside the current version →
  migrations (`features.yaml` schema, data home, project hook settings — e.g.
  `scripts/strip-project-hooks.mjs`) → pull images for enabled features →
  `apply-features` → restart daemons → flip `current`. `coding update
  --rollback` flips back.
- [ ] Dev channel: say so, offer `git pull` + submodule update.
- [ ] `--check` reports only, installs nothing (like `glass update --check`).
- Accept: update from N-1 to N on a release install leaves features, teams and
  learned data intact; rollback returns to N-1.

### P5 — Release notification  `status: not started`

- [ ] The health coordinator (:3034) checks for a newer release every few hours
  (like glass's `UPDATE_CHECK_MS`). Display only — fails open.
- [ ] Status line `⬆ coding x.y.z`; click → `coding update` in a tmux popup.
- [ ] Dashboard banner with the release notes and an **Update** button; the
  update runs on the host, so it goes through the coordinator, like `/features`.
- Accept: a fake newer release shows the badge and banner; clicking Update
  completes P4's flow; no network → no badge, no error spam.

### P6 — Installer becomes a thin bootstrap  `status: not started`

- [ ] `install.sh` downloads the latest release and keeps only the tier menu,
  prerequisites, service registration and optional image pull.
- [ ] The rest of its 5.5k lines moves into re-runnable steps of
  `coding update`.
- [ ] Completes the open T8 fresh-machine test (`per-repo-tenancy.md`) with a
  release as the input instead of a clone.
- Accept: fresh macOS user account and WSL install from a release, per tier.

---

## Session log

- **2026-11-27** — Plan written from a survey of the feature system, the
  launcher's box handling, dashboard tab gating, install/distribution and the
  glass release path. No code yet. Next: answer the four open decisions, then P1.

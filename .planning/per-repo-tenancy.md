# Per-repo tenancy — plan

Living plan, followed across many sessions. **Update the Status column and the
Session log at the end of every session.** Start a session by reading this file,
then `/sl`.

Supersedes the one-tenant-per-install design in
`~/.claude/plans/drifting-crunching-papert.md` (P0–P5). What P0–P4 built stays
(data-home resolver, scope resolver, feature profiles, daemon installer, proxy
installable, clean-room harness); what changes is the **unit of persistence and
sharing**: the repo, not the install.

---

## Target (user's words, condensed)

1. A colleague clones `coding` on macOS, Linux or Windows (WSL), runs install, and
   is **asked** which tier to install. The install delivers exactly that tier:
   - **(a) harness** — agent launcher, status line, health monitoring (coordinator
     + dashboard), LLM proxy incl. token measurement
   - **(b) learning** — (a) + LSL + online learning (observations, digests,
     insights) + UKB batch learning + unified viewer (vkb)
   - **(c) learning + performance** — (b) + performance measurement
   - **(d) everything** — (c) + constraints + codegraph (graphify)
2. When `coding` starts in a repo `X` with no learning-data repo, the user is asked
   where to keep `X`'s learned data: a private `X-history` repo (default
   `bmw.ghe.com/<user>/X-history`) or **skip** (data stays untracked; the skip is
   remembered and never re-asked). A missing remote is created. An existing one
   (e.g. a teammate's) is cloned and **shared** — knowledge travels via git through
   the KB JSON exports.
3. Learned data sources (repos, tracked or not) are grouped into named **teams**
   (e.g. `raas`), configured by YAML **and** the health dashboard. A **discovery**
   scan of a top-level path (default `$HOME`) finds candidate repos. One or several
   teams can be selected; the selection is the primary filter for the **unified
   viewer** and for **insight injection**.
4. LSL redirect keeps working against each user's own coding checkout (developers
   of the toolchain only).
5. A user's installation is completely decoupled from the developer's.

## Decisions (taken 2026-10-03 — do not re-litigate)

| # | Decision |
|---|---|
| D1 | Per-repo learned data lives in a nested checkout **`<repo>/.coding/`** (the `X-history` repo), with `history/` (LSL) and `kb/` (KB exports, measurement exports). Ignored by the outer repo. `<repo>/.specstory/history` becomes a symlink into `.coding/history/` for SpecStory compatibility. |
| D2 | Windows = **WSL only**. No native PowerShell installer; `install.bat` is removed. |
| D3 | Sync: **automatic pull** at session start; automatic **local commit**; **push only on confirmation** (same rule install uses today). |
| D4 | Submodules move to **HTTPS** URLs so a colleague needs no SSH key / access to the developer's GitHub account. |
| D5 | The 2,353 tracked `knowledge-management/insights/` files and the ~119 MB tracked KB under `.data/` **leave the tools repo** (T7). |
| D6 | **One live store per machine** (obs-api is the single owner of km-core's LevelDB; one Qdrant). The repo is the unit of **persistence and sharing**; a **team is a set of repos**; every filter maps repo → team. No per-team or per-repo live stores. |
| D7 | Scope (`~/.coding/scope`) shrinks to "this machine's runtime home": `~/.coding/data/<scope>/var/` keeps machine-local caches (LevelDB, Qdrant, token-usage.db, raw measurements). It is no longer the persisted/shared unit. |

---

## Current state (audit 2026-10-03, read-only)

**Installer**
- Menu (`install.sh` ~:4399-4445) offers `full | proxy-only | logging-only | minimal`; `km`/`km-perf` exist in `config/feature-profiles.yaml` but are hidden. Default `full` turns on `lsl-redirect` (developer-only — moves a colleague's turns into their tools checkout).
- Once `~/.coding/features.yaml` exists the question is never asked again, even interactively (~:4418).
- Ungated steps (run for every tier): `check_dependencies`, `install_plantuml`, `install_gsd_browser`, `setup_local_llm`, `setup_mcp_config`, `initialize_shared_memory`, `install_skills` (all skills), `install_okb_snapshot_guard`, `install_constraint_monitor_hooks` (writes the constraint hook into `~/.claude/settings.json` under `--global-agents` even with constraints off, ~:5354-5430), `setup_api_admin_keys`.
- Proxy clone from `bmw.ghe.com/adpnext-apps/rapid-llm-proxy` failing only warns (~:2937) → a tier can "succeed" without its proxy.
- Submodules use SSH `git@github.com:fwornle/*` (`.gitmodules`); semantic-analysis init failure is fatal.
- Tracked files with developer paths: `.activate:3-4`, `.claude/settings.local.json:14,43,80`. `scripts/migrate-history-to-private.sh:94` defaults to `bmw.ghe.com/Frank-Woernle`.

**Platforms**
- `install_feature_daemons` returns early on non-macOS (~:3158). Linux/WSL get no coordinator, obs-api, sub-agent capture or measurement daemons → health + online learning broken there. `lib/features/daemons.mjs` can drive systemd/schtasks but nothing creates the units. Proxy step uses `lsof`.
- `auto-measure-foreground` is in `DAEMONS` but has no template anywhere.
- CI (`.github/workflows/cross-platform-lite.yml`) never installs a non-default profile, never does a real macOS/Windows install.

**Per-repo learning repo**
- A per-repo launch prompt exists: `ensure_private_history_repo` (`scripts/agent-common-setup.sh:172-407`, called at :822): default `https://bmw.ghe.com/<gh user>/<basename>-history.git`, Enter/URL/`skip`, skip marker `<repo>/.specstory/.history-repo-skipped`, `LSL_HISTORY_AUTO` for non-interactive.
  - Missing remote → `git init` + print a `gh repo create` recipe; never creates it.
  - Existing (teammate) remote → `git init` + README + push → rejected, silently. Never clones.
  - Accepts public URLs (private check only exists in install).
- A second, disjoint mechanism: `install.sh setup_history_repo` (~:3975) + `history_default_url` (`<scope>-history`) + `bin/init-history.sh` (clones into the data home only when empty; never merges, never pushes) + `gh repo create --private` (~:4091). The two never reconcile.
- Only **LSL** is per repo (`<repo>/.specstory/history`, ETM `getSessionFilePath` `scripts/enhanced-transcript-monitor.js:3635`). Observations/digests/insights (`kb/observation-export/*.json`), KB exports (`kb/knowledge-graph/exports/general.json`), LevelDB, token-usage.db, measurements are **per scope**, resolved in `lib/paths/data-home.cjs`.
- No `git push`/`git pull` anywhere in `scripts/ lib/ bin/`. ETM only `git add -f`s.
- Hydrate is count-based: JSON wins only if it has more nodes (`lib/km-core/dist/store/persistence.js:118-131`) — no merge; a teammate's edits are ignored.
- Exports are not split by project: km-core exporter buckets by `metadata.domain` (default `general`, `lib/km-core/src/store/exporter.ts:85,154-161`); `ObservationExporter.js:325,430,493` defaults project to `'coding'`; `ObservationWriter.js:1715` hardcodes `project: 'coding'` on the Redis embedding publish.
- Legacy per-team exports write to `<cwd>/.data/knowledge-export` (`scripts/export-graph-to-json.js:106`, `lib/fallbacks/memory-fallback.js:13`).

**Teams / discovery / viewer / injection**
- "Team" = `config/teams/*.json` (ontology + validation config, `kind: team|project`), read by `lib/teams/registry.mjs:63-93`, served at obs-api `GET /api/teams` (`scripts/observations-api-server.mjs:1517`). No repo list, no YAML, no dashboard UI.
- `metadata.team` is stamped as the repo basename (`lib/attribution/repo-router.mjs:6`, `src/live-logging/ObservationConsolidator.js:895`).
- Three ad-hoc repo scanners, all limited to `dirname(codingRoot)`: `scripts/health-coordinator.js:2483-2507`, dashboard `lsl-sessions.mjs:60-74`, dashboard `server.js:2618-2639`. No persisted registry.
- Viewer: multi-select `TeamsFilter.tsx` / `selectedTeams` (`store/viewer-store.ts`), filtered **client-side** (`graph-builder.ts:411`, `visibility-predicate.ts:378`); one backend per system; obs-api `/api/v1/entities` has no team param; LSL history from one dir (`observations-api-server.mjs:3741`). HistorySidebar shows team but doesn't filter.
- Injection: claude hook `src/hooks/knowledge-injection-hook.js`, opencode `plugins/opencode/knowledge-injection.js`, copilot `src/hooks/knowledge-injection-copilot-posttool.js` → `POST /api/retrieve` → `src/retrieval/retrieval-service.js retrieve()`. Qdrant search has **no payload filter** (:396-405); project is a soft rerank only (×1.15 / ×0.5, :462-488). `src/retrieval/working-memory.js:31` calls the retired `:8080`.

**LSL redirect**: portable (target `CODING_TOOLS_PATH || CODING_REPO || codingRoot`, realpath compares in `lib/scope/resolve.cjs`). Only problem: on by default via `full`.

---

## Phases

Order: **T1 → T3 → T5 → T4 → T6 → T2 → T7 → T8.** T3/T5 fix the layout and the
repo→team mapping that T4/T6 build on. Each phase ends green on `npm test` and
with its own acceptance checks; commit per phase on a topic branch, `merge --no-ff`
to main, push (sole developer — no PRs in coding; rapid-llm-proxy uses PRs).

### T1 — Install tiers  `status: done`

- [x] `config/feature-profiles.yaml`: four tier profiles —
  `harness` = `llm-proxy, health, statusline`;
  `learning` = harness + `lsl, observations, knowledge`;
  `learning-perf` = learning + `performance`;
  `everything` = learning-perf + `constraints, codegraph`.
  `lsl-redirect` in **no** tier; `full` stays as the developer profile (= everything + `lsl-redirect`). `km`→learning, `km-perf`→learning-perf, `proxy-only`→harness, `logging-only`→learning are `alias:` entries (resolve, hidden from `coding-features profiles` + coordinator `/features`); `minimal` kept as the `--features=a,b` baseline. Built-ins mirrored in `lib/features/resolve.cjs`.
- [x] Menu shows the four tiers (one-line descriptions + Docker need). Interactive default `harness` (or the current selection); unattended default `harness`. The choice is always written (`full` included) — an absent file resolves to `full`.
- [x] Interactive re-run re-asks (current selection as default, `keep` for explicit per-feature configs); `--ci`/`--yes` keep current behaviour.
- [x] Gating: skills per feature (`lib/features/skills.cjs`, used by the per-launch plugin and the global copy; generated catalogs stay complete), code-graph MCP entry dropped when `codegraph` off, OKB guard + `initialize_shared_memory` + plantuml → `knowledge`, local LLM → `llm-proxy`, gsd-browser = base, constraint/LSL/health hooks under `--global-agents` → delegated to `build-claude-runtime-config.mjs --install-global` (one hook per feature). `tests/features/installer-gating.test.mjs` + new `skill-gating.test.mjs`.
- [x] Proxy clone/build failure is **fatal** (`llm_proxy_unavailable`, names the access needed); `--ci` records it in INSTALLATION_FAILURES instead.
- [x] `docs/architecture/features.md` + `docs/getting-started.md` tier tables; README + CLAUDE.md updated.
- Accept: `./install.sh --dry-run --features=<tier>` for each tier prints exactly the tier's manifest rows (asserted per tier in installer-gating); profile-matrix covers the four tiers + `full` + `minimal` + alias `km`.

### T3 — One per-repo learning repo  `status: todo`

- [ ] Per-user registry **`~/.coding/repos.yaml`**: `repo path → { remote | skip, team? }`. Replaces `.specstory/.history-repo-skipped` (migrate existing markers on first read).
- [ ] Merge the two mechanisms into one implementation (a node module, e.g. `lib/history/repo-link.mjs`, called by the launcher and by install): `ensure_private_history_repo` becomes a thin caller; `install.sh setup_history_repo` / `init-history.sh` reuse it for the tools repo itself.
- [ ] Launch flow for repo X (not the tools repo): registry hit → done; else prompt (default `https://bmw.ghe.com/<gh user>/X-history.git`, Enter / URL / `skip`) →
  `git ls-remote` → **exists**: clone into `<X>/.coding/` (teammate share); **missing**: `gh repo create --private` on the host, then init + push initial layout; **public repo**: refuse. Non-interactive: `LSL_HISTORY_AUTO` semantics kept.
- [ ] Layout of `<X>/.coding/`: `history/`, `kb/`, `README.md`, `.gitignore`; outer repo ignores `.coding/` (append to `.git/info/exclude`, not the tracked `.gitignore`? — decide; current code edits `.gitignore`).
- [ ] ETM writes LSL to `<X>/.coding/history/`; `<X>/.specstory/history` → symlink. Migrate existing per-repo `.specstory/history` git checkouts (they ARE X-history repos already) by moving them to `.coding/` and restructuring into `history/`.
- [ ] Skip = untracked local `<X>/.coding/` (still written, never committed/pushed).
- Accept: unit tests with a local bare remote for all four paths (new, existing-with-content, skip, public-refused); a launcher smoke in a scratch repo.

### T5 — Teams and discovery  `status: todo`

- [ ] **`config/teams.yaml`** (shipped defaults, replaces/extends `config/teams/*.json` — keep ontology fields) + **`~/.coding/teams.yaml`** (user layer, wins). Per team: `id`, `label`, `kind`, ontology/validation fields, `repos:` (local paths and/or history remotes), `include` patterns. A team may list a remote that isn't checked out locally → only its `X-history` is cloned (under `~/.coding/data/<scope>/var/shared/<X>/` or similar — decide).
- [ ] Active selection: `~/.coding/teams.yaml` `active: [raas, coding]`; env `CODING_TEAMS` overrides.
- [ ] One discovery module `lib/teams/discover.mjs`: configurable roots (default `$HOME`), depth, markers (`.coding/`, `.specstory/history`, nested `*-history` remote), ignore list; cached in `var/projects.json`. Replace the three ad-hoc scanners (coordinator, dashboard lsl-sessions, dashboard workflow-reports).
- [ ] `lib/teams/registry.mjs` returns `repos[]`; a `teamsOf(repoPath)` helper. `metadata.team`/`project` stamping (`repo-router.mjs`, `ObservationConsolidator.js:895`) derives from the mapping, not the basename.
- [ ] Coordinator `/teams` API (host, like `/features`, since the files are on the host) + dashboard **Teams** tab: discovered repos, assign to teams, edit teams, set active teams; writes `~/.coding/teams.yaml`. Dashboard `server.js` reverse-proxies.
- Accept: tests for YAML layering, discovery on a fixture tree, mapping; Teams tab verified with gsd-browser.

### T4 — Persisting and sharing knowledge  `status: todo`

- [ ] Exports split by **project** into each linked repo's `<X>/.coding/kb/` (km-core exporter bucket by `metadata.project`; ObservationExporter per project). Unlinked/skipped repos still export locally (untracked).
- [ ] Hydrate = **union** of all registered repos' `kb/` exports (+ shared team repos from T5), with a real merge: by entity/relation id, newest `updatedAt` wins, tombstones for deletions, provenance kept. Replace the count-based rule in km-core `persistence.js`.
- [ ] Sync (D3): pull at session start (launcher), local commit at session end / periodically (ETM or a sweeper), push only on confirmation (`coding sync --push` + a status-line hint when ahead).
- [ ] Remove `'coding'` defaults: `ObservationExporter.js:325,430,493`, `ObservationWriter.js:1715`; legacy exporters onto the data-home/repo resolver.
- [ ] Measurements + token usage tagged by project; per-repo export of summaries into `kb/` (raw stays in `var/`).
- Accept: two-user test — users A and B (separate `HOME`s) share `raas-history` via a local bare remote; A's insight appears in B's KB after B's next session start; concurrent edits merge.

### T6 — Team filter everywhere  `status: todo`

- [ ] obs-api: `?teams=a,b` (server-side) on `/api/v1/entities`, observations, digests, insights, history; LSL history iterates the discovered/linked repos, not one dir.
- [ ] Viewer: send the selection to the server; HistorySidebar honours `selectedTeams`; team list from `/api/teams` (now repo-backed).
- [ ] Injection: retrieve context carries `teams[]` (active selection, default = teams containing cwd's repo); Qdrant payload **filter** on indexed `team`/`project` payload (index at embed time, `src/embedding/backfill.ts`; backfill existing points); all three hooks (claude, opencode, copilot) send it.
- [ ] Fix `src/retrieval/working-memory.js` (retired `:8080`) → obs-api with teams.
- Accept: injection test with fixtures in two teams proves zero cross-team results; viewer filter verified with gsd-browser.

### T2 — Linux + WSL  `status: todo`

- [ ] systemd **user** units for every `DAEMONS` entry (templates next to `launchd/`, rendered with the same token scheme); `install_feature_daemons` installs them on linux/wsl; uninstall removes them. WSL without systemd: documented fallback (supervisor via `coding` launcher) — decide.
- [ ] Template (or drop) `auto-measure-foreground`.
- [ ] Replace `lsof` in the proxy step; Linux-safe launcher hints (no `launchctl` text).
- [ ] Remove `install.bat`; `bin/coding.bat` → message pointing to WSL.
- Accept: CI real install of each tier on ubuntu with services up (`health`, obs-api, proxy) and a status-line probe.

### T7 — Migrate the developer machine  `status: todo`

- [ ] `coding` itself becomes a normal linked repo: `coding-history` moves to `<coding>/.coding/` (history/ + kb/); `.specstory/history` symlink.
- [ ] Move the ~119 MB tracked KB under `.data/` and the 2,353 `knowledge-management/insights/` files out (D5): `git rm --cached`, `.gitignore`, keep the legitimately shipped ~500 KB (ontologies, knowledge-config, graphify metadata, smoke json, kb-ab specs). Update the UKB commit sweep (`feedback_commit_ukb_run_artifacts`) and the OKB pre-commit guard + its test. History not rewritten.
- [ ] Remove developer paths from tracked files (`.activate`, `.claude/settings.local.json`, `migrate-history-to-private.sh`).
- [ ] D4: `.gitmodules` → HTTPS; `git submodule sync`.
- [ ] Services stopped during the move (LevelDB LOCK held by obs-api + container; km-core `close()` persists). Reversible.
- Accept: UKB production run writes only under data home / `.coding/`; `git status` clean in the tools repo after a UKB run; `/sl` reads history through the symlink.

### T8 — Whole-system test campaign  `status: todo`

- [ ] Clean-room **real install per tier** (Linux container, extend P4 harness `tests/...clean-room`), asserting the sentinel developer tree untouched and the tier's services/tabs/badges present and others absent.
- [ ] Real macOS install in a fresh macOS user account; WSL install on a Windows machine.
- [ ] Two-user sharing scenario (T4 acceptance, end to end with agents).
- [ ] Functional, per tier: UKB batch (`semantic workflow run wave-analysis` production + `--debug` with zero real calls), online learning (observation → digest → insight), unified viewer with team filters, insight injection with team filters, health dashboard + status line, token accounting, performance tabs, constraints.
- [ ] UI checks via `gsd-browser` (measure the live DOM).

---

## Open questions (decide inside the phase)

- T3: ignore `.coding/` via `.git/info/exclude` (no tracked change) vs `.gitignore`.
- T5: where teammate repos that aren't checked out locally are cloned.
- T2: WSL without systemd.

## Session protocol

1. Read this file, then `/sl`.
2. Work the first `todo` / `in progress` phase; tick boxes as they land.
3. At the end: update `status:` and append to the Session log (date, commits, what's verified, what's next).

## Session log

- **2026-10-03** — Audit + plan written. Decisions D1–D7 taken. Prior work this day:
  vendored v1 LLM proxy SDK removed from semantic-analysis + constraint-monitor
  (coding `4e35deb8`); `ukb debug` Wave 1 observation-retry leak fixed (`1a6e5d69`);
  proxy route `bg-constraint-monitor` in PR rapid-llm-proxy#37 (open). Next: **T1**.
- **2026-10-03 (T1)** — Install tiers done on branch `per-repo-tenancy-t1`. Decided:
  retired names are aliases (km→learning, km-perf→learning-perf, proxy-only→harness,
  logging-only→learning), `minimal` kept as the comma-list baseline, unattended default
  `harness`, plantuml→knowledge / gsd-browser→base / local LLM→llm-proxy. Verified:
  `npm test` green (node:test 1923 pass, jest pass); per-tier `--dry-run` manifests;
  live coordinator `/features` + dashboard Features tab list only the 4 tiers + full +
  minimal. Not verified: a real (non-dry-run) install per tier — that is T8. Next: **T3**.

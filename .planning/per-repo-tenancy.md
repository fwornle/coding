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

### T3 — One per-repo learning repo  `status: done`

- [x] Per-user registry **`~/.coding/repos.yaml`**: `repo realpath → { remote | skip, team? }`. `.specstory/.history-repo-skipped` is migrated on first read (recorded, marker removed).
- [x] One implementation: `lib/history/repo-link.mjs` (`ensure`, `linkRemote`, `cloneInto`, `remoteState`, `ensureLayout`, registry). `ensure_private_history_repo` is a thin caller; `bin/init-history.sh` clones the data home through it (`clone --nest`); `install.sh history_repo_state` delegates to `state`.
- [x] Launch flow: registry hit → done; else prompt (default `https://bmw.ghe.com/<gh user>/X-history.git` or `LSL_HISTORY_REMOTE_TEMPLATE`) → exists: clone into `<X>/.coding/`; missing: `gh repo create --private` (or `git init --bare` for a local path) + init + push skeleton; public: refused. `LSL_HISTORY_AUTO` kept; with no way to ask, layout only, nothing recorded.
- [x] Layout `<X>/.coding/`: `history/`, `kb/`, `README.md`, `.gitignore` (lock artefacts, `session-state.json`, `var/`). **Decided:** outer repo ignores `.coding/` + `.specstory/history` via `.git/info/exclude` (no tracked change). The legacy `.specstory/history/` line `ensure_coding_runtime_ignored` writes into tracked `.gitignore` is untouched.
- [x] ETM writes through `<X>/.specstory/history` → `../.coding/history` (relative symlink) — no path change needed. Its `git add -f` now runs only when the nearest repo is not the outer project (a skipped repo used to get transcripts force-staged into the outer repo). Existing nested checkouts become `.coding/` and are restructured into `history/` with a LOCAL commit; plain dirs move into `.coding/history/`.
- [x] Skip = untracked local `<X>/.coding/` (no `.git`), ignored by the outer repo.
- Accept: `tests/history/repo-link.test.mjs` (17 cases, local bare remotes: new, existing current/old layout, skip, public-refused, migrations, stand-downs); launcher smoke via `ensure_private_history_repo` in a scratch repo; migration verified on copies of `balance` and `copi`.
- Follow-up (T4): nothing is pushed beyond the skeleton — restructure commits and migrated transcripts wait for T4's confirmed push. `docs/puml/lsl-repo-split.puml` still shows the nested layout.

### T5 — Teams and discovery  `status: done`

- [x] **`config/teams.yaml`** (shipped, no memberships) + **`~/.coding/teams.yaml`** (user, wins per team/field) EXTEND `config/teams/*.json` (ontology stays there — semantic-analysis reads it directly). Per team: `label`, `kind`, `description`, `repos:` (paths / history remotes / `{path, remote, id}`), `include` globs. No `repos`/`include` = the same-named repo (old basename meaning). **Decided:** remote-only repos clone under `<data home>/var/shared/<X>/` (`lib/teams/shared.mjs`, clone-only).
- [x] Active selection: `active:` in the user (or shipped) layer; `CODING_TEAMS` overrides. Empty = all.
- [x] `lib/teams/discover.mjs`: roots (default `$HOME`), depth 4, ignore list, markers `.coding/` + `.specstory/history` on a git repo; cached in `<data home>/var/projects.json` (TTL 10 min). Replaced the coordinator ETM-candidate walk, dashboard `lsl-sessions.mjs` and `server.js getKnownProjectPaths` — the container reads the host cache via the data-home mount, mapping `$HOME/Agentic` → `/workspace` (new `lib/teams` + `lib/features/vendor` bind mounts).
- [x] `lib/teams/registry.mjs` returns `repos[]`, `include`, `active`; `teamsOf()` / `projectIdFor()` / `isActiveRepo()` in `config.cjs`. ETM observation `project` and `repo-router.teamForPath` stamp via `projectIdFor` (consolidator inherits it).
- [x] Coordinator `GET/PUT /teams`, `POST /teams/discover`, `POST /teams/sync`; dashboard proxy `/api/teams-config`; **Teams** tab (repo×team matrix, active chips, add/delete own teams, shared-repo clone).
- Accept: `tests/teams/config.test.mjs` + `discover.test.mjs` (layering, env, mapping, writer, fixture-tree scan, cache, container translation, fallback, shared clone from a bare remote); Teams tab verified with gsd-browser (render, active toggle + assignment written to `~/.coding/teams.yaml`, reverted).

### T4 — Persisting and sharing knowledge  `status: done` (token usage by project → T4b)

- [x] Exports split by **project**: km-core gets an `ExportLayout` seam (`src/store/layout.ts`; default = the old per-domain dir). coding's `lib/kb/layout.mjs`: bucket = `metadata.project` → legacy `metadata.team` → `general`; file = `<repo>/.coding/kb/knowledge-graph/<project>.json` when the repo has a `.coding/` the outer repo IGNORES (linked or skipped — a never-relaunched repo would otherwise get untracked files), else `<data home>/kb/knowledge-graph/exports/projects/<project>.json`. Shared clones are read, never written. Modes: `owner` (obs-api, the only writer into repos) / `local` (container stores: read everything, write `exports/general.json` — `/workspace` is read-only). ObservationExporter also writes a per-project slice to `<repo>/.coding/kb/observation-export/`; the combined cold-store files stay.
- [x] Hydrate = **union merge** (`src/store/merge.ts`) of LevelDB + every layout source: entities by id, newest `updatedAt` wins (ties → LevelDB/live); relations by `(from,type,to)` (graphology edge keys collide across machines); **tombstones** in `attributes.kmTombstones` (90 days); relations to entities absent on this machine kept aside and written back to their file. Count-based rule removed. Canonical (sorted) files, unchanged files not rewritten. `GraphKMStore.reloadSources()` merges into the live graph; a file changed under the store (git pull) is detected and merged, never overwritten.
- [x] Sync (D3): `lib/history/sync.mjs`, `coding sync [status|pull|commit|--push] [--repo]`. Pull at launch (`pull_learning_repo`, background, then obs-api `POST /api/kb/reload`), local commit at session end (exit trap) and every 30 min (coordinator), push only via `coding sync --push` (asks; `--yes`). Merge driver `lib/kb/merge-driver.mjs` registered per checkout (`.gitattributes` + local config). Shared clones pull-only. `[P:n]` status-line hint from `<data home>/var/sync-state.json`.
- [x] `'coding'` defaults removed (`ObservationExporter` ×3 → `project || team || null`, `ObservationWriter` Redis publish → `metadata.project`); `export-graph-to-json.js`, `memory-fallback.js`, copilot adapter → `knowledgeExportDir()`.
- [ ] **T4b** — measurements + token usage tagged by project; per-repo export of summaries. Needs a `project` column in rapid-llm-proxy's `token_usage` (PR there) and every capture path (proxy tap, file adapters, sub-agent capture) to send it. Not started.
- Accept: `tests/history/sync.test.mjs` — users A/B with separate homes + data homes, one local bare remote, real km-core stores, real sync + merge driver: A's insight reaches B after B's pull; concurrent edits (B deletes + adds, A edits + adds the same file) merge through the driver and both converge. km-core `tests/unit/merge.test.ts` (9). `tests/kb/layout.test.mjs` (4).

### T6 — Team filter everywhere  `status: done`

- [x] One mapping: `lib/teams/scope.mjs` — `projectsOfTeams(teams)` = the project ids of every repo in those teams (discovered repos via `teamsOf`, `repos:` ids/paths, remote-only → repo name minus `-history`, a team with no repos/include → its own id); an id that is no team is a project id (the viewer's "views"); matching case-insensitive on `metadata.project` → `metadata.team`. `defaultTeamsFor(cwd)` = active selection, else the cwd repo's teams.
- [x] obs-api `?teams=a,b`, filtered before pagination: `/api/v1/entities` (km-core router gained a generic `entityFilter` option), `/api/coding/{observations,digests,insights}`, `/api/coding/lsl/sessions` — which now walks EVERY discovered repo's `.specstory/history` (was the tools repo's only), tags each session with its `project` and matches its entities within that project. `/api/teams` returns each team's resolved `projects`.
- [x] Viewer: a selected registry team admits its repos' projects (`teamSelected`/`expandTeamSelection` in `graph/team-of.ts`, used by both canvases' predicates, the rail's counts and HistorySidebar, which now honours `selectedTeams`); the LSL strip sends `?teams=` (server-side, before its 500 cap). The graph stays one fetch with client-side filtering — the predicates already hold the whole graph, and refetching per toggle would rebuild the force layout on every click.
- [x] Injection: `/api/retrieve` resolves teams from `teams` / `context.teams` (hooks send `CODING_TEAMS`) else `defaultTeamsFor(context.cwd)`; `retrieve()` passes a Qdrant `project` `match.any` filter on all four collections AND hard-filters every source afterwards (keyword search too); Working Memory scoped to the same projects. All three hooks send `cwd` (opencode and copilot did not / partly). `project` payload index on all four collections (`ensureCollections` now adds missing indexes to existing collections); `scripts/backfill-qdrant-project.mjs` re-stamped the 1957 `kg_entities` points, which all said `"coding"`; backfill reads every project's export (merged) and writes each entity's own project.
- [x] `working-memory.js`: reads the live km-core store (or obs-api `/api/v1/entities` over HTTP), not the retired `:8080` — the block had silently been empty.
- Accept: `tests/integration/retrieval-service.team-filter.test.js` — fixtures in two teams on all four collections + keyword + graph, Qdrant stub IGNORING the filter: zero cross-team items, WM scoped, filter requested on every collection; `tests/integration/obs-api.teams-filter.test.js`; `tests/teams/scope.test.mjs` (6); viewer `team-of.test.ts`. Live + gsd-browser: see session log.

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
- **2026-10-03 (T3)** — One per-repo learning repo, `lib/history/repo-link.mjs`. Decided:
  `.git/info/exclude` (not tracked `.gitignore`); ETM unchanged (writes through the
  relative symlink), `git add -f` guarded against the outer repo; clone = `reset --hard`
  (tracked wins, untracked local kept); only the skeleton is pushed. Verified: `npm test`
  green (node:test 1940 pass, jest pass); launcher smoke on a scratch repo; migration on
  copies of `balance` + `copi` (clean `.coding/`, registry = existing remote). NOT done:
  the developer machine's ~16 nested checkouts migrate on their next `coding` launch (each
  gets a local restructure commit, unpushed); running ETMs pick up the git-add guard only
  when restarted. Next: **T5**.
- **2026-10-03 (T5)** — Teams = sets of repos (`lib/teams/config.cjs`), one discovery
  (`lib/teams/discover.mjs`), shared clones (`lib/teams/shared.mjs`), coordinator `/teams`
  + dashboard Teams tab. Decided: YAML extends (not replaces) `config/teams/*.json`;
  shipped `config/teams.yaml` declares no memberships (the JSON says RaaS = "Research as a
  Service", so guessing `rapid-automations` would have been wrong); shared clones under
  `<data home>/var/shared/<X>/`. Verified: `npm test` green (node:test 1960 pass, jest
  pass); coordinator `/teams` live (24 repos); container recreated with the `lib/teams`
  mount, discovery maps 22 repos onto /workspace, LSL Sessions now lists 21 projects (incl.
  `_work/*`, which the old scan missed); Teams tab verified in gsd-browser incl. a write
  round-trip (test edits removed — no `~/.coding/teams.yaml` exists). Next: **T4**.
- **2026-10-03 (T6)** — Team filter everywhere (details in the T6 section). Decided: an
  id that is no team is a project id (the viewer's "views" keep working through the same
  `?teams=`); the graph stays one fetch filtered client-side, paginated panels go
  server-side; injection = Qdrant filter + hard post-filter; no teams and a cwd outside
  every team = no filter (unchanged behaviour). Verified: `npm test` green (node:test 1975
  pass, jest 1249 pass), viewer vitest 1095 pass, km-core router test; live: `/api/v1/
  entities?teams=coding` 2393 + `a2a-xpr` 254 = both 2647; LSL sessions now span 6 repos
  and narrow per team; `/api/retrieve` from a coding cwd → only coding items, a2a-xpr →
  only a2a-xpr, `/tmp` → unfiltered; WM back (245 tokens; was empty since :8080 died);
  Qdrant `project` index on all 4 collections, 1226 live kg_entities points re-stamped
  (731 stale points left untouched). gsd-browser on 127.0.0.1:5173: rail count Coding 2393
  (= server), deselecting it → canvas 117→77, HistorySidebar 1534→247 with no coding row,
  LSL strip refetched with `&teams=` (32 of 68); re-selected → restored. NOT done: the
  dry-run backfill shows 2186 kg_entities + 861 insights never embedded — a real
  `node dist/embedding/backfill.js` would add them (with project payloads); not run
  (minutes of CPU, unrequested). Next: **T4b or T2**.

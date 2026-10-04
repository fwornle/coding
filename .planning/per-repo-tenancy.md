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
- Follow-up (T4): nothing is pushed beyond the skeleton — restructure commits and migrated transcripts wait for T4's confirmed push. `docs/puml/lsl-repo-split.puml` showed the nested layout — replaced by `learned-data-layout.puml` (2026-10-04).

### T5 — Teams and discovery  `status: done`

- [x] **`config/teams.yaml`** (shipped, no memberships) + **`~/.coding/teams.yaml`** (user, wins per team/field) EXTEND `config/teams/*.json` (ontology stays there — semantic-analysis reads it directly). Per team: `label`, `kind`, `description`, `repos:` (paths / history remotes / `{path, remote, id}`), `include` globs. No `repos`/`include` = the same-named repo (old basename meaning). **Decided:** remote-only repos clone under `<data home>/var/shared/<X>/` (`lib/teams/shared.mjs`, clone-only).
- [x] Active selection: `active:` in the user (or shipped) layer; `CODING_TEAMS` overrides. Empty = all.
- [x] `lib/teams/discover.mjs`: roots (default `$HOME`), depth 4, ignore list, markers `.coding/` + `.specstory/history` on a git repo; cached in `<data home>/var/projects.json` (TTL 10 min). Replaced the coordinator ETM-candidate walk, dashboard `lsl-sessions.mjs` and `server.js getKnownProjectPaths` — the container reads the host cache via the data-home mount, mapping `$HOME/Agentic` → `/workspace` (new `lib/teams` + `lib/features/vendor` bind mounts).
- [x] `lib/teams/registry.mjs` returns `repos[]`, `include`, `active`; `teamsOf()` / `projectIdFor()` / `isActiveRepo()` in `config.cjs`. ETM observation `project` and `repo-router.teamForPath` stamp via `projectIdFor` (consolidator inherits it).
- [x] Coordinator `GET/PUT /teams`, `POST /teams/discover`, `POST /teams/sync`; dashboard proxy `/api/teams-config`; **Teams** tab (repo×team matrix, active chips, add/delete own teams, shared-repo clone).
- Accept: `tests/teams/config.test.mjs` + `discover.test.mjs` (layering, env, mapping, writer, fixture-tree scan, cache, container translation, fallback, shared clone from a bare remote); Teams tab verified with gsd-browser (render, active toggle + assignment written to `~/.coding/teams.yaml`, reverted).

### T4 — Persisting and sharing knowledge  `status: done` (incl. T4b)

- [x] Exports split by **project**: km-core gets an `ExportLayout` seam (`src/store/layout.ts`; default = the old per-domain dir). coding's `lib/kb/layout.mjs`: bucket = `metadata.project` → legacy `metadata.team` → `general`; file = `<repo>/.coding/kb/knowledge-graph/<project>.json` when the repo has a `.coding/` the outer repo IGNORES (linked or skipped — a never-relaunched repo would otherwise get untracked files), else `<data home>/kb/knowledge-graph/exports/projects/<project>.json`. Shared clones are read, never written. Modes: `owner` (obs-api, the only writer into repos) / `local` (container stores: read everything, write `exports/general.json` — `/workspace` is read-only). ObservationExporter also writes a per-project slice to `<repo>/.coding/kb/observation-export/`; the combined cold-store files stay.
- [x] Hydrate = **union merge** (`src/store/merge.ts`) of LevelDB + every layout source: entities by id, newest `updatedAt` wins (ties → LevelDB/live); relations by `(from,type,to)` (graphology edge keys collide across machines); **tombstones** in `attributes.kmTombstones` (90 days); relations to entities absent on this machine kept aside and written back to their file. Count-based rule removed. Canonical (sorted) files, unchanged files not rewritten. `GraphKMStore.reloadSources()` merges into the live graph; a file changed under the store (git pull) is detected and merged, never overwritten.
- [x] Sync (D3): `lib/history/sync.mjs`, `coding sync [status|pull|commit|--push] [--repo]`. Pull at launch (`pull_learning_repo`, background, then obs-api `POST /api/kb/reload`), local commit at session end (exit trap) and every 30 min (coordinator), push only via `coding sync --push` (asks; `--yes`). Merge driver `lib/kb/merge-driver.mjs` registered per checkout (`.gitattributes` + local config). Shared clones pull-only. `[P:n]` status-line hint from `<data home>/var/sync-state.json`.
- [x] `'coding'` defaults removed (`ObservationExporter` ×3 → `project || team || null`, `ObservationWriter` Redis publish → `metadata.project`); `export-graph-to-json.js`, `memory-fallback.js`, copilot adapter → `knowledgeExportDir()`.
- [x] **T4b** — token usage + measurements by project. rapid-llm-proxy `token_usage.project` (branch `feat/token-project`, off `feat/installable`): `x-project` header (`/v1/messages`, OpenAI shim), `/p/<id>` path segment (copilot, which cannot send headers), `body.project` (`/api/complete`); `sanitizeProject` = one path-safe id or ''. Launcher `_resolve_project_id` (repo-router `teamForPath` of the target dir, '' outside a repo; `CODING_PROJECT_ID` wins) → claude `ANTHROPIC_CUSTOM_HEADERS`, opencode provider headers, pi models.json `$CODING_PROJECT_ID`, copilot URL. Experiment cells: `buildAgentRoutingEnv` same seams, project = the REAL repo (not the temp worktree). Adapters: `token-db` probes the column; builders read the session's own cwd (claude line `cwd`, copilot `session.start` `gitRoot`, opencode `path.root`) via `lib/lsl/token/project-of.mjs`. ObservationWriter sends `metadata.project`. Runs: `aggregateByTaskId().project` = dominant by tokens → `Run.metadata.project` (measurement-stop, auto-measure). Per-repo export `lib/usage/project-usage.mjs`: obs-api hourly → `<repo>/.coding/kb/usage/<user_hash>.json` (linked/local repos; else `<data home>/kb/usage/<project>/`; shared clones never), this machine's rows only, daily + per-task, unchanged not rewritten. Historic rows stay '' (not backfilled).
- Accept: `tests/history/sync.test.mjs` — users A/B with separate homes + data homes, one local bare remote, real km-core stores, real sync + merge driver: A's insight reaches B after B's pull; concurrent edits (B deletes + adds, A edits + adds the same file) merge through the driver and both converge. km-core `tests/unit/merge.test.ts` (9). `tests/kb/layout.test.mjs` (4).

### T6 — Team filter everywhere  `status: done`

- [x] One mapping: `lib/teams/scope.mjs` — `projectsOfTeams(teams)` = the project ids of every repo in those teams (discovered repos via `teamsOf`, `repos:` ids/paths, remote-only → repo name minus `-history`, a team with no repos/include → its own id); an id that is no team is a project id (the viewer's "views"); matching case-insensitive on `metadata.project` → `metadata.team`. `defaultTeamsFor(cwd)` = active selection, else the cwd repo's teams.
- [x] obs-api `?teams=a,b`, filtered before pagination: `/api/v1/entities` (km-core router gained a generic `entityFilter` option), `/api/coding/{observations,digests,insights}`, `/api/coding/lsl/sessions` — which now walks EVERY discovered repo's `.specstory/history` (was the tools repo's only), tags each session with its `project` and matches its entities within that project. `/api/teams` returns each team's resolved `projects`.
- [x] Viewer: a selected registry team admits its repos' projects (`teamSelected`/`expandTeamSelection` in `graph/team-of.ts`, used by both canvases' predicates, the rail's counts and HistorySidebar, which now honours `selectedTeams`); the LSL strip sends `?teams=` (server-side, before its 500 cap). The graph stays one fetch with client-side filtering — the predicates already hold the whole graph, and refetching per toggle would rebuild the force layout on every click.
- [x] Injection: `/api/retrieve` resolves teams from `teams` / `context.teams` (hooks send `CODING_TEAMS`) else `defaultTeamsFor(context.cwd)`; `retrieve()` passes a Qdrant `project` `match.any` filter on all four collections AND hard-filters every source afterwards (keyword search too); Working Memory scoped to the same projects. All three hooks send `cwd` (opencode and copilot did not / partly). `project` payload index on all four collections (`ensureCollections` now adds missing indexes to existing collections); `scripts/backfill-qdrant-project.mjs` re-stamped the 1957 `kg_entities` points, which all said `"coding"`; backfill reads every project's export (merged) and writes each entity's own project.
- [x] `working-memory.js`: reads the live km-core store (or obs-api `/api/v1/entities` over HTTP), not the retired `:8080` — the block had silently been empty.
- Accept: `tests/integration/retrieval-service.team-filter.test.js` — fixtures in two teams on all four collections + keyword + graph, Qdrant stub IGNORING the filter: zero cross-team items, WM scoped, filter requested on every collection; `tests/integration/obs-api.teams-filter.test.js`; `tests/teams/scope.test.mjs` (6); viewer `team-of.test.ts`. Live + gsd-browser: see session log.

### T2 — Linux + WSL  `status: done`

- [x] systemd **user** units for every `DAEMONS` entry: `systemd/<id>.service` (+ `<id>.timer` for the four interval sweepers), tokens `__CODING_REPO__` + `__NODE_DIR__` (a user manager inherits no PATH; node is often under `$HOME`), rendered by `scripts/lib/systemd-unit.sh`, installed by `scripts/install-systemd-daemons.sh` (idempotent, one daemon-reload, enable + restart, poll `is-active`, linger hint). `install_feature_daemons` dispatches macOS→launchd / linux|wsl→systemd. The proxy unit is rendered from `systemd/llm-cli-proxy.service` too (was a heredoc) and gates on `/health` like the LaunchAgent path. `tests/features/systemd-units.test.mjs` keeps each unit field-equal to its plist (mutation-checked). `uninstall.sh` removes every templated unit (timer before service).
- [x] `lib/features/daemons.mjs`: Linux backend drives the `.timer` of an interval job (start/stop/list); new `restart()` (try-restart / kickstart -k) + `restartHint()`; the coordinator's proxy restart goes through it instead of a hard-coded `launchctl kickstart`.
- [x] **Decided — WSL without systemd:** no fallback supervisor. The installer installs no daemons, prints the `/etc/wsl.conf` fix and records a warning (exit 3 from the systemd installer). Same path for a Linux login with no user manager (`loginctl enable-linger`). Reason: a launcher-run supervisor is a third service manager; systemd is the default for WSL distros since late 2022.
- [x] `auto-measure-foreground` **dropped** from `DAEMONS` (nothing ever ran it as a daemon; still runnable by hand).
- [x] `lsof` out of the proxy step (`port_listening`, bash `/dev/tcp`) and out of the launcher/port checks (`scripts/lib/port-pids.sh`: lsof → ss → fuser); the launcher's "proxy unreachable" fix hint is per-platform.
- [x] `install.bat` + `INSTALL_WINDOWS.md` removed; `bin/coding.bat` prints the WSL steps and exits 1. `docs/getting-started.md` Windows = WSL section; `docs/architecture/features.md` host-daemon section rewritten.
- [x] CI `real-install` gets a lingering user manager and asserts the harness tier's coordinator + prompt judge are systemd units, active, 0 restarts, `:3034/health`.
- [x] Two daemon bugs the developer machine hid, found by the clean room: `sub-agent-live-claude` exited 0 when the repo had no `~/.claude/projects/<repo>` yet (only an unref'd retry timer; now pins the loop like copilot), `sub-agent-live-opencode` exited 1 without opencode's db (a KeepAlive crash loop; now waits for it).
- [x] Accept: `tests/cleanroom/services.sh` — systemd-as-PID-1 container, real `./install.sh --ci --yes` per tier (harness → learning → learning-perf → everything), each tier's daemons installed + active + 0 restarts, none of another tier's, coordinator/obs-api/proxy `/health`, status line renders; uninstall leaves no unit.

### T7 — Migrate the developer machine  `status: done`

- [x] `coding` itself is a normal linked repo: `coding-history` is `<coding>/.coding/` (history/ + kb/), `.specstory/history → ../.coding/history`, registry entry in `~/.coding/repos.yaml`. repo-link has no tools-repo exception; `runtime/` + `claude-plugin/` (the per-launch runtime sharing `.coding/`) are META + ignored, and ignored BEFORE the restructure's `add -A` (fixes `session-state.json` being committed for any repo). `bin/init-history.sh` = thin caller (`ensure --no-ask [--remote $CODING_HISTORY_REPO]`) + the insights link; NOT run on `bin/coding --dry-run` (it moves data; profile-matrix dry-runs the real checkout — that is how the first, unplanned migration happened). install.sh `history_home` = `<coding>/.coding`, `setup_history_repo` delegates to init-history; `history_repo_seed`/`CODING_HISTORY_PUSH`/`clone --nest` removed. kb layout + project usage: no tools-repo skip; coding's export moved to `.coding/kb/knowledge-graph/coding.json`.
- [x] D5: the `.data/` KB had already left (744 KB shipped files remain). The 2,353 `knowledge-management/insights/` files: `git rm --cached`, `/knowledge-management/insights` ignored, the dir is a symlink → `../.coding/kb/insights` (moved, all 2,353 byte-identical to the committed blobs). semantic-analysis 18929f3: PlantUML sources → `<insights>/puml` (were `<repo>/.data/knowledge-graph/insights/puml`). OKB guard blocks the path (deletions allowed) + test; image no longer bakes insights; compose mounts `.coding/history` + `.coding/kb`. Memory `feedback_commit_ukb_run_artifacts` updated.
- [x] Developer paths: `.activate`, `.claude/settings.local.json` untracked (install.sh generates both; already ignored); `migrate-history-to-private.sh` → `repo-link default-remote`.
- [x] D4: `.gitmodules` HTTPS (all 5 verified anonymously reachable); `git submodule sync`; dev keeps SSH pushes via per-submodule `remote.origin.pushurl`.
- [x] Services stopped during the move (coordinator, obs-api, ETMs, two sweepers); container recreated with the new mounts. Backup of the old `coding.json`: `<data home>/var/backups/t7-*`.
- Accept: production UKB (`wave-analysis --team coding`, 18:09–18:54) — tools repo `git status` unchanged, 193 docs into `.coding/kb/insights`; its 95 .puml went to `.data/` → fixed (above) and moved. `/sl` discovery + reads through the symlink. Clean room 19/0 incl. new T7 assertions.

### T8 — Whole-system test campaign  `status: in progress`

- [x] Clean-room **real install per tier** — `tests/cleanroom/services.sh` (T2 harness extended): per tier, as `--scope=team-a`, beside a planted sentinel `coding` tenant: daemons active/absent, `/health`s, status-line badges present for health and ABSENT for every off feature, coordinator `/features` = a literal tier oracle, and (harness, the only Docker-free tier) the host dashboard's own origin serving `/api/features` = the tier (what the nav drops tabs from). Sentinel byte-identical after all four tiers; uninstall leaves no unit. Run: 89/90 → the harness dashboard failure, three causes fixed (2c8357a1) → harness re-run 26/26. Tabs in a real DOM are checked on the live machine (gsd-browser, below) — no browser in the clean room.
- [ ] Real macOS install in a fresh macOS user account; WSL install on a Windows machine. **Needs the user** (a new macOS account is a machine-wide change; no Windows machine here). **The only open T8 item.** Steps, per machine: `git clone https://github.com/fwornle/coding.git && cd coding && ./install.sh` → the tier menu appears (default `harness`); pick `learning`. Accept: (1) `coding-features status` = the tier; (2) `curl -s localhost:3034/health` ok, dashboard on :3032 shows only the tier's tabs + Teams + Features; (3) `cd <some repo> && coding` asks for the learning repo (Enter = `bmw.ghe.com/<user>/<repo>-history`), creates it private, `<repo>/.coding/` + `.specstory/history → ../.coding/history`; (4) after one prompt: a transcript in `.coding/history/`, `coding sync status` = `N to push`; (5) `coding sync --push` pushes; (6) a second user cloning that same remote (`coding` in their checkout of the repo, paste the URL) sees the first user's insight in the viewer after `coding sync pull`. WSL extra: `systemctl --user is-active coding-health-coordinator` (systemd must be on in `/etc/wsl.conf`, else the installer prints the fix).
- [x] Two-user sharing scenario end to end with agents — **simulated** (no second account). Users B and A2 (own HOME, data home, tools clone, obs-api :12446/:12456; B with its own throwaway Qdrant :16333) share coding-history through a local bare mirror of the real one; the real checkout, remote, store and Qdrant were verified untouched. Works: clone via `repo-link ensure`, hydrate (2698 nodes), concurrent learn + edit, `sync commit/push/pull` through the merge driver, `/api/kb/reload` → both stores 2485 with both insights and A2's edit. Found + fixed: (1) a fresh clone's obs-api shrank the shared `kb/observation-export/` slice to its own store (6910 obs → 180) — slice now union-merged (ef6dc5ce); (2) Working Memory read STATE.md from the tools repo for every session (b747473b). (3) knowledge that arrives by git was never embedded (embeddings only on local writes; keyword search dead) — B's agent answered UNKNOWN. **Decided: option 1** — obs-api runs the idempotent backfill after startup and after a changing `/api/kb/reload` (`lib/kb/embed-index.mjs`, eb9ca884); (4) `sync pull` reloaded whatever listened on 12436 — now the obs-api recorded in the same data home (`var/obs-api.json`). Re-run from an EMPTY Qdrant: B's startup pass 3857 points/147s; A2 pushes a new insight → B `sync pull` (no port env) reloads B's obs-api (+1; the real one's reload count unchanged) → pass embeds 1 (3857 skipped, 3s) → B's agent answers from it. Keyword search cut over to the km-core store (5b580a3b): B with Qdrant on a dead port → the pulled insight injected, agent answered (was 0 / UNKNOWN); real graph 25–75 ms/query, keyword + vector hits fuse (no duplicate ids). Tombstoned entities' Qdrant points: every backfill pass (the one obs-api schedules after startup / a changing reload) deletes the `kg_entities` points of entities the merged graph tombstoned — exact ids (`src/embedding/tombstones.ts`), not `--prune`, so a point the listener made ahead of the next export survives; a re-created key keeps its point. Live: 39 stale points removed, second pass 0.
- [x] Functional (live, profile `full` = everything + redirect): UKB production (T7 run, 18:09–18:54, git status clean) + `--debug` (single-step off via `/api/ukb/single-step-mode`, 3 waves/17s, zero UKB rows in token_usage, nothing persisted); online learning observation 17:50 → digest 17:50 → insight 17:51; viewer team filter (rail Coding 2483 = server `?teams=coding` 2483, deselect → canvas 127→77, restored); injection (coding cwd → only coding, explicit a2a-xpr → only a2a-xpr, /tmp unfiltered); health page Healthy / 0 Disabled chips; status line all badges; token accounting — FOUND UKB + consolidator rows carried no project (fixed: semantic-analysis eebe90f AsyncLocalStorage run context + obs-api wrap; consolidator digest/insight pass it; a real call through the client recorded `coding`); Performance + Token Usage pages render data; constraints (violation caught, clean 30/30, status operational).
- [x] UI via gsd-browser: nav = 8 feature tabs + Teams + Features; `performance` off → Performance tab gone from the DOM, restored. (Note: `coding-features set` APPLIES — it stopped two daemons; re-applied.)
- [x] **Every repo on the developer machine converted** (2026-10-04). The 17 repos with a pre-T3 nested `.specstory/history` checkout had never been relaunched since T3 (their sessions predated it), so none had migrated: ran the launch step (`repo-link ensure --no-ask`) on each — APFS-clone backup first (`<data home>/var/backups/t8-migrate-20261004-1145`), every backed-up file found in the new layout, every `.coding/` clean, outer repos untouched; live ETMs (a2a-xpr, rec) kept writing through the symlink. 5 of them pointed at remotes that never existed (the old flow only printed a `gh repo create` recipe) → created private on bmw.ghe.com. `coding sync commit` + `--push` for all 18. Found + fixed: a push longer than sync's 60 s network timeout (coding-history: 25 commits incl. ~70 MB transcripts) was killed and reported as a bare `exit 127` — push gets 10 min, a killed child now reports `timed out after Ns`. 6 discovered repos with only a few plain LSL files and no learning repo are left to the launch prompt (user's decision). `sketcher` points at `cc-github.bmwgroup.net`, which no longer resolves — not pushed.
- [x] Injection outside any team: **decided — default to the repo's own project** (b747473b); only a cwd in no repo stays unfiltered. Live: a2a-xpr → only a2a-xpr, no coding Working Memory.

---

### T9 — Retire `.specstory/history`  `status: in progress`

The symlink `<repo>/.specstory/history → ../.coding/history` exists only because code still
addresses the old path. Goal: nothing addresses it; new repos get no `.specstory/` at all.

- [ ] One resolver: `historyDir(repo)` (+ `.cjs`/bash twins) → `<repo>/.coding/history`, the
      single place that knows the layout.
- [ ] Cut every caller over (93 code files / 337 refs in coding; 14 files in semantic-analysis,
      km-core, constraint-monitor, memory-visualizer) — writers first (ETM, sub-agent writers,
      exporters), then readers (obs-api LSL routes, dashboard, `/sl`, tools).
- [ ] `ensure_coding_runtime_ignored` must stop appending `.specstory/history/` to a TRACKED
      `.gitignore` (it did on 2026-10-04 when `coding` launched in coding itself).
- [ ] Discovery keeps ACCEPTING the old marker (repos not relaunched yet), but stops requiring it.
- [ ] `/sl` + its user-level allow rules move to `.coding/history`.
- [ ] Then: `ensureLayout` stops creating the symlink; an existing one is left (harmless) or
      removed on launch once nothing reads it.
- Accept: `git grep '\.specstory/history'` = docs/migration code only; a fresh repo launched
  with `learning` has no `.specstory/`; tests green; live session logs still land.

## Open questions (decide inside the phase)

- ~~Legacy `CODING_TEAM`~~ — done 2026-10-04 (d6f88527).
- **No launcher for the knowledge viewer** (found 2026-10-04): `bin/vkb` went with vkb-server (2fb090da, 2026-09-08); the unified viewer is only reachable via `npm --prefix integrations/unified-viewer run dev` (:5173), and nothing starts it. The `learning` tier promises a viewer. Proposal: a `vkb` command (start-if-needed + open) and/or a `viewer` daemon under the `knowledge` feature.
- **Stale `bin/status`**: still points at :3001 / `bin/dashboard` (both gone).

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
- **2026-10-03 (T2)** — Linux + WSL. systemd user units for every daemon (`systemd/`,
  timers for the sweepers), `install-systemd-daemons.sh`, timer-aware `daemons.mjs` +
  `restart()`, uninstall, lsof-free port checks, `install.bat`/`INSTALL_WINDOWS.md`
  removed, `auto-measure-foreground` dropped from DAEMONS. Decided: WSL without systemd =
  no daemons + the wsl.conf fix + a warning (no fallback supervisor). Verified:
  `tests/cleanroom/services.sh` (systemd PID 1, no lsof, proxy from a bundle) — real
  install harness → learning → learning-perf → everything, 73/73 PASS: each tier's
  daemons active + enabled + 0 restarts, none of another tier's, timers' first runs
  succeed, :3034/:12436/:12435 `/health`, status line renders, uninstall leaves no unit.
  It found and fixed the two sub-agent daemon exits above. NOT verified: the new CI
  `real-install` systemd step (runs on GitHub only); a real WSL machine (T8). Next: **T4b
  or T7**.
- **2026-10-03 (T4b)** — token usage + measurements by project (details in T4). Decided:
  the proxy stores a project ID, never a path; one usage file per USER per repo
  (`kb/usage/<user_hash>.json`) so teammates never conflict; Runs derive the project
  from their own token rows (no span plumbing); historic rows not backfilled.
  Verified: proxy integration 83/0 + new `token-usage-project.test.mjs`; coding
  `tests/token-adapters/project-tagging.test.js` 14/14; live after a proxy restart —
  the column + partial index migrated in the real DB, one real call per wire recorded
  its project (`/v1/messages` x-project, copilot `/p/`, `/api/complete` body), a real
  `claude -p` with the launcher's two-line `ANTHROPIC_CUSTOM_HEADERS` sent x-project;
  launcher resolves coding→`coding`, a subdir→`coding`, /tmp→''; the export wrote one
  file per project from the live DB (probe rows then cleared). NOT done: proxy branch
  not pushed/PR'd (it sits on the local-only `feat/installable`); the first live hourly
  export with real project rows needs sessions launched after this change.
- **2026-10-03 (T7)** — coding 2cb5a272 + a382c42e, merge 0effacf7 (pushed); semantic-analysis
  18929f3 (pushed). Incident: the test suite's profile-matrix (`bin/coding --dry-run`, sandboxed
  CODING_HOME) ran the new init-history against the REAL checkout and migrated it mid-suite — correct
  result, registry written to the sandbox, ETM + proxy export recreated a plain `.specstory/history`
  afterwards; reconciled by hand (3 colliding classification logs parked in the T7 backup dir), guarded
  + tested. Verified: `npm test` green (node:test 1994/0, jest 1263) + touched suites 358/0 after the
  last change; live: obs-api serves 1395 insight docs + images, 2410 coding entities hydrated from
  `.coding/kb`, coding ETM writes this session into `.coding/history`, container sees both links
  (writable). NOT done: coding-history is 6 commits ahead, NOT pushed (D3: `coding sync --push`);
  495 older .puml in `<data home>/kb/knowledge-graph/insights/puml` left in place (versioned nowhere);
  docker image not rebuilt (bind mounts make it moot until the next build). Next: **T8**.
- **2026-10-03 (T8, part 1)** — 2c8357a1 + semantic-analysis eebe90f. Found + fixed: host-mode
  dashboard broken on a fresh harness install (vite [::1] vs health check 127.0.0.1; no /api proxy in
  vite; api-server → host.docker.internal), stale Health Verifier service (dead since May), UKB +
  consolidator tokens without project. Verified: clean room 89/90 → harness 26/26 after the fixes;
  `npm test` green (node:test 1996/0, jest 1263); live functional + gsd-browser checks above. Open:
  item 2 (needs the user), item 3 (approach to decide), the no-team injection default (question).
- **2026-10-04 (T8, part 2)** — km-core keyword search (5b580a3b); injection by repo membership + the viewer
  shows the team selection (d5cdfc9b); viewer follows the selection live, two-way with the dashboard,
  redraws only on a change (fcf89ef2, 1e4f1940, 7816fb48); parent-edge invariant guarded + UKB fixed at
  the source (6353aa71, d46359a6). Then: Qdrant points of tombstoned entities pruned; all 17 legacy repos
  migrated, 5 missing remotes created, 18 learning repos pushed; sync push timeout + error text. Verified:
  `npm test` green (node:test 2015/0, jest 1268); history 23/0; live backfill 39 → 0. Open: real macOS +
  WSL installs (user); `sketcher-history` remote unreachable (`cc-github.bmwgroup.net`; push times out); four ~70 MB
  April transcripts (rapid-automations redirect) in coding-history trip GitHub's 50 MB warning.
- **2026-10-04 (docs)** — sketcher-history moved to bmw.ghe.com (pushed). Docs: new
  `architecture/tenancy.md` (+ deep partial) and `guides/teams.md`; installation page with the
  real installer prompts (captured from `./install.sh` under a throwaway HOME, stopped before any
  step) and the first-launch prompt; dashboard Teams/Features + viewer Teams-rail screenshots.
  Diagrams: `installation-flow` (rewritten — was the 2025 flow), `learning-repo-setup`,
  `learned-data-layout` (replaces `lsl-repo-split`), `learning-data-sharing`,
  `team-filter-scoping`. Found + fixed: the first-launch learning-repo prompt was not gated —
  a harness user (no lsl) was asked for an `X-history` in every repo; now only when `lsl` is on
  (unset CODING_FEATURES keeps the old behaviour). Features tab `lsl` description no longer says
  `.specstory markdown`. `mkdocs build --strict` clean; pages checked in gsd-browser.
- **2026-10-04 (CI, CODING_TEAM, Getting Started)** — CI red since 2026-09-30 → green
  (3129a6d3): submodule-reading tests skip an absent submodule; `lib/teams/config.cjs` lint +
  `expandHome` honoured a sandboxed home. CODING_TEAM retired (d6f88527). Getting Started chapter
  rewritten (overview, installation, verify & repair, configuration ports): no `coding --health`
  / `vkb` / :8080 (none exist); fresh startup + health screenshots replace the Feb-2026 ones.
  **Incident:** running `scripts/test-coding.sh --check-only` to verify a doc claim ran a FULL
  unattended `./install.sh` (it called `install.sh --update-mcp-config`, a flag that does not
  exist, on a check that could never pass) — rebuilt natives + proxy + memory-visualizer, started
  a docker build (killed by timeout, containers untouched), and — forced to wrapper scope —
  removed the developer's global agent setup (8 `~/.claude/commands`, 3 hooks, 2 opencode
  plugins). Restored (scope global, commands, hooks, plugins). Fixed: (1) test-coding.sh — every
  repair goes through `may_repair`/`try_repair`, check-only verified to change nothing; (2)
  install.sh — unknown options exit 2 instead of being ignored; (3) an unattended re-run keeps a
  recorded `global` scope; (4) the root TypeScript build ran before the km-core link (TS2307 →
  a fresh install shipped no `dist/`), now after it. Next: **T9**.

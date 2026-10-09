# glass — proposal

Token measurement + context-window insight for coding agents (GitHub Copilot CLI,
OpenCode, pi, Claude Code) as a compact standalone product, derived from `coding`
by a transformation script. Repo: **https://bmw.ghe.com/AIMAAD/glass** (private; created
2026-10-08 as `Frank-Woernle/glass`, transferred to the AIMAAD org the same day for its
GitHub-hosted runners). `main` is empty — generated content only.

Living plan. Update the phase status and the Session log at the end of every session.

Status: **G4 published** — glass `main` = PR #4 → bbafb6f (from coding@45070e2 + proxy@7440525; 70 files incl. the built UI); CI green on ubuntu + windows × Node 22.13.0 / 22.x, 3 Wiz checks pass. Next: G5 (packaging + platform CI); pi row still waits on a pi login. **G3 published** — glass `main` = PR #2 → 63d224a (from coding@0154fa8 + proxy@7440525, proxy PR #43); CI green on ubuntu + windows (Node 22.13 / 22.x). Real runs on macOS measured for claude, copilot, opencode; pi proven through interception — its token row still waits on a pi login. Next: pi row, then G4 (UI + status line). G1 done and merged (coding `main` cae5aad4, proxy PR #42 → 34c78e5). G0 done (IT-security sign-off for local TLS interception still pending).

## Decisions (2026-10-08 — do not re-litigate)

1. Repo: `AIMAAD/glass` on bmw.ghe.com (was personal; moved for CI runners).
   AIMAAD's org ruleset 1164412 applies to **every branch**: changes only through a pull
   request, and three required checks (Wiz IaC / Secret / Vulnerability Scanner). Creating a
   branch is exempt from the checks; updating one is not. So the extractor's publish step
   (G2) pushes a fresh branch and opens a PR into `main` — never a direct push.
2. Glass-only files live in coding (`glass/overlay/`); the glass repo is generated.
3. Distribution: npm tarball attached to a GHE release.
4. v1 UI: Token Usage + context explainer; Cost later.
5. Keep the tmux status line with its clickable fields where they still make sense
   (see "Status line" below).
6. **The proxy is the primary measurement path** (everything routed through it, full
   control); agent telemetry is secondary (cross-check + fallback for bypassing traffic).
7. **Env names stay as they are** in the extracted code (`CODING_*`, `LLM_PROXY_*`); the G3
   `glass` wrapper sets them (`CODING_DATA_HOME=~/.glass`, `LLM_PROXY_DATA_DIR`, port 12445,
   `CODING_SQLITE_BACKEND=node`). Rewrite rules cover only defaults env cannot reach — the
   generated files stay near byte-identical to coding, so drift is visible. (Supersedes the
   `CODING_*`→`GLASS_*` rewrite in "The transformation script" below.)
8. **Forbidden deps**: never in `package.json`; an import site only when the manifest lists
   it as a guarded optional fallback with a reason (today: better-sqlite3 in `db-open.cjs`
   and `proxy-paths.cjs`, never taken with `CODING_SQLITE_BACKEND=node`).

9. **Capture (G3)**: claude via `ANTHROPIC_BASE_URL` into the shared Anthropic forward (no
   interception); copilot / opencode / pi via `HTTPS_PROXY` into the same port, which decrypts
   only model hosts with a persistent glass CA (option A). `--no-intercept` per run while the
   IT-security sign-off is open. Every agent keeps its own login, catalogue and routing.
10. **Daemon unreachable (G3)**: one warning line, the agent runs unmeasured — glass never
   blocks the user's agent.
---

## What was asked (condensed)

- A wrapper around Copilot and OpenCode (pi + claude offered too) that measures tokens
  and explains what fills the context window.
- macOS, Linux, WSL **and native Windows**; no Docker required (Windows users mostly
  have none) — a native install is the main path.
- Maximally compact; install and uninstall robust on every platform.
- Generated from `coding` by a transformation script, not a hand-maintained fork.

## What coding already has (survey 2026-10-08)

The measuring core is **rapid-llm-proxy** (sibling clone, `_work/rapid-llm-proxy`):
`proxy-bridge/server.mjs` taps usage on both wires (`/v1/messages`, the OpenAI shim
`/v1/<agent>/t/<task>/chat/completions`), binds a task id (header → body → path →
ambient span), writes `token_usage` (SQLite) and per-turn context capture
(`context-turns.mjs`, `turn-identity.mjs`), and serves `/api/token-usage/*`,
`/api/context-breakdown`, `/api/context-turns`.

Around it in coding:

| Piece | Where | Glass needs it |
|---|---|---|
| Agent → proxy wiring | `configure_proxy_routing()` in `scripts/launch-agent-common.sh` + `config/agents/*.sh` (bash, ~1.9k lines) | yes — port to Node |
| File adapters (traffic that bypasses the proxy) | `lib/lsl/token/{claude,opencode,copilot}-token-rows.mjs`, `token-db.mjs`, `reconcile.mjs` | yes |
| Task binding for interactive sessions | `scripts/measurement-reconciler.mjs` + `lib/measurement/foreground-sessions.mjs` (without it: no context capture) | yes |
| Capture retention | `context-turns-sweeper-job.sh` | yes (as an in-process timer) |
| Context gauge | `lib/statusline/context-gauge.cjs` + `model-limits.cjs` | yes |
| UI | dashboard Token Usage + Cost + context explainer (`context-cache-explainer.tsx`, `turn-modal.tsx`, `turn-grouping.ts`) | yes — reduced entry |
| Data home | `lib/paths/data-home.cjs`, `lib/scope/resolve.cjs` | reduced (`~/.glass`) |
| Routing tiers, prompt-classifier, providers, worker pool | proxy `routing-config`, `worker-pool`, classifier | **no** |
| Experiments, km-core/LevelDB, obs-api, LSL, knowledge, Docker container | — | **no** |

Glass-relevant code is roughly **15–20k lines** of coding's total — a real subset.

### What blocks native Windows today

1. **Everything that starts things is bash**: `install.sh` (5.4k), `uninstall.sh`,
   `bin/coding`, the launch chain, `start-llm-proxy.sh` (uses `lsof`, `python3`).
   `bin/coding.bat` only prints WSL steps.
2. **better-sqlite3** (native module) in the proxy, `token-db`, the opencode reader,
   the gauge — a compile/prebuild problem on Windows without build tools.
3. **Service managers**: launchd/systemd units (a schtasks backend exists in
   `lib/features/daemons.mjs` but nothing installs through it except one sweeper).
4. **The UI is served from the Docker container** (`server.js` :3033 → `host.docker.internal:12435`).
5. Small POSIX assumptions: `/` in path regexes (`SUBAGENT_PATH_RE`), `$TMPDIR`,
   `execSync curl`, tmux in the gauge.

---

## Proposed design

### Principles

- **Node is the only runtime.** No bash, no python, no tmux at runtime or install.
  One CLI, `glass`, identical on all four platforms (npm generates the Windows `.cmd` shim).
- **No native modules.** Use the built-in `node:sqlite` instead of better-sqlite3
  (G0: flag-free from **Node 22.13**; 22.12 fails → floor is `>=22.13`).
  This also makes a single-executable build (Node SEA) possible later — no Node prerequisite.
- **No service manager, no global config edits.** Nothing is registered with
  launchd/systemd/schtasks, no shell rc block, no `~/.claude/settings.json` merge.
  That is what makes uninstall trivially complete: delete the package + `~/.glass`.
- **One process, one port.** `glass daemon` = proxy tap + SQLite writer + file adapters
  + span reconciler + retention timer + API + static UI, on one port
  (default **12445**, so it coexists with a coding install on 12435).

### Runtime shape

```
glass copilot [args]   ─┐   ensure daemon (spawn detached if no healthy pid/port),
glass opencode [args]   ├─► open a measurement span (task id), exec the agent with
glass pi [args]         │   SESSION-SCOPED wiring, close the span on exit
glass claude [args]    ─┘
glass ui               → opens http://127.0.0.1:12445  (Token Usage, Cost, Context)
glass status | doctor  → daemon health, per-agent wiring check, DB path, last rows
glass stop             → stop the daemon (it also exits by itself after N min idle)
glass uninstall        → stop daemon, remove ~/.glass (asks before deleting data)
```

Session-scoped wiring per agent (all env or temp-file based — the user's own config is
never edited):

| Agent | Wiring | Fallback capture |
|---|---|---|
| claude | `ANTHROPIC_BASE_URL` + `ANTHROPIC_CUSTOM_HEADERS: x-task-id`; status line via `--settings <temp file>` | transcript + `subagents/agent-*.jsonl` |
| copilot | `COPILOT_PROVIDER_BASE_URL=…/v1/copilot/t/<task>` | `~/.copilot/session-state/*/events.jsonl` (session aggregate only) |
| opencode | `OPENCODE_CONFIG` → temp config merging the user's with glass provider `baseURL`s | `opencode.db` for the bypassing `github-copilot` provider |
| pi | temp `models.json` provider with `x-agent`/`x-task-id` headers (dir via env) | none (proxy only) |

Corporate networks: the daemon's upstream honours `HTTPS_PROXY`/`NO_PROXY`; `glass doctor`
reports the effective egress.

### Install / uninstall

- **Primary**: `npm i -g <tarball URL from the bmw.ghe.com release>` (or GHE Packages).
  Prerequisite: Node ≥ 22. No build step, no postinstall scripts.
- **Uninstall**: `glass uninstall && npm rm -g glass`. Leaves no trace outside
  `~/.glass` (which `glass uninstall` removes on confirmation).
- **Optional later**: SEA single binaries per OS (drops the Node prerequisite);
  an optional Docker image of the same daemon for people who want it containerised —
  never required.
- **Opt-in autostart** is deliberately absent from v1; lazy start by the wrapper covers it.

### The transformation script (coding → glass)

`scripts/glass/extract.mjs` in coding, driven by `glass/manifest.yaml`:

1. **select** — explicit file list from coding and rapid-llm-proxy (no globs over large dirs).
2. **rewrite** — import-path remaps, `CODING_*`→`GLASS_*` env names, data home
   `~/.coding/data/<scope>` → `~/.glass`, port defaults. Rules are few and declarative.
3. **overlay** — glass-only files (CLI, daemon entry, wiring module, UI entry) that live in
   coding under `glass/overlay/` — one source of truth, no parallel copies.
4. **build** — the UI: a reduced Vite entry (Token Usage + Cost + context explainer only)
   built once into static assets; the user never runs a frontend build.
5. **verify** — fails if a selected file imports anything outside the selection, or if a
   forbidden dependency appears (better-sqlite3, km-core, tmux, child bash).
6. **publish** — writes the tree into a glass checkout and commits
   (`extracted from coding@<sha>, rapid-llm-proxy@<sha>`). The glass repo is
   **generated — not hand-edited**; CI there re-runs extract and fails on drift.

To keep the rewrite rules small, the seams are cut **in coding first** (G1) so the subset
is a clean module boundary, and coding itself uses the same Node modules — e.g. coding's
bash launcher calls the new Node wiring module instead of keeping its own copy.

---

### Status line (tmux, clickable)

coding's status line stays, reduced to glass's fields. The renderer is already Node
(`lib/statusline/*.cjs`, `clickable.cjs`, `visible-cell-width.cjs`); only the click handler
`bin/statusline-click` is bash → becomes `glass click <tag>` (its per-platform open-URL
branches — macOS/Linux/WSL/Windows — port as they are).

| Field | Click | Keep |
|---|---|---|
| `ctx` context gauge (per agent: claude/opencode/copilot/pi readers) | popup "Context window" (`statusline-click-report.mjs ctx`) | **yes** |
| token / cost badge (session ↑↓, cache %) | open UI → Token Usage | **yes** (new, from the token DB) |
| `health` → glass daemon badge | open UI | **yes** (reduced: daemon up, last row age) |
| `net` | popup: egress / upstream reachability (no routing tiers) | **yes, reduced** |
| `lsl`, `obs`, `ukb`, `constraints`, `semantic`, `p:*` | — | no (features glass doesn't have) |

Where it shows:
- **tmux present** (macOS, Linux, WSL; tmux optional, never installed by glass):
  `glass <agent>` runs the agent in a tmux session with the status bar + mouse bindings,
  exactly like coding. `--no-tmux` opts out.
- **Native Windows / no tmux**: the same field renderer feeds (a) Claude Code's own
  `statusLine` (via `--settings`, works on Windows), with fields as **OSC 8 hyperlinks**
  (clickable in Windows Terminal, iTerm2, VS Code terminal); (b) for copilot/opencode/pi,
  `glass watch` — a live one-line bar in a split pane (`wt split-pane` offered by `glass doctor`).

## G0 results

| Spike | Result |
|---|---|
| S1 copilot capture without a proxy | **Works, and changes the design.** Copilot CLI 1.0.81 has built-in OTel: `COPILOT_OTEL_FILE_EXPORTER_PATH=<file>` + `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` → one `chat` span per model call with `gen_ai.usage.input_tokens`, `output_tokens`, `cache_read.input_tokens`, model, `gen_ai.conversation.id`, `github.copilot.turn_id`, `execute_tool` spans, and the full context: `gen_ai.system_instructions` (42 KB), `gen_ai.tool.definitions` (41 KB), `input/output.messages`. Per-call tokens AND context composition, no BYOK, no borrowed credentials. (Run via coding's proxy because this machine's direct copilot login had expired; the OTel side is provider-independent — re-confirm once against GitHub directly after `/login`.) |
| S1b why not BYOK | The proxy's `/v1/copilot` route serves the call itself with **OpenCode's** OAuth token (`~/.local/share/opencode/auth.json`). A Copilot-only user has no such file — glass would need its own Copilot login. OTel avoids that entirely. |
| S2 `node:sqlite` | Flag-free from Node 22.13 (22.12: fails; 22.23, 25 fine), WAL ok. Windows run pending (CI). |

| S3 Claude Code 2.1.285 | **Works.** `CLAUDE_CODE_ENABLE_TELEMETRY=1` + OTLP/http-json → `api_request` events per call (`input/output/cache_read/cache_creation_tokens`, `cost_usd`, `request_id`, `prompt.id`); `OTEL_LOG_RAW_API_BODIES=file:<dir>` → untruncated request/response bodies + `index.jsonl` (request ↔ response ↔ transcript message) — full context (system 28 KB, 45 tools 127 KB, messages). |
| S4 OpenCode 1.15.13 | OTLP via `OTEL_EXPORTER_OTLP_ENDPOINT` exports **process internals only** (config, file, session spans); `experimental.openTelemetry` produced no AI-SDK token spans in a `run`. Not a usable token channel → proxy via provider `baseURL`; `opencode.db` for the `github-copilot` provider (which bypasses). |
| S5 pi 0.84.2 | No telemetry option. Proxy via `models.json` provider (as coding does) is the only channel. |

**Decision (user, 2026-10-08): the proxy stays the primary measurement path** — everything
routed through it, so glass controls what is measured (as in coding). Agent telemetry
(copilot OTel, claude `api_request` + raw bodies) is a **secondary channel**: cross-check of
the proxy's numbers, and fallback for traffic that bypasses the proxy. The daemon therefore
carries both: the proxy (tap + passthrough) **and** an OTLP/HTTP receiver.

### The open problem: Copilot through the proxy without borrowed credentials

coding's `/v1/copilot` route serves copilot BYOK calls with **OpenCode's** OAuth token. The
same gap hits OpenCode's `github-copilot` provider (it bypasses the proxy today). Options:

- **A — intercepting forward proxy (recommended to spike).** Per session, `HTTPS_PROXY=http://127.0.0.1:12445`
  + `NODE_EXTRA_CA_CERTS=~/.glass/ca.pem` (a CA glass generates; never added to the OS trust
  store). The agent keeps its **own** login, model catalogue and premium-request accounting;
  glass decrypts, measures, forwards unchanged, chaining to a corporate upstream proxy. One
  mechanism covers copilot CLI, OpenCode's `github-copilot` provider, and could cover claude.
  Risks: CLIs that ignore `NODE_EXTRA_CA_CERTS` (copilot = Node SEA? opencode = Bun), cert
  pinning, and **corporate policy on a local TLS-intercepting tool** — needs a yes from IT security.
- **B — BYOK with the user's own GitHub token.** glass exchanges the user's token (`gh auth token`
  / copilot's stored login, `GH_HOST`-aware) at `/copilot_internal/v2/token` and serves the call
  like coding does — own credentials instead of OpenCode's. Risk: undocumented endpoint,
  editor-integration headers; BYOK mode changes copilot's model routing.
- **C — telemetry only for copilot.** No interception; OTel gives per-call tokens + context. Loses
  "full control" for copilot (glass cannot measure what the CLI does not report).

- [x] S8 option A spike (`scratchpad mitm-spike.mjs`, ~150 lines: CONNECT front, per-host leaf
      certs from a local CA, blind tunnel for everything else, chained to proxydetox :3128):
  - **OpenCode 1.15.13 (Bun binary), `github-copilot` provider: works.** Honours `HTTPS_PROXY` +
    `NODE_EXTRA_CA_CERTS`; every `copilot-api.bmw.ghe.com/chat/completions` call decrypted and
    recorded with `usage` (`prompt_tokens`, `completion_tokens`, `cached_tokens`) and the full
    request body (102 KB = the context). It also exposed a **hidden title-generation call**
    (`gpt-5-mini`, 538 tokens) that coding's current setup never sees — the "full control" case.
  - **Copilot CLI 1.0.81: trusts the CA.** `api.bmw.ghe.com/copilot_internal/user`,
    `copilot-api.bmw.ghe.com/mcp/readonly`, the telemetry service — all 200 through interception.
    The run then fails on `api.githubcopilot.com/models` → **401**: the CLI asks the *public*
    Copilot API although the login is for bmw.ghe.com — so the "expired login" from S1 is likely a
    host-selection problem, not an expired token. A full measured model call is still pending (S7).
  - Corporate chaining works (upstream CONNECT via :3128).
  - Production note: the spike shells out to `openssl` for certs; on native Windows glass needs a
    pure-JS cert generator (e.g. `node-forge`, no native code) — one small dependency.

  **Verdict: option A is technically viable** for both Copilot paths. Remaining gate:
  IT-security sign-off for a local TLS-intercepting proxy.
- [x] S6 platform spike (glass branch `g0-s6-opencode-trust`, CI run 305053962 on AIMAAD
      runners — ubuntu + windows-latest, Node 22.13.0 / 22.23.3; macOS run locally, Node 25.8.1,
      chained through proxydetox :3128): `node:sqlite` WAL ok everywhere; all four agent CLIs
      spawn (Windows: only with `shell: true` — npm `.cmd` shims); **all four trust the pure-JS CA**
      through the intercepting proxy (opencode, claude, copilot, pi decrypted, 0 cert errors).
      AIMAAD has no macOS runners (jobs only queue) — macOS stays a local/cleanroom check.
      Findings for G1/G3: (1) enterprise copilot talks to `copilot-api.<tenant>.ghe.com`, which
      must be in the intercept list; (2) with `shell: true` on Windows, args need cmd quoting
      (a multi-word prompt splits) — use cross-spawn-style escaping; (3) copilot rejects classic
      `ghp_` tokens client-side; (4) stored logins flow through the proxy even with dummy env keys
      — captured traffic is sensitive by default.
- [x] S7 one measured copilot call, proxy vs OTel (`spike/copilot-measure.mjs`, macOS, chained
      through :3128, user's own bmw.ghe.com login, no BYOK): **works with Copilot CLI 1.0.93** (npm
      `@github/copilot`). The call goes to `copilot-api.bmw.ghe.com/v1/messages` (Anthropic wire,
      `claude-sonnet-5.5`) and is decrypted with full usage; OTel `chat` span agrees **exactly**
      (33,203 in / 4 out, cache 16,457 write + 16,742 read on both sides). Context composition from
      both: request 91 KB, 26 tools, system 51 KB, tool definitions 41 KB.
      - The "expired login" / public-host 401 of S1 + S8 is **VS Code's bundled CLI 1.0.81**
        (`github.copilot-chat/copilotCli` shim, first on PATH): it asks `api.githubcopilot.com/models`
        although `copilot_internal/user` returns `endpoints.api = https://copilot-api.bmw.ghe.com`.
        1.0.93 honours the endpoint. → `glass doctor` must report the resolved copilot binary and
        version and warn below 1.0.93; `GH_HOST` does not fix 1.0.81.
      - Normalisation for G1/G3: Anthropic-wire `input_tokens` excludes cache write/read
        (total = input + cache_creation + cache_read); OpenAI-wire `prompt_tokens` includes cached;
        OTel `invoke_agent` rolls up its `chat` spans — count `chat` spans only.

**G0 verdict:** every agent has a measured call through the proxy (opencode + its github-copilot
provider S8, claude S3/S6, pi S5/S6, copilot S7) with its context composition, on macOS, Linux and
Windows (S6). Remaining gate before G1: IT-security sign-off for local TLS interception.

## Phases

| | Phase | Content | Accept |
|---|---|---|---|
| G0 | Spikes | S1–S7 above: which capture channel per agent (OTel / file / tap), `node:sqlite`, Windows native | per agent: a measured call + its context composition, from the chosen channel |
| G1 | Seams in coding | Node port of `configure_proxy_routing` + `config/agents/*.sh` wiring (coding's launcher calls it); `node:sqlite` behind a tiny DB adapter in proxy + `token-db`; injectable data home / redaction path; cut `TranscriptNormalizer`, `repo-router`, `measurement-span` dist import; path regexes `[\\/]` | coding test suite + cleanroom green; coding behaviour unchanged |
| G2 | Extractor | `scripts/glass/extract.mjs` + `glass/manifest.yaml` + import-closure check | generated tree builds, imports closed, no forbidden deps |
| G3 | glass daemon + CLI | single process, lazy spawn, pid/port lock, idle exit, retention timer, wrappers for 4 agents | per agent: tokens + context turns recorded, on mac/linux |
| G4 | UI bundle | reduced dashboard entry, served by the daemon | gsd-browser: pages render with live rows |
| G5 | Packaging + platform CI | npm tarball on GHE release; CI matrix macos / ubuntu / **windows-latest native**; WSL via cleanroom | install → 4 agents measured → uninstall → **HOME diff empty** on every OS |
| G6 | Repo + handover | create `bmw.ghe.com/<owner>/glass` (private), first extracted commit, README (install, uninstall, privacy), CI drift check | a colleague installs from the README alone |

Rough size of glass after extraction: proxy tap + DB (~4k), adapters + reconciler (~4k),
wiring + CLI + daemon (~1.5k new), gauge (~1.5k), UI (~6–8k) → **~17–19k lines**,
one package, zero native deps.

## Risks

- **Copilot token counts**: CLI ≥1.0.63 omits per-message tokens in its event file; only
  proxy routing (BYOK) gives per-call numbers. If BYOK is blocked for a user's seat,
  glass shows session aggregates only — say so in the UI rather than show zeros.
- **Context capture contains prompt bodies.** Redaction on by default, local-only storage,
  retention default 7 days, `glass uninstall` wipes it.
- **`node:sqlite` stability** (release-candidate in Node 22/24) — the DB adapter seam keeps
  better-sqlite3 swappable if needed.
- **Drift**: extraction from two upstream repos; the CI drift check and the generated-only
  rule keep glass from becoming a parallel version.

## Open decisions

- Copilot through the proxy: option A, B or C (see G0) — after S8.
- IT-security sign-off if option A (local TLS interception) is chosen.
- Whether AIMAAD's hosted runners include `windows-latest` and `macos-latest` (seen so far:
  `ubuntu-latest` in AIMAAD/knowledge-management) — answered by run 304427957.

## G1 progress (branch `glass-g1-seams` in coding and rapid-llm-proxy; plan: work packages WP1–WP6)

| WP | Content | Commits | State |
|---|---|---|---|
| WP1 | Portable token-row builders: `claude-subagent-path.mjs` (either separator), `parseCopilot` gate removed, `path.isAbsolute`/root test, injectable `ctx.projectOf`; import-closure test | coding 1bad04a5 | done |
| WP2 | SQLite adapter `proxy-bridge/db-open.cjs` (better-sqlite3 or node:sqlite via `CODING_SQLITE_BACKEND`; keeps 5 s busy timeout, savepoint transactions, better-sqlite3 error codes); token-usage.ts + 5 coding callers use it | proxy c10fac5, coding 0694d87e | done — suites green on both backends |
| WP3 | No `/Users/Q284340` fallbacks in the proxy; redaction config injectable (`LLM_PROXY_REDACTION_CONFIG`), no cross-repo require; retention sweeper is `lib/measurement/context-turns-retention.mjs` | proxy 70b0a88, coding 9ccafe7d, 6bb1ed5b | done |
| WP4 | `lib/proxy/proxy-paths.cjs`: one resolver for the sibling proxy (dist dir, db-open); falls back to coding's better-sqlite3 without the proxy (hosted CI) | coding 0694d87e | done |
| WP5 | Measurement code out of `server.mjs`: `proxy-bridge/measurement.mjs` (task binding per endpoint, Anthropic usage tap, token row of the tap, breakdowns, context turns, raw bodies, the two reads) + `context-capture.mjs` (pure analysers); server.mjs −870 lines. Safety net: `tests/harness/` boots the REAL daemon in a sandbox behind a TLS-terminating fake upstream (`HTTPS_PROXY` + per-run openssl CA), `tests/daemon-characterisation.test.mjs` compares 16 scenarios to a golden recorded before the move | proxy 16a4dfc, 89a2f50, 9d6ea1d | done — golden equal on better-sqlite3 and node:sqlite; mutation check fails it; suite 479/479 |
| WP6 | Agent wiring in Node: `lib/agents/proxy-routing.mjs` is the one implementation (configure_proxy_routing, opencode config, pi models.json/settings.json — no python3 — copilot BYOK reset); the launcher evals its CLI output; experiment cells + kgbench use the same rules (`wireAgentEnv`), `buildAgentRoutingEnv` removed; tmux wrapper passes the routing env and `env -u`s absent vars. Safety net: bash parity matrix (26 rows, golden from the bash before the port) | coding e4893d3d, 4fac2220 | done — parity identical except pi log order; tmux fix tested on a real server; node + jest suites: no new failures vs the pre-change commit |

Findings during G1:
- **Retention bug (fixed, 6bb1ed5b, user-approved):** the sweeper defaulted to `<CODING_REPO>/.data`; the proxy writes to `proxyDataDir()` and the launchd job sets no `LLM_PROXY_DATA_DIR` → nothing was ever swept (3.4 GB, 5,371 task dirs, 56 captures past 14 days).
- Not unified: `resolveDataDir()` across server/token-usage/measurement-span — their defaults genuinely differ (`<coding>/.data` vs `<cwd>/.data`); glass always sets `LLM_PROXY_DATA_DIR`.
- `@types/node` bump unnecessary — TS never imports `node:sqlite` (types live in `db-open.d.cts`).
- tmux env allowlist omitted `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `COPILOT_PROVIDER_*`, `CODING_PROJECT_ID` — **fixed in WP6** (user decision): a new tmux session now gets exactly the launcher's routing env; stale tmux-server values are removed.
- WP6 behaviour changes (user decision "one module, bash wins") — experiment cells: claude runs without the API-key vars (Max OAuth, like the launcher) and sends `x-project`; opencode gets the launcher's OPENCODE_CONFIG_CONTENT (enabled_providers rapid-proxy + github-copilot; the old cell-only anthropic / openai / github-copilot-enterprise task seams are gone — no spec in config/experiments uses those providers); copilot gets `/p/<project>`, task id no longer URL-encoded; pi writes its config into the cell sandbox (`<sandbox>/pi-agent`) and its sessions into the cell worktree; `CODING_PROXY_ROUTE` opt-out is case-sensitive, as in bash. kgbench claude cells: same claude change, plus one health probe per cell (proxy down → unbound).
- Cleanroom (2026-10-08): first run FAILED — the proxy never started: `bin/start-llm-proxy.sh` hard-coded `/Users/Q284340/…` (bridge, .env, user-hash script) and `/opt/homebrew/bin/node`, on origin/main too (WP3 had cleaned the proxy's code, not its start script). Fixed in proxy 84ecfe7 (paths from the checkout, PATH, CODING_REPO); second run: all assertions passed. Run it from the worktree with `RAPID_LLM_PROXY_DIR=…` set, all submodules checked out, and no untracked `node_modules` symlink (the snapshot ships it).
- Worktree: jest ignores `/.claude/worktrees/` and the worktree has no `dist/` build; suites were compared against the pre-change commit run the same way (identical failing sets).
- WP5, not changed (characterised as-is): a per-agent span's `meta.capture_raw_bodies` is ignored by the `/v1/messages` tap — `tapCapturesRawBodies` reads the GLOBAL span, while the task id comes from the per-agent one.
- WP5, pre-existing bug: the `auth.json` watcher in `server.mjs` main() assigns the undeclared `copilotSession` → a ReferenceError thrown from an `fs.watch` callback whenever opencode refreshes its token.
- WP5: the live proxy runs from the `_work/rapid-llm-proxy` checkout, which is on `glass-g1-seams` — the refactor goes live on the next proxy restart.
- Worktree: coding tests that import the proxy by a static relative path (`tests/context-turns/*`, `tests/redaction/proxy-raw-body.test.mjs`) cannot run from `.claude/worktrees/glass-g1` — `../../../_work/…` resolves inside `.claude/worktrees/`.
- Constraint `no-parallel-files` matches file PATHS: any `…lite.` name (e.g. `sqlite.cjs`) trips `lite[ ._-]`.

## G2 progress (branch `glass-g2-extractor` in coding)

| Piece | Where | State |
|---|---|---|
| Import scanner (comments/strings/regex-aware; static, `import()`, `require`, `createRequire(…)(…)`; computed sites reported) | `scripts/glass/import-graph.mjs` — also used by `tests/token-adapters/portable-seams.test.mjs` (one scanner; it now sees the `createRequire` edge) | done |
| Manifest | `glass/manifest.yaml`: 26 coding files, 7 proxy files, 4 compiled TS files, 3 exact-count rewrites (proxy dir + dist → `<pkg>/proxy`, port 12435 → 12445), 4 computed sites, 2 optional sites | done |
| Extractor | `scripts/glass/extract.mjs`: select → compile (proxy's own tsc + compilerOptions, no maps) → rewrite → overlay (must not shadow) → `EXTRACTED.json` → verify → build smoke; `--out` / `--check` (drift) / `--publish` (branch from origin/main + PR) | done |
| Overlay | `glass/overlay/{package.json,README.md}` — `type: module`, `engines >=22.13`, no dependencies | done |
| Tests | `tests/glass/extract.test.mjs`: scanner, every verify failure on fixtures, real manifest (closed, smoke, deterministic; skipped without the proxy checkout) | 10/10 |

Result (coding cae5aad4 + proxy 34c78e5): **40 files, 15,288 JS lines**, imports closed, no
forbidden deps; smoke with no `node_modules` imports all 36 modules and round-trips the token DB
(proxy `logCall` + adapter `insertTokenRowDeduped` → `getSummary` = 2 calls / 25 tokens) on
Node 25.8.1 **and 22.13.0**; two extractions identical.

Findings during G2:
- Run from a coding worktree with `RAPID_LLM_PROXY_DIR` set — `proxyDir()`'s sibling default
  resolves inside `.claude/worktrees/` (the extractor reports the missing files by name).
- Reported, not failed: `proxy/dist/token-usage.js` imports `child_process` — `currentWindow()`
  shells out to `curl` for the health coordinator at import (`setImmediate`). G3: replace or gate.
- Known bloat (closed, harmless): `project-of → repo-router → teams/config → vendored js-yaml`
  (~4.5k lines) only for `projectIdFor`. Later seam cut.
- `token-usage.ts` still guesses a sibling `coding` checkout for `live-logging-config.json`;
  absent in glass → defaults. G3 sets `CODING_REPO`.
- Published: glass PR #1 (`extract/3ccc8a6-34c78e5`), 3 Wiz checks pass, merged 2026-10-08 as 322b3f2.
  `--publish` works in a temporary clone (never in the user's glass checkout); `gh` gets
  `--repo` from the remote URL (bmw.ghe.com remotes use the SSH user `bmw@`, not `git@`).
- For the G6 drift check: `EXTRACTED.json` names the coding commit, so every coding commit
  changes it even when no glass file changed — compare `files`, not `sources`.
- G3 needs, from the proxy: the `/v1/messages` forward without `resolveRoute`/keychain, a real
  OpenAI-shim **passthrough** (today the shim is rewritten into `/api/complete` routing), and
  the three `/api/token-usage/*` handlers moved out of `server.mjs` — next seam cuts.

## G3 progress (branches `glass-g3-forward` in rapid-llm-proxy, `glass-g3-daemon` in coding)

| WP | Content | Commits | State |
|---|---|---|---|
| WP1 | Golden +5 scenarios (`?beta` query, 501 refusal, 3 token-usage reads), then `anthropic-forward.mjs` (forward + tap; routeGuard / keychain token / egress injected), `usage-api.mjs` (+ `getCost` in token-usage.ts), `model-canonical.mjs` out of server.mjs | proxy 3663254, bfaf380 | done — golden (22) equal on both backends; proxy suite 479/479 |
| WP2 | `openai-passthrough.mjs` (chat + Responses, verbatim, real SSE, `include_usage` only when missing), `createOpenAIUsageTap` + `recordOpenAITap`, `parseResponsesUsage`; `/api/complete` capture shares the writer | proxy 5966ba3 | done — 7 tests, golden unchanged |
| WP3 | `intercept.mjs`: CONNECT on the daemon's own server, persistent CA (node-forge certs, native keygen), session binding from Proxy-Authorization, blind tunnel for other hosts | proxy afdb6e9 | done — 5 tests |
| — | `HEALTH_COORDINATOR_URL=off` (no curl); Anthropic tap takes provider/subscription from the caller | proxy 0f531c3, 1cbed96 | done |
| WP4/5 | `glass/overlay`: `bin/glass.mjs`, `lib/glass/{daemon,cli,client,wiring,spawn,egress,home}.mjs`, tests, CI workflow | coding f6838f70 + CI | done — 10 overlay tests in the generated tree (Node 25 + 22.13) |
| WP6 | manifest (+7 shared proxy modules), overlay deps `undici` + `node-forge`, smoke installs deps (`--ignore-scripts`) + runs `bin --version` | coding f6838f70 | done — 56 files, 17,435 JS lines, closed |

Real runs through glass (macOS, chained through proxydetox :3128, each agent's own login):
- claude 2.x → glass → api.anthropic.com: `claude-opus-5-5` in 2 / out 4 / cache-write 44,284, task-bound, context turn.
- copilot 1.0.93 → intercept → copilot-api.bmw.ghe.com `/v1/messages`: `claude-sonnet-5.5` in 4 / out 4 /
  cache-write 28,377 — **equal to its OTel `chat` span** (input 28,381 = 4 + 28,377).
- opencode 1.15.13 `github-copilot/claude-haiku-4.5` → intercept: 27,893 in / 5 out, plus its hidden
  `gpt-5-mini` title call (532 / 78) — both task-bound.
- pi 0.84.2 → intercept → api.openai.com: TLS trusted, forwarded, real upstream answer (401 for a dummy
  key → no row, correct). A token row needs a pi login (pi has no provider of its own on this machine).

Findings during G3:
- **Binding spike**: copilot 1.0.93, opencode 1.15.13 and pi 0.84.2 all send `Proxy-Authorization`
  from `HTTPS_PROXY` credentials on every CONNECT → per-session binding, concurrent sessions safe.
- **Double count avoided**: opencode's file adapter assumes `github-copilot` bypasses the proxy (true in
  coding); under interception it does not, so adapters run only for claude (request-id dedup) and
  `--no-intercept` sessions.
- coding bug (not fixed): `config/live-logging-config.json` `session_duration: 3600000` is ms, but
  `token-usage.ts` reads minutes → the coordinator-less LSL window is `0000-0000`. Glass is unaffected
  (no such config → 60 min default).
- `--no-intercept`, status line, `glass ui`, Windows verification: G4 / G5.

## G4 plan (branch `glass-g4-ui` in coding)

The UI is the dashboard's own components behind a reduced entry: no forked pages. The daemon
serves the read shapes those components already fetch, so they run unchanged.

| WP | Content | Accept |
|---|---|---|
| WP1 | Dashboard seams: `TokenUsagePage` takes `proxyBase` + `tabs` (coding: unchanged defaults); `timeline-read.mjs` opens the DB through `openDb` (no direct better-sqlite3) | coding dashboard typecheck + timeline tests green |
| WP2 | Reduced entry `integrations/system-health-dashboard/glass-ui/` (index.html, main, app, vite config): Token Usage (Overview / Evolution / Recent) + Sessions with the context explainer and turn modal | `vite build` of the entry green |
| WP3 | Daemon: static `ui/` (SPA fallback), `/api/experiments/runs` (glass sessions as runs), `/runs/:id/timeline`, `/runs/:id/context-turns`; `glass ui` opens the browser | overlay tests |
| WP4 | Extractor `build` step: the entry built into `<tree>/ui`, verify that the page and its assets exist, drift-safe (deterministic) | two extractions identical |
| WP5 | Live check: real daemon with real rows, gsd-browser on every page | screenshots + DOM assertions |
| WP6 | Status line (fields table above): `glass click <tag>`, token badge, daemon badge, tmux / `--settings` statusLine | per field: render + click |

### G4 progress

| WP | Result | State |
|---|---|---|
| WP1 | `TokenUsagePage({ proxyBase, tabs, settings })`; `ContextCacheExplainer({ topology })` (`CODING_TOPOLOGY` default — glass shows its daemon, no Docker services); `timeline-read.mjs` → `openDb` | done — dashboard typecheck clean (one pre-existing semantic-analysis import, submodule absent in the worktree); timeline tests 7/7 on both backends |
| WP2 | `glass-ui/`: HashRouter app, Token Usage (Overview / Evolution / Recent), Sessions (table → `PerformanceTimeline` + `TurnModal`, Context → explainer); own store with the performance slice only; `@/store` aliased to `glass-ui/store.ts` (coding's store pulls every slice → semantic-analysis dist) | done — 7 files, main chunk 139 KB gzip |
| WP3 | `lib/glass/ui-api.mjs` (static + SPA fallback, traversal-safe; runs = live sessions + archived spans with per-task totals and dominant model; timeline via `readTimeline`; context turns), `open-url.mjs` (statusline-click's opener chain, no shell), `glass ui` | done — 13/13 overlay tests on Node 25.8.1 and 22.13.0 |
| WP4 | manifest `build:` step (Vite with the dashboard's node_modules → `ui/`; verify + smoke skip browser code; index.html refs checked) | done — 67 files, 18,033 JS lines, closed; extract tests 12/12; two extractions identical |
| WP5 | Real `glass claude` + `glass copilot` through the generated tree (port 12446, scratchpad home), gsd-browser on every page | done — Token Usage: 2 calls / 83.9K = the two rows; Recent Calls: both rows; Sessions: both runs, copilot timeline (cache-write 33,243), turn modal, explainer: claude 135.5 KB (tools 67.2 KB, history 61.4 KB, 50% cached), copilot 88.6 KB (system 50.0 KB, tools 38.4 KB) |

| WP6 | `lib/glass/statusline.mjs` (daemon facts + tmux / ansi / plain renders + ctx / net reports), `/api/statusline`, `lib/glass/tmux.mjs` (own session via argv `new-session -d` + attach, exit code through a file; inside a user's tmux: session options set and restored; one MouseDown1Status binding for `g:*` ranges that falls through to the previous binding), `glass statusline / click / report / watch`, claude without tmux → `--settings` statusLine (temp file, removed after), UI deep link `#/sessions?task=&explain=1`; coding seam `CODING_MODEL_LIMITS_CACHE` (model-limits cached into the package dir); `tmux` off the forbidden-spawn list (optional, decision 5) | done — 21/21 tree tests on Node 25.8.1 + 22.13.0 (incl. configureStatus on a real tmux server); live, interactive, in an isolated tmux server: claude and copilot sessions with the bar updating (claude ↑92.7K, copilot ctx 4% ↑36.9K), ctx popup over the pane, exit → session closed + span archived + exit file gone; claude `--no-tmux`: Claude Code renders glass's line with OSC 8 links (ctx 9%), settings file removed on exit; deep link opens the explainer (gsd-browser) |

Findings during G4:
- **Gauge anchor**: the latest context turn is often a side call — Claude Code's title / summary request on the
  SAME model (no tools, ~1.2K), copilot's `gpt-4o-mini` call — which dropped the gauge to ~0%. The gauge uses
  the latest turn that carries tool definitions (the agent's main loop), else the latest.
- Copilot's TUI ignores an Enter injected with `send-keys` into its own pane; through the attached client it
  works. Only matters for scripted tests.
- Not verified: the click itself with a real mouse (the binding, its `#{m:g:*,…}` match and `glass click` were
  each exercised; tmux cannot synthesise a status-line click), `glass click g:health / g:tok` (they open the
  browser — the opener chain is unit-tested), Windows / WSL (G5 CI).
- jest ignores `.claude/worktrees/` (G1 finding) — the model-limits seam was checked directly (default path
  unchanged); coding's gauge suite runs after the merge.
- The reused pages carry coding vocabulary glass has no use for: process names `token-adapter-<agent>`, the
  Knowledge / Infrastructure lanes and "Development narrative" in the timeline (`/api/observations`,
  `/api/digests` 404 → rejected quietly). Harmless; trim if users find it confusing.
- The bundle still contains the Cost and Routing tabs (static imports, never rendered). Lazy-load if size matters.
- The explainer verdict counts cache reads only: a single-turn session that only WROTE the cache reads
  "does not reuse a prompt cache" — true, but terse.

## Session log

- **2026-10-08** — proposal written; decisions taken (above); repo created
  (`Frank-Woernle/glass`, private, empty). G0: S1 copilot OTel works (per-call tokens + full
  context, no proxy) → design pivots to an OTLP receiver with the tap optional; S2 `node:sqlite`
  floor Node 22.13. tmux status line kept (field table above). S3 claude telemetry complete
  (tokens + raw bodies), S4 opencode OTel = internals only, S5 pi has none. User decision: proxy
  stays primary, telemetry secondary. Open: copilot through the proxy without OpenCode's token
  (options A/B/C). S8: option A works for OpenCode's github-copilot provider (usage + full body,
  plus a hidden title call) and copilot CLI trusts the CA; copilot's 401 is a public-vs-GHE host
  issue. Next: IT-security question, S7 (copilot host fix + one measured call), S6 Windows CI.
- **2026-10-08 (S6)** — platform spike pushed to `g0-s6-windows`; the run never started: hosted
  runners disabled on bmw.ghe.com for this repo. Plan committed + pushed (270ebacb).
  Spike gained corporate-proxy chaining (verified locally). Repo transferred to `AIMAAD/glass`;
  AIMAAD's ruleset (PR-only, 3 Wiz checks, every branch) → spike re-pushed as `g0-s6-platform`.
- **2026-10-08 (S6 done, S7)** — S6 green on ubuntu + windows (CI) and macOS (local, chained);
  copilot + pi added to the trust check. S7 script written; blocked on copilot `/login`.
  Repo still has no `main` (default = `g0-s6-windows`) — user to create it. *Resolved
  2026-10-08:* empty `main` created and set as default branch; user is admin on `AIMAAD/glass`
  (the transfer had dropped them to write). Clone over SSH needs `id_ed25519_ghe`.
- **2026-10-08 (S7 done)** — after `/login`: copilot measured through the proxy, exact match with
  OTel. The 401 was VS Code's bundled copilot CLI 1.0.81 using the public host; 1.0.93 fine.
  G0 complete except the IT-security sign-off. Next: G1 (seams in coding).
- **2026-10-08 (G1 WP1–WP4)** — portable builders, SQLite adapter (both backends green), proxy resolver, no machine-specific paths, redaction injectable, retention ported + its data-dir bug fixed. Next: WP5 harness + extraction, WP6 wiring.
- **2026-10-08 (G1 WP5)** — real-daemon characterisation harness (sandbox + TLS-terminating fake upstream, 16 scenarios, golden), then measurement moved out of `server.mjs` into `measurement.mjs` + `context-capture.mjs` with the golden unchanged on both SQLite backends. Next: WP6 wiring.
- **2026-10-08 (G1 WP6)** — bash parity matrix, then the agent → proxy wiring in one Node module used by the launcher, experiment cells and kgbench; tmux routing-env gap fixed. Next: cleanroom run, then merge G1 (coding: merge main into the branch first; proxy: PR).
- **2026-10-08 (G1 cleanroom)** — cleanroom green after fixing the proxy start script's machine-specific paths. Next: merge G1.
- **2026-10-08 (G2)** — G1 merged (coding main cae5aad4, proxy 34c78e5). Extractor, manifest, shared import scanner and tests built in worktree `glass-g2`; first extraction green (40 files, closed, smoke on Node 22.13 + 25). Decisions 7 (env names kept) and 8 (forbidden-dep allowlist). Next: publish the first generated PR into glass `main`, merge G2.
- **2026-10-08 (G2 done)** — coding main 3ccc8a69 (+ 58a77d83 gh `--repo` fix); glass PR #1 merged (322b3f2): 40 generated files on `main`. Next: G3.
- **2026-10-08 (G3)** — binding spike (all three intercepted agents send Proxy-Authorization); proxy seam cuts (anthropic-forward, usage-api, model-canonical) under an extended golden; OpenAI measuring passthrough; intercept module; glass daemon + CLI in the overlay; real claude / copilot / opencode runs measured through glass. Next: pi login for its row, proxy PR, merge coding, publish glass PR #2.
- **2026-10-09 (G4 published)** — coding main 45070e2a (glass-g4-ui merged after main's CI fixes d82ed5ef). Glass PR #3 failed on ubuntu only: tmux 3.4's default MouseDown1Status is `select-window`, 3.6's `switch-client` — glass chained it correctly, the test had hard-coded 3.6's; test fixed, #3 closed, PR #4 merged (bbafb6f), all 7 checks green. Next: G5.
- **2026-10-09 (G4 status line)** — WP6: status line from the daemon's own measurement, tmux session per run with clickable fields, Claude Code statusLine without tmux, `glass watch`; verified live with claude + copilot. Next: merge G4 into coding, publish glass PR #3, then G5 (packaging + platform CI).
- **2026-10-08 (G4 UI)** — reduced UI from the dashboard's own components (three seams in coding), daemon serves it + the run reads, extractor builds it; verified live with gsd-browser on real claude + copilot rows. Next: WP6 status line, then merge (coding) + publish glass PR #3.
- **2026-10-08 (G3 published)** — proxy PR #43 merged (7440525); coding main 0154fa83; glass PR #2 merged (63d224a, 57 files): Wiz IaC + Secret pass (Vulnerability Scanner "skipping" on both PRs, not blocking), glass tests pass on ubuntu + windows × Node 22.13.0 / 22.x. Live proxy checkout `_work/rapid-llm-proxy` left on 34c78e5 — pulling it needs `npm run build` (usage-api imports `getCost` from dist) before the proxy restarts.

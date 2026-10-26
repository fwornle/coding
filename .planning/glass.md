# glass — proposal

Token measurement + context-window insight for coding agents (GitHub Copilot CLI,
OpenCode, pi, Claude Code) as a compact standalone product, derived from `coding`
by a transformation script. Repo: **https://bmw.ghe.com/AIMAAD/glass** (private; created
2026-10-08 as `Frank-Woernle/glass`, transferred to the AIMAAD org the same day for its
GitHub-hosted runners). `main` is empty — generated content only.

Living plan. Update the phase status and the Session log at the end of every session.

Status: **G7 done** — v0.1.18 (Models tab, eight-slide overview) released on both targets (bmw.ghe.com AIMAAD/glass #31 → 01faf87; github.com fwornle/glass #8 → 19d1748, docs live); v0.1.16 was the first G7 release (#29 / #6). **G8 planned** (opt-in local offload, off by default). **G6 done (one item open)** — v0.1.2 is the latest release (tag at c0f0f52 = glass PR #7, from coding 51d2d91 + proxy 6170f5d; proxy PR #45 merged as 21ef373): main's tests green on all 4 cells incl. the provenance drift check, release job's install check green, the downloaded asset re-checked on macOS. pi row recorded (exact match with pi's own count). Open: a colleague installs on their own machine (ideally Windows) from the README. **G5 done** — v0.1.1 is the latest release (tag at e58dfc6 = glass PR #6, from coding 8242f7b + proxy b90d48d): main's tests green on all 4 cells incl. the Windows uninstall, release job's install check green, the downloaded asset re-checked on macOS. v0.1.0 (828d204) has the Windows uninstall race. Next: G6 (README for colleagues, CI drift check). **G4 published** — glass `main` = PR #4 → bbafb6f (from coding@45070e2 + proxy@7440525; 70 files incl. the built UI); CI green on ubuntu + windows × Node 22.13.0 / 22.x, 3 Wiz checks pass. Next: G5 (packaging + platform CI); pi row still waits on a pi login. **G3 published** — glass `main` = PR #2 → 63d224a (from coding@0154fa8 + proxy@7440525, proxy PR #43); CI green on ubuntu + windows (Node 22.13 / 22.x). Real runs on macOS measured for claude, copilot, opencode; pi proven through interception — its token row still waits on a pi login. Next: pi row, then G4 (UI + status line). G1 done and merged (coding `main` cae5aad4, proxy PR #42 → 34c78e5). G0 done (IT-security sign-off for local TLS interception still pending).

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
| G7 | Read-only routing view | per call: which model the agent itself chose and which account answered (relay rows); side calls marked; no proxy routing (see "G7 plan") | gsd-browser: one real session per agent shows its model mix and answering accounts; no offload / classifier code in the tree |
| G8 | Opt-in local offload | optional install of the proxy's routing core + classifier, offloading to a local OpenAI-compatible cluster (see "G8 plan"); off by default, base tree unchanged without it | a session on the BMW cluster: eligible calls offloaded, unreachable cluster → agent's own provider, Routing tab shows it; base tree byte-identical with the option off |

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
- **pi row (2026-10-09, v0.1.2 release tarball):** pi `/login` GitHub Copilot on bmw.ghe.com, then
  `glass pi --model github-copilot/claude-haiku-4.5 -p …` → intercept → copilot-api.bmw.ghe.com `/v1/messages`:
  in 2,823 / out 43, task-bound, context turn (system 5,479 B, tools 2,757 B, user 91 B) — **equal to pi's own
  usage event** (`--mode json`: input 2823, output 43). All four agents now measured through glass.

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

## G5 progress (branch `glass-g5-packaging` in coding, `glass-g5-ca-identity` in rapid-llm-proxy)

| Piece | Result |
|---|---|
| Tarball | overlay `package.json` 0.1.0: `files` (bin, lib, proxy, config, scripts, ui, EXTRACTED.json — no tests / CI), undici + node-forge as `bundleDependencies` → `npm i -g --offline ./glass-0.1.0.tgz` needs no registry; 1.4 MB, 340 files |
| Install check | `tests/install-check.mjs` (overlay): pack → global offline install into a sandbox (own HOME with its AppData / XDG dirs, prefix, npm cache, temp) → `glass doctor` → one `glass <agent> --no-tmux` per agent with a stand-in sending that agent's wire shape (claude: base URL; copilot `copilot-api.bmw.ghe.com/v1/messages`, opencode `api.githubcopilot.com/chat/completions`, pi `api.openai.com/v1/responses`: CONNECT + Proxy-Authorization + TLS against NODE_EXTRA_CA_CERTS) → upstream is a stand-in corporate proxy (glass chains through HTTPS_PROXY; it terminates TLS with its own CA) → token row per run bound to its task → `glass uninstall --yes` + `npm rm -g` → HOME byte-identical, temp empty, prefix clean |
| CI | `ci.yml` runs the install check after the tests (ubuntu + windows × 22.13.0 / 22.x); `release.yml`: on main, a version without a release → pack, install check on the tarball, `gh release create v<version>` with the tarball |
| README | install (`gh release download` + `npm install -g`) / uninstall |
| Real agents | tarball installed into a scratch prefix: real `glass claude` (opus, cache-write 57,077) and `glass copilot` (in 4 / cache-write 28,457 / out 4 = copilot's own "↑ 28.5k (28.5k written) ↓ 4") |

Findings during G5:
- **CA identity bug (fixed, proxy PR #44):** every interception CA had the subject `glass local interception CA` and no key ids. glass bundles the user's prior NODE_EXTRA_CA_CERTS with its CA; with another such CA ahead of it (coding's proxy, a second glass home), OpenSSL 3.0 (Node 22) checked the leaf against the wrong one → "certificate signature failure" for every intercepted agent. Node 25 (OpenSSL 3.5) tolerated it. Now: random suffix on the subject, SKI on the CA, AKI on leaves; regression test fails without the fix.
- npm 11 writes Node's compile cache into TMPDIR (`node-compile-cache`) — npm's trace, not glass's; the check gives npm its own temp dir. npm's cache (`~/.npm`) is likewise npm's and kept outside the checked HOME.
- `https.request` with `agent: false` ignores `createConnection` and dials the host itself — the first stand-in reached the real APIs directly (this Mac has direct egress). Only a test-side bug, but a reminder that "200 from upstream" needs the upstream to be the stub (the check asserts the stub saw every call).
- **Windows uninstall race (fixed, 0.1.1):** glass main's first run failed on windows / 22.x — `glass uninstall` deleted ~/.glass while the daemon was still closing token-usage.db and holding daemon.log (its stdout) → EBUSY. `stopDaemon(port, { waitMs })` now waits for the daemon pid to exit; `rmSync` retries. The added POSIX test does not reproduce the race on macOS (the daemon exits fast enough) — windows CI is the real check.
- Not covered: WSL (no runner; Linux path = ubuntu), macOS in CI (no AIMAAD runners — local runs only), the release workflow itself (runs on the first merge to main), pi with a real login.

## G6 progress (branch `glass-g6-handover` in coding, `glass-g6-redact-capture` in rapid-llm-proxy)

| Piece | Result |
|---|---|
| README | rewritten for colleagues: requirements (Node ≥ 22.13, repo access, copilot ≥ 1.0.93), install with / without gh (Windows too), use + status line, how it measures (per-run env only, CA never in a trust store, `--no-intercept`), privacy table (what, where, how long), uninstall, troubleshooting, generated-repo notice |
| Drift check | `tests/provenance.test.mjs` (overlay, runs in glass CI): tree = EXTRACTED.json — stray, missing and edited files each named; CRLF-only differences (Windows checkout) accepted. The other direction (coding changed, glass not republished) stays `extract.mjs --check` — glass CI cannot reach coding (github.com, private) |
| Retention | `sweepAgedCaptures({ breakdownsDir })` also reclaims per-run context-breakdown snapshots; glass's daemon and coding's sweeper CLI pass it |
| Colleague walk-through | README commands verbatim in a fresh HOME + npm prefix (gh with a token only): download v0.1.1, install, doctor (4 agents found); real `glass claude` / `glass copilot` rows; `glass status`; uninstall + `npm rm -g` leave no glass files |

Findings during G6:
- **Captures were not redacted (fixed, proxy PR #45):** context-breakdown snapshots and context-turns lines store previews of the system prompt, tools and messages (up to 2 KB); only `prompt_preview` and opt-in raw bodies went through the redaction set → a key pasted into a prompt was stored verbatim in three files. Now every string of a capture is redacted at the write points; the characterisation golden had recorded the test secrets inside captures (diff = those redactions only). Affects coding's proxy too.
- **Retention gap (fixed):** the 7-day sweep covered `measurements/<task>/` only; per-run breakdown snapshots (same previews) were kept forever. Coding's sweeper now reclaims them too (after its 14 days).
- `gh` on a `*.ghe.com` host reads `GH_TOKEN`, not `GH_ENTERPRISE_TOKEN`.
- `glass doctor` runs `copilot --version`, which unpacks copilot's package into its own cache (`~/Library/Caches/copilot`) — copilot's data, not glass's, but a write a doctor run causes.
- A true "colleague" test (other person, other machine, Windows) is still open — the walk-through above used this Mac.

## Docs site (branch `glass-docs` in coding)

MkDocs Material site at https://aimaad-glass.pages.bmw.ghe.com/ (GitHub Pages enabled 2026-10-09, build type
workflow, private to the org). Source in `glass/overlay/`: `mkdocs.yml`, `docs/*.md` (two tiers per page: ⚡ Quick
inline, 📚 Deep Dive from `docs/_tiers/`, labels as in coding), `docs/puml/` → `docs/images/` (architecture,
interception sequence, release pipeline; `_standard-style.puml`), Mermaid inline. Screenshots from real sessions on a
neutral demo project (claude, opencode, pi; copilot had lost its login), terminal views rendered from captured tmux
panes and real command output, paths anonymised. `docs.yml`: PR touching docs → `mkdocs build --strict`; push to main
with a docs change → build + deploy (Pages accepts main only). README starts with the site link. "A/B experiments": glass
has no experiment runner — documented as manual run comparison (Comparing Runs page).

## G7 plan — read-only routing view (done, v0.1.16)

**Question (2026-10-11):** should glass include coding's semantic router and the Routing
tab / config / control (dashboard Token Usage → Routing, Flow, settings dialog), installed
by default and optional to switch off at install?

**Answer: no routing. A read-only view of who answered, on by default.** Why routing stays out:

- It contradicts decision 9: glass measures and passes through; routing means the proxy
  answers the call itself with an account it chooses. G3 deliberately cut `resolveRoute` and
  the keychain token out of the forward.
- 33 of the ~37 routes in coding's config are `bg-*` services; glass has none. Only the four
  `fg-chat/<agent>` routes would carry over.
- Offloading copilot (and OpenCode's `github-copilot`) means substituting responses on an
  intercepted TLS connection. The IT-security sign-off covers decrypting to measure, not
  substituting answers.
- An offload needs a target. The local Qwen 27B (llama.cpp) is not on colleagues' Windows
  laptops; on 2026-10-11 coding's own offload moved 0 routes (qwen-laptop off).
- Size: proxy `routing-config` + `worker-pool` + classifier + `egress-decision` (~4.1k),
  `src/providers` (~2.1k), `llm-service` / `provider-registry` / circuit breaker / quota
  tracker (~1.3k), Routing + Flow + settings UI (~5.5k), plus `yaml` and the provider SDKs
  — about the size of glass itself.

Routing itself: an **opt-in** feature, off by default — planned as G8 (below), because the
"no target" objection does not hold at BMW (local Qwen mini-cluster).

**Why the coding Routing tab cannot simply be rendered:** its rows are keyed by `route_key`,
`route_band`, `route_step` and `attempt_trail` (`components/llm-routing/recent-call.ts`),
written by the proxy's routing path — glass rows have none of them. The tab reads
`/api/llm/routing/resolve` (server.mjs only, not in glass) and `/api/token-usage/recent`
(in `usage-api.mjs`, glass has it). The G4 bundle still carries the tab as dead code.

**What the view shows, from data glass already records:**

| Fact | Source in glass |
|---|---|
| Model per call, as the agent chose it (copilot `auto`, claude's title / summary side call on a small model, opencode's hidden title call) | `token_usage.model` |
| Answering account for relayed calls (opencode → an LLM proxy) | `provider` from `x-llm-provider` (glass 0.1.12, `1b4ffd2d`) |
| Wire / upstream host (Anthropic, Copilot, OpenAI) | forward vs intercept path, host |
| Main loop vs side call | same rule as the gauge anchor (tools present → main loop; G4 finding) |
| Tokens and cache per model, per session | existing rows |

Work packages:

- **WP1 rows:** check that `/api/token-usage/recent` returns model, provider, host and a
  side-call flag for every agent; add the missing ones in `measurement.mjs` / the forwarders
  (proxy repo) under the characterisation golden.
- **WP2 UI:** a "Models" section in glass-ui: per session a model mix (calls / tokens / cache
  per model and account), per call the strip with side calls marked. Reuse coding's
  components where they need no `route_*` field; otherwise a glass-ui component (overlay),
  not a fork of the Routing tab. Remove the dead Routing / Cost imports from the bundle.
- **WP3 docs:** a docs page plus the deep tier ("which model answered and why glass does not
  route"); screenshot from a real session.
- **WP4 release:** extract, glass PRs on both targets, release, CI green.

### G7 progress (branches `glass-g7-routing-view` in coding, `glass-g7-call-facts` in rapid-llm-proxy)

| WP | Result |
|---|---|
| WP1 | What the rows already had (live `~/.glass` DB, 2026-10-11): `model` and `provider` on every row, through `/api/token-usage/recent` (`SELECT *`). Missing: where a call went and whether it was the agent's loop. Two additive columns in `token_usage` (proxy 72ffad0), written only by the measuring passthroughs (`''` elsewhere — routed calls, file adapters, legacy rows): `upstream` = host[:port] the call was forwarded to (`sanitizeUpstream`: never a path, query or credentials); `call_kind` = `main` (tools sent) / `subagent` (claude's toolset without a spawner tool) / `side` (no tools). Not in the hour exports — like agent / task / project. Tests: proxy golden re-recorded (the two fields only) + a subagent and a side scenario, passthrough unit tests (tools → main, toolless → side, a Responses request with only `web_search` → main, host only), proxy suite 504/504 + vitest 35; glass daemon test per capture path (claude base URL, copilot + pi intercepted, opencode relay) — generated tree 58/58 on Node 25.8 (no 22.13 here; CI has it) |

| WP2 | Daemon reads `GET /api/experiments/runs/<id>/models` (groups by model × provider × upstream × call_kind + the newest 200 calls) and `GET /api/calls/unbound` (`lib/glass/ui-api.mjs`). glass-ui `models.tsx`: a Models card under a selected session (headline: calls, models, side-call share of tokens; kind badges main / subagent / side / not recorded; per-call list in a `<details>`) and an unbound-calls note on the Sessions page. `anthropic` labelled "Anthropic (own login)" — the dashboard alias maps it to Claude Max, which is coding's account, not glass's. Coding's `token-usage.tsx`: settings dialog, Routing and Cost tabs lazy-loaded → glass main chunk 471 → 352 KB (140 → 107 KB gzip) including the new card; the three are separate chunks glass never fetches (checked in the browser's resource list). Tests: daemon test for both reads, tree 59/59; real `glass claude` + `glass copilot` runs on the generated tree against a copy of `~/.glass` (copilot row = copilot's own "↑ 31.3k (31.3k written) ↓ 4"; claude relayed through coding's proxy → `127.0.0.1:12435`, `claude-code-max`); gsd-browser: card + unbound note render, pre-G7 rows show "not recorded" / "—" |

Findings during WP1:
- **Two names for one account family**: glass's own host map says `github-copilot`, coding's proxy (relayed, `x-llm-provider`) says `gh-copilot`; claude direct is `anthropic`, claude relayed through coding's proxy `claude-code-max`. Both are true — the second names the proxy's account. The view shows provider together with `upstream`, so a relay is visible as one; no renaming.
- **Unbound rows**: 5 intercepted calls on 2026-10-10 recorded with agent `unknown` and no task (no Proxy-Authorization and not exactly one live intercepting session — the rule from G3). The view must show them as "not bound to a session", not drop them.
- The anthropic wire writes `per-turn`, the OpenAI wire `per-llm-call` — the tier follows the wire, not the call; the view must not read it as main vs side (that is `call_kind`).

## Data flow per agent — coding vs glass (2026-10-12, read from the code)

**One rule does not hold across both:** coding's proxy *routes* (it decides where a call goes and
answers it with accounts of its own); glass only *measures* (it forwards every call, unchanged, to
the host the agent chose, with the agent's own login). Measurement happens on **both wires** in
both: OpenAI-wire calls in the OpenAI tap, Anthropic-wire calls (`/v1/messages`) in the Anthropic tap.

### coding (rapid-llm-proxy :12435) — `lib/agents/proxy-routing.mjs`

| Agent | How it reaches the proxy (configuration) | Wire | Proxy then | Demotable to Qwen? |
|---|---|---|---|---|
| claude | `ANTHROPIC_BASE_URL` → `/v1/messages` passthrough | Anthropic | measures, forwards to Anthropic with the Max OAuth login | **no** — the passthrough refuses a provider without `fg_transport` |
| opencode | `OPENCODE_CONFIG_CONTENT`: `github-copilot` → `/v1/opencode` shim, `rapid-proxy` → `/v1`; its `anthropic` provider via `ANTHROPIC_BASE_URL` | OpenAI (+ Anthropic) | routes (`fg-chat/opencode`), answers with **OpenCode's `auth.json` login read by the proxy** | yes (small band) |
| copilot | BYOK `COPILOT_PROVIDER_BASE_URL=/v1/copilot[/p/..][/b/..][/t/..]` (opt-out `COPILOT_AMBIENT_ROUTE=0` → direct to GitHub, adapter only) | OpenAI | routes (`fg-chat/copilot`), answers with the same borrowed OpenCode login | yes (small band) |
| pi | `models.json` provider `rapid-proxy-pi` → `/v1` (default provider pinned) | OpenAI | routes (`fg-chat/pi`) | yes (small band) |

So in coding **three of four** are demotable, not only opencode. In practice little moves (step 2):
only `small`-band calls are offloaded — a prompt's first turn (if the classifier lowers it) and side
calls; loop turns are `high`/`medium` and turns carrying tool results are never classified. And today
nothing moves at all: `qwen-local` is unreachable, so every chain falls back to gh-copilot.

### glass (daemon :12445) — `glass/overlay/lib/glass/wiring.mjs`

| Agent | How it reaches the daemon | Wire | Daemon then | Offload (G8, not built) |
|---|---|---|---|---|
| claude | `ANTHROPIC_BASE_URL` (configuration) | Anthropic | measures, forwards to api.anthropic.com (or your prior base URL) with **claude's own login** | later — needs Anthropic→OpenAI translation |
| opencode | `github-copilot` + plain-HTTP providers → `/relay` (configuration, since 0.1.22; copilot relay also under `--no-intercept`); other HTTPS model hosts → interception | OpenAI (+ Anthropic) | measures, forwards to the host the provider names with **opencode's own login** | **yes — the relay is the hook point** |
| copilot | `HTTPS_PROXY` → interception (TLS, glass CA) | Anthropic for claude models (`copilot-api…/v1/messages`), OpenAI for others | measures, forwards to `copilot-api.<tenant>` with **copilot's own login** | no — substituting on an intercepted connection needs IT sign-off; BYOK would need an account of glass's own |
| pi | `HTTPS_PROXY` → interception | per provider | measures, forwards with **pi's own login** | no — pi's copilot login cannot be pointed at a relay by configuration (spike item 2) |

Why "only opencode" is a **glass** constraint, not a coding one: glass offloads only where a call
reaches it by configuration *and* carries the agent's own login — then the fallback is simply the
forward glass already does. coding has no such constraint because it answers every routed call
itself with the borrowed OpenCode login; glass never borrows a login (decision 9, G3).

## G8 plan — opt-in local offload (not started)

**Premise change (user, 2026-10-11):** at BMW glass will run next to a local mini-cluster of
Qwen3.8-27B. That gives offload a target, which was the main argument against routing in G7.
Routing stays **off by default**; an install option (and `glass config`) turns it on.

What changes against G7's reasoning, and what does not:

| G7 objection | With the cluster |
|---|---|
| no offload target | gone — the cluster is the target (BMW target; public: any OpenAI-compatible endpoint the user names) |
| decision 9 (glass only measures) | holds for the default; the option is an explicit user choice to let glass answer some calls |
| copilot = substituting answers on an intercepted connection | **still out** until IT security says yes to that specifically; the G0 sign-off covers measuring |
| size (~10k lines + yaml + SDKs) | acceptable as an optional part; the base tree must stay closed and unchanged without it |

Scope sketch (to be checked in a spike first):
- **Which calls**: claude through its base URL (Anthropic wire → translation to the cluster, as
  coding's proxy does); opencode / pi on the OpenAI wire (relay or intercepted chat — format-native
  to the cluster, the easiest case). Copilot: measured only (row above).
- **Pieces from the proxy**: `routing-config`, `prompt-classifier` + `classifier-client` (judging
  on the cluster itself, `CLASSIFIER_BASE_URL`), `egress-decision`, the OpenAI-compatible provider,
  the routing trail columns (rows then carry `route_key` / `route_band` / `attempt_trail`, so the
  Routing tab — already a lazy chunk since G7 — works unchanged). Not `worker-pool`, keychain, or
  the subscription providers: glass never answers with an account of its own.
- **Gates from coding's experience**: offload only when the cluster is reachable and healthy;
  a timeout falls back to the agent's own provider (coding saw 30 s timeouts and 92 s averages on a
  wedged llama.cpp — an offload must never be slower than not offloading); tool-call fidelity of
  Qwen on the agent's toolset is a measured gate per agent, not assumed.
- **Extractor**: an optional selection in `glass/manifest.yaml` (a second closure; `verify` proves
  the base closure does not reach it) and an install switch; the release ships both.
- **Config**: cluster URL / key in `~/.glass` config, never in the repo; the BMW target may carry a
  default URL, the public one none.

- **Status line (only with the option on)**: coding's `[D:n]` (prompts the classifier
  downgraded) and `[L:n]` (calls the local cluster actually answered — a timed-out offload
  that fell back does not count); both hidden at 0, never colouring the line. glass's `net`
  popup gains coding's "Where a turn goes right now" section (route + fallback chain per
  agent, cluster reachable or not). Not `[P:n]` — that is coding's unpushed learning repos,
  a feature glass does not have. With the option off, the line and popup stay as today.

Open: the cluster's URL and auth at BMW; whether its tool calling holds up on each agent's loop.

### G8 spike, step 1 — what coding's proxy already does (2026-10-11, read from rapid-llm-proxy 0afc4d5)

The "local Qwen" is the **on-prem cluster** `qwen-local` (V100, nodes 2+3, `QWEN_LOCAL_API_BASE_URL`,
default `http://10.143.242.184:8000/v1`, key `QWEN_LOCAL_API_KEY` in coding's `.env`; reachable on
VPN only). Three models map onto the bands: small → `qwen3.8-27b-dual-fast`, medium →
`dual-normal` (a reasoning model), high → `dual-deep`. `qwen-laptop` (llama.cpp on 8081) is the
off-VPN stand-in and is switched off.

How a call is demoted — no new mechanism needed, all of it is in `config/llm-routing.yaml` +
`proxy-bridge/routing-config.mjs` + `server.mjs`:

1. **Route**: `fg-chat/<agent>` is a `from-caller` route; the band comes from the caller
   (`complexity` field, `x-complexity`, `reasoning_effort`, or the `/b/<band>` path segment).
2. **Classifier** (`classifier: enabled, impl: service`, judge = `scripts/prompt-classifier-service.mjs`
   on :12437, 6 s budget): only for caller-declared bands, DOWNGRADE-ONLY, after a free structural
   gate (a turn carrying tool results is never classified) and a veto (code, paths, multi-step,
   length). A lowered band is attributed `complexitySource: classifier` — this is the `[D:n]` count.
3. **Offload** (`semantic_routing`): if the resolved band is in the target's `offload_bands`, the
   network matches `require_network: corporate`, the target is `enabled` and the route is not
   `offload: false`, the provider becomes `qwen-local` (model by band) and the route's own provider
   is inserted as the FIRST fallback. Today `qwen-local` takes `small` for fg+bg only (medium was
   removed: dual-normal reasons first, 28 s avg vs copilot's 3.3 s). Timeout 60 s (medium 150 s); the
   endpoint is re-probed every 60 s and dropped from every chain while unreachable.

Live check (Open network): `/api/llm/routing/resolve?job=fg-chat/opencode&complexity=small&classified=true`
→ `network=public`: gh-copilot/claude-haiku-4.5, "no offload target for network=public";
`network=corporate`: qwen-local/qwen3.8-27b-dual-fast, `offloadedFrom: gh-copilot`, gh-copilot second.

Which agents can be demoted:

| Agent | Path into the router in coding | In glass today | Offloadable |
|---|---|---|---|
| claude | `/v1/messages` Anthropic passthrough | base-URL forward (measure) | **no** — the passthrough 501s for a provider without `fg_transport`; routing-config refuses it |
| opencode | shim `/v1/opencode[/t/<task>]/chat/completions` (its `github-copilot` provider's baseURL) | openai-passthrough relay (measure) | yes — OpenAI wire, native to the cluster |
| copilot | **BYOK**: `COPILOT_PROVIDER_BASE_URL=/v1/copilot[/p/..][/b/<band>][/t/..]`, type openai | TLS intercept (measure) | yes — and via BYOK the CLI talks to the proxy by configuration, so nothing is substituted on an intercepted connection (the G0/IT objection was about the intercept) |
| pi | shim, `from-caller` | intercept | yes |

Consequence for glass: offload means opencode and copilot leave the measuring passthroughs for the
routed shim paths. The open cost is the FALLBACK: when the router keeps a call (non-small band,
cluster down, timeout), the proxy itself must answer with the agent's own account — for copilot BYOK
that is the `copilot-provider` with the user's GitHub token, i.e. exactly the subscription-provider
code G3 cut out. That is the main design question for G8, more than the classifier. *(Superseded — see "G8 design" below: true of coding's shims, not of glass.)*

### G8 spike, step 2 result (VPN run 2026-10-11 ~18:00 local) — the cluster was not reachable

- Proxy on VPN: `Network mode from coordinator: corporate`, then `qwen-local: unreachable at
  http://10.143.242.184:8000/v1 (fetch failed)`; the classifier service warm-up got HTTP 502. The last
  call qwen-local answered is 2026-09-13 (1,783 calls in total); the last `reachable` verdict is just as old.
  The address or the deployment moved again (it already moved node 1 → nodes 2+3 on 2026-09-07). Needed: the current URL.
- The decision path itself worked: small-band calls on both agents carry `offloaded_from: gh-copilot`,
  with the trail `qwen-local: not reachable` → gh-copilot/claude-haiku-4.5 in ~1.0–1.5 s. Because the
  probe had already dropped the endpoint, there was no 60 s timeout penalty.
- Classifier downgrades seen: opencode `classified high -> small` on the first turn, copilot one turn `classifier` → small.
- How much would move even with the cluster up: opencode's loop turns send no band → `defaults.fg-chat` = high
  (claude-opus-5), and turns carrying tool results are never classified. Copilot declares `medium` on its loop
  turns (claude-sonnet-5) and `small` only on its ~640-token side calls. So per prompt, at most the
  first turn plus side calls offload — tool-call fidelity on Qwen was not exercised at all.
- pi: all five prompts answered (session in ui-template/.observations/pi-sessions), but on pi's OWN
  `github-copilot` login, claude-sonnet-5.5 — the router never saw it. Cause: coding wrote
  `enabledModels: ["claude-sonnet-5", …]`; pi resolves that before `defaultProvider`, the bare id matched
  both rapid-proxy-pi and github-copilot, and pi's partial fallback chose github-copilot/claude-sonnet-5.5.
  Fixed in coding (provider-qualified ids). Matters for glass G8: any agent with its own login can
  silently leave the routed path, so the spike must assert the provider on every row.

### G8 spike, step 2b — office LAN probe (2026-10-12 ~09:45 local)

On the BMW office LAN (router 10.143.251.254 — no VPN needed for the 10.143.x range; the proxy reports
`network=corporate` and resolves small → qwen-local/dual-fast as designed):
- `10.143.242.184` (nodes 2+3, the configured `QWEN_LOCAL_API_BASE_URL`): host up (ping 6 ms, ssh 22 open),
  **nothing listening on 8000** (nor 8001/8002/8080/8443) — the proxy's probe says `unreachable` correctly.
- `10.143.241.223` (node 1, the address before 2026-09-07): **8000 and 8080 open**, both answer
  `401 invalid API key` with coding's `QWEN_LOCAL_API_KEY` (43 chars) — the deployment moved back to node 1
  with a new key, or node 1 serves a different tenant.
- Blocker for step 2: the current base URL (which port on node 1, and its model ids) plus its key, from
  the cluster owners. With them: set both in coding's `.env`, restart `com.coding.llm-cli-proxy`, re-run
  the step-2 runbook — on the office LAN, so Claude Code can drive it directly (no VPN drop).

### G8 design — the fallback needs no account of glass's own (2026-10-12)

**Step 1 overstated the problem.** "The fallback must answer with the agent's own account, i.e. the
subscription-provider code G3 cut" is true of *coding*, not of glass. coding's shims receive a call
with a dummy key and answer from credentials the proxy reads itself — OpenCode's
`~/.local/share/opencode/auth.json` (`server.mjs` ~947–980, `Authorization: Bearer ${creds.token}`).
A shim that took the call over must also be able to finish it, so its fallback needs an account.

glass never takes the auth over. Every call reaches the daemon **carrying the agent's own
credentials**: claude's on the base-URL forward, copilot / opencode / pi's on the intercept, opencode's
plain-HTTP providers' on the relay. `openai-passthrough.mjs` and `anthropic-forward.mjs` already hold the
whole request (body + headers) before they forward it. So:

> **Fallback = what glass does today: forward the held request, unchanged, to the host the agent
> addressed, with the agent's own credentials.** No subscription provider, no keychain, no token
> exchange, no `auth.json` reader. Offload is the only new branch.

#### Shape

```
agent ──► daemon (forward | intercept | relay) ── buffer request ──► decide(call)
                                                                     ├─ forward ─► agent's host, agent's creds   (today)
                                                                     └─ offload ─► cluster, cluster key
                                                                                   └─ failed before first byte ─► forward
```

- `decide(call)` sits between buffering and forwarding in the two taps; inputs: agent, path, wire,
  model, band (caller-declared or classified, as in coding), tools present, cluster health. Off by
  default; with the option off it is never called and the tree is the G7 tree.
- **Offload**: rewrite base URL + model to the cluster, **strip the agent's credentials** (`Authorization`,
  `x-api-key`, cookies, `copilot-*`/`openai-*` org headers) and add the cluster key from `~/.glass` config.
  The user's GitHub / Anthropic token must never reach the cluster, and the cluster key never an upstream.
- **Fallback is only possible before the first byte reaches the agent.** Connect error, non-2xx, or no
  first token within the band's budget → forward the held original. After the first streamed byte the
  agent has a partial answer; an error is surfaced, not retried. Hence: the time-to-first-byte budget is
  the real gate (coding's 60 s / 150 s timeouts are far too long for glass — budget from the measured
  p95 of the call's own upstream, so an offload is never slower than not offloading), and the 60 s
  re-probe keeps a dead cluster out of `decide()` entirely (no per-call timeout penalty — step 2 showed this works).
- **Rows**: provider `qwen-local`, `offloaded_from` = the provider the agent addressed, `attempt_trail`
  with the fallback hop, so the Routing tab (G7) and the `[L:n]` count work unchanged.

#### Per agent

| Agent / path | Reaches glass by | Own creds on the call | Offload = substitution on an intercepted connection? | v1 |
|---|---|---|---|---|
| claude | `ANTHROPIC_BASE_URL` (configuration) | yes | no | **later** — needs Anthropic→OpenAI request + SSE translation, and no small calls to take: all 184 claude rows in `~/.glass` are opus |
| opencode, plain-HTTP providers | `/relay` via `OPENCODE_CONFIG_CONTENT` (configuration) | yes | no | **yes** — OpenAI wire, native to the cluster |
| opencode `github-copilot` | intercept | yes | **yes** → IT gate | move it to the relay by configuration (override its `baseURL`, as coding's shim does) — then no interception; spike item 1 |
| pi `github-copilot` | intercept | yes | **yes** → IT gate | same via pi's `models.json` provider `baseUrl` override; spike item 2 |
| copilot CLI | intercept (BYOK would hand glass a *static* key, not the user's) | yes, intercept only | **yes** → IT gate | **measure only** (unchanged). BYOK is the one path where the fallback *would* need an account of glass's own (option B token exchange = the cut code); not worth it: step 2 showed its loop turns are `medium` and only its ~600-token side calls are `small` (5 of ~70 copilot rows in `~/.glass`) |

So the IT-security question narrows from "may glass substitute answers on intercepted connections" to
nothing at all for v1: every offloaded call arrives by configuration the user's `glass` launch set.

#### What moves (and what does not)

From step 2: opencode's loop turns send no band → `defaults.fg-chat` = high; turns carrying tool results
are never classified. Offload therefore takes the **first turn of a prompt** (classified, often
`small`) and opencode's **hidden title call** (gpt-5-mini, ~530 tokens, seen in S8/G3) — not the loop.
That is the honest size of the win; tool-call fidelity on Qwen matters only once loop turns move, which
needs a band policy for tool-result turns that coding does not have either.

#### Pieces taken from the proxy

`routing-config`, `classifier-client` (+ classifier service optional — judge on the cluster itself),
`egress-decision` (network gate), `routing-trail`, the OpenAI-compatible provider call. **Not**
`providers/`, the `auth.json` reader, `worker-pool`, keychain — the G8 plan's "glass never answers with
an account of its own" now holds for the fallback too.

#### Spike items (no cluster needed for 1–2)

1. opencode `github-copilot` with `baseURL` → glass relay: does it send its session token there, and does
   `copilot-api.<tenant>` accept the forwarded call unchanged (enterprise host from `endpoints.api`)?
2. pi `github-copilot` the same via `models.json`.
3. With the cluster: first-turn + title-call offload on opencode, time-to-first-byte vs the copilot
   upstream, and the fallback before first byte (kill the cluster mid-run).

### G8 spike items 1–2 result (2026-10-12, office LAN, standalone relay in the session scratchpad)

A 60-line relay on 127.0.0.1 forwarding verbatim to `https://copilot-api.bmw.ghe.com` (via proxydetox),
logging header names and token shapes only.

1. **opencode 1.15.13 — works.** `OPENCODE_CONFIG_CONTENT={"provider":{"github-copilot":{"options":{"baseURL":"<relay>"}}}}`
   + `-m github-copilot/claude-haiku-4.5`: opencode sends its own login to the relay (`Authorization: Bearer`,
   40-char `gho_` OAuth token — no exchange, no copilot session token), plus `openai-intent`, `x-initiator`,
   `x-session-affinity`; copilot-api accepts both calls forwarded unchanged (200, usage in the stream):
   the hidden title call `gpt-5-mini` 537 in / 143 out (TTFB 1.6 s) and the turn `claude-haiku-4.5`,
   20 tools, 27,671 in / 6 out (TTFB 0.9 s). The one unauthenticated `GET /models` gets 403 and opencode
   carries on. → opencode's `github-copilot` can leave the intercept for a configured relay; offload and
   the fallback-by-forward both work there with no interception and no credential of glass's own.
   Note: the relay now handles the user's GitHub OAuth token directly — it must never log or capture
   `Authorization` (raw-body capture redaction covers `gho_` since caf93d27).
2. **pi 1.1.0 — does not work by configuration.** Its OAuth `github-copilot` provider derives the base URL
   from the credential on every request (`pi-ai/dist/auth/oauth/github-copilot.js` `toAuth()` →
   `copilot-api.<enterpriseUrl>`), which wins over `models.json`: a provider `baseUrl` and a
   `modelOverrides.<id>.baseUrl` are ignored (pi answered, the relay saw nothing); a replacement `models`
   entry with `baseUrl` still did not reach the relay and lost the copilot headers (`400 missing
   Editor-Version header`). Only a pi provider extension (`extension.oauth` wrapping the built-in
   `toAuth`, returning the relay URL) could move it. → **pi stays measure-only in v1** (intercept, as
   today); an extension is a later option if pi usage justifies it.

Revised v1 offload set: opencode only (relayed plain-HTTP providers + `github-copilot` moved to the relay).
claude later (translation), copilot and pi measure-only.

### G8 step 2 result — the five prompts with the cluster up (2026-10-12 09:18–09:23 UTC, office LAN)

Cluster moved to `http://10.143.242.222:8000/v1` (8 models: `qwen3.8-27b-{dual,hga}[-fast|-normal|-deep]`); the
proxy reads `QWEN_LOCAL_API_BASE_URL` from **rapid-llm-proxy/.env**, not coding's. Headless runs, each agent with
exactly coding's wiring (`proxy-routing.mjs pre-launch` + `route`), 15/15 exit 0.

What Qwen answered (all `offloaded_from gh-copilot`; the cluster reports `qwen3.8-27b-dual` for a `-dual-fast` request):
- opencode's **title calls** (caller `small`): 562 in / 10 out in 6.3 s; four more (20–27 in / 4–6 out) in **29–39 s**.
- pi prompt 1 (strawberry), first turn classified `medium -> small`: 2,231 in / 36 out in 13.4 s, correct ("3 r's").

What was offloaded and **fell back after a 60 s timeout** (`attempt_trail: qwen-local … error timeout, ms 60008`):
- opencode prompt 1 (classified `high -> small`, 27,569 in incl. tools) → gh-copilot/haiku, **62.4 s** total.
- copilot prompt 1 (classified `medium -> small`, 20,485 in) → gh-copilot/haiku, **61.4 s** total.

Everything else stayed paid, as step 2 predicted: opencode loop turns `high` (no band sent → defaults), copilot
and pi loop turns `medium` (caller). No turn carrying tool results was offloaded, so Qwen tool-call fidelity was
**still not exercised**.

Findings:
1. The decision logic works as designed (classifier, offload, fallback chain, trail).
2. **The fallback is too slow to be safe**: an offloaded first turn with a full agent context does not answer
   within 60 s, and the user waits the whole timeout before the paid answer — offload made those two prompts
   ~60× slower. Even tiny calls took 6–39 s on the cluster vs ~1 s on gh-copilot (contention with coding's
   background jobs, now also routed to Qwen, is the likely cause — not measured).
3. Consequence for glass G8: a time-to-first-byte budget of a few seconds (not 60 s) and a size gate
   (offload only below N input tokens — title/side calls) are prerequisites, not tuning.
4. Side observation (coding, not glass): copilot sessions also produce `provider copilot / claude-opus-5 /
   latency 0` rows from the events adapter next to the proxy rows — check for double counting.

### G8 step 2 rerun with the foreground gates (2026-10-12 11:37–11:39 UTC, rapid-llm-proxy PR #53)

Same five prompts, sandbox and wiring; qwen-local now has `foreground: {max_input_tokens: 3000, timeout_ms: 15000,
max_in_flight: 1}`. 15/15 exit 0, **1 m 49 s** for the whole run (first run ~5 min). **No timeouts, no fallbacks.**

- **First turns no longer reach the cluster:** opencode 28.3k (est. ~25.9k) and copilot 20.5k (est. ~19.2k) were
  classified `small` and kept on gh-copilot by the size gate — 1.7 s each, against 62.4 s / 61.4 s before.
- **Qwen answered two foreground calls:** one opencode title (566 in, 6.2 s) and pi's first turn (2,231 in, 9.5 s,
  correct "3"; 13.4 s in the first run).
- **The in-flight gate fired on 4 of 5 opencode title calls** — they went to gh-copilot in 0.6–0.9 s instead of
  queueing. The cluster was busy with BACKGROUND work the agent sessions themselves trigger: `bg-kb-relevance-judge`
  (1.2–2.3k in, 9.6–14.5 s, one per prompt) and `bg-observation-writer` (7–10 s). So the "~620 s busy per day"
  average understates load during an active session; the gate bites exactly then.
- Everything else stayed paid as before (opencode loop `high` by default; copilot / pi loop turns `medium`).
- Even when Qwen serves a foreground call it is slower than gh-copilot (6–10 s vs 0.6–2 s): offload trades latency
  for cost, it does not win on both.

### G8 cluster latency, measured directly (2026-10-12 ~09:40 UTC, no proxy, no other cluster traffic via the proxy)

Streaming chat calls to `10.143.242.222:8000/v1`, sequential unless noted:

| Case | Time to first byte = total | Notes |
|---|---|---|
| tiny (24 in / 4 out), `dual-fast` ×3 | 3.0 s, 1.9 s, 1.9 s | no reasoning, correct |
| tiny, `hga-fast` ×3 | 1.9 s each | same floor |
| tiny, `dual` ×3 | 4.2 s, 2.3 s, 2.3 s | **reasons first** (~70 chars) and hit `max_tokens 16` with no answer — the `-fast` variants are the no-thinking ones |
| ~2k in, `dual-fast` ×2 | **6.7 s**, then 1.95 s | second call hits the prefix cache |
| ~20k in, `dual-fast` ×2 | **38.8 s**, then 2.2 s | uncached prefill ≈ 540 tokens/s |
| 4 tiny calls in parallel, `dual-fast` | 12–18 s each, 17.8 s wall | concurrent requests queue badly (≈ 4–9× a single call) |

Causes of the step-2 timeouts:
1. **Uncached prefill, not contention.** An agent's first turn carries 20–28k tokens (system prompt + tools);
   uncached that is ~40–55 s of prefill alone, so the 60 s timeout is hit. The prefix cache makes a repeat ~2 s —
   but whether an agent's prompt is still cached (eviction, which of the two nodes answers) is not knowable from outside.
2. **Small calls queue behind big ones.** Concurrency degrades sharply; the 29–39 s title calls in step 2 overlapped
   the offloaded 20–28k first turns.
3. **No incremental streaming**: the first byte arrives when the answer is complete, so the planned
   "fall back before the first byte" budget is a total-time budget — and the agent sees nothing until then.
4. Floor ≈ 1.9 s per call (gh-copilot ≈ 1 s for the same calls).

Consequences for G8 (and for coding's own routing):
- **Size gate**: offload only calls below a few thousand input tokens (≈ ≤ 7 s uncached) — title/side calls,
  not agent first turns with a full tool context.
- **Short budget** (~8 s) instead of 60 s, and **at most one call in flight** to the cluster per client; when one
  is pending, route the next call to its paid provider instead of queueing it.
- Request the `-fast` variants only (already the case for `small`).

### G8 spike, step 2 — measure on VPN (runbook; Claude Code drops on VPN, so the user drives)

Uses coding's own install unchanged — no glass code yet. On VPN:
1. `curl -s localhost:12435/api/llm/routing/resolve?job=fg-chat/opencode\&complexity=small\&classified=true`
   → expect `qwen-local` first and `available: true` (if `false`, the probe has not seen the cluster yet; wait 60 s).
2. `coding --opencode`, then in one session: (a) "how many r's in strawberry", (b) "what is the capital
   of Portugal", (c) "list the files in this directory and tell me how many there are", (d) "read
   README.md and summarise it in one sentence", (e) "write a python function that checks if a number is prime".
3. Same five prompts in `coding --copilot`.
4. Back on Open: Claude reads the rows (`provider`, `model`, `route_band`, complexity source,
   `attempt_trail`, latency, and whether the tool calls in (c)/(d) completed on Qwen) and writes
   the result here. Expected: (a)(b) demoted to dual-fast; (c)(d) first call possibly demoted, the
   tool-result turns never classified; (e) vetoed as code → stays on the paid account.

## G8 build plan (2026-10-15) — runtime switch, all three OpenAI-wire agents, routing in glass's UI

**User decisions (2026-10-15):** (1) the cluster URL is per user, not shipped; (2) offload must cover **pi and
copilot too**, not only opencode — as in coding; (3) go; **no corporate knowledge in code** (the public target is on
github.com and coding itself is public); switching happens **at runtime in the UI**, in a routing panel taken from
coding's LLM Routing dialog (only what makes sense in glass); the Flow graph's cluster node should be a way to switch.

### What changes against the G8 design

- **pi and copilot offload on the intercept, not by configuration.** Both already reach glass through the TLS
  intercept carrying the user's own login, and every one of their chat calls lands in `handleOpenAIPassthrough`
  with the body fully buffered. So the one offload branch in `openai-passthrough.mjs` serves opencode (relay),
  pi and copilot (intercept) alike, and the fallback stays "forward the held original with the agent's own
  credentials". coding's way (BYOK / `rapid-proxy-pi` → proxy answers with OpenCode's `auth.json` token) is NOT
  taken: it needs the subscription code G3 cut, and a copilot-only user has no `auth.json`. pi's extension seam
  (`registerProvider('github-copilot', {oauth})`) stays unneeded.
  - This IS answering on an intercepted connection — the IT-security point from G0. It is an explicit, per-agent,
    default-off user choice in the UI, and the panel says so. claude: not offloaded (Anthropic wire; coding refuses
    it too).
- **No routing yaml, no `routing-config.mjs`.** coding's router is 1.5k lines of route tables for 39 routes glass
  does not have, and its yaml is where the cluster's corporate details live. glass gets a small `offload.mjs`
  (rapid-llm-proxy, shipped to glass): `decide()` + target call + fallback, plus `classifier-client.mjs` and
  `routing-trail.mjs` as they are.
- **Config is glass's own file**, `~/.glass/offload.json` (0600): `enabled`, per-agent switches, `target {name,
  url, models{small,medium,high}}`, `bands`, `classifier`, gates. The key is in `~/.glass/offload.key` (0600), never
  returned by any endpoint. Nothing about any cluster is in code: no default URL, no model ids, no node history —
  the user types the URL; the model list comes from the target's `/v1/models`; the target's display name is what the
  user calls it (default "local cluster").

### Decision per call (`decide()`)

Inputs: agent, wire, requested model, body (tools / tool results / size), config, target health. In order — the
first that fails keeps the call on its own provider (`forward`), and the reason is recorded:
1. offload on, this agent switched on, target configured and **reachable** (probe every 60 s; unreachable = out of
   every decision, no per-call timeout).
2. not a tool-result turn (as coding).
3. band: the caller's (`reasoning_effort` / model tier: mini / haiku / flash = small, sonnet / gpt-5 = medium,
   opus = high), lowered by the classifier when it is on (downgrade-only, coding's rubric, judged on the target
   itself) → `[D:n]`.
4. band in `bands` (default `small` only).
5. size gate: estimated input ≤ `maxInputTokens` (default 3000 — measured: ≈7 s uncached prefill).
6. in-flight gate: at most `maxInFlight` (1) calls on the target; a second goes to its own provider, never queues.
Offload: model by band, agent credentials and org headers stripped, target key added, budget `timeoutMs` (8 s).
Error / non-2xx / timeout before the first byte → forward the held original. Rows: provider = the target name,
`offloaded_from`, `route_band`, `complexity_source`, `attempt_trail` → `[L:n]` counts only target-answered rows.

### UI — one "Routing" panel, the switch where the user looks

coding's dialog is built for 39 routes, eight providers and per-route provider selects; glass has four agents,
the agent's own account, and one optional target. Extract only:
- **Token Usage → settings (gear), "Routing" panel**: master switch "Offload easy calls"; target card (name, URL,
  key set / not, reachability + latency, "Test"); bands (small / medium / high, model per band from the target's
  list); per agent switch (opencode / pi / copilot; claude shown disabled with the reason); classifier switch;
  gates (max input tokens, timeout) under "Advanced". Plain sentences, no yaml paths, no route keys.
- **Not taken**: per-route provider/complexity tables, background routes, fallback chains tab, provider chips
  (glass never picks a paid provider), network-scoped targets (the reachability probe is the gate; a URL that only
  resolves on the office network is simply unreachable elsewhere).
- **Models → Flow**: the target appears as an account node (dashed when off/unreachable). **Clicking it opens a
  small popover** (status, last 24 h calls, the switch, "Settings…") — not a toggle on click: a canvas click is easy
  to misfire and a silent behaviour change is the worst outcome. Agents that are switched on get a decision column
  ("easy → target, else → own account") between agent and model.
- Writes: `PATCH /api/offload` on the daemon (127.0.0.1 only, requires `content-type: application/json` + an
  `x-glass-ui` header so a web page cannot fire it cross-origin); `GET /api/offload` (config minus key, + health);
  `PUT /api/offload/key`; `POST /api/offload/test`. Takes effect on the next call — no restart, no relaunch.
- **Status line**, only with offload on: `[D:n]` `[L:n]` per session from the token DB; `net` popup gains
  "where a turn goes now" per agent. Off = unchanged.

### No corporate knowledge — enforced, not promised

- Public deny list gains: `qwen`, `V100`, `on-prem`, `\b10/8\b`, `nodes? [0-9]\+`, `a2a-xpr`, `nl-realm`, and the
  scan covers `ui/` (the bundle) too. Existing hits fixed at the source, not rewritten: coding's
  `providers.ts` labels ("On-prem Qwen") come from data, `repo-router.mjs`'s example names become neutral.
- Tests use `http://cluster.example:8000/v1` and model ids `m-small` / `m-medium`.

### Work packages

| WP | Content | Accept |
|---|---|---|
| 1 | rapid-llm-proxy `offload.mjs` + branch in `openai-passthrough.mjs` (decide, target call incl. SSE, fallback before first byte, row fields); unit tests with a fake target (offload, each gate, timeout → fallback, credentials never reach the target) | proxy tests green |
| 2 | daemon: config + key store, health probe, `/api/offload*` endpoints, hot apply; manifest selects the new modules | glass tests green, closure verified |
| 3 | UI Routing panel + Flow node popover + decision column (glass-ui) | gsd-browser: switch on/off, test target, Flow popover |
| 4 | status line `[D:n]` `[L:n]` + net popup section | statusline tests; tmux check |
| 5 | deny list + source fixes + docs (Routing page, privacy: "what leaves your machine when offload is on") | public extract deny-clean incl. ui/ |
| 6 | live run on the cluster: opencode, pi, copilot — five prompts each, assert provider per row, kill target mid-run | rows show target / fallback as designed |

## Session log

- **2026-10-17 (0.1.34 — a tool loop stays where its turn started; .gitignore)** — 0.1.33 published on both targets. rapid-llm-proxy #59 merged (`fix/sticky-turn-band`): a call inside an agentic turn's tool loop inherits the band of the turn's first call instead of falling back to the provider at the first tool result; new `proxy-bridge/turn-band.mjs` added to the manifest (offload.mjs imports it). Public rapid-llm-proxy exported (fcb51ce → fwornle @ 7f1d4f0, 519/519 on the exported tree). New overlay `.gitignore`: node_modules/, results/, .coding/, *.code-workspace and the per-machine .github/copilot-instructions.md showed as untracked in every glass checkout. Verified: both extracts closed and smoke-ok.
- **2026-10-17 (0.1.33 — header links the docs; deck keys)** — 0.1.32 published on both targets. The UI header's "glass" links the online overview presentation (package.json `homepage`, public rewrite → fwornle.github.io; daemon `/health` `docs`). Docs deck: arrow keys work wherever focus is (except typing in a field), Esc goes to the docs home. Verified: both extracts deny-clean, glass 72/72 on each tree, gsd-browser on the scratch daemon (link href/target) and on the deck (arrows from body and header, search ignored, Esc → home).
- **2026-10-16 (0.1.32 — WSL clicks open the browser; Haiku 5.5)** — 0.1.31 published on both targets. WSL: a status-line click tries $BROWSER, wslview, cmd.exe start (also by absolute path, cwd /mnt/c) and, with no opener, shows a tmux message instead of its command line — a click always exits 0. Docs: WSL must use its own Node (Windows npm on the PATH installs a Windows glass). Haiku 5.5 replaces 4.5 as the small / fast model (rapid-llm-proxy #58 merged; `haiku` alias → 5.5, dotted for Copilot, hyphenated for Anthropic); doc examples use `github-copilot/claude-haiku-5.5`.
- **2026-10-15 (0.1.31 — the Flow shows offload before it is set up)** — 0.1.30 published on both targets (public #23, BMW #46; v0.1.30 releases with the tarball). On a glass with no endpoint configured the Flow showed nothing of offload, which read as "the cluster is lost": a dashed "Your endpoint — not set up" account node now stands where its traffic would show and opens the settings on click; a node without tokens shows no 0 total. Docs: offload page names the node.
- **2026-10-15 (0.1.30 — G8 offload released as opt-in)** — Models → Flow: the endpoint's node, while selected (its card open), gets a faint wash of the offloaded green over its border (dashed still = off / no calls), so it is clear which node the card belongs to; verified with gsd-browser on the scratch daemon, on and off. The card's switch no longer falls back to the settings dialog when the write fails (it did so silently — seen against a stopped daemon): the error shows in the card ("glass is not running — `glass ui` starts it" for an unreachable daemon), and with no agent chosen the button reads "Choose agents…" and opens the settings on purpose. Version 0.1.30; coding G8 commits pushed; rapid-llm-proxy `feat/glass-offload` pushed as a PR — merge it before publishing, since the extract reads the proxy checkout. WP6 (live run on the team's endpoint, office LAN) still open.
- **2026-10-15 (G8 WP1–WP5 — opt-in offload, switched in the UI)** — rapid-llm-proxy `feat/glass-offload` (6cc2b28 offload.mjs + passthrough branch, 9bec0cd neutral comments / turn-identity NUL), on top of #56. coding d4897380 (daemon store, health, `/api/offload`), 9f7d72f3 (UI: header pill, Token Usage → Settings, Flow node card), 9d9aec48 (`[D:n]` `[L:n]`, net report), f0573ff1 (public deny list + source fixes, offload docs). Verified: proxy 535/535 node tests (+8 offload), glass 72/72 on the extracted tree, public extract deny-clean incl. ui/, gsd-browser end to end against stub provider + stub endpoint (configure → test → save → calls offloaded / kept with reason → switch off from the Flow card), tmux render of `[L:2]`. Deviation from the plan: pi and copilot offload on the intercept (answering on an intercepted connection — per agent, off by default). Open: WP6 live run on the cluster (URL + key on the office LAN), version bump + release, proxy PR.
- **2026-10-14 (0.1.29 — the network heal on Linux / WSL / Windows, not only macOS)** — Audit of every network step by platform (coding: macOS, Linux, WSL 2; glass: also native Windows). macOS-only and broken elsewhere: (1) the coordinator's proxydetox restart was a hard-coded `launchctl` line → `lib/network/proxydetox-restart.mjs`: launchd on macOS, the `.deb`'s `proxydetox.service` systemd user unit on Linux / WSL, anything else on :3128 left alone (`unmanaged`). (2) The LLM-proxy wedge restart (`health-remediation-actions.js`) was `launchctl`-only → daemons.mjs `restart()` off macOS. (3) The launcher never healed :3128 off macOS and, giving up, unset EVERY proxy variable — a Linux user's own proxy too → systemd restart, and only its own :3128 pin is dropped. (4) Network-change events: Linux / WSL `ip -o monitor address route`, container interfaces (veth, docker, br-, cni, virbr) ignored; Windows polls. (5) WSL's VPN signal is the Windows host's `vpncli.exe` via interop. (6) Kerberos request stays macOS-only by design (Linux/WSL: `K:NO` → `kinit`; Windows renews at logon). Also: the change watcher now runs under an sh parent guard — 11 orphaned `notifyutil -w` had piled up under launchd, one per parent exit that skipped stop() (glass's daemon test leaked one per run). rapid-llm-proxy (PR #56): the claude OAuth token is read from `~/.claude/.credentials.json` off macOS, so the direct-API fast path works on Linux / WSL. Docs: "By platform" table in Connectivity & Recovery; deck, guides, glass docs and six diagrams platform-neutral; 9 unreferenced network diagram sources deleted. undici `^8` → `^7.30`: every undici 8 requires Node ≥ 22.19 and 8.12 (2026-10-14) calls `zlib.createZstdDecompress`, which 22.13 lacks — the 22.13.0 CI legs crashed on import; undici 7 has `fetch`, `EnvHttpProxyAgent` and `ProxyAgent`, all glass uses, and supports Node ≥ 20.18.1, so the documented minimum stays 22.13.
- **2026-10-14 (0.1.28 — the VPN outage was the Kerberos ticket, not proxydetox)** — On VPN at 05:27:52 UTC every tunnel through :3128 was refused until 05:30:12, when macOS's Kerberos SSO extension issued a TGT (the overnight one had expired off-corp); `coding --claude` showed "502 proxy forward failed after 3 attempts" throughout, the status line `K:NO`. Three proxydetox restarts in between changed nothing; :3128 forwarded at the first probe after the ticket landed. Same shape on 10-13 (restarts 16:23:22/:27/:34 killing each other: `kickstart -k` outlived its 5 s exec timeout, the failure count stayed over threshold, the next 5 s poll kicked again). Fixes: (1) `requestKerberosTicket()` — `app-sso -a REALM -R -q`, fire-and-forget, ≤ every 2 min, on CN/VPN with `klist -s` failing; measured 11.7 s to a fresh TGT, no dialog with a keychain password. glass's network monitor calls it too. (2) heal rule 3a `no-ticket` — no proxydetox restart on CN/VPN without a ticket. (3) rule 1b `restarting` — 45 s cooldown after a dispatched restart, ahead of the dead-port rule; a timed-out kickstart logs "still landing", not ERROR. (4) launcher defers on `network-change`/`restarting`/`no-ticket` and waits up to 20 s for a restart in progress instead of bootout. (5) `K:NO` now logged on arrival on CN/VPN, not only on change.
- **2026-10-13 (0.1.27 — CN / VPN egress: one root cause, four fixes)** — Evidence from three sessions (glass opencode, plain claude, coding --claude) + a 30 s probe recorder + the coordinator log: every agent egress funnels through proxydetox :3128, and proxydetox does not recover from a network-class change on its own. VPN up 16:22:12 UTC → :3128 refused every tunnel while proxy.muc with the same Kerberos ticket answered at 16:22:58; forwarding again 16:24:01, right after the coordinator's 16:23:22 restart (held back ~70 s by the network-change window + 6-probe threshold); leaving VPN 16:28:09 → dead until the 16:29:21 restart. coding's LLM proxy stayed direct meanwhile (4 s probe of :3128 failed) → claude API errors until 16:25:14; glass's held opencode call waited out 2 × ~40 s attempts. Morning CN 09:30–13:48: every tunnel 502, while the coordinator's captive.apple.com probe through :3128 passed 760× (P:AUTO during a 4 h outage); the Kerberos TGT was only issued 13:39 (likely cause, not proven). Fixes: (1) heal rule 3b — restart proxydetox once as soon as an open ↔ corporate/VPN change is settled and :3128 does not forward (`class_change_heal_due`); (2) P = a bare CONNECT to api.github.com:443 through :3128 (`PROXY_PROBE_HOST`, launcher too), not captive.apple.com; (3) `kerberos_ticket` (klist -s) → `K:NO` on CN/VPN in both status lines + glass net popup; (5) glass egress names a refused tunnel (proxy, host, status, klist hint) instead of "fetch failed" and does not ask the same proxy again for 10 s, so the forward's retries fail at once; last refusal in the net popup. Also corrected comments that read N:CN as China (GFW).
- **2026-10-13 (0.1.26 — Claude login kind, no-session label, on-prem wording, live status-line shot)** — user asked why "Anthropic (own login)" and "unknown" appear. (1) The 8 `anthropic` rows (2026-10-10 06:49) are the Max subscription: the base-URL forward hard-coded `provider: 'anthropic'` for every claude call, before 0.1.10 also behind coding's proxy. Now the daemon records the login KIND from which header carries it (x-api-key → `anthropic-api`, bearer → `anthropic`), never the credential; the UI shows `anthropic` / `claude-code` / `claude-code-max` as one "Claude subscription" account. (2) The 5 `unknown` rows (2026-10-10 11:27) are a copilot run that outlived the 0.1.5 → 0.1.6 daemon upgrade (all sessions closed 10:43:43Z): its credential was unknown to the new daemon, which never guesses — the UI now says "no session". (3) Offload slide/docs say on-prem Qwen cluster. (4) `terminal-statusline-tmux.png` is a real Terminal.app capture (title bar cropped) of `glass claude` after three prompts on a throwaway demo project, with the ctx popup opened via `glass click g:ctx` — the current terminal-coloured bar, not the old green one.
- **2026-10-13 (0.1.25 — Models flow, ten-slide overview)** — glass Models tab gains a Flow card (agent → model → answering account, tokens as thickness, side calls dashed; no decision column — glass does not route), screenshot with the tenant host masked. Overview: slide 7 shows the flow, new slide 8 "Small calls to the local Qwen cluster" marked planned (G8, opt-in, off by default — glass still does not offload), new slide 10 "Extracted, not rewritten" (`glass-composition.puml`: 11.9k lines from coding incl. 3.9k vendored js-yaml, 5.4k from the proxy, 2.3k glass-only ≈ 12%). Models deep tier: reading the flow + the planned offload. coding's Flow (Token Usage → Routing) underlays the parts glass also carries (`src/lib/glass-scope.ts`: fg-chat/<agent> callers, claude-code-max + gh-copilot).
- **2026-10-12 (0.1.24 — copilot BYOK not recounted)** — the shared copilot token adapter subtracts BYOK calls (`session.usage_record.isByok`) from the session aggregate, because in coding BYOK is the proxy and those calls are already rows (8 duplicate rows from the two five-prompt runs, deleted). glass passes `byokMetered: false`: a BYOK provider there is the user's own, so its calls stay counted under --no-intercept. Also in this release: rapid-llm-proxy #53/#54 (foreground offload limits; glass does not route, so no behaviour change).
- **2026-10-12 (0.1.23 — copilot relay under --no-intercept; data-flow overview)** — `glass opencode --no-intercept` keeps relaying `github-copilot` (no HTTPS_PROXY, no CA); the opencode file adapter is skipped for such a session (`skipped (github-copilot relayed)`) since github-copilot is the only provider it imports — no double count (live: 2 rows, once each). Added "Data flow per agent — coding vs glass": coding routes 3 of 4 (claude never), glass measures all 4 and can offload only opencode.
- **2026-10-12 (0.1.22 — opencode github-copilot relayed)** — `glass opencode` relays `github-copilot` to its Copilot API host (`copilot-api.<tenant>` from opencode auth.json `enterpriseUrl`, else api.githubcopilot.com; tokens never read) via `OPENCODE_CONFIG_CONTENT` baseURL, so opencode sends its own login by configuration and these calls need no interception. Daemon `relaysOf` accepts https only for Copilot API hosts. Live: rows for the turn + hidden title call; with glass interception bypassed (wrapper pointing HTTPS_PROXY at proxydetox) the calls were still recorded — relay path proven. Extracted tree 62/62. Open: `--no-intercept` still disables all opencode relays. This is G8's offload hook point for opencode.
- **2026-10-12 (0.1.21 — `glass update` network hint)** — `glass update` answered a 502 from bmw.ghe.com with "logged in? gh auth login", and the login attempt then failed the same way. Cause was proxydetox (:3128) wedged since the previous evening's VPN run across two network switches (corporate upstream, Kerberos and the gh login were all fine); `launchctl kickstart -k gui/$UID/cc.colorto.proxydetox` fixed it. `viewFailureHint()` in update.mjs now names a network/proxy problem (gateway 502/503/504, DNS, refused/timed-out, TLS, proxyconnect; quotes HTTPS_PROXY) and keeps the login hint for everything else. Test hosts are `ghe.example.com` — the public deny scan rejects bmw/AIMAAD strings in shipped tests.
- **2026-10-12 (0.1.20 — pi stays on the proxy, GitGuardian)** — GitGuardian flagged fwornle/glass 3bb14f7 (2026-10-10): the "apikey" was the SHA-256 of `lib/lsl/token/claude-token-rows.mjs` in EXTRACTED.json (all 135 entries = sha256 of the file; no real key in the commit — the three `apiKey` hits in proxy-routing.mjs are the local-proxy placeholder). Added `glass/overlay/.gitguardian.yaml` (v2, `secret.ignored_paths: [EXTRACTED.json]`, bb7ae330), published as fwornle #10 / AIMAAD #33 together with the pi `enabledModels` fix (bfe20943); merged, no release (version unchanged). Bumped to 0.1.20 to ship the pi fix.
- **2026-10-11 (0.1.19 — summary buckets)** — 48h / 7 d / all drew different evolution charts on a DB younger than the window: `getSummary()` sized buckets from the window asked for, not the span shown. Fixed in proxy PR #52 (8bd3f34, main 0afc4d5; regression Test 8). Re-extracted and published as 0.1.19 on both targets.
- **2026-10-11 (0.1.18 released)** — #31 conflicted with the parallel #30 (both rewrote EXTRACTED.json, package.json, ui/index.html from the same main); resolved by `merge -s ours` of main into the extract branch (tree unchanged — ea3c702 already contains 9a7337a), normal push. User merged AIMAAD/glass #31 (01faf87) and fwornle/glass #8 (19d1748): v0.1.18 Latest on both, release + docs workflows green. Checked live on fwornle.github.io/glass: overview says eight slides with Question 3 = Models / Question 4 = compare, Home "eight-slide" (no "six-slide"), /models/ shows ui-models.png + ui-session-models.png. bmw Pages sits behind SSO — verified by its deploy job (success) only. Open idea: `--publish` should update an older open extract PR instead of racing it.
- **2026-10-11 (G7 follow-up, 0.1.18 — after the parallel status-line fix took 0.1.17)** — user could not find the feature: the card only appeared after selecting a session, and nothing on Home / Overview / README mentioned it (Home still said "six-slide" for seven). Added a top-level **Models** tab (`/api/models?hours=N`: agent × model × account × host × kind across sessions, with session counts; 24 h / 7 d / 30 d / all), an 8th overview slide ("Question 3 / Which models did the work?", compare → Question 4), Home + README + Models page updates, `<1%` instead of a rounded 0% for a non-zero side share. Screenshots from real demo-project runs (opencode ×2, claude); tree 59/59, strict docs build green, slide 7/8 checked in the browser.
- **2026-10-11 (G7 done)** — user merged glass #29 (bmw, v0.1.16 released, installed via `glass update`) and fwornle/glass #6 (22d2229: release v0.1.16, docs deployed — /models/ live, 9/9 PR checks incl. macOS); proxy public export bf8fb9c → fwornle/rapid-llm-proxy 833bb87. Next: G8 spike (cluster URL / auth at BMW, Qwen tool-call fidelity per agent).
- **2026-10-11 (G7 WP3 + WP4 partly)** — docs page Models & Accounts (strict build green). Proxy PR #51 merged (bf8fb9c); coding main 14c8dcb2 (glass 0.1.16, coding dashboard's lazy Routing tab checked live on :3032); glass PR #29 on bmw.ghe.com green on all 10 checks. Left to the user (auto mode refused): merging glass #29, the public glass publish (`extract.mjs --target public --publish`), the proxy's public export (`scripts/public-export.mjs --publish`). Then: check v0.1.16 on both.
- **2026-10-11 (G7 WP1 + WP2, G8 planned)** — proxy `glass-g7-call-facts` 72ffad0 (upstream + call_kind columns); coding `glass-g7-routing-view` (daemon test, models / unbound reads, Models card, lazy Routing / Cost). User: BMW will run glass next to a local Qwen3.8-27B mini-cluster → G8 = opt-in local offload, off by default. Next: WP3 docs, WP4 publish (proxy PR, coding merge, glass PRs on both targets).
- **2026-10-11 (G7 planned)** — checked whether to include coding's semantic router / Routing tab: no (decision 9, bg-only routes, interception sign-off, no local target, size). G7 = a read-only view of model mix and answering accounts from existing rows; opt-in routing noted as a possible later feature. Next: G7 WP1.
- **2026-10-09 (docs site)** — MkDocs site with screenshots, PlantUML + Mermaid diagrams, two tiers per page; Pages enabled; docs workflow; strict build green locally, 23/23 tree tests, install check green. Next: merge coding glass-docs, merge the glass PR → first publish.
- **2026-10-09 (pi row)** — pi logged in (Copilot, bmw.ghe.com; first attempt hit a 429 from a Copilot-side endpoint after device approval, retry fine); measured through the released v0.1.2: exact match with pi's own usage. Remaining: colleague install, IT-security sign-off.
- **2026-10-09 (G6 released)** — coding main 763b9856 (glass-g6-handover); proxy #45 and glass #7 merged → v0.1.2 released and verified (CI 4/4 with drift check, release job, macOS on the asset). Remaining: colleague install; then pi row, IT-security sign-off.
- **2026-10-09 (G6)** — README for colleagues, provenance drift check, breakdown retention; capture-redaction bug found while writing the privacy notes and fixed in the proxy (PR #45). Next: merge #45 → coding glass-g6-handover → glass PR (0.1.2), check v0.1.2, a colleague installs.
- **2026-10-09 (G5 done)** — coding main ea0e5b84 (glass-g5-packaging merged; local stale-dist fix rebased on top as 9555491a); glass PR #6 merged → v0.1.1 released and verified (CI 4/4, release job, macOS on the asset). Next: G6.
- **2026-10-09 (G5 released)** — v0.1.0 published by release.yml on the PR #5 merge; main's tests run exposed the Windows uninstall race → fixed, 0.1.1, glass PR #6 green. Next: merge coding `glass-g5-packaging` + glass PR #6, check v0.1.1, then G6.
- **2026-10-09 (G5)** — tarball with bundled deps, install check (install → 4 agents measured → uninstall → HOME unchanged), CI + release workflow, README; CA identity bug found on Node 22.13 and fixed in the proxy (PR #44). Glass PR #5 green on all 7 checks. Merges left to the user (auto-mode blocks merging without review). Next: merge proxy #44 → coding branch → glass #5, check the v0.1.0 release, then G6.

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
- **2026-10-18 (0.1.35 — a session promoted to the provider stays there)** — rapid-llm-proxy #60 merged (`feat/sticky-session-band`, de46080): at each turn's first call, a session that has had a turn at an offloaded band and then gets a turn judged above it is promoted; its later turns stay on the provider unjudged (band source `session`), never demoted, 2 h record per process. Applies to the glass agent offload (offload.mjs) and routed fg-chat calls (server.mjs). No new files, manifest unchanged. Public rapid-llm-proxy exported (de46080 → fwornle @ 8218264, 524/524 on the exported tree).
- **2026-10-24 (0.1.36 — Cost tab, Tokens/€/$, Copilot pricing, cost field)** — rapid-llm-proxy #61 merged (summary `?cells=1`, `local_providers`); #62 open (no organisation-specific cost / budget defaults). glass ships the Cost tab (write controls hidden without a settings API), the page-wide Tokens / € / $ switch and Evolution month-to-date, and a new status-line field `[GH €n]` (g:cost → Token Usage → Cost). Copilot rates in `lib/cost/copilot-pricing.mjs`: per-model calibration from an itemized sheet (≥5 billed days), GitHub's rate card as the fallback, zero-rate included models known. A contract discount / FX is data, never code: glass `config/cost-defaults.json` (per target, from the new manifest `private_overlay` outside this repo) and `~/.glass/cost.json`; coding's in the proxy's saved settings. coding's click handler hands `g:*` fields to glass (a coding launch after a glass session had taken glass's clicks over). Both targets extract clean (public deny scan), 75/75 tests each.
- **2026-10-24 (0.1.38 — Cost tab log axis, readable tooltip, €/$ in the tab, window-labelled cards, coverage note)** — Cost by month gets Linear/Log (side by side on log) and a popover tooltip above a padded legend (it had covered the month labels); the Cost tab offers €/$ in its own toolbar; summary cards name their window (24 h cards over a calendar-month Cost tab read as a bug); glass's Cost tab says its figures cover glass sessions only — a GitHub Copilot budget counts the whole account. Open: per-account selection in the cost settings (filters every view), and coding + glass combined figures where both run (coexist.mjs: a glass claude call through coding's proxy is recorded by both, so combining must drop coding's copies of glass sessions).
- **2026-10-24 (0.1.37 — month-to-date from the 1st, neutral discount example)** — the internal 0.1.36 tarball was cut from #52, before #53 (docs, month-to-date fix, neutral 0.8 hint) merged; the release workflow only cuts on a version change, so this bump ships them. Evolution's Month-to-date now starts on the 1st (UTC) via an hourly run-up summary instead of summing from the window edge. rapid-llm-proxy #63 (neutral discount example) merged and exported publicly. extract.mjs supersedes a stale-named extract PR rather than renaming its branch.
- **2026-10-24 (0.1.39 — account selection, coding's figures where both run)** — rapid-llm-proxy #64 merged (`exclude` on summary / recent / cost, `GET|PUT /api/token-usage/accounts`); coding's proxy restarted on it. The Accounts dialog (header + Cost toolbar) unticks accounts machine-wide: every usage view, the Models tab and the `GH €` field; saved as `excludeAccounts` in `~/.glass/cost.json`. Where coding is installed, the usage views read a read-only union of glass's token DB and coding's (combined.mjs: TEMP VIEW over an attached DB); coding's copies of glass sessions (same task id) are dropped, an empty task id never matches. On by default, "Sources → coding's figures" switches it (`includeCoding`); the Cost tab's coverage note follows. Account and source writes take the daemon's UI-only gate. 81/81 tests.
- **2026-10-24 (0.1.40 — CLI off the proxy's token-usage module, Claude no longer shown as off)** — 0.1.39's CI failed under Node 22: the CLI imported `proxy/dist/token-usage.js` through ui-api.mjs; the account clause now lives in glass, so the CLI loads no proxy module (5010c6a). The offload dialog showed Claude as switched off although it is on (4f4f603). Fake-peer test row removed from coding's token DB.
- **2026-10-24 (0.1.41 — OFFLINE on the status line, no Kerberos blame when the host has no internet)** — after a wake from sleep the laptop had no egress 18:45–19:16 (reboot cured it; Cisco socket filter / Defender netext suspected, unconfirmed). glass's refused-tunnel error told the user to check Kerberos on an open network; it now asks first whether the machine has internet. glass's network monitor probes direct internet off CN when :3128 is not forwarding; the shared networkBadge shows `OFFLINE` (off CN / VPN only, so `K:NO` keeps its meaning). coding's coordinator no longer dispatches failure-driven proxy restarts while offline off CN (15 futile ones that evening, kickstart-gate `offline`). 82/82 glass tests, 159/159 coding network tests.
- **2026-10-24 (0.1.42 — Evolution hover card opaque, legend capped; 0.1.41 was the offline-host release, e3e5c61)** — the Evolution chart still used recharts' default tooltip (series-coloured text, every zero row, no z-order over the Legend), so the legend drew through it. It now shares the Cost tab's card (series-tooltip.tsx): opaque, zeros dropped, largest first, 12 rows + "+N more", total. Grouped by process over All time the in-chart legend (~135 entries) left the plot ~50px tall; capped at 96px with scroll (plot 262px).
- **2026-10-24 (0.1.43 — timestamped proxy log lines, the cause behind `fetch failed`)** — rapid-llm-proxy #65 merged (38ba141): log-format.mjs `errorDetail()` names the underlying cause (ECONNREFUSED, ENOTFOUND, a timeout…) on the forward / intercept / passthrough error lines instead of a bare `fetch failed`; log-stamp.mjs timestamps every line of the proxy's own server (not shipped in glass). Manifest gains `proxy-bridge/log-format.mjs`. 82/82 glass tests, 521/521 proxy unit tests.
- **2026-10-25 (0.1.44 — what the Copilot figure covers)** — docs only. New overview slide 7 (deck now twelve slides) and a Token Usage Deep Dive section "What the Copilot figure covers" with `glass-copilot-coverage.puml`: agents started as `glass <agent>` (any terminal, VS Code's included) and coding's background jobs are measured; Copilot inside VS Code / another IDE (chat, agent mode, completions), agents started without glass, other machines and github.com reach the bill unseen — `GH €` is a floor, not the invoice. October's data confirmed it: 0 rows from VS Code's Copilot. Open: measuring IDE Copilot (VS Code `http.proxy` → glass?) and checking the € figure against the actual invoice (discount / FX are unverified settings).
- **2026-10-25 (0.1.45 — Copilot measured against GitHub's own count; VS Code Copilot Chat; Copilot CLI cache tokens priced once)** — (1) b3e18886: Copilot CLI's `modelMetrics.inputTokens` is the whole prompt (cache read + write are a breakdown of it); the adapter stored it as fresh input, so every reader priced cached tokens twice (a cache-heavy session read about 7x its cost). Fixed in copilot-token-rows.mjs; 502 coding rows re-derived from their session files; rates refitted on corrected rows. Against the usage sheet the measured total is within a few percent of the bill per month; the excess is mostly GPT-5.6 Sol via opencode's own Copilot login — open. (2) 3513ebd5: VS Code's built-in Copilot Chat rebuilt from `workspaceStorage/*/chatSessions` (operation log; agent `vscode`, hash `vscadt`, estimated: prompt growth = fresh, rest cache read; -21% vs the credits VS Code printed for 8 requests, which matched the bill to the cent) — swept by glass's daemon every 15 min into glass's DB only. GitHub's month-to-date figure (`gh api /copilot_internal/user`, premium_interactions.credits_used × $0.01) on the Copilot tile with the difference. rapid-llm-proxy #66 (vscadt foreground). Rejected: intercepting VS Code (keychain trust + http.proxy: VS Code offline whenever the daemon is down), `glass vscode` (single instance; Chromium network stack ignores NODE_EXTRA_CA_CERTS), an extension (cannot see another extension's model calls). 88/88 glass tests.
- **2026-10-25 (0.1.46 — the quota read finds the work account; GPT-5.6 Sol at each month's rate; green main)** — (1) 74fe9d64: with no Copilot traffic measured yet the quota read asked gh's default host and showed a personal github.com plan (entitlement 0) as "GitHub reports €0"; it now tries every host `gh auth status --json hosts` lists with a working login, enterprise first, keeps the first metered account and remembers it; entitlement 0 = no quota. startDaemon takes `gh` / `vscodeUserDirs`: the daemon tests had run the real gh and swept the real VS Code folders, and on Windows a gh still writing after exit broke cleanup (glass tests #85 red on main). (2) b683a6be: GitHub cut GPT-5.6 Sol in October (the October-only fit equals the rate card; the whole-sheet row carried September's higher rate, so every October day read high). September's rate kept as a dated rate, priced per month. (3) 402c8fbd: gsd-browser shim heals wedge E (socket rebound by a second daemon). 91/91 glass tests.
- **2026-10-25 (0.1.47 — no double count of coding's rebuilt glass sessions; stale tabs reload)** — After 0.1.46 the tile read the right account (bmw.ghe.com) but measured above it: coding's opencode adapter re-imports sessions glass measured on the wire (Oct 10: 113 calls, rows under coding's ids). combined.mjs drops coding token-adapter-* rows inside a glass session window of the same agent + project (±2 min); wire rows and concurrent other-project sessions kept. October then within ~2% of GitHub's figure. glass-ui reloads on vite:preloadError (a tab open across an update had gone blank on the Cost tab's renamed chunk). 92/92 tests.
- **2026-10-25 (0.1.48 — VS Code as a switchable source; contents list follows the tab; no slide counts)** — The Accounts dialog's Sources add *VS Code's Copilot Chat* (offered once glass has read a request; estimated rows, agent `vscode`); unticked → `includeVscode: false` in cost.json and combined.mjs serves the usage views a read-only view without those rows (with or without coding's). Coverage label built from both switches. The right-hand contents list hides headings of the inactive tier tab (`docs/assets/tabbed-toc.js`, moved from coding's docs-content/javascripts, which now links to it). Deck labels and links no longer name a slide count. Checked: shipped prices within ~2% of the usage sheet per month — in-sample. 94/94 tests.
- **2026-10-25 (0.1.49 — billing is data: dated rules by account, model family and model; nothing of a bill in public code)** — `lib/cost/billing-rules.mjs` is the one reading of a cost file for the status line, the Cost tab and coding's dashboard: standing `discount` / `currency` / `copilotPrices` plus `periods` (`from`/`to` days or months, `account`, `discount`, `families` by id prefix, `models`, `prices`, `usdPerEur`, `note`). Every row is priced on its own day (proxy `/api/token-usage/cost?by=day`, rapid-llm-proxy feat/cost-by-day; status line groups by day); most specific discount wins (model → longest family → period → standing), the later entry at equal specificity; rates: dated → measured → GitHub's rate card. `copilot-pricing.mjs` keeps only the public rate card: the fitted table and rate history moved to the private overlay's cost-defaults.json (and coding's own settings). `calibrate-copilot-prices.mjs --into=FILE [--until]` writes rates into a cost file instead of code. `glass doctor` lists unreadable rules. Public target: `deny_values_from` turns every discount factor, measured rate and label of the private cost file into deny patterns, so a bill value can no longer reach the public tree. Checked: all 399 Copilot day×model rows price identically before and after; per-month fit against the sheet unchanged. 95/95 glass tests.
- **2026-10-26 (0.1.50 — glass doctor reports gh)** — Without `gh` (or without a login) glass measures and prices as before; only GitHub's own Copilot figure and `glass update` are missing, and the only sign was one line in the Cost tab. `glass doctor` now prints `✓ gh: <path> (logged in: <hosts>)` plus what became of the daemon's last read (read from <host> at <time> / unavailable: <reason> / switched off), or a `! gh: not installed` / `not logged in` warning with the `gh auth login --hostname <release host>` hint — warnings, not problems, so the exit code is unchanged. `ghEnvIn` (gh's state inside the glass home) is shared by the daemon's read and doctor; `ghDoctorLines` is pure and tested; no usage figure is printed. 99/99 tests, both targets.
- **2026-10-26 (0.1.51 — the Copilot tile says it is list price, not the invoice)** — Traced both October figures (the tile's measured € and GitHub's): both are gross — GitHub's per-model rates × the Azure discount ÷ FX; `credits_used` from /copilot_internal/user is gross credits too. The billing usage report bills `gross − discount_amount = net`, and that discount covered each month in full up to a different amount, then nothing (a pool shared with other users, by its shape), so the invoice is far below either figure and cannot be computed from one machine. The tile now reads "at list price <month>" with a line saying it is before GitHub's own discount and not the invoice; the "incl. allowance · overage" line (a $19-per-seat assumption the billing report contradicts) is gone. Docs: *List price, not the invoice* under How cost is calculated. 99/99 tests, both targets.

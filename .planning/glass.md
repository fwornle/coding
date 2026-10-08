# glass — proposal

Token measurement + context-window insight for coding agents (GitHub Copilot CLI,
OpenCode, pi, Claude Code) as a compact standalone product, derived from `coding`
by a transformation script. Repo: **https://bmw.ghe.com/AIMAAD/glass** (private; created
2026-10-08 as `Frank-Woernle/glass`, transferred to the AIMAAD org the same day for its
GitHub-hosted runners). `main` is empty — generated content only.

Living plan. Update the phase status and the Session log at the end of every session.

Status: **G0 in progress.**

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
- [ ] S7 one measured copilot call, proxy vs OTel (`spike/copilot-measure.mjs` on
      `g0-s6-opencode-trust`). 2026-10-08 run: blocked — copilot's stored bmw.ghe.com login is
      invalid (`no authenticated GitHub host available`, models 401), with and without the proxy.
      Needs `copilot` → `/login` (user), then `node spike/copilot-measure.mjs`.

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
  Repo still has no `main` (default = `g0-s6-windows`) — user to create it.

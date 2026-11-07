# Guardrail hardening — plan

Living plan. **Update the Status table and the Session log at the end of every
session.** Start a session by reading this file, then `/sl`.

Goal (user's words, condensed): constraints must be **100% enforced** and safe
from an agent that wants to get past them, while the **user keeps a bypass**.
Beyond constraints, every mechanism in the repo that is "developed but not
thoroughly validated" gets an invariant, a hardening step and a test that proves
it holds. Must work on **macOS, Linux, WSL and Windows**.

---

## Why the current design cannot be 100%

1. **No privilege boundary.** The agent runs as the user. Everything the guard
   consists of — hook script, rules YAML, `~/.claude/settings.json`,
   `~/.coding/features.yaml`, the proxy and its launchd plist — is user-owned and
   therefore agent-writable.
2. **Text, not effects.** All 31 rules are regexes over the *text of a tool
   call*. The same effect has unbounded spellings (Bash heredoc instead of Write,
   `cp`/`mv`, `console['log']`, base64, `u=uk''b; $u`, case changes).

A guarantee therefore needs (a) the guard to live where the agent cannot write,
and (b) the authoritative check to look at the **resulting state** (files,
commits), with the per-call hook demoted to fast feedback.

## Audit findings (2026-11-07)

### Constraint system

| # | Finding | Evidence |
|---|---|---|
| C1 | Override forgeable: `$TMPDIR/constraint-override-<ppid>.json`, `_constraint_override` tool param | `pre-tool-hook-wrapper.js:104-132` |
| C2 | Skill-required rules satisfied by forgeable `$TMPDIR/skill-invocations-<id>.json` | `pre-tool-hook-wrapper.js:69-101` |
| C3 | User override is dead: `prompt-override-parser.js` registered nowhere | grep |
| C4 | Fail-open on every internal error; missing `CODING_REPO` ⇒ silent allow-all; 3 s config-load timeout ⇒ enforcement off | wrapper `:225-230`, `real-time-constraint-hook.js:54-74` |
| C5 | A `.constraint-monitor.yaml` in any non-coding cwd can switch blocking off | `real-time-constraint-hook.js:30-44` |
| C6 | No hook timeout; Qdrant `getCollections` (300 s client timeout) in the per-call path; engine rebuilt per call (0.3–1.6 s) | `constraint-engine.js:30` |
| C7 | Rules case-sensitive (`apiKey` passes `no-hardcoded-secrets`); MultiEdit outside `no-console-log`; dead `documentation-style-skill-required` | `constraint-engine.js:138-145` |
| C8 | Rules without `tool_filter` fire on any tool text (Read paths, sub-agent hand-backs) ⇒ "random" blocks that train agents to rephrase | probe |
| C9 | Prompt hook exits 1 on violation; only exit 2 blocks | `pre-prompt-hook-wrapper.js:76` |
| C10 | Copilot / opencode / pi have no constraint check at all | `config/hooks-config.json`, `proxy-routing.mjs:128` |
| C11 | Only the `everything`/`full` install tiers enable constraints | `lib/features/resolve.cjs:192-195` |
| C12 | Constraint-monitor tests: 8/12 pass; not run in CI; no end-to-end "agent tried X, was blocked" test | `npm test` in submodule |

### Rest of the repo

| Risk | Finding | Evidence |
|---|---|---|
| Critical | :12436 obs-api, :3034 coordinator, :12435 proxy, :3032/:3033 dashboard, :6333 Qdrant, :6379 Redis listen on **all interfaces**, no auth, CORS `*` ⇒ any web page / LAN host can write knowledge, flip features, change routing, restart services | `lsof`, preflight from `Origin: https://evil.example` ⇒ 204 `Allow-Origin: *` |
| Critical | Observation redaction fails open (redactor init failure ⇒ stored raw; `_redact` returns raw on error; erroring pattern skipped). Effectiveness harnesses not collected by `npm test` (shebang ⇒ classified as script); run by hand: 70.2 % effective, 7/24 pattern tests fail. No PEM / Slack / Google key patterns | `ObservationWriter.js:343-351,758-764`, `ConfigurableRedactor.js:657-663`, `scripts/lib/test-inventory.mjs:209` |
| High | Knowledge injection has no provenance/trust — agent- or API-written entities are injected verbatim | `src/retrieval/retrieval-service.js` |
| High | `budgets.*.enforce` only colours the dashboard | proxy `server.mjs:773`, `CostTab.tsx:257` |
| Med-High | Team scope fails open (no cwd / any error ⇒ unfiltered search) | `observations-api-server.mjs:2116-2120`, `lib/teams/scope.mjs:137` |
| Medium | No runtime test of "feature off ⇒ daemon absent" or "read-only open leaves LevelDB unchanged" | — |

Reusable validation infrastructure (for Phase 3): `/experiment` independent-clone
sandboxes + `detectSandboxEscape`; kgbench `tool_escape`, process-group kill,
`agentEnv`; replay `sandbox-exec` profile (`lib/job-classes/replay-sandbox.mjs:214`),
the only OS-level containment + egress control in the repo.

---

## Decision 1 — the privilege boundary (cross-platform)

Requirement: macOS, Linux, WSL, Windows.

| Layer | macOS | Linux | WSL2 | Windows native |
|---|---|---|---|---|
| Admin-owned guard install + Claude Code managed settings (`allowManagedHooksOnly`, `allowManagedPermissionRulesOnly`, `disableBypassPermissionsMode`) | `/Library/Application Support/ClaudeCode/` | `/etc/claude-code/` | `/etc/claude-code/` | `C:\Program Files\ClaudeCode\` |
| Claude Code OS sandbox for Bash (`sandbox.enabled`, `failIfUnavailable`, `allowUnsandboxedCommands:false`, `denyWrite` on guard + config paths) | Seatbelt | bubblewrap | bubblewrap | **not supported** — run inside WSL2 |
| Uniform containment for non-Claude agents | container | container | container | container (Docker Desktop) |
| User bypass | `sudo coding-guard allow …` | `sudo …` | `sudo …` | elevated (UAC) shell |

**Recommendation:** two layers that together cover all four platforms.

- **Layer A (all OSes, Claude):** guard + rules installed admin-owned, wired via
  managed settings. The agent can no longer edit, disable or re-point the guard.
  User bypass = an elevated `coding-guard allow <rule> --ttl 15m` writing a
  short-lived exemption into the admin-owned directory (sudo / UAC — something
  the agent cannot produce). On this Mac sudo goes through CyberArk EPM — confirm
  elevation is available before relying on it.
- **Layer B (containment):** Claude's sandbox on macOS/Linux/WSL2; native Windows
  runs agents in WSL2 for "enforced" mode. Copilot/opencode/pi get no managed
  hooks, so they run in a container profile (`coding --agent X --contained`) until
  each has an equivalent guard — the container is the one mechanism identical on
  all four OSes.

Status: **superseded — user chose CONTAINER (2026-11-07)**, see "Phase 1 design".
Requirements: identical on macOS, Linux, WSL, Windows; all four agents (claude,
copilot, opencode, pi); user bypass via keychain-style authentication
(fingerprint, phone face scan, YubiKey, password, …), method chosen at install.

## Decision 2 — Docker access for agents

**Who uses Docker today, and why**

1. The **launcher** (`bin/coding`) starts `coding-services` (knowledge,
   codegraph, constraints) *before* the session. That is not the agent.
2. **Host CLIs the agent calls**: `bin/graphify` is a shim that runs
   `docker exec coding-services graphify …`; `bin/semantic` diagnoses via
   `docker exec … supervisorctl`.
3. **Skills tell the agent to use Docker**: `/semantic`, `/graphify`,
   `/experiment` say `docker-compose up -d coding-services`,
   `docker exec … supervisorctl restart …`.
4. **Developing this repo**: after a submodule change the agent rebuilds the
   image, restarts programs and reads `docker logs`.
   `.claude/settings.local.json` pre-approves `docker run *`, `docker exec`,
   `docker compose`, `docker cp`, `docker rm`, `docker system` etc.

**Why it matters.** The Docker daemon does the work, not the agent's process, so
OS sandbox rules and file permissions on the agent do not apply.
`docker run -v "$HOME":/h alpine sh -c 'edit /h/.claude/settings.json'` — or
`-v /:/host` on Linux, where the daemon is root — edits anything, including an
admin-owned guard on Linux. Unrestricted Docker access is equivalent to "guard
off" (and root on Linux).

**If Docker were simply forbidden:** knowledge/codegraph/constraints keep working
(the launcher starts them), but the agent could no longer run `graphify` (the
shim needs `docker exec`), restart or rebuild services after a code change, read
container logs, or follow the recovery steps in `/semantic` and `/graphify`.
Day-to-day development of *this* repo would need the user for every container
action.

**Recommendation — a broker, not raw Docker.** Deny `docker`/`docker-compose`
to the agent; ship an admin-owned `coding svc` broker with a fixed vocabulary
(`status`, `logs <svc>`, `restart <program>`, `rebuild`, `up`, `graphify …`)
that builds every Docker argv itself and never accepts mounts, `--privileged`,
images or arbitrary `exec` commands. It is the single `excludedCommands` entry
in the sandbox. `bin/graphify`/`bin/semantic` and the skills switch to it.

Status: **resolved by the container decision** — inside the box there is no
Docker socket; the `coding svc` broker on the host is the only Docker access.

---

## Phases

### Phase 0 — close the open doors (no design change)

- **0.1 Constraint hook fails closed and loses the forgeable paths** (submodule
  `integrations/constraint-monitor`)
  - internal error while enforcement is on ⇒ block (exit 2) with a clear
    message, not allow;
  - config resolved from the hook's own install location (no reliance on
    `CODING_REPO`/`PWD`); the project-level `.constraint-monitor.yaml` may
    add rules but cannot disable enforcement;
  - remove the `$TMPDIR` override file and `_constraint_override`; the user
    override is read from the **session transcript's genuine user prompts**
    (`transcript_path` in the hook input), not from a state file;
  - skill state recorded per real `session_id` from the hook input, not ppid;
  - Qdrant out of the per-call path; hook timeout set;
  - rules: case-insensitive where meant, MultiEdit covered, dead rule fixed,
    content rules scoped to the tools that write content (no more blocks on
    Read paths / sub-agent hand-backs);
  - prompt hook blocks with exit 2.
- **0.2 Constraint tests:** fix the 4 failing tests; add a hook-level adversarial
  suite (feed tool-call JSON to the hook, assert block) covering every bypass in
  C1–C9; run it in CI.
- **0.3 Redaction fails closed:** refuse to store on redactor init failure /
  redaction error / pattern error; add PEM, Slack, Google key patterns; collect
  the two effectiveness harnesses in `npm test`; fix what they find.
- **0.4 Network:** host services listen on loopback (plus the Docker bridge on
  native Linux, where `host.docker.internal` = bridge gateway); Docker ports
  published on `127.0.0.1`; Host-header allow-list (DNS rebinding); Origin
  allow-list for CORS and for every state-changing request (cross-site
  writes); drop the LAN-range trust in `isExperimentOriginAllowed`.
  *A per-request token was dropped from Phase 0:* it would touch every
  internal client (ETM, hooks, containers) and still not stop the agent,
  which can read any token file the user can. It belongs to Phase 1, where
  the sandbox can deny the agent read access to it.
- **0.5 Out of repo:** rapid-llm-proxy (`bmw.ghe.com/adpnext-apps/rapid-llm-proxy`,
  a team repo) has the same `0.0.0.0` + CORS `*` + unauthenticated
  `/api/llm/routing` + `/api/llm/settings`. Needs a PR there — not done here.

### Phase 1 — the boundary: agents run in a container

**Why a container satisfies all four platforms and all four agents.** Inside the
container it is always Linux, whatever the host is (Docker Desktop on macOS /
Windows / WSL, native Docker or Podman on Linux). The boundary is the same
everywhere: the agent runs as an unprivileged user and simply has no write path
to the guard. Native Windows needs no special case, and the Claude-only managed
settings stop being the only lever.

**Agent box** (`docker/agent.Dockerfile`, launched by `coding --<agent>`)
- Image ships claude, copilot CLI, opencode and pi; the agent runs as uid
  `agent`, no sudo, no Docker socket.
- Workspace: the repo bind-mounted read-write — and nothing else of `$HOME`.
  Agent state dirs (`~/.claude`, `~/.copilot`, opencode/pi config) are
  per-agent volumes; credentials come in read-only.
- Guard: hook code, rules and agent-specific guard config are baked into the
  image or mounted READ-ONLY at root-owned paths (`/opt/coding-guard`,
  `/etc/claude-code/managed-settings.json` with `allowManagedHooksOnly` +
  `allowManagedPermissionRulesOnly` + `disableBypassPermissionsMode`). The
  repo's `config/constraints/` is NOT the live rule source inside the box;
  rule changes go through the host.
- Network: an internal Docker network whose only exit is rapid-llm-proxy (and
  the guard daemon). Provider egress outside the proxy is impossible, which also
  makes token measurement complete for every agent.
- Docker: no socket. `coding svc` (status / logs / restart / rebuild / graphify)
  is served by the host daemon with fixed verbs; no mounts, images or arbitrary
  exec accepted (Decision 2).
- Open per agent: copilot / opencode / pi must load their guard plugin from a
  root-owned location that a user-level config cannot remove. Investigate each
  CLI's config precedence; where none exists, the proxy (outside the box, sees
  every tool_use) refuses the call — enforcement for that agent moves there.

**Host guard daemon** (`coding-guard`, outside the box, one per host user)
- Holds the Ed25519 signing key (never mounted into the box) and the audit log.
- API reachable from the box: `request-override`, `grants?session=…`, `svc`.
- Approval UI on host loopback only, opened in the host browser.

**User bypass — WebAuthn, chosen at install.** One mechanism that is identical on
all four platforms and covers every factor the user listed:

| Factor | Via |
|---|---|
| Laptop fingerprint / face | platform authenticator: Touch ID (macOS), Windows Hello (Windows, WSL via the Windows browser), fprintd-backed browser on Linux where available |
| Phone face scan / fingerprint | passkey on the phone, cross-device ("hybrid", QR code) |
| YubiKey / FIDO2 key | roaming authenticator |
| Password | argon2id hash held by the daemon; typed in the host browser, never in the agent's terminal |

- `install.sh` asks which factors to enrol (several allowed), enrols them in
  the browser, prints recovery codes.
- Flow: the hook blocks with a link (`http://localhost:<port>/approve/<id>`)
  that names the rule, file, a diff excerpt and the agent's stated reason.
  The user authenticates and picks a scope: this call / N minutes / this
  session. The daemon returns a grant signed with its key; the hook in the box
  verifies it with the public key (read-only). The agent can request but never
  produce a grant.
- In box mode the transcript-based `OVERRIDE_CONSTRAINT` is OFF: the
  transcript is writable by the agent inside the box, and a typed prompt can be
  forged with `tmux send-keys`. Only signed grants count.
- Rate limit + lockout on password attempts; every grant and denial in the
  host audit log.

**Phase 1 work items**
1. Agent-box image + launcher integration (`coding --<agent>` starts the box;
   `--no-box` escape hatch for the user, logged).
2. Host `coding-guard` daemon: signing key, grant API, `coding svc` broker,
   audit log; launchd / systemd / schtasks units like the other daemons.
3. WebAuthn enrolment + approval UI; password fallback; install-time choice.
4. Hook: verify signed grants; disable transcript overrides in box mode.
5. Per-agent guard wiring inside the box (claude via managed settings; copilot,
   opencode, pi per the investigation above; proxy fallback).
6. Red-team cells (Phase 3) run the same box, so what is tested is what ships.

### Phase 2 — check results, not wording

Hook rules become fast feedback. The guarantee is a gate on the resulting state:
AST/lint rules (eslint `no-console`, not regex) on the post-edit files, and the
authoritative gate in CI on push (off-machine, cannot be skipped with
`--no-verify`). Optional: filesystem watcher running as another user for
Bash-originated writes.

### Phase 3 — prove it (red-team regression suite)

- Hook-level adversarial suite in CI (from 0.2), growing with every bypass found.
- Agent-level suite (scheduled locally — agents need logins) on `/experiment`
  cells with the replay sandbox profile and process-group kill. Per cell: a
  tempting task, a canary violation that must be blocked (else `guard-absent`),
  guard-file hashes before/after, a fixed-argv assertion on disk state; verdict
  `held | bypassed | tampered | guard-absent`.
- Same pattern for redaction (secret corpus), team scope (cross-team probes),
  API auth (unauthenticated write probes), feature-off ⇒ process absent,
  read-only ⇒ LevelDB unchanged.

### Later — remaining High/Medium items

Knowledge provenance + fenced injection; budget enforcement in the proxy
request path (proxy repo); team scope fails closed with a route test.

---

## Status

| Item | Status | Notes |
|---|---|---|
| Audit | done | 2026-11-07, three parallel audits + spot checks |
| Decision 1 (boundary) | decided: container | WebAuthn bypass chosen at install |
| Decision 2 (Docker) | decided: broker only | no socket in the box |
| 0.1 hook fail-closed | done | see "Phase 0 results" |
| 0.2 constraint tests | done | 48 pass + 5 todo (Phase 1/2 bypasses); runs in CI |
| 0.3 redaction fail-closed | done | LSL security harness deferred |
| 0.4 network | done for host services; containers need recreate | |
| 0.5 proxy repo | todo (external) | needs PR on bmw.ghe.com |
| Phase 1 item 1 (agent box) | done — DEFAULT for claude since item 2 | see "Phase 1 item 1 results" |
| Phase 1 item 2 (host guard daemon) | done — LaunchAgent install left to the user | see "Phase 1 item 2 results" |
| Phase 1 item 3 (WebAuthn approval) | done — enrolment on this Mac needs the user | see "Phase 1 item 3 results" |
| Phase 1 item 4 (hook verifies grants) | done | see "Phase 1 item 4 results" |
| Phase 1 item 5 (per-agent guards) | done — other agents still opt-in `--box` | see "Phase 1 item 5 results" |
| Phase 1 item 6 | todo | red-team cells on the box |
| Phase 2–3 | todo | |

## Phase 0 results (2026-11-07)

**Constraint hook** (`integrations/constraint-monitor`, `config/constraints/`)
- Fail-closed: bad input, config errors, unevaluable rules ⇒ exit 2; read-only
  tools stay allowed for diagnosis; user escape `OVERRIDE_CONSTRAINT: guard-error`.
- Overrides + skills read from the session transcript (`session-transcript.js`):
  only entries with `turnOrigin: human` + `promptSource: typed` count; override
  lasts one turn. `$TMPDIR` state files, `_constraint_override` and the
  unregistered `prompt-override-parser.js` / `pre-prompt-hook-wrapper.js` removed.
- Config found from the hook's own location (no `CODING_REPO` dependency);
  enforcement settings from the canonical file only; no Qdrant in the hot path
  (0.18 s per call, was 0.34–1.62 s); 30 s hook timeout in the runtime config.
- Unscoped rules apply to content tools only (Write/Edit/MultiEdit/NotebookEdit/
  Bash); Bash `description` no longer checked; `applies_to: filename` honoured;
  secrets rule case-insensitive; MultiEdit in `no-console-log`; dead
  skill-required rule revived; both PlantUML content rules scoped to `.puml`;
  evolutionary-names split into unambiguous suffixes vs ordinary vocabulary.
- `install.sh` no longer writes a second hook registration into
  `.claude/settings.local.json`.

**Redaction**
- `ObservationWriter._redact` throws instead of returning raw text; init
  failure ⇒ writes refused; block-array message content now redacted.
- `ConfigurableRedactor`: a failing pattern fails the redaction; **missing
  config throws** — the old auto-create wrote a hardcoded 28-pattern default
  OVER the real `config/redaction/redaction-patterns.json` whenever any caller
  passed a non-existent custom path (found when it silently reverted this
  session's edits twice).
- Patterns: generic `*_API_KEY/SECRET/TOKEN/PASSWORD=…`, generic JSON secret
  fields, PEM private keys, Slack tokens + webhooks, Google API keys; shorter
  thresholds for explicitly named fields and Bearer; catch-all moved after the
  specific token shapes (it was splitting JWTs).
- `tests/security/redaction-effectiveness.test.mjs` runs the e2e harness in
  `npm test`/CI (8/8 checks pass).

**Network** — `lib/network/local-only.mjs` (+ 30 tests) used by obs-api and the
coordinator; verified live: loopback + `::1` only, LAN refused, foreign-origin
PUT 403, rebinding Host 403, container + dashboard proxy 200, dashboard renders.

**Resolved with the user (2026-11-07)**
1. `.claude/settings.local.json` hooks block removed by the user.
2. Test fixtures: `**/integrations/constraint-monitor/test/**` whitelisted on the
   fixture rules (Write/Edit only). Engine suite 12/12, adversarial suite added,
   both in CI via a checkout of the public submodule.
3. Containers: `docker compose up` needs `CODING_DATA_HOME` + `CODING_SCOPE`
   (exported by the launcher); recreated with them.
4. Committed on topic branches and merged (submodule first).

**Deferred, recorded**
- `tests/security/lsl-security-validation.test.js` (LSL coordinator path,
  70 % on the audit run) still not collected; it also rewrites the tracked
  `tests/security/data/sensitive-test-data.json` on every run.
- The observation summariser sends unredacted exchanges to the LLM (same
  provider that already saw them in-session).
- Environment trap: `grep` in agent shells is a shell function that can miss
  matches silently; use `/usr/bin/grep` for audits.

## Phase 1 item 1 results (2026-11-07)

**What exists**
- `docker/agent-box/` — image (`node:22-bookworm-slim` + claude, copilot,
  opencode, pi), root-owned guard at `/opt/coding-guard`, Claude managed
  policy at `/etc/claude-code/managed-settings.json` (`allowManagedHooksOnly`,
  PreToolUse hook with `CONSTRAINT_CONFIG_PATH` pinned to the baked rules),
  entrypoint that drops to the host uid/gid with `no_new_privs` and refuses root.
- `scripts/agent-box.mjs` — `build` (stages ONLY committed content: the
  superproject's pinned constraint-monitor SHA via `git archive`, the committed
  rules blob, the committed box files; labels the image with a guard digest),
  `status` (0 current / 2 stale / 1 missing), `run <agent>`; `boxRunArgs` is
  pure and pinned by `tests/agents/agent-box.test.mjs`.
- `coding box build|status`; `coding --<agent> --box` swaps only the final
  command — tmux, status line and every host service are unchanged. A stale
  image warns; the launcher never rebuilds by itself (an agent could otherwise
  edit the guard source in the mounted repo and have it baked in).
- Mounts: workspace rw at the SAME path (Claude transcript folders keep their
  names, so host session logging works); coding repo ro when it is not the
  workspace; `~/.claude/projects`; a `coding-box-home` volume; pi agent dir
  and CA bundle when set. Routing env (`ROUTING_ENV_VARS`) passed with
  localhost → host.docker.internal.

**Verified in a real box (macOS, Docker Desktop)**: uid 502 / NoNewPrivs=1;
all four CLIs run; guard dir, hook and policy not writable or removable; no
sudo, no Docker socket; workspace writes owned by the host user; proxy reachable
(200); the guard's suites pass INSIDE the box as the agent user (48 pass,
5 todo). `disableAllHooks` in user/project settings cannot disable managed
hooks (Claude Code docs).

**Found and fixed on the way**
- constraint-monitor's `package-lock.json` was out of sync with `package.json`
  (since b2c1934): every `npm ci` failed — the image build and the CI step
  added in Phase 0. Lock regenerated (submodule 9081743).
- `tests/experiments/injection-env.test.mjs` bound a stub on 127.0.0.1:3033 —
  the live dashboard port — and only passed because Docker held `*:3033`.
  It now uses a free port via `CODING_RETRIEVAL_PORT`.

**Not yet (follow-ups, mostly items 2–5)**
- Each agent logs in ONCE inside the box (Linux has no macOS Keychain); the
  login persists in the `coding-box-home` volume. Not exercised here — needs
  an interactive session.
- In the box: no MCP servers, no knowledge-injection / LSL tool hooks (only the
  managed guard hook loads). LSL still works from transcripts for claude;
  copilot / opencode / pi session stores are not mounted yet.
- Egress is not locked to the proxy yet (default bridge network).
- copilot / opencode / pi run in the box but without their own guard (item 5).
- Box mode was opt-in (`--box`); since item 2 it is the DEFAULT for claude
  (user's request, 2026-11-07), opt-in for the other agents until item 5.
- glass is untouched: none of the new/changed files is in `glass/manifest.yaml`;
  re-verified (extract both targets, extracted suite 114/114, extract tests 22/22).

## Phase 1 item 2 results (2026-11-07)

**What exists**
- `lib/guard/home.mjs` — `~/.coding/guard/` (0700; `CODING_GUARD_HOME`
  overrides): Ed25519 `signing-key.pem` + `approver.token` (0600), `audit.jsonl`,
  `state.json`, and `public/guard-public.pem` — the only part the box sees.
  NOT under the data home: that is mounted rw into coding-services, whose code
  the agent can edit and restart. The public key is re-derived from the
  private one at every start.
- `lib/guard/grants.mjs` — `signGrant` / `verifyGrant` / `grantCovers`;
  canonical JSON, scopes `call` (10 min, one use) / `minutes` (1–240) /
  `session` (12 h), bound to rule + box session (+ file when named).
  node:crypto only, so the in-box hook can import it unchanged (item 4).
- `lib/guard/audit.mjs` — hash-chained JSONL; `verifyAudit` names the first
  edited / deleted / reordered line.
- `lib/guard/svc.mjs` — the broker vocabulary: `status`, `logs <container|
  program> [n]`, `restart <program>` (must be a live supervisor program),
  `graphify query|path|explain|update|diagnose|cluster-only …`; `up` and
  `rebuild` are GATED (they act on the agent-writable compose file and
  Dockerfile) and need a signed grant for `svc:<verb>`. Every argv is built
  here; nothing goes through a shell.
- `scripts/coding-guard-daemon.mjs` on :3035 (loopback + docker0 via
  `listenLocal`, Host allow-list, no browser writes; approver routes refuse
  any Origin until item 3 has a real UI). Requests rate-limited (30/min,
  100 pending), fields clipped.
- `scripts/coding-guard.mjs` = `coding guard status|pending|approve <id>
  [--call|--minutes N|--session]|deny|audit|note` and `coding svc <verb>`.
  Approving needs the token file, so it only works from a host shell.
- Units `launchd/com.coding.guard.plist`, `systemd/guard.service`; DAEMONS
  `guard: 'constraints'`; features.md row; install manifest rows;
  `CODING_GUARD_PORT=3035` in `.env.ports`. Windows: no host daemons are
  installed there yet (only the ctx sweeper) — the guard follows the others.
- Box: `CODING_GUARD_URL=http://host.docker.internal:3035`,
  `CODING_GUARD_SESSION=<container name>`, guard `public/` dir mounted ro at
  `/etc/coding-guard`; `boxRunArgs` THROWS when any mount would contain the
  guard home (workspace = `$HOME`, `~/.coding`, …). `bin/graphify` inside the
  box (`CODING_BOX=1`) goes through `coding svc graphify`.
- Launcher: claude runs in the box by default; `--no-box` / `CODING_BOX=false`
  run it on the host and write `host.box.bypass` (agent, via flag|env,
  project) into the audit log. Other agents: `--box` opt-in. The launcher
  warns when the daemon is unreachable but still starts the box.

**Verified** — tests: `tests/guard/` 30/30 (grants, audit chain, svc
vocabulary, daemon over real HTTP with a fake docker), `tests/agents/agent-box`
17/17, `tests/launcher/box-default` 6/6, feature drift guards 90/90.
Live (daemon in the foreground with a scratch guard home, real box, real
docker): from inside the box health OK, public key readable and its dir not
writable, guard home invisible, request 201, approve without / with a guessed
token 401, `svc run -v /:/h` 400, `svc rebuild` 403 + approval request, no
docker socket. Approved from the host CLI → the box verified the grant with
the mounted public key; a tampered copy failed; another session not covered.
`graphify query` through the broker exit 0, `graphify install` refused.
Audit chain intact. Launcher dry-run: `coding` → box=true (default),
`--no-box` → false (flag), `--copilot` → false (default).

**Open**
- The LaunchAgent is NOT installed on this Mac (the session's permission
  classifier refused a persistence change): run
  `scripts/install-launchd-daemons.sh guard`.
- Approval is the host CLI holding the token; item 3 replaces it with
  WebAuthn / password in a host browser page.
- Nothing consumes grants yet — item 4 makes the in-box hook ask for them
  instead of reading `OVERRIDE_CONSTRAINT` from the transcript.

## Phase 1 item 3 results (2026-11-07)

**What exists**
- `lib/guard/factors.mjs` — `~/.coding/guard/factors.json` (0600): WebAuthn
  credentials (public keys only), argon2id password (Node 25 built-in
  `crypto.argon2Sync`, 64 MiB / 3 passes, ≥12 chars), ten argon2id one-time
  recovery codes (issued with the FIRST factor), lockout 5 failures → 15 min
  for password + recovery (authenticators are not guessable, stay usable).
- `lib/guard/ceremonies.mjs` — `@simplewebauthn/server` 14.1 (docs via ctx7):
  rpID `localhost`, origin `http://localhost:3035`, attestation none,
  userVerification REQUIRED; ceremonies single-use, 2 min, and the purpose
  (request id + scope, or "manage") is fixed when the challenge is issued.
  `preferredAuthenticatorType` → hints: platform / hybrid (QR) / security-key.
- Daemon: token approval REMOVED. Approve = `/approve/:id/options|verify`
  (WebAuthn), `/approve/:id/password`, `/approve/:id/recovery`. Enrol =
  approver token for the first factor; afterwards token + a management ticket
  from proving a factor (5 min). Never remove the last factor. Deny needs no
  auth. Pages `/approve/<id>`, `/enroll` (token in the URL FRAGMENT, stripped
  by the page) + fixed asset map, CSP `script-src 'self'`, `frame-ancestors
  'none'`; agent-written fields rendered with textContent; 127.0.0.1 page
  loads redirect to localhost (WebAuthn refuses IP origins); own-origin POSTs
  allowed, foreign Origins refused, `/audit` + `/note` still refuse any Origin.
- CLI: `coding guard approve <id>` opens the page; `enroll`, `factors`.
- `install.sh` step `setup_guard_factors` (after the daemons; interactive
  only; skips when already enrolled) + manifest row for `~/.coding/guard/`.
- Box default now also requires the `constraints` feature: the Docker-free
  `harness` tier stays on the host instead of failing on a missing image.
- Docs (MkDocs): `docs-content/core-systems/agent-box.md` (nav: Core Systems →
  Agent Box & Overrides), diagrams `docs/puml/agent-box-architecture.puml`,
  `agent-box-override-flow.puml`; Constraints page (box, overrides, exit 2,
  fail-closed), Core Systems overview row, installation step 6. Strict build OK.

**Verified** — `tests/guard/` 47/47 incl. real `@simplewebauthn/server`
verification against a software authenticator
(`tests/guard/helpers/soft-authenticator.mjs`): enrol, approve, unenrolled
key 401, UV missing 401, proof moved to another request 400 then replay 401,
foreign origin 401, password, recovery once, lockout, token-only enrol of a
2nd factor 401. Browser (gsd-browser, scratch guard home): enrol page strips
the token, loads SimpleWebAuthnBrowser, sets a password, shows 10 codes;
approval page escapes `<img onerror>` / `<script>` from the agent's reason
and excerpt, approves with the password at scope "15 minutes" → signed grant,
audit `via: password`. NOT verifiable here: a real Touch ID / phone / YubiKey
ceremony (gsd-browser has no virtual authenticator) — the user's enrolment is
that test.

**Open**
- LaunchAgent still not installed (classifier refused again):
  `scripts/install-launchd-daemons.sh guard`, then `coding guard enroll`.
- Item 4: hook fetches + verifies grants, transcript override off in the box.

## Phase 1 item 4 results (2026-11-07)

**What exists**
- `integrations/constraint-monitor/src/hooks/box-grants.js` — box mode
  (`CODING_GUARD_MODE=box`): the transcript override is OFF (including the
  `guard-error` escape). A blocked call fetches `GET /grants?session=`,
  verifies each with the mounted public key (`lib/guard/grants.mjs`, imported
  from `../../../../lib/guard/`, staged into the image at the same relative
  place), matches rule + session + file + expiry, spends a one-call grant via
  `/grants/:id/consume` (non-call grants are preferred so a 15-min approval
  doesn't burn a one-call one); otherwise it files `POST /requests` and the
  block message carries the approval link. Guard unreachable / keys missing
  ⇒ blocked, "no override is possible right now". A broken guard asks for a
  `guard-error` grant. An escaped rejection in the wrapper now blocks (Node
  exits 1 on an unhandled rejection, which Claude Code treats as allow).
- Trusted inputs only: `CODING_GUARD_MODE` / `CODING_GUARD_KEYS` set INLINE
  in the managed hook command (a nested `claude` started by the agent can
  carry any env, but an inline assignment wins); guard URL from
  `public/guard.json` (written by the daemon) in the ro mount, NOT from
  `CODING_GUARD_URL` — a fake guard could otherwise replay a spent grant;
  session = container hostname (`docker run --hostname <name>`).
- Daemon: writes `public/guard.json`; a pending request for the same rule +
  session + file is reused, so a retrying agent files one request.
- Image: `lib/guard/grants.mjs` staged from HEAD, part of the guard digest.

**Verified** — `tests/guard/box-hook.test.mjs` 16/16 (real hook wrapper vs
real `createGuard`): block files one request with the link, typed transcript
override ignored, call / minutes / file binding, other session, denied,
forged-key grant from a fake guard, edited payload, env URL ignored, guard
down, no keys, broken guard + `guard-error` grant. Submodule suite 51 pass /
5 todo (3 box cases added). Full `npm test`: jest 1297/1297, node 2321 pass
/ 0 fail / 4 skipped. Live, real image + scratch guard on :3036: the managed
command run in the box with an agent env of `CODING_GUARD_MODE=host`, own
keys dir and a fake URL → still box mode, request filed (session =
`coding-box-claude-live4`); after a one-call password approval the next run
exit 0, the one after exit 2 with a fresh request; `/etc/coding-guard` is
read-only, `hostname` needs root; audit chain intact.

**Residual (not item 4)**
- Skill activations still come from the transcript in the box; a forged
  `Skill` entry satisfies the skill-required (documentation-style) rules.
  Low impact; result-based checks (Phase 2) are the real fix.
- `/svc` gated verbs take `session` from the request body: a box could name
  another box's session and use its `svc:<verb>` grant. Bind to the caller
  (e.g. per-box token in the ro mount) in item 5.
- `NODE_OPTIONS` etc. still reach the hook from a nested agent's env; the
  hook's own decision inputs are inline, but preload code would run inside
  it. Next hardening: `env -i` in the managed command (needs a check of
  what claude passes to hooks).

## Phase 1 item 5 results (2026-11-07)

**Investigation (CLIs in the box: copilot 1.0.107, opencode 1.19.5, pi 1.5.0;
each run through the proxy with a logging hook, not from docs alone)**
- opencode: managed config `/etc/opencode/` (docs: highest precedence).
  Verified: project `"plugin": []`, `OPENCODE_CONFIG_CONTENT` and
  `OPENCODE_DISABLE_DEFAULT_PLUGINS` keep the managed plugin; it runs AFTER
  project plugins (sees final args). Only `OPENCODE_TEST_MANAGED_CONFIG_DIR`
  moves it — not in the box's env allowlist.
- pi: `-e <path>` always loads (also with `-ne`); its handler runs before
  discovered extensions. Shapes: `bash{command}`, `write{path,content}`,
  `edit{path,edits[{oldText,newText}]}`, paths relative.
- copilot: no local managed layer (managed settings = GitHub org / MDM).
  Hooks fire from `--plugin-dir` (legacy plugin.json inline/`hooks.json`,
  and Claude-format `.claude-plugin` + `hooks/hooks.json`, which gets a
  Claude-shaped payload: `Write{path,file_text}`, `Edit{path,old_str,new_str}`).
  `disableAllHooks` in REPOSITORY settings (`.github/copilot/settings*.json`,
  `.claude/settings*.json`) silences plugin hooks too, but only in a trusted
  folder — and trust is in `~/.copilot/config.json`, agent-writable. User
  `disableAllHooks` / `enabledPlugins:false` do not stop the plugin. Settings
  planted mid-session did not stop hooks in that session (read at start).
  Copilot hides an exit-2 hook's stderr; it shows a JSON deny reason (exit 0),
  and it ALLOWS when stdout is not exactly the JSON.
- A ro mount of `.github/copilot` alone is NOT enough: renaming its parent
  `.github` works and a new settings file can be planted (tested). Pinning
  `.github` with its own rw mount makes it a mount point (EBUSY).

**What exists**
- `integrations/constraint-monitor/src/hooks/agent-adapters.js` — native
  calls → Claude shape; the wrapper takes the agent from `CODING_GUARD_AGENT`
  (inline in each plugin) and records it on requests. For copilot `block()`
  writes a JSON deny to fd 1 and every other stdout write goes to stderr.
- `docker/agent-box/agents/`: `copilot/` (Claude-format plugin),
  `opencode/guard.js` + `opencode.json` (→ `/etc/opencode/`), `pi/guard.js`,
  `guard-hook.mjs` (runs the hook with box mode / keys / rules / agent fixed,
  fail-closed). Image copies them root-owned; `stageContext` now archives the
  whole committed `docker/agent-box` tree.
- `scripts/agent-box.mjs`: `AGENT_GUARD_ARGS` (copilot `--plugin-dir`, pi
  `-e`, before user args); copilot boxes mount `.github` rw (pin),
  `.github/copilot` + `.claude` ro in every dir from workspace to cwd
  (`configRoots`); `prepareCopilotConfig` refuses a repo that disables hooks
  and creates missing dirs (empty, git-invisible).

**Verified** — tests: adapters 11 (submodule, now 62 pass / 5 todo),
`tests/guard/box-hook.test.mjs` 22/22 (per-agent native payloads vs real
daemon, copilot JSON deny incl. broken guard, empty stdout on allow),
`tests/agents/agent-box` 26/26. Full `npm test`: jest 1297/1297, node 2333
pass / 0 fail / 4 skipped. LIVE, real image + real `boxRunArgs` + scratch
guard (:3036), each agent asked to write a blocked line: copilot, opencode
and pi all blocked, each quoted the rule and the approval link, requests
filed with the right agent / box session / absolute file; after a one-call
password approval each wrote the file. In a copilot box: writing either
settings dir, renaming `.github` / `.github/copilot`, deleting `.claude`, and
editing any guard file — all refused. Claude hook re-checked on the new image.

**Open**
- Other agents stay opt-in (`--box`): opencode/pi provider config
  (`~/.config/opencode`, `~/.pi/agent`) is host-only and not in the box —
  mounting `~/.pi/agent` rw would let the box plant a HOST extension, so it
  needs a generated, read-only copy; copilot needs a box login or BYOK.
- Agent-written in-process code (opencode project/global plugins, pi
  discovered extensions, copilot extensions) can mutate a call around the
  check — same class as Bash running an agent-written script → Phase 2.
- Carried from item 4, NOT done here: `/svc` session binding (per-box token),
  `env -i` for the hook command.
- Enforcement in the proxy (plan's fallback) not needed: every agent has a
  root-owned load path.

## Session log

- **2026-11-07** — audit; plan written; Phase 0 implemented (0.1, 0.3, 0.4;
  0.2 partial). Full `npm test` green: jest 1294/1294, node 2229 pass / 0 fail.
- **2026-11-07 (later)** — user decisions: container boundary, WebAuthn bypass,
  test-fixture whitelist. Phase 0 completed, committed (82ebde86). Phase 1 item 1
  (agent box, opt-in `--box`) built and verified; glass re-verified unchanged.
- **2026-11-07 (evening)** — Phase 1 item 2: host guard daemon (signed grants,
  audit chain, `coding svc` broker, units) built and verified against a real
  box; box mode made the default for claude with an audited `--no-box`.
- **2026-11-07 (late)** — Phase 1 item 3: WebAuthn / password / recovery
  approval with enrolment UI and install step; box default tied to the
  constraints feature; MkDocs page + two diagrams.
- **2026-11-07 (night)** — Phase 1 item 4: in-box hook honours only signed
  grants, files the request itself; verified against a real box.
- **2026-11-07 (night, later)** — Phase 1 item 5: copilot / opencode / pi
  load the guard from root-owned places; copilot repo-settings bypass found
  and closed; verified live for all three agents.

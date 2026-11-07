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
| Phase 1 (container + WebAuthn) | designed | work items 1–6 |
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

## Session log

- **2026-11-07** — audit; plan written; Phase 0 implemented (0.1, 0.3, 0.4;
  0.2 partial). Full `npm test` green: jest 1294/1294, node 2229 pass / 0 fail.

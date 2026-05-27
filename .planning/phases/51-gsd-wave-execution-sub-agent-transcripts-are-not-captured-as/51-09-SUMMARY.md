---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 09
subsystem: lsl-parity
tags: [phase-51, copilot, live, path-a, file-tail, degraded-parity, wave-4]
dependency_graph:
  requires:
    - 51-01 (registry contract — Plan 51-01 row shape)
    - 51-04 (parseCopilot v1.0.48 fix + workspace.yaml helpers + stripToolCallIdPrefix)
    - 51-06 (sub-agent LSL writer — frontmatter shape consumer downstream)
  provides:
    - "lib/lsl/live/copilot-events-tail.mjs — Path A live watcher"
    - "scripts/sub-agent-live-copilot.mjs — long-running daemon CLI"
    - "tests/live-logging/live-copilot-events-tail.test.js — 13-test watcher contract"
  affects:
    - "(none — pure additive surface; no existing file modified)"
tech_stack:
  added: []
  patterns:
    - "fs.watchFile-based file tail (200ms poll; matches Plan 51-07 per-file tail pattern)"
    - "Live-session detection via inuse.<pid>.lock + 10-min mtime stale grace (landmine #5)"
    - "Per-session scan loop (10s default) — adds tails for newly-live sessions, removes tails when locks disappear"
    - "Best-effort 'lock_gone' completion on lock-file removal (defensive — hard-crashed sessions)"
    - "Stub-observation pattern: synthetic 2-message exchange (user/assistant) carrying spawn metadata + outcome — INNER REASONING LOST per RESEARCH key finding"
    - "Atomic .tmp + rename heartbeat write (matches Plan 50-03 lsl-resolver-job.sh)"
    - "D-Live-Sweep-Tags: metadata.source='sub-agent' (NO -backfill suffix) for live tier"
    - "D-Reuse within Phase 51: imports parseWorkspaceYaml + projectFromWorkspace + stripToolCallIdPrefix from Plan 51-04 adapter"
    - "Error budget: >10 errors in 60s → exit 1 for supervisor restart (mirrors Plan 51-07 shape)"
    - "TDD (RED → GREEN per task)"
key_files:
  created:
    - lib/lsl/live/copilot-events-tail.mjs
    - scripts/sub-agent-live-copilot.mjs
    - tests/live-logging/live-copilot-events-tail.test.js
  modified: []
decisions:
  - "DEGRADED LSL PARITY ACCEPTED (RESEARCH key finding): Copilot CLI emits only subagent.started/completed/failed lifecycle bookends to events.jsonl. The sub-agent's user/assistant messages, tool calls, and intermediate reasoning are NEVER persisted by Copilot. Inner reasoning is FOREVER LOST — no live mitigation possible (would require Copilot CLI source changes). Every live observation carries metadata.lsl_incomplete=true + metadata.note='Copilot CLI emits only lifecycle bookends' + metadata.lsl_incomplete_reason locked verbatim. Plan 51-11 surfaces this via /health/state."
  - "Lock-file 10-min stale grace (RESEARCH landmine #5): a hard-crashed Copilot session leaves inuse.<pid>.lock orphaned on disk. Treating its mtime as a freshness proxy lets us skip dead sessions without false positives on slowly-updating long sessions. Default LOCK_STALE_GRACE_MS = 10*60*1000."
  - "Lock-file disappearance → markCompleted with completion_status='lock_gone' + completed_at=null. Defensive — operator sees stale entries explicitly rather than the row staying 'running' forever. This is best-effort; the sweep tier (Plan 51-04) is the authoritative recovery path."
  - "Project filter: sessions whose workspace.yaml git_root basename doesn't match the projectRoot basename are NOT watched. This bounds CPU + write volume to the project of interest (saves resources for stray Copilot sessions across the user's other repos)."
  - "Stub observation shape: synthetic 2-message exchange — `[Copilot sub-agent invocation: <agentName>]` (user) + `<agentDescription or agentName>\\n\\n(Status: <completion_status>)` (assistant). Locked here by Plan 09 <interfaces> block; Plan 51-06's writer round-trips this faithfully."
  - "Daemon heartbeat schema: payload includes `lsl_incomplete_marker_present: true` as an explicit per-agent capability surface for Plan 51-11's degraded-parity badge. Plans 51-07 and 51-08 daemons omit this field (their agents persist inner reasoning)."
  - "Path A is forward-looking only: pre-existing content of events.jsonl at watcher start is NOT processed. The sweep tier (Plan 51-04) is the authoritative source for historical sub-agent rows. This prevents double-counting on daemon restart."
metrics:
  duration: ~10m
  tasks_completed: 2
  files_changed: 3
  lines_added: 1523
  tests_added: 13
  tests_total_phase_51_subset: 86
  commits: 3
  completed_at: "2026-05-27"
---

# Phase 51 Plan 09: Copilot Path A — Live events.jsonl Tail Watcher Summary

Live (Path A) hook for GitHub Copilot CLI sub-agents — Wave 4's Copilot deliverable. Mirrors the operational shape of Plans 51-07 (Claude FSEvents watcher) and 51-08 (OpenCode SQLite poller) while honoring the **fundamental degraded-LSL-parity** that RESEARCH-copilot.md identified as the Copilot tier's defining limitation.

## One-liner

`lib/lsl/live/copilot-events-tail.mjs` tails `~/.copilot/session-state/<uuid>/events.jsonl` for every locked-and-fresh session, ingests `subagent.started/.completed/.failed` bookend events into the Plan 51-01 registry, and writes stub observations stamped `lsl_incomplete: true` because Copilot CLI does not persist the sub-agent's inner reasoning to disk.

## The DEGRADED LSL PARITY rationale

This is the load-bearing decision of Plan 09 — documented prominently per CONTEXT.md `additional_context`:

> RESEARCH-copilot.md §"Sub-agent inner content is lost on disk" — sampled session with 1062 events across 10 sub-agents shows ZERO `subagent.user.message` / `subagent.assistant.message` / `subagent.tool.*` events on disk. Only the bookending `subagent.started` and `subagent.completed`/`.failed` are persisted. The sub-agent's actual reasoning trace appears to be either (a) discarded after the sub-agent returns, (b) summarized in the parent's `tool.execution_complete` for the orchestrating tool call, or (c) optionally written via the `SubagentSessionBoundary` event which has not been observed in any of the 283 sessions on disk that contain sub-agent events.

**Operational consequences:**

1. The observation written by this live tier is a STUB containing only spawn metadata (`agentName`, `agentDescription`) + completion outcome (`success` / `error` / `lock_gone`).
2. The LSL file Plan 51-06's writer produces from this stub carries `lsl_incomplete: true` frontmatter (matches Plan 51-04 sweep behavior).
3. The sub-agent's internal reasoning is **FOREVER LOST** — no live mitigation possible. Fixing this would require Copilot CLI source changes (out of Phase 51 scope, deferred per `Could #11`).

**How the marker propagates through the live tier:**

| Layer | Field |
|---|---|
| Registry row's `agent_metadata` | `lsl_incomplete: true`, `lsl_incomplete_reason: '<locked string>'`, `note: 'Copilot CLI emits only lifecycle bookends'` |
| Observation writer `metadata` | Same three fields PLUS `completion_status` + `detected_via: 'event-tail'` + `toolCallId` + `source: 'sub-agent'` + per-row provenance (`parent_session_id`, `sub_index`, `sub_hash`, `agent: 'copilot'`, `project`) |
| Daemon heartbeat payload | `lsl_incomplete_marker_present: true` — Plan 51-11 reads this to render the degraded-parity badge for Copilot in `/health/state` |
| LSL frontmatter (Plan 51-06 writer) | Round-trips `lsl_incomplete: true` from the registry row's `agent_metadata` into the per-file frontmatter |

## Lock-file-based live-session detection + 10-min stale grace

Detection rule (RESEARCH §"Detection plan — Path A Option A1 RECOMMENDED"):

1. **Live indicator** — `inuse.<pid>.lock` file in the session directory. Copilot CLI creates this when the session process starts; it disappears on clean exit.
2. **Stale grace** — RESEARCH landmine #5: a hard-crashed Copilot (SIGKILL) leaves the lock orphaned. A 10-min `mtime` window guards against false-positive "live" classifications. Sessions whose lock mtime is older than `LOCK_STALE_GRACE_MS = 10 * 60 * 1000` are treated as dead.
3. **uid-check** — every session dir + events.jsonl file passes through a uid match against the current process uid. Non-owned sessions skipped with stderr emission (T-51-09-FI defense-in-depth, matching Plan 51-04 adapter's pattern).
4. **Project filter** — sessions whose `workspace.yaml git_root` basename doesn't match the daemon's `--project-root` basename are NOT watched (bounds CPU + write volume to the project of interest).

The scan loop runs every `liveSessionScanIntervalMs` (default 10s). On each tick:

- Newly-live sessions get a tail started.
- Sessions whose lock disappeared get their tails stopped + open sub-agents marked `completion_status='lock_gone'` (best-effort completion).

## Stub observation shape (synthetic 2-message payload)

Per Plan 09 `<interfaces>` block — verbatim:

```javascript
// One observation per subagent lifecycle pair (started + completed/failed):
{
  messages: [
    {role:'user',
     content:`[Copilot sub-agent invocation: ${agentName}]`,
     createdAt: started_at},
    {role:'assistant',
     content:`${agentDescription || agentName}\n\n(Status: ${completion_status})`,
     createdAt: completed_at},
  ],
  metadata: {
    agent: 'copilot',
    source: 'sub-agent',                  // D-Live-Sweep-Tags (NO -backfill)
    parent_session_id, sub_index, sub_hash, project,
    lsl_incomplete: true,
    lsl_incomplete_reason: 'Copilot CLI emits only subagent.started/completed lifecycle events; inner reasoning not persisted to events.jsonl',
    note: 'Copilot CLI emits only lifecycle bookends',
    toolCallId,
    completion_status,                    // 'success' | 'error' | 'lock_gone'
    detected_via: 'event-tail',
    sourceFile: <events.jsonl path>,
  },
}
```

This is the same shape Plan 51-04's adapter produces during sweep — only the `source` field differs (`'sub-agent'` here vs. `'sub-agent-backfill'` there), per D-Live-Sweep-Tags.

## D-Reuse compliance

**Within Phase 51 (D-Reuse permits inter-plan reuse):**

| Imported helper | From | Used for |
|---|---|---|
| `parseWorkspaceYaml` | `lib/lsl/adapters/copilot-events.mjs` (Plan 51-04) | Parse workspace.yaml without js-yaml dep (landmine #6) |
| `projectFromWorkspace` | `lib/lsl/adapters/copilot-events.mjs` (Plan 51-04) | Derive project name from git_root basename (landmine #12) |
| `stripToolCallIdPrefix` | `lib/lsl/adapters/copilot-events.mjs` (Plan 51-04) | Derive 7-char sub_hash from toolCallId (landmine #3 — strip `toolu_vrtx_` first) |
| `parseCopilot` | `src/live-logging/TranscriptNormalizer.js` (Plan 51-04 v1.0.48 fix) | Per-line event parsing — subagent branch returns `type:'subagent'` discriminator |

**Cumulative D-Reuse gate (Phase 50 primitives unchanged):**

```bash
$ git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs
(empty — 0 files changed)
```

Plan 09 introduces a NEW path (`lib/lsl/live/`) — no modification to Phase 50 surface.

## Daemon CLI shape (mirror of Plans 51-07, 51-08)

`scripts/sub-agent-live-copilot.mjs` flags (matches Plan 51-07/51-08 conventions):

| Flag | Default | Purpose |
|---|---|---|
| `--session-state-dir` | `$LSL_COPILOT_SESSIONS_DIR` or `~/.copilot/session-state` | Root dir for Copilot session-state |
| `--project-root` | `process.cwd()` | Project filter (basename-matched against workspace.yaml git_root) |
| `--state-file` | `.data/sub-agent-live-state-copilot.json` | Heartbeat destination |
| `--scan-interval` | `10000` (ms) | Live-session scan cadence |
| `--heartbeat-interval` | `30` (s) | Heartbeat write cadence |
| `--help` | — | Print help and exit 0 |

**Lifecycle:**

1. Bootstrap: `createRegistry()` + `new ObservationWriter() / init()` + `startCopilotWatcher(...)`
2. Heartbeat loop: every 30s, atomic-write payload to `--state-file` (`.tmp` sibling + `rename` swap)
3. Graceful `SIGTERM` / `SIGINT`: stop watcher (drains in-flight writes) → close writer → emit final heartbeat with `shutdown_at` → `exit 0`
4. Error budget: `>10` errors in any rolling 60s window → `exit 1` for supervisor restart (Plan 51-11 launchd)

**Heartbeat payload shape (Plan 51-11 consumer surface):**

```json
{
  "agent": "copilot",
  "last_heartbeat_at": "2026-05-27T22:05:30Z",
  "watching_sessions": 0,
  "tail_count": 0,
  "registered": 0,
  "errors": 0,
  "last_scan_at": "2026-05-27T22:05:30Z",
  "lsl_incomplete_marker_present": true,
  "session_state_dir": "/Users/Q284340/.copilot/session-state",
  "project_root": "/Users/Q284340/Agentic/coding",
  "registry_rows": []
}
```

`lsl_incomplete_marker_present: true` is the Plan 51-11 contract point — the dashboard surfaces this as a per-agent capability degradation badge ("Copilot: lifecycle bookends only").

## Verification

**Watcher contract tests (13 — all passing):**

| # | Test |
|---|---|
| 1 | `startCopilotWatcher` returns handle with `stop` + `getStats` |
| 2 | Live-session scan only watches locked sessions (1 of 2 fixtures) |
| 3 | `subagent.started` registers row with sub_hash, parent_session_id, detected_via='event-tail' |
| 4 | `subagent.completed` stamps completed_at + completion_status='success' |
| 5 | `subagent.failed` stamps completion_status='error' + errorMessage |
| 6 | Stub observation written with lsl_incomplete=true + locked note |
| 7 | Lock-file disappearance → markCompleted with completion_status='lock_gone' |
| 8 | Lock-file mtime > 10 min → session NOT watched |
| 9 | workspace.yaml git_root → project='coding' (basename) |
| 10 | Project filter rejects sessions whose git_root differs from projectRoot |
| 11 | `handle.stop()` drains in-flight writes |
| 12 | `getStats()` returns shape with `last_scan_at` |
| 13 | uid-check skips non-owned session dirs with stderr |

**Cumulative regression:**

- Plan 51-04 23-test gate (10 parseCopilot + 13 adapter): **GREEN**
- Phase 51 cumulative subset (registry + claude/copilot/opencode/mastra adapters + parseCopilot + Plan 09 watcher): **86 tests passing**
- D-Reuse cumulative: `git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` → **0 files changed**
- `package.json` unchanged (zero new package installs — T-51-09-SC mitigation)
- `grep -c "console\\." lib/lsl/live/copilot-events-tail.mjs` → **0** (CLAUDE.md no-console-log rule)
- `grep -c "console\\." scripts/sub-agent-live-copilot.mjs` → **0**

**Acceptance grep gates:**

```bash
$ grep -F "inuse."           lib/lsl/live/copilot-events-tail.mjs  # → 5 lines
$ grep -F "subagent.started" lib/lsl/live/copilot-events-tail.mjs  # → 4 lines
$ grep -F "source: 'sub-agent'"     lib/lsl/live/copilot-events-tail.mjs  # → 2 lines
$ grep -F "detected_via: 'event-tail'" lib/lsl/live/copilot-events-tail.mjs  # → 3 lines
$ grep -F "lsl_incomplete"   lib/lsl/live/copilot-events-tail.mjs  # → 9 lines
$ grep -F "stripToolCallIdPrefix" lib/lsl/live/copilot-events-tail.mjs  # → 4 lines
$ grep -F "startCopilotWatcher" scripts/sub-agent-live-copilot.mjs  # → 3 lines
$ grep -F "SIGTERM"          scripts/sub-agent-live-copilot.mjs  # → 3 lines
$ grep -F "lsl_incomplete_marker_present" scripts/sub-agent-live-copilot.mjs  # → 3 lines
```

All gates passing.

## Deviations from Plan

**None — plan executed exactly as written.**

Both tasks landed in their specified commits with the TDD RED→GREEN cadence dictated by frontmatter:

| # | Commit | Type | Purpose |
|---|---|---|---|
| 1 | `e02eb406d` | `test(51-09)` | RED — 13 failing tests |
| 2 | `02c0b5ef3` | `feat(51-09)` | GREEN — watcher implementation, 13/13 passing |
| 3 | `55e6288de` | `feat(51-09)` | Daemon CLI |

No Rule 1/2/3 deviations were required. The plan's `<interfaces>` block, `<action>` steps, `<acceptance_criteria>` grep gates, and TDD test enumeration were specific enough that the GREEN implementation passed all 13 tests on first run.

## Threat Flags

None — this plan introduces a new file-watcher path with explicit threat-register coverage in the plan itself (T-51-09-FI, T-51-09-LP, T-51-09-RC, T-51-09-PV, T-51-09-RL, T-51-09-AD, T-51-09-SC). All seven threats are mitigated by the implementation as documented.

## Self-Check: PASSED

- ✓ `lib/lsl/live/copilot-events-tail.mjs` exists (719 lines)
- ✓ `scripts/sub-agent-live-copilot.mjs` exists (281 lines)
- ✓ `tests/live-logging/live-copilot-events-tail.test.js` exists (523 lines)
- ✓ Commit `e02eb406d` present in git log (test RED)
- ✓ Commit `02c0b5ef3` present in git log (feat GREEN watcher)
- ✓ Commit `55e6288de` present in git log (feat daemon)
- ✓ 13 watcher tests pass
- ✓ 23-test Plan 51-04 regression gate green
- ✓ Phase 51 86-test cumulative subset green
- ✓ Phase 50 primitives unchanged (D-Reuse cumulative)
- ✓ `package.json` unchanged (zero new dependencies)
- ✓ No `console.*` calls in either new module (CLAUDE.md gate)

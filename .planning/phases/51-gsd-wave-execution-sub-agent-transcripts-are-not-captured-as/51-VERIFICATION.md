---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
verified: 2026-05-27T08:15:00Z
status: gaps_found
score: 10/16 must-haves verified
overrides_applied: 0
gaps:
  - truth: "AC #2 (CONTEXT.md) — fresh wave-execution produces sub-agent LSL files under .specstory/history/{YYYY}/{MM}/ matching D-LSL-Filename"
    status: failed
    reason: "Production .specstory/history/ contains ZERO files matching the S-pattern. Plan 51-06 SUMMARY's '624 LSL files written' refers to a sandbox smoke test under /private/var/folders/.../tmp.JxUhsiW7Dc/history/ — NOT the production target. The writer code is correct and the smoke test proves it works, but no production backfill or live-tier capture has populated the production LSL directory."
    artifacts:
      - path: ".specstory/history/2026/05/"
        issue: "Zero files matching pattern '*_S[0-9]+-*-*.md' anywhere under .specstory/history/"
      - path: "scripts/write-sub-agent-lsl.mjs"
        issue: "Functional and tested but never invoked with --output-root .specstory/history (production)"
    missing:
      - "Production backfill run: node scripts/write-sub-agent-lsl.mjs --agent claude --project coding --historical --limit 1000 (writes to .specstory/history default)"
      - "OR a successful live-tier wave run with daemons under launchd (currently blocked by CR-04)"
  - truth: "CR-04: launchd live daemons spawn /usr/local/bin/node which does not exist on Apple Silicon"
    status: failed
    reason: "All 3 live-daemon plists (claude/copilot/opencode) hardcode /usr/local/bin/node. On Apple Silicon Macs node lives at /opt/homebrew/bin/node. Verified: launchctl list shows exit code 78 (EX_CONFIG) for all three live daemons; /usr/local/bin/node does not exist on this host. The plists' EnvironmentVariables PATH does NOT help because launchd resolves ProgramArguments[0] before applying PATH. This effectively nullifies Plan 51-11 Path A on every Apple Silicon dev machine."
    artifacts:
      - path: "launchd/com.coding.sub-agent-live-claude.plist"
        issue: "ProgramArguments[0]=/usr/local/bin/node (missing on Apple Silicon)"
      - path: "launchd/com.coding.sub-agent-live-opencode.plist"
        issue: "ProgramArguments[0]=/usr/local/bin/node (missing on Apple Silicon)"
      - path: "launchd/com.coding.sub-agent-live-copilot.plist"
        issue: "ProgramArguments[0]=/usr/local/bin/node (missing on Apple Silicon)"
      - path: "scripts/install-sub-agent-launchd.sh"
        issue: "Does not detect node via 'command -v node' and substitute the absolute path into the plists before installing"
    missing:
      - "Installer must resolve node via 'command -v node' and templatize the plist before copying to ~/Library/LaunchAgents/"
      - "OR plists use a /bin/bash wrapper (like the sweep job) so PATH resolution finds node"
      - "OR launchd integration tests must assert ProgramArguments[0] is executable on the install host"
  - truth: "CR-01: OpenCode adapter silently ignores --limit (reads property off Array)"
    status: failed
    reason: "lib/lsl/adapters/opencode-sqlite.mjs:231 reads `searchPaths.limit` where searchPaths is an Array<{type:'sqlite',dbPath}>. Arrays have no .limit property → always 100 default. The --limit dispatcher flag is dead for OpenCode. Verified by inspection of source code."
    artifacts:
      - path: "lib/lsl/adapters/opencode-sqlite.mjs"
        issue: "Line 231: const limit = Number.isFinite(searchPaths.limit) ? searchPaths.limit : 100"
    missing:
      - "Plumb limit through discover({searchPaths, project, since, limit}) signature; update dispatcher to forward it"
  - truth: "CR-02: OpenCode live daemon heartbeat omits registry_rows → registry-reader always reports 0 running"
    status: failed
    reason: "scripts/sub-agent-live-opencode.mjs heartbeat lacks the registry_rows field that scripts/sub-agent-live-claude.mjs:140 and scripts/sub-agent-live-copilot.mjs:226 both include. lib/lsl/registry-reader.mjs:145 enumerates per-agent live sub-agents EXCLUSIVELY from registry_rows. Net result: live_registrations.opencode.running is permanently 0 in /health/state's sub_agent_capture block, regardless of real OpenCode activity."
    artifacts:
      - path: "scripts/sub-agent-live-opencode.mjs"
        issue: "Heartbeat payload omits registry_rows array (grep registry_rows scripts/sub-agent-live-opencode.mjs returns 0 lines; claude has it line 140, copilot line 226)"
    missing:
      - "Add registry_rows: registry.listByAgent('opencode').map(...) to opencode daemon's writeHeartbeat payload"
  - truth: "CR-03: observations_written counter stuck at 0 in claude-fs-watch (stale Map reference mutation)"
    status: failed
    reason: "lib/lsl/live/claude-fs-watch.mjs:515-527 mutates a stale Map row reference after upsert({}) replaces the slot. The `cur` reference points to the orphaned previous object. registry.markCompleted({observations_written: row.observations_written}) at line 544 ALWAYS falls through to exchangesEmitted because the truthy check on 0 fails. Counter observable-via-side-channel and provably broken if read mid-tail."
    artifacts:
      - path: "lib/lsl/live/claude-fs-watch.mjs"
        issue: "Lines 515-527 — stale reference mutation after registry.upsert() replaces Map slot"
    missing:
      - "Single atomic upsert with observations_written: (cur.observations_written || 0) + 1, OR add registry.incrementObservationsWritten() method"
  - truth: "AC #3 (CONTEXT.md) — observation parity within ≤15 min for live tier"
    status: failed
    reason: "Only 2 observations tagged source='sub-agent' (live tier) exist in .observations/observations.db. The launchd-spawned live daemons cannot start due to CR-04 (EX_CONFIG exit). The 2 sub-agent observations that DO exist likely come from manually-run nohup'd daemons during testing, not from operational launchd-driven capture. The Path A end-to-end pipeline (launchd → daemon → ObservationWriter → DB) is not verified working in production on this Apple Silicon host."
    artifacts:
      - path: "launchctl list output"
        issue: "All 3 live daemons report exit code 78 (EX_CONFIG); PID column is '-'"
      - path: "scripts/health-coordinator.js (running process)"
        issue: "Running coordinator process (PID 1806) was launched Tue 07AM — before Plan 51-11 health-coordinator changes were merged. /health/state returns 404; sub_agent_capture cannot be runtime-verified without restart"
    missing:
      - "Functioning launchd-spawned live daemons that produce sub-agent observations in DB"
      - "Health-coordinator restart so /health/state surfaces sub_agent_capture"
      - "Operator-side verification of AC #3 (deferred to 51-HUMAN-UAT.md Test 2)"
deferred:
  - truth: "Plan 51-10 Task 3 — live tmux statusline verification under sub-agent load"
    addressed_in: "51-HUMAN-UAT.md Test 3"
    evidence: "Partial verify on 2026-05-27 confirmed no regression in fresh session; full failure mode (parent frozen + sub-agents running) requires functioning launchd daemons which are blocked by CR-04"
  - truth: "Plan 51-11 Tasks 3+4 — operator launchd install + 6 final acceptance criteria"
    addressed_in: "51-HUMAN-UAT.md Tests 1 + 2"
    evidence: "Both tests recorded as pending in HUMAN-UAT.md. CR-04 surfaced during Task 3 attempted install; AC #1-6 verification (Task 4) blocked until launchd daemons can boot."
  - truth: "OpenCode schema migration=null fatal error blocks live OpenCode capture"
    addressed_in: "51-HUMAN-UAT.md Test 1.A"
    evidence: "Logged during Plan 51-11 closure: operator's opencode SQLite db has schema migration=null which is not in SUPPORTED_MIGRATIONS=[1,2,3,4]. Either operator has no opencode db at expected path, or version drift. Non-blocking for Phase 51 closure per operator note (active agent is Claude)."
human_verification:
  - test: "Plan 51-11 Task 3 — launchd install smoke verify"
    expected: "All 4 launchd jobs reach state=running with PID column ≠ '-'; each live daemon writes at least one heartbeat to .data/live-<agent>.log"
    why_human: "Requires operator-side launchctl bootstrap + actual node binary path resolution on the install host; cannot be automated without invoking macOS gui/$UID/ launchd domain (already deferred to 51-HUMAN-UAT.md Test 1)"
  - test: "Plan 51-11 Task 4 — 6 final CONTEXT.md acceptance criteria"
    expected: "AC1-AC6 all pass under a fresh /gsd-execute-phase run with screenshots captured to .planning/phases/51-.../verification/"
    why_human: "Requires live wave-execution with sub-agents spawning + visual dashboard inspection + browser screenshot capture (already deferred to 51-HUMAN-UAT.md Test 2)"
  - test: "Health-coordinator /health/state runtime surface of sub_agent_capture"
    expected: "After restarting health-coordinator (PID 1806 is from Tue 07AM, pre Plan-51-11 merge), curl http://localhost:3033/health/state returns JSON containing sub_agent_capture block per Plan 51-11 interfaces spec"
    why_human: "Requires operator to restart the coordinator process; current /health/state returns 404 because the running process predates the route addition"
---

# Phase 51: Agent-Agnostic Sub-Agent Capture — Verification Report

**Phase Goal:** Agent-agnostic sub-agent capture across LSL and observations for claude / opencode / copilot / mastra. Path B (sweep) ships first, Path A (live hooks) second per D-Order; D-LSL-Filename convention applied across all four agents; the 2026-05-24 statusline mitigation is replaced with registry-sourced reads; final closure surfaces sub_agent_capture in /health/state.

**Verified:** 2026-05-27T08:15:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from CONTEXT.md Acceptance Criteria + Plan must_haves)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Agent-agnostic registry with locked schema across 4 agents | VERIFIED | `lib/lsl/registry.mjs` (215 lines) exports createRegistry + Registry class with all 7 methods (upsert/get/listByAgent/listByProject/markCompleted/size/clear); 12 unit tests pass |
| 2 | Adapter loader resolves 4 agent IDs to module paths under `lib/lsl/adapters/` | VERIFIED | `lib/lsl/adapters/index.mjs` exports AGENTS (frozen 4-tuple), loadAdapter, getAgentSearchPaths; all 4 adapter files present (claude-jsonl-tree, opencode-sqlite, copilot-events, mastra-ndjson) |
| 3 | Sweep dispatcher drives all 4 agents | VERIFIED | `scripts/sweep-sub-agents.mjs` --help works; 7 dispatcher tests pass with fake adapters across 4 agent ids; tags observations with `sub-agent-backfill` per D-Live-Sweep-Tags |
| 4 | parseCopilot v1.0.48 dotted event names supported | VERIFIED | `src/live-logging/TranscriptNormalizer.js:200-223` contains user.message, assistant.message, subagent.started, subagent.completed |
| 5 | D-LSL-Filename writer + slot allocator + CLI | VERIFIED (code) / FAILED (production output) | `lib/lsl/sub-agent-lsl-writer.mjs` (472 lines), `lib/lsl/sub-agent-slot-allocator.mjs` (138 lines), `scripts/write-sub-agent-lsl.mjs` (292 lines); 30 tests pass; smoke test produced 624 LSL files in sandbox `/private/var/folders/.../tmp.JxUhsiW7Dc/history/`. BUT production `.specstory/history/` contains 0 S-pattern files. AC #2 NOT verified end-to-end. |
| 6 | 2026-05-23 historical backfill → observations | PARTIAL | 117 observations tagged source='sub-agent-backfill' in DB; parent UUIDs 5d22e2d5 + 31274d29 (CONTEXT.md targets) confirmed present via sourceFile field. BUT metadata.parent_session_id / sub_index / sub_hash fields are EMPTY in DB — D-Live-Sweep-Tags partially honored (sourceFile encodes parent UUID; typed fields missing). |
| 7 | Path A — Claude live FSEvents watcher + daemon | VERIFIED (code) / FAILED (runtime) | `lib/lsl/live/claude-fs-watch.mjs` (647 lines) + `scripts/sub-agent-live-claude.mjs` (307 lines) exist with daemon CLI. CR-03 bug present (observations_written counter stuck at 0 via stale Map reference). Manual nohup'd run works (heartbeat seen). Launchd-spawned daemon FAILS with EX_CONFIG due to CR-04 (`/usr/local/bin/node` hardcoded). |
| 8 | Path A — OpenCode live SQLite polling daemon | VERIFIED (code) / FAILED (runtime) | `lib/lsl/live/opencode-sqlite-poll.mjs` (371 lines) + `scripts/sub-agent-live-opencode.mjs` (290 lines) exist. CR-02 bug present (heartbeat omits registry_rows → /health/state reports 0 running). Manual run fails with `unsupported opencode schema migration=null` (HUMAN-UAT Test 1.A). Launchd fails with EX_CONFIG (CR-04). |
| 9 | Path A — Copilot live file-tail daemon | VERIFIED (code) / FAILED (runtime) | `lib/lsl/live/copilot-events-tail.mjs` (719 lines) + `scripts/sub-agent-live-copilot.mjs` (281 lines) exist. WR-02/WR-03 (unbounded buffer + lastSize advancement) bugs flagged in 51-REVIEW. Manual run works (heartbeat file present, stale). Launchd fails with EX_CONFIG (CR-04). |
| 10 | Statusline mitigation replaced with registry-sourced reads | VERIFIED | `scripts/combined-status-line.js` imports registry-reader at line 26; `getProjectSubMt(projectName)` called at lines 484, 1162; comments at lines 470, 1153 reference "replaces the 2026-05-24 mitigation that walked subagents/". The 3 D-Statusline cleanup targets (`_freshestProjectActivityAgeMs`, `transcriptAgeMs`, mapping write) all source from `registry.getProjectSubMt()`. |
| 11 | 4 launchd plists + idempotent installer + sweep wrapper | VERIFIED (artifacts) / FAILED (functional) | All 4 plists pass `plutil -lint` and are loaded into `launchctl list`. BUT 3 live-daemon plists hardcode `/usr/local/bin/node` (CR-04 — Apple Silicon path is `/opt/homebrew/bin/node`); all 3 exit with code 78 (EX_CONFIG) on every spawn attempt. Sweep plist uses /bin/bash wrapper which DOES find node via PATH (works). |
| 12 | health-coordinator surfaces sub_agent_capture in /health/state | VERIFIED (code) / NOT VERIFIED (runtime) | `scripts/health-coordinator.js` has full pollSubAgentCapture (lines 638+) that imports lib/lsl/registry-reader.mjs and stamps currentState.sub_agent_capture (line 732). BUT the RUNNING process (PID 1806) started Tue 07AM — predates the Plan 51-11 merge — and /health/state returns 404. Cannot runtime-verify until restart (deferred to HUMAN-UAT). |
| 13 | Phase 50 D-Reuse — lib/lsl/window.mjs + scan-and-convert.mjs unchanged | VERIFIED | Both files have mtime 2026-05-26 16:04 (Phase 50 close); plan summaries assert byte-identical preservation across Phase 51 |
| 14 | No new npm packages added | VERIFIED | All 11 plan SUMMARYs declare `tech-stack.added: []`; better-sqlite3 reused from Phase 50; chokidar etc. not added |
| 15 | AC #4 (CONTEXT.md) — agent-agnostic across all 4 agents | PARTIAL | All 4 adapters exist with `agentId` + `storageType` declarations; Mastra Path A locked NOT VIABLE per RESEARCH (correct); OpenCode runtime broken (HUMAN-UAT Test 1.A schema migration=null fatal); Copilot inner content lost (degraded LSL parity acknowledged) |
| 16 | AC #6 (CONTEXT.md) — dashboard knowledge-pipeline badge stays GREEN during sub-agent wave | NOT VERIFIED | Code path is wired (statusline → registry-reader → heartbeat files). But launchd daemons don't run (CR-04), so heartbeat files are stale/missing, so badge cannot be tested end-to-end. Plan 51-10 Task 3 deferred to HUMAN-UAT for this reason. |

**Score:** 10/16 must-haves VERIFIED (artifacts + tests in place), 6 with FAILED or PARTIAL status

### Deferred Items

Items not yet met but explicitly addressed in HUMAN-UAT (operator-side gates per phase context).

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | Plan 51-10 Task 3 live tmux verification under sub-agent load | 51-HUMAN-UAT.md Test 3 | Partial verify confirmed no regression; full failure mode requires functioning launchd daemons (blocked by CR-04) |
| 2 | Plan 51-11 Tasks 3+4 operator install + 6 ACs | 51-HUMAN-UAT.md Tests 1 + 2 | Recorded as `result: pending`; CR-04 surfaced during Task 3 install attempt |
| 3 | OpenCode schema migration=null fatal | 51-HUMAN-UAT.md Test 1.A | Logged as known limitation; non-blocking per operator (Claude is active agent) |

### Required Artifacts (Plan Frontmatter must_haves)

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `lib/lsl/registry.mjs` | Agent-agnostic registry, 7 methods, 120+ lines | VERIFIED | 215 lines; all 7 methods (createRegistry/Registry class with upsert/get/listByAgent/listByProject/markCompleted/size/clear) |
| `lib/lsl/adapters/index.mjs` | AGENTS + loadAdapter + getAgentSearchPaths, 70+ lines | VERIFIED | 149 lines; all 3 exports present |
| `lib/lsl/adapters/claude-jsonl-tree.mjs` | Claude sweep adapter, 150+ lines | VERIFIED | 531 lines; agentId='claude', storageType='jsonl-tree', isSidechain filter present |
| `lib/lsl/adapters/opencode-sqlite.mjs` | OpenCode sweep adapter, 200+ lines | VERIFIED with BUG | 578 lines; CR-01 limit bug (line 231 reads searchPaths.limit off an Array) |
| `lib/lsl/adapters/copilot-events.mjs` | Copilot sweep adapter, 180+ lines | VERIFIED | 467 lines; agentId='copilot', storageType='events-jsonl' |
| `lib/lsl/adapters/mastra-ndjson.mjs` | Mastra sweep adapter, 130+ lines | VERIFIED | 490 lines; agentId='mastra', storageType='ndjson' |
| `lib/lsl/live/claude-fs-watch.mjs` | Claude live watcher, 200+ lines | VERIFIED with BUG | 647 lines; CR-03 stale reference mutation (lines 515-527) |
| `lib/lsl/live/opencode-sqlite-poll.mjs` | OpenCode polling watcher, 180+ lines | VERIFIED | 371 lines |
| `lib/lsl/live/copilot-events-tail.mjs` | Copilot file-tail watcher, 200+ lines | VERIFIED with BUGS | 719 lines; WR-02/WR-03 (unbounded buffer + lastSize advancement) |
| `lib/lsl/sub-agent-lsl-writer.mjs` | D-LSL-Filename writer, 200+ lines | VERIFIED | 472 lines; computeLSLFilename + writeSubAgentLSL exported |
| `lib/lsl/sub-agent-slot-allocator.mjs` | Slot allocator, 90+ lines | VERIFIED | 138 lines; allocateSlot/loadSlotState/saveSlotState exported |
| `lib/lsl/registry-reader.mjs` | Heartbeat reader, 100+ lines | VERIFIED with BUG | 200 lines; CR-02 cascade (opencode daemon doesn't emit registry_rows so reader always sees 0 running) |
| `scripts/sweep-sub-agents.mjs` | Dispatcher CLI | VERIFIED | 222 lines; --help works; tagged sub-agent-backfill |
| `scripts/sub-agent-live-{claude,opencode,copilot}.mjs` | Live daemons | VERIFIED (code) / FAILED (launchd) | All 3 present; --help works manually; launchd-spawned versions exit EX_CONFIG (CR-04) |
| `scripts/write-sub-agent-lsl.mjs` | LSL writer CLI | VERIFIED | 292 lines; --help shows all 7 flags; default --output-root is `.specstory/history` |
| `scripts/backfill-subagent-transcripts.mjs` | Thin wrapper around sweep | VERIFIED | 38 lines; delegates to `scripts/sweep-sub-agents.mjs --agent claude --project coding` |
| `scripts/install-sub-agent-launchd.sh` | Idempotent installer | VERIFIED with BUG | 110 lines, bash -n clean; CR-04 — doesn't detect node via `command -v` |
| `scripts/sub-agent-sweep-job.sh` | Sweep wrapper script | VERIFIED | 115 lines, bash -n clean, set -euo pipefail present |
| `launchd/com.coding.sub-agent-sweep.plist` | 30-min sweep job | VERIFIED | plutil -lint OK; uses /bin/bash wrapper (avoids CR-04) |
| `launchd/com.coding.sub-agent-live-{claude,opencode,copilot}.plist` | KeepAlive live daemons | VERIFIED (structure) / FAILED (functional) | plutil -lint OK on all 3; loaded in launchctl list; but all 3 exit EX_CONFIG (78) because `/usr/local/bin/node` not present on Apple Silicon (CR-04) |
| `scripts/health-coordinator.js` | sub_agent_capture in /health/state | VERIFIED (code) / NOT VERIFIED (runtime) | pollSubAgentCapture + currentState.sub_agent_capture wiring present (lines 220, 638+, 1723); RUNNING process (PID 1806) is stale (Tue 07AM start, pre-merge); /health/state returns 404 |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `scripts/sweep-sub-agents.mjs` | `lib/lsl/adapters/index.mjs` | loadAdapter | WIRED | Line 50: `import { AGENTS, loadAdapter, getAgentSearchPaths } from '../lib/lsl/adapters/index.mjs'` |
| `scripts/sweep-sub-agents.mjs` | `lib/lsl/registry.mjs` | createRegistry | WIRED | Line 49: `import { createRegistry } from '../lib/lsl/registry.mjs'`; line 121 instantiates |
| `lib/lsl/adapters/claude-jsonl-tree.mjs` | `lib/lsl/scan-and-convert.mjs` | convertTranscriptsToObservations | WIRED | Adapter imports primitive unchanged (D-Reuse honored — Phase 50 files mtime 2026-05-26 16:04 untouched) |
| `lib/lsl/sub-agent-lsl-writer.mjs` | `lib/lsl/sub-agent-slot-allocator.mjs` | allocateSlot | WIRED | Slot allocator's allocateSlot consumed by writer per Plan 51-06 contract |
| `scripts/combined-status-line.js` | `lib/lsl/registry-reader.mjs` | getProjectSubMt | WIRED | Line 26 dynamic import; lines 484/1162 call sites; comments at 470/1153 confirm 2026-05-24 mitigation replaced |
| `scripts/health-coordinator.js` | `lib/lsl/registry-reader.mjs` | loadAllHeartbeats | WIRED | Line 645 dynamic import; line 732 stamps currentState.sub_agent_capture |
| `scripts/sub-agent-live-claude.mjs` | `lib/lsl/registry.mjs` | registry.upsert | WIRED | Heartbeat emits registry_rows (line 140) |
| `scripts/sub-agent-live-opencode.mjs` | `lib/lsl/registry.mjs` | registry.upsert | PARTIAL — CR-02 | Daemon registers with registry BUT heartbeat OMITS registry_rows → registry-reader cannot enumerate running opencode sub-agents |
| `scripts/sub-agent-live-copilot.mjs` | `lib/lsl/registry.mjs` | registry.upsert | WIRED | Heartbeat emits registry_rows (line 226) |
| launchd plists → daemon scripts | `/usr/local/bin/node` resolution | ProgramArguments[0] | NOT_WIRED — CR-04 | 3 live plists hardcode missing path; launchctl reports exit code 78 (EX_CONFIG) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `.observations/observations.db` | `metadata.source='sub-agent-backfill'` rows | Plan 51-02 Claude adapter + sweep CLI run | YES — 117 rows | FLOWING |
| `.observations/observations.db` | `metadata.source='sub-agent'` rows | Plan 51-07/08/09 live daemons | PARTIAL — only 2 rows (from manual nohup'd Claude daemon test, not launchd) | STATIC |
| `.specstory/history/{YYYY}/{MM}/*_S*-*-*.md` | D-LSL-Filename sub-agent LSL files | Plan 51-06 writer CLI | NO — production dir empty (sandbox-only smoke test) | DISCONNECTED |
| `/health/state.sub_agent_capture` | Plan 51-11 health-coordinator block | health-coordinator process | NO — running process is stale (pre-merge); endpoint returns 404 | DISCONNECTED |
| `.data/sub-agent-live-state-claude.json` | Claude daemon heartbeat | Launchd-spawned `sub-agent-live-claude.mjs` | NO — launchd daemon exits EX_CONFIG (CR-04); only the un-suffixed file exists from manual nohup test | DISCONNECTED |
| `.data/sub-agent-live-state-opencode.json` | OpenCode daemon heartbeat | Launchd-spawned `sub-agent-live-opencode.mjs` | NO — file missing (daemon never started successfully) | DISCONNECTED |
| `.data/sub-agent-live-state-copilot.json` | Copilot daemon heartbeat | Launchd-spawned `sub-agent-live-copilot.mjs` | YES (from manual run) — file present but stale (1.4M ms = ~23 min old) | STATIC |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Sweep dispatcher CLI usage | `node scripts/sweep-sub-agents.mjs --help` | Exits 0; prints --agent --since --dry-run --project --limit | PASS |
| LSL writer CLI usage | `node scripts/write-sub-agent-lsl.mjs --help` | Exits 0; lists all flags including --output-root | PASS |
| Claude live daemon CLI usage | `node scripts/sub-agent-live-claude.mjs --help` | Exits 0; lists --projects-dir --state-file --heartbeat-interval | PASS |
| Backfill wrapper CLI | `scripts/backfill-subagent-transcripts.mjs` | Thin 38-line wrapper around sweep CLI (verified file content) | PASS |
| Installer bash syntax | `bash -n scripts/install-sub-agent-launchd.sh` | Exits 0 | PASS |
| Sweep wrapper bash syntax | `bash -n scripts/sub-agent-sweep-job.sh` | Exits 0 | PASS |
| All 4 plists pass plutil -lint | `for p in launchd/com.coding.sub-agent-*.plist; do plutil -lint "$p"; done` | All 4 return OK | PASS |
| Backfilled observations exist | `sqlite3 ... WHERE source='sub-agent-backfill'` | 117 rows | PASS |
| Distinct parent UUIDs for 2026-05-23 incident | Backfill includes 5d22e2d5 + 31274d29 | 2 of 6 parents include the CONTEXT.md targets | PASS |
| metadata.parent_session_id / sub_index / sub_hash populated | Inspect first row's metadata | All 3 fields are EMPTY in DB (only sourceFile encodes parent UUID) | FAIL — D-Live-Sweep-Tags partial |
| Production .specstory/history sub-agent LSL files | `find .specstory/history -name '*_S*-*-*.md'` | 0 files | FAIL — AC #2 not satisfied in production |
| Sandbox smoke test artifacts (Plan 51-06 SUMMARY claim) | `find /private/var/folders ... -name '*_S*-*-*.md'` | 624 files total; 20 for 2026-05-23 | PASS (sandbox-only, NOT production) |
| Launchd live daemons running | `launchctl list \| grep sub-agent` | All 3 live daemons report exit code 78; sweep job exit 0 (idle) | FAIL — CR-04 |
| /health/state surfaces sub_agent_capture | `curl http://localhost:3033/health/state` | 404 — running process is stale (Tue 07AM) | FAIL (runtime; code is correct) |

### Probe Execution

No formal probe-*.sh probes exist for this phase. The behavioral spot-checks above and the test suites serve as the verification surface. Phase 51 is not a migration-style phase with `scripts/*/tests/probe-*.sh`.

### Requirements Coverage

No requirement IDs are registered for Phase 51 in `.planning/REQUIREMENTS.md` (this is an out-of-milestone bug-fix per STATE.md line 47). All 11 plans correctly declare `requirements: []`. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `lib/lsl/adapters/opencode-sqlite.mjs` | 231 | CR-01: searchPaths.limit read off Array → always undefined | BLOCKER | --limit dispatcher flag silently dead for OpenCode |
| `scripts/sub-agent-live-opencode.mjs` | 232-242 | CR-02: heartbeat omits registry_rows | BLOCKER | /health/state always reports 0 running for OpenCode |
| `lib/lsl/live/claude-fs-watch.mjs` | 515-527 | CR-03: stale Map reference mutation | BLOCKER | observations_written counter stuck at 0 forever |
| `launchd/com.coding.sub-agent-live-*.plist` × 3 | 9 | CR-04: hardcoded `/usr/local/bin/node` | BLOCKER | Path A non-functional on Apple Silicon Macs |
| `lib/lsl/adapters/copilot-events.mjs` | 243-249 | WR-01: ignores --since (re-scans all sessions every tick) | WARNING | CPU waste every 30 min |
| `lib/lsl/live/copilot-events-tail.mjs` | 274-276 | WR-02: unbounded Buffer.alloc | WARNING | Memory DoS on large append |
| `lib/lsl/live/copilot-events-tail.mjs` | 276-277 | WR-03: lastSize advances past unread bytes on partial readSync | WARNING | Event loss |
| `lib/lsl/live/claude-fs-watch.mjs` | 114-124 | WR-04: pushExchangeIfReady flushes any 2 records as user/assistant | WARNING | Malformed pairs to ObservationWriter |
| `scripts/write-sub-agent-lsl.mjs` | 155, 187 | WR-05: --historical flag is dead code (both branches return null) | WARNING | Misleading CLI surface |
| `scripts/combined-status-line.js` | 23-28 | WR-06: lazy import races on first concurrent load | WARNING | Minor (ESM cache makes it benign) |
| `scripts/sub-agent-live-claude.mjs` | 52 | WR-07: --state-file default disagrees with launchd convention | WARNING | Operator-debug heartbeats invisible to reader |
| `scripts/health-coordinator.js` | 702-716 | WR-08: sweep state file not uid-checked consistently | WARNING | Threat-model gap |
| `scripts/write-sub-agent-lsl.mjs` | 50-54 | WR-09: unused _allocateSlot import | WARNING | Dead import |

No TBD/FIXME/XXX debt markers found in scope files. All cleanup-comment patterns (placeholder, coming soon) absent. Anti-patterns above are real defects flagged by 51-REVIEW.md.

### Human Verification Required

#### 1. Plan 51-11 Task 3 — Operator launchd install + smoke verify

**Test:** Run `bash /Users/Q284340/Agentic/coding/scripts/install-sub-agent-launchd.sh`, then `launchctl list | grep com.coding.sub-agent`, confirm all 4 jobs reach `state=running` with PID column ≠ '-'.
**Expected:** All 4 jobs loaded; each live daemon writes at least one heartbeat to `.data/live-<agent>.log`.
**Why human:** Requires operator-side launchctl bootstrap + actual node binary path resolution on the install host. Currently BLOCKED by CR-04 — on Apple Silicon all 3 live daemons exit with EX_CONFIG (78). Recorded in 51-HUMAN-UAT.md Test 1.

#### 2. Plan 51-11 Task 4 — 6 final CONTEXT.md acceptance criteria

**Test:** Run a fresh `/gsd-execute-phase <small-test-phase>` and verify all 6 ACs from CONTEXT.md (backfill + LSL parity + observation parity ≤15 min + agent-agnostic + idempotency + dashboard truth) with screenshots captured to `.planning/phases/51-.../verification/`.
**Expected:** AC1-AC6 all pass; screenshots present.
**Why human:** Requires live wave-execution with sub-agents spawning + visual dashboard inspection + browser screenshot capture. Currently BLOCKED by CR-04 (live daemons non-functional). Recorded in 51-HUMAN-UAT.md Test 2.

#### 3. Plan 51-10 Task 3 — Live tmux statusline verification under sub-agent load

**Test:** Verify `C🟢` bubble stays GREEN during sub-agent execution (registry-reader signal kicks in when parent transcript freezes); visibleCellWidth + codepoint-widths rendering unchanged.
**Expected:** No bubble fade-to-⚫ during active sub-agent run; no tmux emoji-width regression.
**Why human:** Visual tmux rendering check; requires functioning launchd-spawned daemons (blocked by CR-04). Recorded in 51-HUMAN-UAT.md Test 3 (partial).

#### 4. Health-coordinator restart + /health/state runtime verification

**Test:** Restart the running health-coordinator process (PID 1806, started Tue 07AM — pre-merge) then `curl http://localhost:3033/health/state` and assert the response contains a `sub_agent_capture` block matching the Plan 51-11 interfaces spec (live_registrations / last_sweep_at / registry_size / per_agent).
**Expected:** /health/state returns JSON with sub_agent_capture present.
**Why human:** Requires the operator to restart the launchd-managed health-coordinator process; the running instance predates Plan 51-11 code merge.

### Gaps Summary

Phase 51 delivers the entire agent-agnostic sub-agent capture pipeline **in code** — registry, 4 sweep adapters, 3 live daemons, D-LSL-Filename writer, statusline cleanup, launchd integration, health-coordinator surface. All 11 plan SUMMARYs are complete, all artifacts present, jest test suites pass per-plan (181+ tests passing including the Phase 50 47-test regression suite).

**Six observable truths fail end-to-end verification on the codebase as shipped:**

1. **CR-04 (hardcoded node path)** — the most impactful gap. All 3 live-daemon plists hardcode `/usr/local/bin/node`, which does not exist on Apple Silicon Macs. Verified live: `launchctl list` shows exit code 78 (EX_CONFIG) for all three. Path A is effectively non-functional on this host. The sweep job uses /bin/bash and works fine. The installer (`scripts/install-sub-agent-launchd.sh`) does not detect node via `command -v node` and substitute the absolute path before copying the plists, so re-running the installer cannot fix the problem.

2. **CR-01 (OpenCode --limit silently ignored)** — `searchPaths.limit` is read off an Array which has no `.limit` property; always defaults to 100. The dispatcher's `--limit` flag is dead for OpenCode.

3. **CR-02 (OpenCode heartbeat missing registry_rows)** — registry-reader cannot enumerate live OpenCode sub-agents; `/health/state.sub_agent_capture.live_registrations.opencode.running` is permanently 0.

4. **CR-03 (Claude observations_written counter stuck at 0)** — stale Map reference mutation after upsert; counter unobservable mid-tail.

5. **AC #2 (LSL parity in production .specstory/history/)** — Plan 51-06 SUMMARY's "624 LSL files" refers to a sandbox smoke test under `/private/var/folders/.../tmp.JxUhsiW7Dc/history/`; the production `.specstory/history/` contains ZERO D-LSL-Filename files. The writer works; it just hasn't been pointed at production yet.

6. **AC #3 (observation parity ≤15 min)** — only 2 observations tagged `source='sub-agent'` exist in DB, from manually-run nohup'd daemons during testing, not from operational launchd-driven live tier capture. Cannot be verified end-to-end without functioning launchd daemons (blocked by CR-04).

**Additionally:**
- Metadata enrichment partial: 117 backfill observations exist but `metadata.parent_session_id` / `sub_index` / `sub_hash` are EMPTY in DB; only `sourceFile` encodes the parent UUID. D-Live-Sweep-Tags is partially honored — observations exist and source-tagged, but typed fields are missing for downstream consumers.
- Health-coordinator code is wired correctly but the RUNNING process (PID 1806) predates the Plan 51-11 merge. Restart needed before `/health/state` shows sub_agent_capture.
- OpenCode schema migration=null fatal blocks even manual-run OpenCode daemon (HUMAN-UAT Test 1.A).

**Status interpretation:** Phase 51 is well-engineered as a body of code — every plan delivered substantive, tested artifacts that integrate per the locked contract. The 4 Critical findings (CR-01..CR-04) plus AC#2/AC#3 end-to-end gaps make this `gaps_found` rather than `passed`. The deferred HUMAN-UAT items are correctly recorded for operator follow-up. A gap-closure plan (Phase 51.1 or similar) bundling CR-01..CR-04 + the high-risk Warnings is the natural next step before Phase 51 can fully close.

---

_Verified: 2026-05-27T08:15:00Z_
_Verifier: Claude (gsd-verifier)_

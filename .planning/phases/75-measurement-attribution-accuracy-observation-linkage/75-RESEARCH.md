# Phase 75: Measurement Attribution Accuracy & Observation Linkage - Research

**Researched:** 2026-06-29
**Domain:** Measurement/telemetry attribution + observation event-time correctness (existing in-repo infrastructure — NOT a new AI/LLM system)
**Confidence:** HIGH (every load-bearing claim verified against on-disk source and real `token_usage.db` data)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01: Both stamp + denylist guard.** Positive lineage = explicit `task_id` at the foreground capture seam (ATTR-03 own-rows carry the active task_id). A process denylist (`consolidator-*`, `health-coordinator`, `observation-writer`, other non-task daemons) defensively classifies any in-window row lacking foreground lineage as background. Replaces TELEM-03's "in-window → task_id" blanket rule.
- **D-02: Background rows kept but segregated, not dropped.** Concurrent background rows stay associated with the Run but are flagged as background. Run headline cost = foreground only; segregated background rows feed ATTR-02's background-models column. (Discretion: new column vs aggregation-time derivation — pick least-invasive that survives re-aggregation.)
- **D-03: Batch at measurement-stop.** On stop, read the active agent transcript, build rows, stamp task_id, `insertTokenRowDeduped()`. Reuse `buildClaudeTokenRows()`. Live-streaming deferred.
- **D-04: All four foreground agents via a per-agent adapter registry.** Claude Code, Copilot CLI, OpenCode, Mastra. Only build a transcript adapter for agents that BYPASS the proxy; proxy-routed agents need task_id STAMPING only, not a new adapter (double-count risk).
- **D-05: Canonical = the foreground chat agent.** One canonical model/agent per Run = the agent/model that ran the measured session (from ATTR-03 capture). Background-service models never canonical. Replaces `byAgentModel[0]`. Legacy un-re-measured Runs → empty canonical. (Discretion: empty-canonical display string.)
- **D-06: Compute once at stop, persist on the Run entity.** `measurement-stop` writes `canonical_model` + `background_models[]` onto `Run.metadata`. Runs table, score drawer, timeline READ these — no per-surface recompute.
- **D-07: Re-capture on AskUserQuestion decisions + significant tool-activity batches.** No arbitrary periodic timer this phase. (Discretion: concrete batch threshold + dedup key.)
- **D-08: Stamp each observation with the triggering exchange timestamp** (decision time or last message in batch), not prompt-set start, not wall-clock.
- **D-09: ETM reads `getActiveMeasurement()` and stamps `task_id`** (same single-span reader as the token path, `resolveLiveTaskIdSafe()`); observations exposed and queryable per Run.

### Claude's Discretion
- Storage for the fg/bg discriminator (new `token_usage` column vs aggregation-time derivation) — least-invasive that survives re-aggregation.
- Concrete "significant tool-activity batch" threshold + observation dedup key.
- Empty-canonical display string for legacy Runs.

### Deferred Ideas (OUT OF SCOPE)
- Live (in-session) foreground token streaming (file watcher, partial-turn, crash recovery) → future phase.
- Periodic time-based observation flush for ultra-long question-less stretches → later if decision/tool-batch boundaries prove insufficient.
- Out of scope (CONTEXT domain): rubric/judge/Score keying, `token_usage` schema *shape* redesign (extend only), Phase 67 replay rig, Phase 74 query-builder/report features.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ATTR-01 | Attribute by task/process lineage, not time-window; segregate background daemons | D-01 denylist values confirmed in real data (§Q3); lineage = `user_hash`/`task_id` stamp (§Q1). Aggregation-time derivation recommended (§Q2). |
| ATTR-02 | One canonical model/agent + per-process breakdown, two-column display across 3 surfaces | Canonical = fg chat agent (§Q7); read path `readRuns` spreads `...meta` so new fields flow automatically (§Q7). |
| ATTR-03 | Capture fg agent's own tokens into `token_usage` stamped with task_id | Root cause confirmed: 0 `cladpt` rows in bad run; live watcher only tails sub-agent JSONLs, never main session (§Q1, §Pitfall 1). |
| OBS-01 | Observations tagged with active task_id, queryable per Run | `ObservationWriter.processMessages` can resolve span at write time without proxy coupling (§Q6). |
| OBS-02 | ETM captures throughout prompt-set with real event times | AskUserQuestion + per-message timestamps confirmed present in transcript (§Q4, §Q5); fix is in ETM prompt-set boundary logic (§Q4). |
</phase_requirements>

## Summary

This phase corrects a measurement rig whose foundational plumbing already exists (Phases 68/69/71/73/74) but is wired for the wrong unit of work: **sub-agent transcripts and proxy-routed daemons, not the interactive foreground session.** The `exp-dash-start-control` run proved it — 1.24M tokens / haiku attributed to an Opus session, with **zero (`SELECT COUNT(*) WHERE user_hash='cladpt'` = 0)** rows from the foreground Claude adapter. All 186 attributed rows are proxy traffic (`user_hash='c197ef'`) from consolidator/observation/health daemons that overlapped the 05:33–05:54Z span.

Two independent root causes, both stemming from the same "interactive foreground" blind spot:
1. **Token side (ATTR-01/02/03):** TELEM-03 attributes every in-window proxy row to the task. The foreground Claude session bypasses the proxy (talks to Anthropic directly) and its tokens are captured ONLY by `lib/lsl/live/claude-fs-watch.mjs` — which by design watches `<uuid>/subagents/agent-*.jsonl` and explicitly skips the main session (`isSidechain:false` gate). So the foreground session's own tokens are never captured, and the dashboard's canonical model is whatever daemon dominated by raw count.
2. **Observation side (OBS-01/02):** ETM's unit of observation is the *typed-prompt prompt-set*, snapshotted once near its start and stamped at `messages.find(m => m.createdAt)?.createdAt` (the first exchange = the typed prompt at T0). A GSD session is one typed prompt → hours of agent work steered by AskUserQuestion. Result: 8 observations, all stamped T0, none for the 9 h of morning work.

**Primary recommendation:** (a) Add a **main-session** Claude token adapter wired at `measurement-stop.mjs` step (3), keyed `cladpt`; for OpenCode/Mastra/Copilot stamp task_id on the existing proxy rows (do NOT build transcript adapters — they route through the proxy). (b) Derive the fg/bg discriminator at aggregation time from `user_hash` + denylist (no schema migration). (c) Compute `canonical_model` + `background_models[]` once at stop, write to `Run.metadata` (auto-flows via `readRuns` spread). (d) Refactor ETM's prompt-set flush into per-decision / per-tool-batch fires stamped with the batch's own last-message timestamp, and add `task_id` to observation metadata via `resolveLiveTaskIdSafe()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Foreground own-token capture (ATTR-03) | Host CLI / stop-path (`measurement-stop.mjs`) | LSL extraction (`lib/lsl/token/*`) | Stop is the convergence wiring point (D-03); extraction is pure & reusable |
| fg/bg discrimination (ATTR-01/02) | Aggregation layer (`token-aggregate.mjs`) | Persistence (`run-write.mjs`) | Derive at read so it survives re-aggregation (D-02); persist the *result* on Run |
| Canonical model selection (ATTR-02/05) | Stop-path compute-once | km-core Run entity (`run-write.mjs`) | D-06: compute once, persist, read everywhere |
| Dashboard two-column display (ATTR-02) | Dashboard frontend (3 components) | vkb-server `/api/experiments/runs` | Read `Run.metadata` fields; bind-mounted, no Docker rebuild |
| Observation re-capture + event time (OBS-02) | ETM (`enhanced-transcript-monitor.js`) | `ObservationWriter.processMessages` | ETM owns the unit-of-observation boundary; writer honors `createdAt` |
| Observation→Run linkage (OBS-01) | ETM (resolve at write) | `task-id.mjs` single-span reader | Reuse the same reader the token path uses (D-09) |

## Standard Stack

No new packages. This phase extends in-repo modules only.

### Core (existing, reused)
| Module | Purpose | Role in Phase 75 |
|--------|---------|------------------|
| `lib/lsl/token/token-db.mjs` | 21-col INSERT helpers, `cladpt`/`copadt` user_hash, `insertTokenRowDeduped()` | ATTR-03 insert seam (idempotent) |
| `lib/lsl/token/claude-token-rows.mjs` | `buildClaudeTokenRows()` extractor | ATTR-03 main-session capture (works on non-subagent paths) |
| `lib/lsl/token/task-id.mjs` | `resolveLiveTaskIdSafe()` single-span reader | Shared task_id resolution (ATTR-03 + OBS-01) |
| `lib/experiments/token-aggregate.mjs` | `aggregateByTaskId()` read-only SUM + `byAgentModel` | ATTR-01/02 fg/bg derivation point |
| `lib/experiments/run-write.mjs` | `writeRun()` idempotent Run+Outcome | D-06 persist `canonical_model`/`background_models[]` |
| `lib/experiments/query.mjs` | `readRuns()` joins Run+Score+Outcome, spreads `...meta` | D-06 read path (new fields auto-flow) |
| `scripts/measurement-stop.mjs` | close orchestrator (highest-churn file) | D-03 capture + D-05/D-06 compute wiring |
| `scripts/enhanced-transcript-monitor.js` (ETM) | prompt-set observation generation | OBS-02 re-capture + true-event-time refactor |
| `src/live-logging/ObservationWriter.js` | `processMessages()` → km-core | OBS-01 task_id in metadata; honors earliest `createdAt` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Aggregation-time fg/bg derivation | New `is_background`/`lineage` column on `token_usage` | Column = idempotent startup migration on a proxy-OWNED DB (coding is a second writer only — risky); derivation needs no schema change and re-heals on re-aggregate. **Recommend derivation.** |
| Batch-at-stop main-session capture | Extend the live watcher to also tail the main session | Live = the deferred idea; CONTEXT locks D-03 batch-at-stop. |

**Installation:** none.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. All work extends existing in-repo `.mjs`/`.js` modules and frontend `.tsx` components. (slopcheck/registry verification skipped: no new dependencies.)

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────────┐
TOKEN PATH (ATTR-01/02/03)│                                             │
                          ▼                                             │
  Foreground Claude ──(Anthropic direct, BYPASSES proxy)──► ~/.claude/projects/<cwd>/<sessionId>.jsonl
       session                                                          │  (MAIN session, NOT a subagent file)
                                                                        │
  Background daemons ──(rapid-llm-proxy)──► token-usage.db [user_hash=c197ef]
   consolidator-*, health-coordinator, observation-writer              │
                                                                        ▼
  measurement-stop.mjs ──(3) NEW: per-agent adapter registry──┐
     │  - claude  → buildClaudeTokenRows(mainSessionJsonl)     │  insertTokenRowDeduped(cladpt rows, task_id)
     │  - copilot → ALREADY in DB (copadt/proxy) → stamp only  │
     │  - opencode/mastra → ALREADY in DB (c197ef) → stamp only│
     │                                                          ▼
     │  aggregateByTaskId(task_id) ──► derive fg vs bg by user_hash + denylist
     │       canonical_model = fg chat agent (cladpt rows' model)
     │       background_models[] = distinct bg (model,process)
     ▼
  writeRun(...) ──► Run.metadata.{canonical_model, background_models[]}  (km-core experiment.json)
                          │
                          ▼
  vkb-server /api/experiments/runs (readRuns spreads ...meta) ──► dashboard
       runs-table.tsx | score-drawer.tsx | timeline.tsx  (render two columns)


OBSERVATION PATH (OBS-01/02)
  ETM tails transcript ──► prompt-set buffer (currentUserPromptSet)
       │  TODAY: one fire per typed-prompt set, created_at = first exchange (T0)
       │  FIX:  fire on (a) each AskUserQuestion tool_use/result boundary
       │        (b) significant tool-activity batch between decisions
       │        created_at = batch's last-message timestamp (D-08)
       │        metadata.task_id = resolveLiveTaskIdSafe() (D-09)
       ▼
  ObservationWriter.processMessages(messages, metadata)
       created_at = messages.find(m=>m.createdAt).createdAt  ← already honors per-message ts
       ──► km-core Observation entity (queryable per Run via metadata.task_id)
```

### Pattern 1: Per-agent adapter registry at stop (D-04)
**What:** A map keyed by agent → `{ mode: 'transcript' | 'stamp-only', build?, locate? }`. `claude` is `transcript` (build main-session rows, insert as `cladpt`). `copilot`/`opencode`/`mastra` are `stamp-only` (their rows already exist in `token_usage`; the gap is task_id, not capture).
**When to use:** ATTR-03 wiring in `measurement-stop.mjs` step (3), before `aggregateByTaskId`.
**Evidence:** see §Q1 verdict table.

### Pattern 2: Compute-once-at-stop, persist-on-Run, read-everywhere (D-06)
**What:** Already the established pattern (Phase 74). `readRuns` spreads `...e.metadata`, so adding `canonical_model`/`background_models` to `writeRun`'s `metadata` object makes them available to all dashboard surfaces with zero per-surface recompute.
```javascript
// run-write.mjs metadata block — add alongside existing tags:
canonical_model:    tags.canonical_model ?? null,   // fg chat agent's model, or null (legacy)
canonical_agent:    tags.canonical_agent ?? null,
background_models:  tags.background_models ?? [],    // [{ model, process, total_tokens }]
```

### Anti-Patterns to Avoid
- **Building a transcript adapter for opencode/mastra/copilot.** They route through the proxy → already in `token_usage`. A transcript adapter would DOUBLE-COUNT (CONTEXT D-04 explicit warning). Verified: opencode/mastra rows carry `provider='copilot'`/`'claude-code'` via proxy, `agent` set, `user_hash='c197ef'` (proxy hash) — they are proxy writes, not adapter writes.
- **Adding a column to the proxy-owned `token-usage.db`.** Coding is a SECOND writer only (`token-aggregate.mjs` opens `{ readonly:true }`; `token-db.mjs` opens with `fileMustExist:true`, never creates/migrates). A schema migration belongs to the proxy, not this phase. Derive fg/bg at aggregation.
- **Falling back to dominant model for legacy Runs.** D-05: empty canonical must display as a sentinel ("—" / "unmeasured"), never silently `byAgentModel[0]` (that recreates finding B).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| task_id resolution | A second span-file parser | `resolveLiveTaskIdSafe()` (`task-id.mjs`) | Single-span reader, best-effort, never throws; CONTEXT D-09 mandates reuse |
| Claude transcript → rows | A new extractor | `buildClaudeTokenRows()` | Handles uid-gate, per-turn + per-reasoning-step tiers, malformed-line skip; works on main-session paths too |
| Idempotent token insert | Manual dedup SQL | `insertTokenRowDeduped()` | `(user_hash, tool_call_id)` natural-key dedup already implemented |
| Run read/join | Re-query km-core per surface | `readRuns()` | Spreads `...meta`; new metadata fields flow free |
| Observation timestamp | Wall-clock at generation | `messages[].createdAt` (already honored) | `processMessages` uses earliest message `createdAt`; ETM just needs to pass the RIGHT (batch-local) timestamps |

**Key insight:** Almost everything needed already exists. Phase 75 is *re-targeting* existing capture at the foreground unit + *deriving/persisting* canonical attribution — not net-new extraction.

## Runtime State Inventory

This phase is partly a re-wiring/refactor; the runtime-state surfaces:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `token_usage.db` (`.data/llm-proxy/`, 50MB, 145k rows) — proxy-owned, coding is read+second-writer. Existing legacy Runs in `experiment.json` have NO `canonical_model`. | Code: aggregation derivation + new Run.metadata fields. Data: legacy Runs stay empty-canonical until re-measured (D-05 accepts this). No migration of proxy DB. |
| Live service config | `com.coding.etm` (launchd) runs `scripts/enhanced-transcript-monitor.js` from working dir `/Users/Q284340/Agentic/coding`. `com.coding.sub-agent-live-claude` runs the sub-agent token watcher. | ETM behavioral change ships in the source file → `launchctl kickstart -k gui/$(id -u)/com.coding.etm` to pick up. No re-registration (args unchanged). |
| OS-registered state | launchd jobs `com.coding.etm`, `com.coding.sub-agent-live-{claude,copilot,opencode}` — descriptions/args unchanged by this phase. | None — kickstart after deploy only. |
| Secrets/env vars | `LLM_PROXY_DATA_DIR`, `LLM_PROXY_DIST_DIR`, `CODING_REPO` — already read by stop/aggregate/task-id modules. No new vars. | None. |
| Build artifacts | Dashboard is bind-mounted: `.tsx` edits need `npm run build` + `supervisorctl restart web-services:health-dashboard-frontend` (CLAUDE.md), NOT Docker rebuild. `.mjs`/`.js` host modules are not compiled. | Plan must include the dashboard rebuild step for the ATTR-02 display tasks. |

## Common Pitfalls

### Pitfall 1: Assuming `buildClaudeTokenRows()` already captures the foreground session
**What goes wrong:** It's wired into `sub-agent-live-claude.mjs` via `onTokenRow`, so it LOOKS captured.
**Why it happens:** `lib/lsl/live/claude-fs-watch.mjs` matches only `RELATIVE_SUBAGENT_RE = /<uuid>/subagents/agent-<hex>.jsonl/` and discards any first-record `isSidechain:false` file. The MAIN interactive session JSONL (`~/.claude/projects/<cwd>/<sessionId>.jsonl`) is never tailed.
**How to avoid:** ATTR-03 must point `buildClaudeTokenRows()` at the **main-session** JSONL at stop time (it works on non-subagent paths — `SUBAGENT_PATH_RE` non-match just yields `parent_call_id=''`, rows still extract). Insert with `user_hash='cladpt'` and the active task_id.
**Warning signs:** `SELECT COUNT(*) FROM token_usage WHERE task_id=? AND user_hash='cladpt'` returns 0 after a measured Claude session (exactly the bad-run signature).

### Pitfall 2: Locating the right main-session JSONL at stop
**What goes wrong:** Multiple session files exist under `~/.claude/projects/<cwd>/`; picking the wrong one captures another session's tokens.
**Why it happens:** No `sessionId` is stored on the active-measurement span today (`{ task_id, started_at, ended_at?, goal_sentence? }`).
**How to avoid:** Locate by time-window (mtime/last-message-timestamp ∈ [started_at, ended_at]) — the same time-window seam `buildTraceSeam(normAgent, span)` already uses in `measurement-stop.mjs` for route heuristics. Consider capturing `sessionId` at `measurement-start` as a hardening follow-up (note for planner; not strictly required this phase).
**Warning signs:** captured model doesn't match the operator's known session model.

### Pitfall 3: ETM prompt-set boundary is per-typed-prompt, not per-decision
**What goes wrong:** A 9-hour session = one prompt set → one observation at T0.
**Why it happens:** `enhanced-transcript-monitor.js:1375` `if (exchange.isUserPrompt)` starts a new set only on a typed user prompt; flush fires the WHOLE set with `created_at` = first exchange.
**How to avoid:** Add mid-set fire points: (a) when an `AskUserQuestion` tool_use+tool_result pair is seen (decision boundary), (b) when accumulated tool-activity since the last fire crosses the batch threshold. Each fire passes only the batch's messages, so `processMessages`'s earliest-`createdAt` = the batch's real time.
**Warning signs:** observations clustered at one timestamp; `metadata.task_id` absent.

### Pitfall 4: Re-emitting the same exchange on re-capture
**What goes wrong:** Firing mid-set then again at set-flush re-sends earlier exchanges.
**Why it happens:** ETM already has a fire-dedup (`_firedPromptKeys`, 15s window, key=`count|lastExchangeId`) AND ObservationWriter has content-hash + 4h semantic dedup. But a per-batch refactor changes the unit, so the dedup key must change too.
**How to avoid:** Advance a `lastFiredExchangeUuid` cursor per transcript on every mid-set fire; the next batch starts after it. Use the **last** message uuid of the batch (the existing code already learned this — see the 2026-06-04 "1,506 wasted obs-writer calls" comment at lines 515–526 using `lastMessageUuid`). Dedup key for OBS = `(task_id, batch-last-message-uuid)`.
**Warning signs:** duplicate observations with overlapping content.

## Code Examples

### Confirm fg/bg by user_hash + denylist (ATTR-01/02 derivation)
```javascript
// In token-aggregate.mjs — add a parallel breakdown that classifies lineage.
// FOREGROUND = adapter rows (cladpt = Claude) with the active task_id.
// BACKGROUND = everything else in-window (proxy daemon rows, denylisted processes).
const BACKGROUND_PROCESS_RE = /^(consolidator-|health-coordinator$|observation-writer$|backfill$|reproject-|route-judge$)/;
// Foreground signal: the row was written by a foreground transcript adapter.
const FOREGROUND_USER_HASHES = new Set(['cladpt', 'copadt']); // claude / copilot adapters
function isForeground(row) {
  return FOREGROUND_USER_HASHES.has(row.user_hash)
    && !BACKGROUND_PROCESS_RE.test(row.process || '');
}
```

### Canonical computation at stop (D-05/D-06) — replaces `dominant = byAgentModel[0]`
```javascript
// measurement-stop.mjs step (3), AFTER aggregateByTaskId:
const fgRows   = byAgentModel.filter(isForegroundGroup);   // adapter rows, this task_id
const bgRows   = byAgentModel.filter(g => !isForegroundGroup(g));
const canonical = fgRows[0] ?? null;                        // fg chat agent/model, or null (legacy)
const canonicalModel = canonical?.model ?? null;           // D-05: NEVER fall back to dominant
const backgroundModels = bgRows.map(g => ({ model: g.model, process: g.process, total_tokens: g.total_tokens }));
// pass canonicalModel / canonicalAgent / backgroundModels into writeRun's tags.
```

### Dashboard empty-canonical render (D-05 discretion)
```tsx
// runs-table.tsx — replace the run.model cell:
{run.canonical_model
  ? <span className="font-mono">{run.canonical_model}</span>
  : <span className="text-muted-foreground italic">unmeasured</span>}
// second column: background-service models
{run.background_models?.length
  ? <span className="text-xs text-muted-foreground">{run.background_models.map(b => b.model).join(', ')}</span>
  : <span className="text-muted-foreground">—</span>}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TELEM-03 in-window→task_id | Lineage-based attribution (D-01) | Phase 75 (this) | Stops daemon-traffic conflation |
| `dominant = byAgentModel[0]` canonical | Fg-chat-agent canonical, persisted (D-05/D-06) | Phase 75 | Fixes finding B (haiku-shown-for-Opus) |
| ETM one-snapshot-per-prompt-set at T0 | Per-decision / per-tool-batch fire at real event time (D-07/D-08) | Phase 75 | Fixes finding D |
| Timeline drops untagged rows (finding A) | Dedup only by non-empty id | Already FIXED on main | n/a (out of scope) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenCode/Mastra always route through the proxy (so stamp-only, no adapter) | §Q1 | LOW — verified rows carry proxy `user_hash='c197ef'`. BUT config shows network-dependent routing: outside-VPN may use "Anthropic direct" / "Claude Max". If a future session runs Anthropic-direct, those tokens would bypass the proxy and need a transcript adapter. **Planner: add a stop-time guard that warns when an in-scope agent ran with no proxy rows AND no adapter rows** (detects the bypass case). |
| A2 | The main-session JSONL is locatable by time-window at stop | §Pitfall 2 | MEDIUM — multiple session files; mis-pick captures wrong tokens. Mitigate by also matching cwd-encoded dir + (optionally) capturing sessionId at start. |
| A3 | `BACKGROUND_PROCESS_RE` covers all non-task daemons | §Code Examples | LOW — derived from real distinct `process` values, but new daemons could appear. Belt-and-suspenders: anything NOT a foreground adapter row is background by default (D-01 denylist is the defensive layer, not the only signal). |
| A4 | "Significant tool-activity batch" threshold (discretion) — propose: fire when ≥ 8 tool_use blocks OR ≥ 10 min elapsed since last fire within a question-less stretch | §Q4 | LOW — tunable; OBS-02 acceptance is driven by decisions, batches are the fallback for question-less stretches. |

## Open Questions (RESOLVED)

1. **RESOLVED: sessionId on the span?** — Capturing the Claude `sessionId` at `measurement-start` would make main-session location exact (vs time-window heuristic). **Recommendation (adopted in plans):** time-window is sufficient for the locked D-03 batch path; sessionId capture is a low-cost hardening follow-up, not a blocker. Plan 75-04 uses the time-window main-session locator.
2. **RESOLVED: Copilot adapter at stop vs proxy double-count** — `copadt` adapter rows exist historically (6 rows) AND copilot routes through the proxy. **Recommendation (adopted in plans):** treat copilot (and opencode/mastra) as stamp-only by default (proxy-routed today); only enable a `copadt` transcript adapter if A1's bypass-guard fires. Plan 75-03 registers copilot/opencode/mastra as stamp-only with no transcript build, and 75-04 adds the A1 bypass-guard warning.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `.data/llm-proxy/token-usage.db` | ATTR-01/02/03 | ✓ | 21-col schema, 50MB | aggregate returns zero-totals if missing (already handled) |
| `~/.claude/projects/<cwd>/*.jsonl` | ATTR-03 main-session capture | ✓ | per-message `timestamp` present | uid-gate skips non-owned; empty rows if absent |
| `better-sqlite3` | token-db/aggregate | ✓ | via createRequire | best-effort, never throws |
| km-core experiment store (`openExperimentStore`) | D-06 persist + read | ✓ | needs `ontologyDir` (CLAUDE.md rule — store.mjs handles it) | — |
| ETM launchd (`com.coding.etm`) | OBS-01/02 | ✓ | running | kickstart after deploy |
| Dashboard (bind-mounted) | ATTR-02 display | ✓ | localhost:3032 | `npm run build` + frontend supervisorctl restart |

**Missing dependencies with no fallback:** none.

## Validation Architecture

> `workflow.nyquist_validation` is ABSENT in `.planning/config.json` → treat as ENABLED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Two runners: **jest** 29 for `.js` (`tests/live-logging/*.test.js`, ETM/ObservationWriter); **node:test** for `.mjs` (`tests/experiments/*.test.mjs`, `tests/lsl/token/*`) |
| Config file | jest in `package.json`; node:test runs per-file (`node --test tests/experiments/<f>.test.mjs`) |
| Quick run command | `node --test tests/experiments/token-aggregate.test.mjs` (per-touched-module) |
| Full suite command | `npm test` (jest) + a node:test pass over `tests/experiments/*.mjs` and `tests/lsl/**` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ATTR-01 | in-window background rows segregated from fg | unit | `node --test tests/experiments/token-aggregate.test.mjs` | ✅ extend |
| ATTR-02 | canonical = fg chat; bg models listed; persisted on Run | unit | `node --test tests/experiments/run-write.test.mjs` | ✅ extend |
| ATTR-02 | dashboard renders two columns + empty-canonical sentinel | e2e | `gsd-browser navigate localhost:3032` + screenshot (CLAUDE.md) | ❌ Wave 0 (playwright spec under `tests/e2e/performance/`) |
| ATTR-03 | main-session Claude tokens captured as cladpt with task_id | unit | `node --test tests/lsl/token/claude-token-rows.test.mjs` + a new stop-wiring test | ❌ Wave 0 (stop-path adapter-registry test) |
| OBS-01 | observation carries active task_id, queryable per Run | unit | jest `tests/live-logging/ObservationWriter.*.test.js` | ✅ extend |
| OBS-02 | per-decision/per-batch fire stamped at real event time | unit | jest ETM test (fixture: typed prompt T0, decisions T0+n → obs dated T0+n) | ❌ Wave 0 (ETM re-capture fixture) |

### Sampling Rate
- **Per task commit:** the per-module quick command for the file touched.
- **Per wave merge:** full node:test experiments pass + relevant jest suites.
- **Phase gate:** full suite green + a live re-measure of a short Claude session showing `cladpt` rows + canonical=Opus before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/experiments/canonical-attribution.test.mjs` — fg/bg derivation + canonical computation (ATTR-01/02/05).
- [ ] `tests/lsl/token/stop-adapter-registry.test.mjs` — per-agent registry dispatch (transcript vs stamp-only) + double-count guard (ATTR-03/D-04).
- [ ] ETM re-capture jest fixture — transcript with typed prompt @T0 + AskUserQuestion decisions @T0+n; assert observations dated ~T0+n and carry task_id (OBS-02/01 acceptance from finding D / `e0af5b8b`).
- [ ] `tests/e2e/performance/canonical-columns.spec.ts` — dashboard two-column render via playwright/gsd-browser (ATTR-02).
- [ ] Acceptance grep (CLAUDE.md km-core convention): grep the stop path for the time-window seam used to locate the main-session JSONL, and grep for `cladpt` insert at stop.

## Security Domain

> `security_enforcement` ABSENT → treat as enabled. This phase reads local transcripts + a local SQLite DB; no network surface, no auth.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | local-only tooling |
| V4 Access Control | yes (file) | uid-gate already enforced in `buildClaudeTokenRows()` (`st.uid === process.getuid()`) — preserve for any new locator |
| V5 Input Validation | yes | per-line `JSON.parse` try/catch (transcripts); numeric coalesce `?? 0`; task_id ALWAYS a bound `?` param (`token-aggregate.mjs` T-71-03-01) |
| V6 Cryptography | no | none introduced |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via task_id | Tampering | Bound `?` placeholders only (existing convention — never interpolate) |
| Second-writer corruption of proxy DB | Tampering/DoS | Keep aggregation `{ readonly:true }`; adapter inserts use distinct `cladpt`/`copadt` user_hash + `busy_timeout=5000` (existing) — do NOT add a migration to the proxy-owned DB |
| Non-owned transcript read | Info disclosure | uid-gate (existing) — re-apply to any new main-session locator |
| PII in observation content | Info disclosure | `ConfigurableRedactor` runs in `ObservationWriter` before persist (existing) — unchanged |
| Observation re-capture O(n²) inflation | DoS | per-transcript `lastFiredExchangeUuid` cursor + content-hash dedup (Pitfall 4) |

## Sources

### Primary (HIGH confidence — verified this session)
- `lib/lsl/token/token-db.mjs`, `claude-token-rows.mjs`, `task-id.mjs`, `copilot-token-rows.mjs` — read in full / headers.
- `lib/lsl/live/claude-fs-watch.mjs` + `scripts/sub-agent-live-claude.mjs` — confirmed sub-agent-only watch (RELATIVE_SUBAGENT_RE, isSidechain gate).
- `scripts/measurement-stop.mjs` — read in full (the `byAgentModel[0]` seam, buildTraceSeam time-window).
- `lib/experiments/token-aggregate.mjs`, `run-write.mjs`, `query.mjs` — read (readonly aggregate; `readRuns` `...meta` spread).
- `scripts/enhanced-transcript-monitor.js` — prompt-set boundary (`:1375`), `_firePromptSetObservation` (`:768`), createdAt source (`:799,835`), dedup (`:774`).
- `src/live-logging/ObservationWriter.js` — `processMessages` created_at = earliest `createdAt` (`:1126`); redactor; km-core write.
- **Real data:** `.data/llm-proxy/token-usage.db` — distinct process/agent/user_hash; bad-run breakdown (186 rows, all c197ef; 0 cladpt); span window 05:33–05:54Z; copadt/c197ef routing proof.
- **Real transcript:** `~/.claude/projects/-Users-Q284340-Agentic-coding/*.jsonl` — AskUserQuestion tool_use (ts 08:21:53Z) + tool_result answer (ts 08:25:14Z); per-message `timestamp` field present.
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` §Phase 75, `.planning/v7.4-attribution-findings.md`, `75-CONTEXT.md`.

### Secondary (MEDIUM)
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` (Run interface) + `runs-table.tsx` (render).
- `config/agents/{opencode,mastra}.sh` — network-dependent routing note (A1 risk).

## Metadata

**Confidence breakdown:**
- ATTR-01/02 (denylist + canonical): HIGH — real `token_usage` data + read-path code confirmed.
- ATTR-03 (foreground capture gap): HIGH — root cause proven by 0-cladpt query + watcher source.
- OBS-01/02 (ETM re-capture + timestamps): HIGH — boundary code + transcript timestamps + AskUserQuestion visibility all verified.
- D-04 per-agent verdicts: HIGH for claude/copilot/opencode/mastra current behavior; MEDIUM-flagged (A1) for the network-dependent Anthropic-direct bypass case.

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stable in-repo infrastructure; re-verify if the rapid-llm-proxy DB schema or agent routing config changes)

# Phase 72: Syntactic Route Quality - Research

**Researched:** 2026-06-24
**Domain:** Cross-agent route-trace normalization + deterministic (zero-LLM) route-quality heuristics, written into the Phase-71 experiment km-core store at run-close.
**Confidence:** HIGH (all source files inspected on disk; all three agent trace shapes confirmed against live data)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (LOCKED):** Cross-agent normalized trace. Phase 72 defines ONE normalized route-trace schema (ordered tool-call events with timestamps + outcome) and adapts each agent's native trace into it — Claude session JSONL, Copilot `events.jsonl`, OpenCode — so all agents get route metrics from v0. NOT Claude-only. NOT the summarized LSL/observation stream.
- **D-02 (LOCKED):** Per-heuristic graceful degradation, null the rest. Compute every heuristic the source trace can support; write the ones it cannot as explicit `null` (NOT `0`). Run schema stays uniform across agents; queries filter on non-null. Mirrors Phase 71 D-13.
- **D-03 (LOCKED):** /gsd runs auto-derive `goal_sentence` from the active phase's `PLAN.md` `**Goal**:` line. Fallback: ROADMAP phase `**Goal**:` when no PLAN.md exists. Zero-LLM extraction.
- **D-04 (LOCKED):** Freeform runs prompt at start (`startMeasurement`), editable at close (`stopMeasurement`).
- **D-05 (DERIVED, Phase 71 D-06):** Headless freeform runs quarantine (`goal_sentence` empty + pending flag), EXCLUDED from route-alignment queries, never block.
- **D-06 (LOCKED):** Strict / high-precision calibration for the four fuzzy heuristics. Count only unambiguous cases. A non-zero count must be real signal.
- **D-07 (LOCKED):** One step = one tool call; parallel calls in the same turn count separately. `total_step_count` = number of tool-call events; `wallclock_per_step` = gap between consecutive tool events.
- **D-08 (DERIVED guardrail):** Each heuristic ships with a documented, testable definition backed by golden-trace fixtures.
- **D-09 (LOCKED):** Flat metrics on the Run + one Route summary node per Run carrying the same heuristic summary + `goal_sentence`. No per-Step node explosion. The Route node gives Phase 73's judge a place to attach `goal_aligned_ratio`.

### Claude's Discretion (delegated — resolved in this research)
1. Normalized-trace schema shape + where normalization lives + reuse-vs-new reader.
2. Exact strict definition of each of the six heuristics.
3. When/where heuristics compute.

### Deferred Ideas (OUT OF SCOPE)
- Semantic `goal_aligned_ratio` (LLM-judge) → Phase 73 (ROUTE-03).
- 5-dimension success scoring → Phase 73 (SCORE-01/02).
- Per-Step entity population (one node per tool call) → not built; Step class stays a stub.
- Performance dashboard rendering of route metrics → Phase 74.
- Any change to Phase-68 `token_usage` schema, `getActiveMeasurement()`/span contract, or Phase-71 Run-write keying — consumed as-is.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROUTE-01 | Each run carries a one-sentence `goal_sentence` — auto-derived from PLAN.md (/gsd) or prompted at start (freeform) — stored on the Run. | `SpanRecord.goal_sentence` field already exists (measurement-span.ts:46); ROUTE-01 only populates it. PLAN.md `**Goal**:` extraction + freeform prompt path documented below. Run-write already writes `description: span.goal_sentence` (run-write.mjs:81) — needs propagation onto the Route node too (D-09). |
| ROUTE-02 | Six deterministic syntactic heuristics computed per run, stored on the Run and queryable alongside tags. | Normalized-trace schema + six heuristic definitions + compute-location (extend measurement-stop.mjs) + Route node write documented below. All three agents' trace shapes confirmed on disk. |
</phase_requirements>

## Summary

Phase 72 adds two things to the existing Phase-71 close pipeline (`scripts/measurement-stop.mjs`): (1) populating `goal_sentence` on the span/Run, and (2) computing six deterministic route-quality heuristics from a cross-agent normalized tool-call trace, writing them flat on the Run plus a single Route summary node.

The decisive research finding: **all three agents expose rich per-tool-call event data on disk** — the D-02 "coarse agents yield null" framing is more conservative than reality. Confirmed live:
- **Claude** session JSONL: `tool_use` content blocks (`name`, `id`, `input`, record `timestamp`) + `tool_result` blocks (`tool_use_id`, `is_error`, `content`, plus a `toolUseResult` sibling). Full fidelity — all six heuristics computable.
- **Copilot** `events.jsonl` (v1.0.63): `tool.execution_start` (`toolCallId`, `toolName`, `arguments`, `timestamp`) + `tool.execution_complete` (`toolCallId`, `success`, `result`, `timestamp`). Full per-tool fidelity — all six heuristics computable. (This is a *different* feed from the Phase-69 Copilot token adapter, which reads only the `session.shutdown` aggregate.)
- **OpenCode** `~/.local/share/opencode/opencode.db` (SQLite) `part` table: `data` JSON of `type:"tool"` with `callID`, `tool` (name), `state.{status,input,error,time:{start,end}}`. Full per-tool fidelity — all six heuristics computable.

**Primary recommendation:** Build a **new, dedicated normalized-route-trace reader** (one adapter per agent emitting a common `RouteEvent[]`), do NOT overload the Phase-69/70 *token* adapters — they parse a different slice of the same files (`usage` blocks / `session.shutdown` / per-llm-call proxy rows) and have no tool-call sequence concept. Compute heuristics inside the existing `measurement-stop.mjs` close orchestrator (step 3.5, after aggregation, before `writeRun`), pass them through to an extended `writeRun` that adds flat Run metrics + a Route node. Recompute/backfill rides the existing idempotent re-close (Phase 71 D-14). Per-heuristic `null` (D-02) survives as the honest fallback for any agent whose trace cannot be located for a given run (e.g. a session file rotated away, or a future coarser agent), not as the normal Copilot path.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Native trace storage (tool-call events) | Agent runtime (Claude JSONL / Copilot events.jsonl / OpenCode SQLite) | — | The agents already write these; Phase 72 only reads. |
| Per-agent → normalized `RouteEvent[]` adaptation | Coding-side host (new `lib/lsl/route/` modules) | — | "Proxy stays generic" (Phase 70) — route/trace knowledge lives coding-side, NOT in rapid-llm-proxy. |
| Heuristic computation (zero-LLM) | Coding-side close orchestrator (`scripts/measurement-stop.mjs`) | on-demand recompute CLI | D-07 of Phase 71; idempotent re-close (D-14) makes backfill free. |
| Run/Route persistence | Experiment km-core store (`lib/experiments/`) | — | The Phase-71 dedicated GraphKMStore at `.data/experiments/`. |
| `goal_sentence` source | PLAN.md/ROADMAP parse (/gsd) OR start/stop prompt (freeform) | `SpanRecord.goal_sentence` field | D-03/D-04; field already exists in the proxy span contract. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fwornle/km-core` | (already pinned in repo) | Experiment store entities/relations; `mintEntityId`, `GraphKMStore` | Phase 71 substrate; consumed as-is. `[VERIFIED: codebase — lib/experiments/store.mjs:22,42-50]` |
| Node `node:fs` / `node:path` / `node:crypto` | stdlib | Read JSONL/SQLite-adjacent files, hash, path safety | Already the pattern in every adapter. `[VERIFIED: codebase]` |
| `node:sqlite` (`DatabaseSync`) OR `better-sqlite3` | Node ≥ 22.5 (built-in) / repo dep | Read OpenCode `opencode.db` read-only | Phase 70 already reads OpenCode; reuse whichever sqlite path Phase 70 chose. **Verify which** before planning (see Open Questions). `[ASSUMED]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lib/lsl/adapters/claude-jsonl-tree.mjs` | in-repo | `SUBAGENT_PATH_RE`, uid-check gate, sub-agent linkage helpers | Reuse the uid-check + path-resolution gates verbatim when locating Claude session files for a run. `[VERIFIED: codebase]` |
| `src/live-logging/TranscriptNormalizer.js` (`parseCopilot`) | in-repo | Canonical Copilot line primitive (recognized-line gate) | Reuse as the recognized-primitive gate when reading `events.jsonl`, mirroring `copilot-token-rows.mjs:54`. `[VERIFIED: codebase]` |
| `lib/experiments/store.mjs` (`openExperimentStore`) | in-repo | The ONLY way to open the experiment store (passes mandatory `ontologyDir`) | Already used by `measurement-stop.mjs`. `[VERIFIED: codebase]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New dedicated route-trace readers | Reuse Phase-69/70 *token* adapters as the feed | **Rejected.** Token adapters parse a disjoint slice: `claude-token-rows.mjs` only reads `usage` blocks (skips `tool_use`/`tool_result` entirely); `copilot-token-rows.mjs` only reads `session.shutdown.modelMetrics`; Phase-70 OpenCode logs per-llm-call proxy rows, not tool calls. None carry an ordered tool-call sequence. Overloading them would couple two unrelated concerns and force a token row to grow a tool-event shape it does not have. Reuse the *file-location + uid-gate + line-primitive* helpers, not the row builders. |
| Reading OpenCode via SQLite | Reading an OpenCode JSONL export | OpenCode has NO JSONL; everything is in `opencode.db` (confirmed: 2GB SQLite, tables `message`/`part`). SQLite read is the only path. |

**Installation:** No new external packages required. (If Phase 70 chose `better-sqlite3` for OpenCode, it is already a repo dep; otherwise Node ≥ 22.5 `node:sqlite` is built-in.)

## Package Legitimacy Audit

> Phase 72 installs **no new external packages**. All dependencies are in-repo modules or the already-pinned `@fwornle/km-core` + Node stdlib. slopcheck N/A.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none — all in-repo / stdlib / already-pinned) | — | No install step |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                       run-close (operator or future /gsd hook)
                                    │
                                    ▼
                    scripts/measurement-stop.mjs  (the close orchestrator — D-07)
        ┌───────────────────────────┼───────────────────────────────────────┐
        │ (1) stopMeasurement()      (2) derive/prompt task_class   (3) tokens │
        │     → archive span               (existing)                 aggregate │
        └───────────────────────────┼───────────────────────────────────────┘
                                    │
                 ┌──────────────────▼───────────────────┐   NEW (Phase 72)
                 │ (3.5) buildNormalizedTrace(span, agent)│
                 │   pick reader by dominant agent tag    │
                 └──────────────────┬───────────────────┘
            ┌──────────────┬────────┴────────┬──────────────┐
            ▼              ▼                 ▼               ▼
   claude reader    copilot reader    opencode reader   (no trace found)
   ~/.claude/...    ~/.copilot/...    opencode.db        → all heuristics null (D-02)
   tool_use +       tool.execution_   part.data type:tool
   tool_result      start/complete    state.{status,time}
            └──────────────┴────────┬────────┴──────────────┘
                                    ▼
                          RouteEvent[]  (ordered, normalized)
                                    │
                 ┌──────────────────▼───────────────────┐  NEW (Phase 72)
                 │ (3.6) computeHeuristics(RouteEvent[])  │  zero-LLM, strict (D-06)
                 │   → { loop_count, edit_revert_count,   │
                 │       redundant_read_count,            │
                 │       abandoned_tool_count,            │
                 │       total_step_count,                │
                 │       wallclock_per_step }             │
                 └──────────────────┬───────────────────┘
                                    │
                 ┌──────────────────▼───────────────────┐  EXTEND writeRun (D-09)
                 │ (4) writeRun(... , heuristics, goal)   │
                 │   • flat metrics on Run.metadata       │
                 │   • ONE Route node per Run             │
                 │   • Run --tookRoute--> Route relation  │
                 └────────────────────────────────────────┘
                                    │
                                    ▼
                  .data/experiments/ km-core store (Phase 71)
```

File-to-implementation mapping is in the Component Responsibilities table below.

### Recommended Project Structure
```
lib/lsl/route/                      # NEW — the normalized-trace layer (coding-side, generic-proxy principle)
├── route-event.mjs                 # the RouteEvent type/jsdoc + shared helpers (digest, outcome enum)
├── claude-route-trace.mjs          # Claude session JSONL → RouteEvent[]  (reuses claude-jsonl-tree gates)
├── copilot-route-trace.mjs         # Copilot events.jsonl → RouteEvent[]  (reuses parseCopilot gate)
├── opencode-route-trace.mjs        # opencode.db part table → RouteEvent[] (read-only sqlite)
└── build-trace.mjs                 # buildNormalizedTrace(span) — picks reader by dominant agent, returns RouteEvent[] | null
lib/experiments/
├── route-heuristics.mjs            # NEW — computeHeuristics(RouteEvent[]) → {six metrics}, pure + fixture-tested
└── run-write.mjs                   # EXTEND — accept heuristics + goal, write flat Run metrics + Route node
scripts/
├── measurement-stop.mjs            # EXTEND — call buildNormalizedTrace + computeHeuristics between (3) and (4)
└── experiments-recompute-route.mjs # NEW (optional) — on-demand recompute/backfill for an existing Run (rides D-14)
tests/experiments/
├── route-heuristics.test.mjs       # golden-trace fixtures (D-08), one block per heuristic, strict-calibration cases
tests/fixtures/route/               # NEW — golden RouteEvent[] fixtures (loop, revert, redundant-read, abandoned, parallel)
```

### Pattern 1: Normalized RouteEvent (the ONE cross-agent schema — Discretion item 1)
**What:** A single ordered event type every agent reader emits. Field-by-field:

```typescript
// Source: synthesized from confirmed on-disk shapes (Claude JSONL / Copilot events.jsonl / OpenCode part table)
/**
 * One normalized tool-call event. D-07: one RouteEvent == one tool call;
 * parallel same-turn calls are SEPARATE RouteEvents (not collapsed).
 */
interface RouteEvent {
  seq:           number;            // 0-based ordinal in the run (stable sort key; ties broken by tool_call_id)
  tool_call_id:  string;           // native id — Claude toolu_*, Copilot toolCallId, OpenCode callID
  tool_name:     string;           // 'Read' | 'Edit' | 'Bash' | 'task' | ... (agent-native, NOT normalized away)
  inputs_digest: string;           // sha256 of a canonical JSON of the tool input args (for loop/redundant detection)
  target_path:   string | null;    // for file tools: the resolved file_path (Read/Edit/Write); null otherwise
  started_at:    string;           // ISO-8601 — tool_use record timestamp / execution_start / state.time.start
  ended_at:      string | null;    // ISO-8601 — tool_result timestamp / execution_complete / state.time.end; null = abandoned
  outcome:       'success' | 'error' | 'denied' | 'abandoned';  // see per-agent mapping below
  agent:         'claude' | 'copilot' | 'opencode';
}
```

**Per-agent outcome + field mapping (the load-bearing detail):**

| RouteEvent field | Claude (session JSONL) | Copilot (events.jsonl) | OpenCode (opencode.db part) |
|------------------|------------------------|------------------------|------------------------------|
| `tool_call_id` | `tool_use.id` (`toolu_*`) | `tool.execution_start.data.toolCallId` | `part.data.callID` |
| `tool_name` | `tool_use.name` | `...execution_start.data.toolName` | `part.data.tool` |
| input args | `tool_use.input` (object) | `...execution_start.data.arguments` | `part.data.state.input` |
| `started_at` | record `timestamp` of the assistant `tool_use` record | `tool.execution_start.timestamp` | `state.time.start` (epoch ms → ISO) |
| `ended_at` | record `timestamp` of the matching `tool_result` (by `tool_use_id`) | `tool.execution_complete.timestamp` (matched by `toolCallId`) | `state.time.end` (epoch ms → ISO) |
| `outcome=success` | `tool_result` present, `is_error` falsey | `execution_complete.data.success === true` | `state.status === 'completed'` |
| `outcome=error` | `tool_result.is_error === true` | `execution_complete.data.success === false` | `state.status === 'error'` |
| `outcome=denied` | `tool_result.content` matches a permission-denied marker (rare in JSONL — treat as `error` unless a clear marker exists) | (no distinct denied signal observed in v1.0.63 — fold into `error`) | `state.status === 'error'` with permission-error marker, else `error` |
| `outcome=abandoned` | a `tool_use` with NO matching `tool_result` in the file | a `tool.execution_start` with NO matching `execution_complete` | a `tool` part with `state.status` in `{pending, running}` and no terminal state |

**When to use:** every reader; `computeHeuristics` consumes only `RouteEvent[]` and never touches agent-native files.

### Pattern 2: Reuse file-location + line-primitive gates, NOT row builders
**What:** Each route reader reuses the *security/location* helpers from the Phase-69 adapters, not their token-row logic.
```javascript
// Source: codebase — lib/lsl/token/claude-token-rows.mjs:82-101 (uid gate), :114-117 (subagent linkage)
//                    lib/lsl/token/copilot-token-rows.mjs:54 (parseCopilot gate), :129-136 (session uuid)
// claude-route-trace.mjs reuses the uid-check gate + SUBAGENT_PATH_RE verbatim,
// then walks tool_use/tool_result blocks (which the token adapter SKIPS).
```
**Why:** the uid-check (`st.uid === process.getuid()`) is a confirmed security gate (T-69-traversal); the per-line `JSON.parse` try/catch is the DoS gate (T-69-dos). Both must be preserved in the new readers.

### Anti-Patterns to Avoid
- **Overloading the token adapters.** `claude-token-rows.mjs` deliberately reads only `usage` blocks; bolting tool-event extraction onto it couples token attribution to route tracing and risks regressing the Phase-69 contract. Build separate readers.
- **Collapsing parallel same-turn tool calls.** D-07 says count them separately. Do NOT dedupe by turn or by identical input — that would hide genuine parallel work AND corrupt the loop heuristic.
- **Writing `0` where the trace is unavailable.** D-02: a run whose agent trace file cannot be located writes `null` for every heuristic, not `0`. `0` means "computed, genuinely none"; `null` means "could not compute."
- **`new GraphKMStore(...)` inline.** Always `openExperimentStore()` — it is the only caller that passes the mandatory `ontologyDir` (CLAUDE.md km-core rule).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Locate + safely read Claude session files | A new path walker / uid check | `claude-jsonl-tree.mjs` `SUBAGENT_PATH_RE` + the uid-gate pattern from `claude-token-rows.mjs:82-101` | Security gates already audited (Phase 51/69 threat register). |
| Recognize Copilot event lines | A second `events.jsonl` parser | `parseCopilot` from `TranscriptNormalizer.js` (recognized-primitive gate) | Locked key-link contract — one parser only. |
| Open the experiment store | `new GraphKMStore({...})` | `openExperimentStore()` | Mandatory `ontologyDir` (CLAUDE.md). |
| Mint a Run/Route entity id | `task_id` as the id | `mintEntityId()` | `task_id` is not a UUIDv7; `parseEntityId` throws (run-write.mjs:11-14, Pitfall below). |
| Idempotent re-close / dedupe relations | A new write path | extend existing `writeRun` (keyed on `metadata.task_id`, stable edge `key`) | D-14 idempotency + the `addRelation` `key` dedupe is already solved (run-write.mjs:133-138). |
| Archive/find the span | re-reading `active-measurement.json` | the archived `.data/measurements/<task_id>.json` that `stopMeasurement()` wrote | Single-reader contract (measurement-span.ts:9). |

**Key insight:** Phase 71 already solved the hard km-core problems (idempotency, UUIDv7 ids, strict-path provenance, ontologyDir, relation-key dedupe). Phase 72 is overwhelmingly *new readers + a pure heuristics function*; the persistence delta is small (add metrics to an existing `putEntity`, add one Route node + one relation).

## The Six Heuristics (Discretion item 2 — strict definitions, D-06/D-07/D-08)

> All definitions operate on the ordered `RouteEvent[]` only. "Step" = one RouteEvent (D-07). Errored/denied/abandoned events **DO count toward `total_step_count`** (they are real tool calls that consumed a turn) — see rationale in the table. Strict calibration (D-06): a non-zero count must be unambiguous.

| Heuristic | Strict definition | Source events / fields required | Claude | Copilot | OpenCode | null-when condition | Golden-fixture test idea |
|-----------|-------------------|----------------------------------|:------:|:-------:|:--------:|---------------------|--------------------------|
| **total_step_count** | Count of all RouteEvents, regardless of outcome (success/error/denied/abandoned all count — each is one tool call that consumed a step). | the RouteEvent array length | ✅ | ✅ | ✅ | trace unavailable | fixture of 5 events (1 error, 1 abandoned) → expect 5. |
| **wallclock_per_step** | `(last.ended_at_or_started_at − first.started_at) / max(1, total_step_count)` in ms. Use each event's `started_at`; the run span is first start → last terminal timestamp. Report as ms (number). | `started_at` on every event; `ended_at` on the last | ✅ | ✅ | ✅ | trace unavailable, OR fewer than 1 event | fixture with known timestamps → expect exact ms/step. Edge: single-event run → gap defined as `ended−started` of that event. |
| **abandoned_tool_count** | Count of RouteEvents with `outcome === 'abandoned'` (a tool call started but has no matching terminal result/complete in the trace). Strict: only when the start event exists AND no terminal event with the same `tool_call_id` exists. | start events + terminal-match by `tool_call_id` | ✅ | ✅ | ✅ | trace unavailable | fixture: 1 `tool_use` with no `tool_result` → expect 1; a matched pair → expect 0. |
| **redundant_read_count** | Count of read events that are an **exact re-read** of a `target_path` already read earlier in the run, **with no Edit/Write to that same `target_path` between the two reads**. Strict: same resolved `target_path` AND no intervening mutation of that path AND `outcome==='success'` on both. Re-read after an edit is NOT redundant (state changed). | read events with `target_path`; edit/write events with `target_path`; ordering | ✅ | ✅ | ✅ | trace unavailable | fixture: Read(a), Read(a) → 1. Read(a), Edit(a), Read(a) → 0. Read(a), Read(b), Read(a) → 1. |
| **edit_revert_count** | Count of edits to a `target_path` whose resulting byte-state provably returns to an **earlier byte-state of that same path within the run**. Strict (D-06): only when the file content hash after edit N equals the content hash at some earlier point in the run. Requires content snapshots (see note). | edit/write events with `target_path` + a content hash at each edit | ✅ | ⚠️ partial | ⚠️ partial | content hashes unavailable for the agent | fixture: hash sequence A→B→A on path p → 1 revert. A→B→C → 0. |
| **loop_count** | Count of **maximal runs of ≥2 consecutive RouteEvents** that are identical in `(tool_name, inputs_digest)` AND not separated by a state-changing event on the same target. Strict (D-06): byte-identical inputs, adjacency (or adjacency modulo only read-noops). Each maximal repeat-cluster contributes 1 to the count (a 3x repeat = 1 loop of length 3, not 2). | `tool_name` + `inputs_digest` ordering | ✅ | ✅ | ✅ | trace unavailable | fixture: Bash(x), Bash(x), Bash(x) → loop_count 1. Bash(x), Bash(y), Bash(x) → 0 (not adjacent). |

### Notes that the planner MUST resolve into tasks

- **`edit_revert_count` needs content hashes, which the raw trace does not always carry.** Claude's `tool_result`/`toolUseResult` for Edit can include the new content or a diff; OpenCode's `state.metadata` may carry it; Copilot's `execution_complete.result` is a summary string. **Strict fallback (D-06/D-02):** if a per-edit content hash cannot be reconstructed deterministically for an agent, write `edit_revert_count = null` for that run rather than guessing. A cheap deterministic alternative the planner may choose: hash the *Edit tool input* (`old_string`/`new_string` for Claude) and detect an A→B then B→A input pattern on the same path — this catches the unambiguous "undid my own edit" case without reading file bytes. Recommend the input-pattern approach as the v0 strict definition and mark byte-state reconstruction as a Phase-72-optional / future refinement. **Flag for the planner: pick ONE and fixture it (D-08).**
- **`denied` outcome is thin in practice.** None of the three traces surfaced a clean, distinct "denied" marker in the live samples (Copilot v1.0.63 has only `success: bool`). Recommend folding `denied` into `error` for v0 unless a clear per-agent marker is found during implementation; keep the enum value for forward-compat. This does not affect any count except as part of `error` (which still counts toward `total_step_count`).
- **Strict-calibration unit:** every heuristic's test block must include at least one **true-negative** case (a near-miss that must NOT count) to prove the strict calibration, per D-06.

## Where heuristics compute (Discretion item 3 — confirmed on disk)

**Home: `scripts/measurement-stop.mjs`**, between step (3) token aggregation and step (4) `writeRun`. Confirmed by inspection: the file's header documents the exact pipeline (lines 4-22), and step (4) is `await writeRun(store, { span, taskClass, pending, tags, totals })` at line 205. Phase 72 inserts:

```
// ── (3.5) NEW: build normalized trace + compute route heuristics ──
const trace = await buildNormalizedTrace(span, { dominantAgent: dominant.agent });
const heuristics = trace ? computeHeuristics(trace) : ALL_NULL_HEURISTICS; // D-02
// ── (4) writeRun gains heuristics + goal_sentence (already on span) ──
await writeRun(store, { span, taskClass, pending, tags, totals, heuristics });
```

- `dominant.agent` already exists at line 188-189 (`byAgentModel[0]`), so the reader can be picked by the run's dominant agent without new tag work.
- `span.goal_sentence` already flows into `writeRun` via `description` (run-write.mjs:81); for ROUTE-01 the planner must (a) ensure `goal_sentence` is *populated* (PLAN.md derive / freeform prompt), and (b) propagate it onto the new Route node.

**`goal_sentence` population (ROUTE-01):**
- **/gsd runs (D-03):** at `startMeasurement` (or close), read the active phase's `PLAN.md` `**Goal**:` line; fallback to ROADMAP phase `**Goal**:`. Pure string extraction (regex on `**Goal**:`), zero-LLM. The `--goal`/`--phase` args already exist on `measurement-stop.mjs` (lines 137-138) as a manual seam.
- **Freeform (D-04):** prompt at `startMeasurement` (already has `goal_sentence` input param, measurement-span.ts:174), editable at `stopMeasurement` (the TTY `prompt()` helper already exists, measurement-stop.mjs:95-103).
- **Headless freeform (D-05):** empty `goal_sentence` + `pending=true` (the quarantine path already exists, measurement-stop.mjs:181-185) — never block.

**Recompute / backfill path (allowed by Phase 71 D-14):**
- Add `scripts/experiments-recompute-route.mjs <task_id>` that: opens the store, finds the Run by `metadata.task_id` (same scan as run-write.mjs:55-60), rebuilds the trace from the archived span + agent files, recomputes heuristics, and calls the same extended `writeRun` (which updates the SAME Run node and the SAME Route node by idempotent lookup). No new write semantics — it reuses the idempotent path. This covers late-arriving traces (a session file that finished writing after close).

## Storage shape (D-09) — extend `writeRun`

`writeRun` (lib/experiments/run-write.mjs) gains a `heuristics` arg and does two new things, mirroring its existing idempotent Outcome pattern (run-write.mjs:102-138):

1. **Flat metrics on the Run** — add the six keys to the Run `metadata` object (run-write.mjs:82-97), all `null`-able (D-02):
   `loop_count, edit_revert_count, redundant_read_count, abandoned_tool_count, total_step_count, wallclock_per_step`.
2. **One Route node per Run** — `putEntity({ entityType: 'Route', ... })`, idempotent-looked-up by a `metadata.run_task_id === span.task_id` scan (exact analog of the Outcome lookup at run-write.mjs:102-110), carrying the same six heuristics + `goal_sentence`. Then `addRelation({ type: 'tookRoute', from: runId, to: routeId, key: \`${runId}:tookRoute:${routeId}\` })` — the `tookRoute` relation is already declared on the Run class (experiment-ontology.json:20) and `hasStep` stays unused (Step is a stub). **The stable edge `key` is mandatory** (run-write.mjs:128-138) or re-close appends parallel edges (WR-01).

**Ontology note (verify, then likely a no-op):** the `Route` class currently declares `"properties": {}` (experiment-ontology.json:35-39). km-core's strict path validates `entityType`, not unknown metadata keys, so heuristics can ride in `metadata` without an ontology change (the Run already stores 11 metadata keys against a class that declares ~10 properties). **Recommend NOT editing the ontology** unless the planner wants the six heuristics + `goal_sentence` as first-class declared `Route` properties for query ergonomics — that is a clean, low-risk addition (additive properties) but strictly optional. Flag as a planner decision.

## Runtime State Inventory

> Phase 72 is additive code + new reads of existing agent files. No rename/migration. Brief inventory for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing Phase-71 Runs in `.data/experiments/leveldb` have NO route heuristics yet. | Backfill is OPTIONAL via the recompute CLI (D-14 idempotent). Not required for ROUTE-01/02 acceptance (which is per-new-run). |
| Live service config | None — no service config carries route knowledge (proxy stays generic, Phase 70). | None. |
| OS-registered state | None. The close orchestrator is a manual/hook CLI, not a launchd daemon. | None. |
| Secrets/env vars | `LLM_PROXY_DATA_DIR`, `LLM_PROXY_DIST_DIR`, `CODING_REPO` already consumed. No new secrets. | None. |
| Build artifacts | rapid-llm-proxy submodule is NOT touched (no new proxy code — generic-proxy principle). No submodule rebuild needed for Phase 72. | None — all new code is in-repo `.mjs` (no build step). |

## Common Pitfalls

### Pitfall 1: Using `task_id` as a km-core entity id (Run OR Route)
**What goes wrong:** `putEntity({ id: span.task_id })` throws in `parseEntityId` — `task_id` (e.g. `telem-live-68`) is not a UUIDv7.
**Why:** km-core ids are UUIDv7.
**How to avoid:** `mintEntityId()` on first write; on re-close find the existing node by a `metadata.task_id`/`metadata.run_task_id` scan and reuse its id (run-write.mjs:54-77, 102-113). The Route node MUST follow the identical pattern.
**Warning signs:** `parseEntityId` throw at close; or duplicate Route nodes after a second close.

### Pitfall 2: `addRelation` without a stable `key` → parallel-edge explosion
**What goes wrong:** N re-closes create N `tookRoute` edges.
**Why:** without `key`, km-core falls through to `addEdge()` which appends (run-write.mjs:128-138, WR-01).
**How to avoid:** pass `key: \`${runId}:tookRoute:${routeId}\``.

### Pitfall 3: Reusing the token adapter as the trace feed
**What goes wrong:** zero tool-call events — `claude-token-rows.mjs` `continue`s on everything except `usage` blocks (line 161), and `copilot-token-rows.mjs` only emits on `session.shutdown` (line 198).
**How to avoid:** new readers that walk `tool_use`/`tool_result` (Claude), `tool.execution_*` (Copilot), `part.data type:tool` (OpenCode). Reuse only the gates.

### Pitfall 4: `0` vs `null` confusion (D-02)
**What goes wrong:** a run with no locatable trace silently scores `total_step_count: 0`, polluting averages with fake zeros.
**How to avoid:** `buildNormalizedTrace` returns `null` (not `[]`) when no trace file is found; `computeHeuristics(null)`-equivalent path writes all six as `null`. Reserve `0` for "trace found, genuinely none."

### Pitfall 5: LevelDB single-owner contention
**What goes wrong:** the recompute CLI run while another experiment CLI holds the store → LevelDB lock error.
**Why:** dedicated store is single-owner (store.mjs:30-31).
**How to avoid:** open-on-demand, `try/finally` close (already the measurement-stop.mjs pattern, lines 202-209); document "don't run two experiment CLIs concurrently."

### Pitfall 6: Clock skew / timestamp units across agents
**What goes wrong:** OpenCode `state.time.{start,end}` are epoch **milliseconds** (confirmed: `1773654748480`); Claude/Copilot are **ISO-8601 strings**. Mixing units corrupts `wallclock_per_step`.
**How to avoid:** each reader normalizes to ISO-8601 in `RouteEvent`; `computeHeuristics` parses via `Date.parse` only.

### Pitfall 7: Matching a run to the right agent session file
**What goes wrong:** the trace reader reads the wrong session (another concurrent run) and computes nonsense.
**Why:** the span carries `task_id` + `started_at`/`ended_at`, but agent files are not keyed by `task_id`.
**How to avoid:** scope by the run's time window (`span.started_at`..`span.ended_at`) AND the dominant agent, filtering RouteEvents to those whose `started_at` falls in the window — analogous to the Phase-68 timestamp-join backfill (`scripts/backfill-task-id-by-timestamp.mjs`). **Flag for the planner:** confirm the timestamp-join window approach against the existing backfill helper before implementing. This is the single biggest correctness risk.

## Code Examples

### Claude tool-call extraction (the slice the token adapter skips)
```javascript
// Source: confirmed on-disk shape (agent-a5388015534cc609c.jsonl, 2026-06-24)
// assistant record: message.content[] has { type:'tool_use', id, name, input }
// user record:      message.content[] has { type:'tool_result', tool_use_id, is_error, content }
// record.timestamp is the per-event clock; record also carries a sibling toolUseResult.
for (const line of raw.split('\n')) {
  const rec = safeParse(line); if (!rec) continue;
  const content = Array.isArray(rec.message?.content) ? rec.message.content : [];
  for (const b of content) {
    if (b.type === 'tool_use')   starts.set(b.id, { id: b.id, name: b.name, input: b.input, ts: rec.timestamp });
    if (b.type === 'tool_result') ends.set(b.tool_use_id, { ts: rec.timestamp, is_error: !!b.is_error });
  }
}
// abandoned = starts whose id is absent from ends.
```

### Copilot tool-call extraction (richer than its token adapter)
```javascript
// Source: confirmed on-disk shape (events.jsonl v1.0.63)
// tool.execution_start.data    = { toolCallId, toolName, arguments }   + event.timestamp
// tool.execution_complete.data = { toolCallId, success, result, ... }  + event.timestamp
```

### OpenCode tool-call extraction (read-only SQLite)
```javascript
// Source: confirmed on-disk shape (opencode.db part table)
// SELECT data FROM part WHERE data LIKE '%"type":"tool"%'  (or parse all + filter type==='tool')
// part.data = { type:'tool', callID, tool, state:{ status, input, error, time:{start,end} } }
// status: 'completed' | 'error' | 'pending'|'running' (abandoned); time is epoch ms.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Copilot route fidelity assumed = its token tier (per-session-aggregate, D-02 "null the rest") | Copilot v1.0.63 `events.jsonl` carries full `tool.execution_start/complete` per-tool events | confirmed this research | Copilot can compute ALL six heuristics — D-02 null is the *fallback*, not Copilot's normal path. Plan should NOT pre-null Copilot. |

**Deprecated/outdated:** none.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 70 already established a read-only path to `opencode.db` (better-sqlite3 or `node:sqlite`); the route reader can reuse it. | Standard Stack | If no sqlite reader exists in-repo, the planner must add one (Node ≥22.5 `node:sqlite` is built-in, so low risk). |
| A2 | `edit_revert_count` via Edit-input A→B→A pattern is acceptable as the v0 strict definition (vs full byte-state reconstruction). | Six Heuristics notes | If true byte-state is required, edit_revert is harder; mitigated by D-02 (`null` is a legal answer). USER/planner should confirm the v0 definition. |
| A3 | A run's agent session file can be matched by the span time-window + dominant agent (timestamp-join). | Pitfall 7 | If concurrent same-agent runs overlap, attribution could bleed. Recommend confirming against `backfill-task-id-by-timestamp.mjs`. |
| A4 | `denied` is folded into `error` for v0 (no clean per-agent denied marker observed). | Six Heuristics notes | Low — only affects label granularity, not counts. |
| A5 | Heuristics can ride in Run/Route `metadata` without an ontology edit (km-core strict validates entityType, not metadata keys). | Storage shape | Low — Run already stores more metadata keys than declared properties (run-write.mjs vs ontology). Verify by re-close test. |

## Open Questions (RESOLVED)

1. **Which sqlite reader does Phase 70 use for OpenCode?**
   - **RESOLVED:** `better-sqlite3` (the repo dep, per 72-PATTERNS.md / opencode-sqlite.mjs) — locked in Plan 72-04 Task 1 (NOT `node:sqlite`).
   - What we know: OpenCode data is exclusively in `opencode.db` (SQLite, confirmed); Phase 70 read it for per-llm-call token rows.
   - What's unclear: whether it used `better-sqlite3` (repo dep) or `node:sqlite`.
   - Recommendation: planner greps Phase-70 plans/code for the sqlite import and reuses it; if absent, use built-in `node:sqlite` `DatabaseSync` (Node ≥22.5) in read-only/immutable mode.

2. **`edit_revert_count` v0 definition: Edit-input A→B→A pattern vs byte-state hash?** (A2)
   - **RESOLVED:** Edit-input A→B→A pattern is the strict v0 — locked in Plan 72-01 Task 2 (byte-state reconstruction deferred; `null` when edit inputs are not reconstructable).
   - Recommendation: ship the Edit-input pattern as the strict v0 (deterministic, fixture-testable, no file I/O), `null` when the agent's edit inputs are not reconstructable. Mark byte-state reconstruction as a future refinement. Planner should lock this in a task definition + fixture.

3. **Run↔session matching window** (A3) — confirm the timestamp-join approach against `scripts/backfill-task-id-by-timestamp.mjs` before implementing the readers. Single biggest correctness risk.
   - **RESOLVED:** lexical-ISO span time-window join confirmed as an in-task confirm step in Plan 72-04 Task 2 (predicate verified against backfill-task-id-by-timestamp.mjs:131-147).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Claude session JSONL | Claude route trace | ✓ | `~/.claude/projects/**/**.jsonl` (live, dated 2026-06-24) | — |
| Copilot `events.jsonl` | Copilot route trace | ✓ | `~/.copilot/session-state/<uuid>/events.jsonl` (v1.0.63 vocabulary confirmed) | — |
| OpenCode `opencode.db` | OpenCode route trace | ✓ | `~/.local/share/opencode/opencode.db` (SQLite, `part` table confirmed) | — |
| Experiment km-core store | Run/Route write | ✓ | `.data/experiments/leveldb` (Phase 71, openExperimentStore) | — |
| Archived span files | trace time-window + goal_sentence | ✓ | `.data/measurements/<task_id>.json` (Phase 68 contract) | — |
| Node sqlite reader | OpenCode read | ✓ (built-in `node:sqlite` ≥22.5) | — | `better-sqlite3` if Phase 70 used it |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** sqlite reader (built-in vs better-sqlite3 — both viable).

## Validation Architecture

> nyquist_validation key absent in `.planning/config.json` → treated as ENABLED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (the established pattern — `tests/experiments/*.test.mjs`, `tests/token-adapters/*.test.js`) |
| Config file | none — `node --test` discovers `tests/**` |
| Quick run command | `node --test tests/experiments/route-heuristics.test.mjs` |
| Full suite command | `node --test tests/experiments/ tests/token-adapters/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROUTE-01 | /gsd run derives goal_sentence from PLAN.md `**Goal**:`; freeform prompts; headless quarantines (empty + pending) | unit | `node --test tests/experiments/goal-sentence.test.mjs` | ❌ Wave 0 |
| ROUTE-02 | Each of six heuristics matches golden fixtures incl. true-negative cases (D-06/D-08) | unit | `node --test tests/experiments/route-heuristics.test.mjs` | ❌ Wave 0 |
| ROUTE-02 | Each per-agent reader emits correct `RouteEvent[]` from a captured fixture (Claude/Copilot/OpenCode) | unit | `node --test tests/experiments/route-readers.test.mjs` | ❌ Wave 0 |
| ROUTE-02 | `writeRun` writes six flat metrics on the Run + one idempotent Route node + `tookRoute` edge (re-close = no dup) | integration | `node --test tests/experiments/run-write.test.mjs` (extend existing) | partial — extend |
| ROUTE-02 | Trace-unavailable run writes `null` (not `0`) for all six (D-02) | unit | `node --test tests/experiments/route-heuristics.test.mjs` | ❌ Wave 0 |
| ROUTE-01/02 | Live: a real /gsd run close lands a Run with PLAN.md-derived goal + six strict heuristics + a Route node | manual/live | operator close + `node scripts/experiments-query.mjs` | n/a (live gate) |

### Sampling Rate
- **Per task commit:** `node --test tests/experiments/route-heuristics.test.mjs`
- **Per wave merge:** `node --test tests/experiments/`
- **Phase gate:** full experiment + token-adapter suites green + a live close proving cross-agent (at minimum one Claude run all-six + the D-02 null path) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/fixtures/route/` — golden `RouteEvent[]` fixtures (loop, edit-revert, redundant-read, abandoned, parallel-same-turn, true-negatives) — covers ROUTE-02
- [ ] `tests/experiments/route-heuristics.test.mjs` — one block per heuristic + true-negative cases (D-08) — covers ROUTE-02
- [ ] `tests/experiments/route-readers.test.mjs` — captured per-agent trace fixtures (small real-shape JSONL/events.jsonl/part rows) — covers ROUTE-02
- [ ] `tests/experiments/goal-sentence.test.mjs` — PLAN.md/ROADMAP `**Goal**:` extraction + quarantine path — covers ROUTE-01
- [ ] extend `tests/experiments/run-write.test.mjs` — Route node + flat metrics + idempotent re-close

## Security Domain

> `security_enforcement` absent in config → treated as ENABLED.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface (local CLI). |
| V3 Session Management | no | — |
| V4 Access Control | yes | uid-check gate (`st.uid === process.getuid()`) on every agent file read — reuse the Phase-69 pattern verbatim (claude-token-rows.mjs:93-101). Reject non-owned files. |
| V5 Input Validation | yes | Per-line `JSON.parse` try/catch (skip malformed, never throw — T-69-dos). `task_id` sanitization already enforced (measurement-span.ts `sanitizeTaskId`). SQLite read uses read-only/immutable URI + parameterized queries (no string interpolation of the LIKE filter; prefer parse-all-then-filter). |
| V6 Cryptography | yes (low) | `inputs_digest` uses `crypto.createHash('sha256')` (stdlib) — never hand-roll a hash. Do NOT decode `reasoningOpaque` (V6 — already a Phase-69 rule). |

### Known Threat Patterns for {Node ESM CLI reading agent trace files + LevelDB/SQLite}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via a crafted `task_id` → archive filename | Tampering | `sanitizeTaskId` (measurement-span.ts) — already enforced; the route reader never builds a filename from `task_id`. |
| Reading another user's session file | Info disclosure | uid-check gate (V4 above). |
| Malformed JSONL line crashing the close (DoS at run-end) | DoS | per-line try/catch; `buildNormalizedTrace` returns `null` on unreadable trace → heuristics null, close still completes. |
| SQL injection into the OpenCode query | Tampering | open `opencode.db` `mode=ro&immutable=1`; no user-controlled SQL (the only input is the run time-window, applied in JS after parse, or via bound parameters). |
| LevelDB lock contention (two CLIs) | DoS (self) | single-owner open-on-demand + `try/finally` close. |

## Sources

### Primary (HIGH confidence — inspected on disk)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts` — `SpanRecord.goal_sentence`, start/stop/getActiveMeasurement contract.
- `/Users/Q284340/Agentic/coding/scripts/measurement-stop.mjs` — the close orchestrator pipeline (insertion point confirmed at lines 188-209).
- `/Users/Q284340/Agentic/coding/lib/experiments/run-write.mjs` — idempotency, UUIDv7 minting, relation-key dedupe, Outcome-stub pattern (Route node analog).
- `/Users/Q284340/Agentic/coding/lib/experiments/store.mjs` — `openExperimentStore()` + mandatory `ontologyDir`.
- `/Users/Q284340/Agentic/coding/.data/ontologies-experiment/experiment-ontology.json` — Run `tookRoute`/Route/Step classes (Route `properties:{}`, Step stub).
- `/Users/Q284340/Agentic/coding/lib/lsl/token/claude-token-rows.mjs` + `copilot-token-rows.mjs` — proof the token adapters read a DISJOINT slice (usage / session.shutdown), and the uid/parse gates to reuse.
- Live trace shapes: Claude `~/.claude/projects/.../agent-a5388015534cc609c.jsonl` (tool_use/tool_result confirmed 2026-06-24); Copilot `~/.copilot/session-state/<uuid>/events.jsonl` v1.0.63 (`tool.execution_start/complete` confirmed); OpenCode `~/.local/share/opencode/opencode.db` `part` table (`type:tool`, `state.{status,time}` confirmed).

### Secondary (MEDIUM)
- `.planning/phases/71-experiment-kb-task-taxonomy/71-CONTEXT.md`, `.planning/ROADMAP.md` §Phase 71/72 — D-12/D-13/D-14 substrate decisions.

### Tertiary (LOW)
- none — all claims grounded in on-disk inspection.

## Metadata

**Confidence breakdown:**
- Normalized-trace schema + reuse decision: HIGH — all three agent shapes confirmed against live files; token-adapter disjointness proven by reading the source.
- Heuristic definitions: HIGH for five; MEDIUM for `edit_revert_count` (v0 Edit-input-pattern definition is a recommendation needing a planner/USER lock — see A2/OQ2).
- Compute location + storage: HIGH — exact insertion point and idempotent-write analog identified in source.
- Run↔session matching: MEDIUM — timestamp-join approach recommended but must be confirmed against the existing backfill helper (A3/OQ3).

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable — in-repo substrate; Copilot CLI version drift is the one external variable, already version-keyed at v1.0.63).

## RESEARCH COMPLETE

**Phase:** 72 - Syntactic Route Quality
**Confidence:** HIGH

### Key Findings
- All three agents (Claude JSONL, Copilot v1.0.63 events.jsonl, OpenCode opencode.db) expose full per-tool-call data confirmed against live files — Copilot is NOT limited to its per-session token tier, so D-02 `null` is the fallback, not the normal cross-agent path.
- Build NEW dedicated route-trace readers (`lib/lsl/route/`); do NOT overload the Phase-69/70 token adapters — they parse a disjoint slice (usage / session.shutdown / per-llm-call) with no tool-call sequence.
- Heuristics compute inside the existing `scripts/measurement-stop.mjs` close orchestrator at a confirmed insertion point (lines 188-209), then flow through an extended `writeRun` that adds six flat Run metrics + one idempotent Route node + a `tookRoute` edge (mirroring the existing Outcome-stub pattern).
- Six strict definitions specified + fixture ideas; `edit_revert_count` v0 = Edit-input A→B→A pattern (recommendation needing a lock), `null` when not reconstructable.
- Backfill rides the Phase-71 idempotent re-close (D-14) via a thin recompute CLI.

### File Created
`/Users/Q284340/Agentic/coding/.planning/phases/72-syntactic-route-quality/72-RESEARCH.md`

### Open Questions (non-blocking) (RESOLVED)
- Which sqlite reader Phase 70 used for OpenCode (reuse vs built-in `node:sqlite`). **RESOLVED:** `better-sqlite3` (repo dep) — Plan 72-04 Task 1.
- Lock the v0 `edit_revert_count` definition (Edit-input pattern vs byte-state). **RESOLVED:** Edit-input A→B→A pattern — Plan 72-01 Task 2.
- Confirm the run↔session timestamp-join window against `scripts/backfill-task-id-by-timestamp.mjs` (biggest correctness risk). **RESOLVED:** lexical-ISO span window confirmed as an in-task confirm step — Plan 72-04 Task 2.

### Ready for Planning
Research complete. The planner can author PLAN.md files for the readers, the heuristics function, the close-orchestrator extension, the `writeRun` extension, the goal_sentence population, and the Wave 0 fixtures/tests.

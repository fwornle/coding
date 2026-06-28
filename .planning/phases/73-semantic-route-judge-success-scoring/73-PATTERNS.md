# Phase 73: Semantic Route Judge & Success Scoring - Pattern Map

**Mapped:** 2026-06-28
**Files analyzed:** 8 (5 new, 3 modified)
**Analogs found:** 8 / 8 (every new/modified file has a strong in-repo analog — this phase is a near-pure extension of the Phase 71/72 experiment substrate)

This is a pure-backend phase. Every file copies an existing Phase 71/72 pattern almost verbatim; the only genuinely novel logic is the judge prompt + structured-output parsing (Claude's Discretion, no analog to copy — see "No Analog Found").

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/experiments/judge.mjs` (new) | service | request-response (proxy `/api/complete`) | `scripts/backfill-raw-observations.mjs` (`callProxy` + `buildSummaryRequest`) | exact (data-flow) |
| `lib/experiments/evidence-harness.mjs` (new) | utility | file-I/O (read on-disk artifacts) | `scripts/measurement-stop.mjs` `locatePlanMd`/`readArchivedSpan` + `lib/experiments/goal-sentence.mjs` | role-match |
| `lib/experiments/score-write.mjs` (new) | service / model-writer | CRUD (idempotent km-core write) | `lib/experiments/run-write.mjs` (`writeRun`) | exact |
| `lib/experiments/consequential-events.mjs` (new) | utility | transform (RouteEvent[] → labels) | `lib/experiments/route-heuristics.mjs` (`isReadTool`/`isMutateTool` + `HEURISTIC_KEYS`) | exact (role+flow) |
| `scripts/experiments-recompute-score.mjs` (new) | CLI / route | batch (resolve → judge → write) | `scripts/experiments-recompute-route.mjs` | exact |
| `.data/ontologies-experiment/experiment-ontology.json` (modify) | config / schema | n/a (declarative) | the existing `Run`/`Outcome` class blocks in the same file | exact |
| `scripts/measurement-stop.mjs` (modify) | CLI / orchestrator | event-driven (run-close hook) | itself — the existing step (3.5)/(4) heuristics+writeRun block | exact |
| `lib/vkb-server/api-routes.js` (modify) — PATCH override endpoint | controller | request-response (REST) | `handleUpdateEntity` + `registerRoutes` in the same file | exact |

> **Path note:** the experiment ontology lives at `.data/ontologies-experiment/experiment-ontology.json` (NOT `.data/ontologies/`). Confirmed on disk and in `lib/experiments/store.mjs:46` (`ontologyDir: path.join(repoRoot, '.data', 'ontologies-experiment')`). The Phase 71 CONTEXT.md's `.data/ontologies/` reference is stale — use the `ontologies-experiment` path.

---

## Pattern Assignments

### `lib/experiments/judge.mjs` (service, request-response)

**Analog:** `scripts/backfill-raw-observations.mjs` (the canonical host-side `/api/complete` client).

**Proxy client pattern** (`scripts/backfill-raw-observations.mjs:38-42, 94-106`):
```javascript
const PROXY_PORT = process.env.LLM_CLI_PROXY_PORT || '12435';
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
const REQUEST_TIMEOUT_MS = 60_000;

async function callProxy(body) {
  const resp = await fetch(`${PROXY_URL}/api/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`);
  }
  return resp.json(); // → { content, provider, model, tokens, latencyMs } (NOT OpenAI-wrapped)
}
```

**Request body shape** (`scripts/backfill-raw-observations.mjs:62-91`): `{ process, messages: [{role:'system',...},{role:'user',...}], taskType }`. The judge adds `taskType` to route to Haiku:
```javascript
return {
  process: 'route-judge',          // pick a stable process literal (CLAUDE.md: proxy keys overrides by `process`)
  taskType: 'route_judge',         // ← routes to the `fast` tier (Haiku) — see Shared Pattern "taskType→Haiku"
  messages: [ { role: 'system', content: JUDGE_SYSTEM_PROMPT }, { role: 'user', content: judgeContext } ],
};
```

**URL resolution precedence (CLAUDE.md, MANDATORY):** `RAPID_LLM_PROXY_URL` → `LLM_CLI_PROXY_URL` → `LLM_PROXY_URL` → `http://localhost:${LLM_CLI_PROXY_PORT ?? '12435'}`, append `/api/complete` exactly once. Port **12435**, NOT 3033 (3033 is the Health API and silently returns `Cannot POST /api/complete` HTML).

**Failure quarantine pattern (D-03/D-04):** wrap the `callProxy` in try/catch — on throw OR non-OK, return all judged fields `null` + `pending: true` (NEVER block the close). This mirrors `run-write.mjs`'s null-preservation ethos and `measurement-stop.mjs`'s "close must not hard-block" comments (lines 212-215, 224). The trivial-run guard (D-04) returns `null` + `not_scored: 'trivial'` WITHOUT calling the proxy at all.

> **Token measurement is free (Phase 68):** because the judge call goes through `/api/complete`, the proxy's `attachTokenLogger` auto-attributes its tokens. No extra instrumentation — just ensure the active `task_id` is set (it is, mid-close).

---

### `lib/experiments/consequential-events.mjs` (utility, transform)

**Analog:** `lib/experiments/route-heuristics.mjs` (the tool-name classifier + frozen key list + `RouteEvent[]` consumer). This is the Phase-72 D-08 fixture-tested tool-name classification the CONTEXT.md points to.

**Tool-name classification pattern** (`lib/experiments/route-heuristics.mjs:58-65`):
```javascript
function isReadTool(name) {
  return name === 'Read';
}
function isMutateTool(name) {
  // Edit/Write/MultiEdit/NotebookEdit all mutate the target_path's state.
  return name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit';
}
```

**Phase-73 extension:** add a `isConsequentialTool(name)` (acting = Edit/Write/MultiEdit/NotebookEdit/Bash/Task) vs navigation (Read/Glob/Grep/WebFetch/…). Mirror the frozen-set style (`lib/experiments/route-heuristics.mjs:32-40`):
```javascript
const CONSEQUENTIAL_TOOLS = Object.freeze(['Edit','Write','MultiEdit','NotebookEdit','Bash','Task']);
export function isConsequentialTool(name) { return CONSEQUENTIAL_TOOLS.includes(name); }
```
D-02 ratio = `toward / (toward + away)`; neutral excluded from denominator. The filter runs over the **Phase-72 `RouteEvent[]`** — consume the `tool_name` + `outcome` fields documented in `lib/lsl/route/route-event.mjs:27-37`. Per-agent native names already arrive un-normalized (`route-event.mjs:30` "NOT normalized away"), so cross-agent name sets matter — fixture-test like D-08.

**Module conventions to copy** (pure ESM, no km-core/fs import, `process.stderr.write` only for diagnostics): `lib/experiments/route-heuristics.mjs:17-30` header + `lib/lsl/route/route-event.mjs:46-57` (frozen `OUTCOMES` enum + `OUTCOME_VALUES` array for membership checks).

---

### `lib/experiments/evidence-harness.mjs` (utility, file-I/O)

**Analog:** `scripts/measurement-stop.mjs` `locatePlanMd` (lines 107-122) for phase-dir resolution + `lib/experiments/goal-sentence.mjs` (fail-soft on-disk PLAN.md/ROADMAP reader, already used at `measurement-stop.mjs:62,229`).

**Fail-soft phase-artifact locator pattern** (`scripts/measurement-stop.mjs:107-122`):
```javascript
function locatePlanMd(phasesRoot, phaseToken) {
  try {
    const num = String(phaseToken).trim().match(/^\d+/)?.[0];
    if (!num) return null;
    const dirs = fs.readdirSync(phasesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && new RegExp(`^0*${num}(?:[.-]|$)`).test(d.name))
      .map((d) => d.name);
    if (dirs.length === 0) return null;
    const phaseDir = path.join(phasesRoot, dirs[0]);
    const plans = fs.readdirSync(phaseDir).filter((f) => /-PLAN\.md$/.test(f)).sort();
    if (plans.length === 0) return null;
    return path.join(phaseDir, plans[0]);
  } catch { return null; }
}
```
**Phase-73 use:** same locator, but glob the active phase dir for `*-VERIFICATION.md` (verdict), `*-REVIEW.md` (findings count), `*-PLAN.md` (task list for `spec_drift`). Each read is **fail-soft → `null`** (D-01: a dimension with no evidence is written `null`, NOT zero/guessed — carries Phase 72 D-02). Add a `git diff --stat` read (spawn `git`, capture stdout) and a test pass/fail parse of **existing** output (D-01: do NOT run new tests/linters). Return a structured `{ verification, reviewFindings, testSummary, diffStat, planTasks }` evidence object fed to `judge.mjs`.

**Read-archived-artifact fail-soft idiom** (`scripts/measurement-stop.mjs:92-98`):
```javascript
function readArchivedSpan(archivePath, fallback) {
  try { return JSON.parse(fs.readFileSync(archivePath, 'utf8')); }
  catch { return fallback; }
}
```

---

### `lib/experiments/score-write.mjs` (service, CRUD — idempotent km-core write)

**Analog:** `lib/experiments/run-write.mjs` (`writeRun`). The `writeScore` is the Outcome/Route-stub pattern (lines 124-208) applied to a new `Score` entity + `scored` edge. **Copy this template verbatim.**

**Idempotent lookup-by-task_id → mint-or-reuse → strict putEntity** (`lib/experiments/run-write.mjs:64-72, 76-122, 126-151`):
```javascript
// (1) idempotent lookup — find existing Score by back-link, NEVER use task_id as entity id
let existingScoreId;
for await (const e of store.iterate({ entityType: 'Score' })) {
  if (e.metadata?.run_task_id === span.task_id) { existingScoreId = e.id; break; }
}
// (2) synthetic provenance — the store NEVER invents one (D-30); the orchestrator supplies it
const provenance = {
  provider: 'coding-measure-stop', model: 'n/a',
  runId: span.task_id, timestamp: new Date().toISOString(),
};
// (3) strict-path putEntity (validated against experiment-ontology.json — NOT skipOntologyCheck)
const scoreId = await store.putEntity({
  id: existingScoreId ?? mintEntityId(),  // re-close updates SAME node; first write mints (never task_id)
  name: `${span.task_id}-score`,
  entityType: 'Score',
  layer: 'evidence',
  description: '...',
  metadata: {
    domain: 'experiment',          // exporter buckets by metadata.domain → experiment.json
    run_task_id: span.task_id,     // back-link for idempotent lookup
    // judged fields (overwritten on re-judge) ...
    // corrected_* fields (PRESERVED on re-judge — read existing first, see below) ...
  },
}, { provenance });
```

**Stable-key edge dedupe** (`lib/experiments/run-write.mjs:158-163, 203-208`) — WITHOUT the `key`, every re-close appends a parallel edge (WR-01 bug):
```javascript
await store.addRelation({
  type: 'scored', from: runId, to: scoreId,
  key: `${runId}:scored:${scoreId}`,   // stable key ⇒ N re-closes dedupe to ONE edge
});
```
(`runId` is resolved by the same `iterate({entityType:'Run'})` task_id scan as `run-write.mjs:64-72` / `experiments-recompute-route.mjs:66-71`.)

**D-06 override preservation (CRITICAL):** judged fields are overwritten by a re-judge; `corrected_*` fields are NEVER clobbered. On re-write, read the existing Score first and carry forward any `corrected_<dim>` / `overridden_by` / `overridden_at` that are already set (the lookup at step (1) already has the entity `e` in hand — reuse `e.metadata`). This is the one place `writeScore` diverges from `writeRun` (which has no corrected-field concept).

**Null/marker tri-state to keep distinguishable in metadata (D-04 + Phase 72 D-02/D-05):**
| State | Storage |
|-------|---------|
| genuinely scored | numeric value |
| no evidence for dimension | `null` |
| judge failed / proxy down | judged fields `null` + `pending: true` |
| trivial run (≈0 consequential events) | judged fields `null` + `not_scored: 'trivial'` |

---

### `scripts/experiments-recompute-score.mjs` (CLI, batch)

**Analog:** `scripts/experiments-recompute-route.mjs` — near-clone. Swap the `computeHeuristics` step for the judge step; everything else (arg parse, span read, store open/finally-close, idempotent re-write, entry-point guard) copies 1:1.

**Store open + finally-close + entry guard** (`scripts/experiments-recompute-route.mjs:94-95, 142-162`):
```javascript
const store = await openExperimentStore();   // mandatory ontologyDir factory — never `new GraphKMStore`
try {
  const run = await findRun(store, taskId);
  // ... rebuild trace, judge, writeScore ...
} finally {
  await store.close();                       // LevelDB single-owner — always close
}
// entry-point guard (recompute-route.mjs:149-162) — only run main() when invoked directly, not on import
const isMain = (() => { try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } })();
if (isMain) main().catch((err) => { warn(`FATAL: ${err.stack || err.message}`); process.exit(1); });
```

**Trace rebuild with agent-seam wiring (MUST copy — else Claude/Copilot runs re-null)** (`scripts/experiments-recompute-route.mjs:122-127`):
```javascript
const normAgent = normalizeAgent({ agent: tags.agent, model: tags.model });
const trace = await buildNormalizedTrace(span, {
  dominantAgent: normAgent,
  __seam: buildTraceSeam(normAgent, span),
});
```
The judge consumes this `trace` (filtered through `consequential-events.mjs`) for `goal_aligned_ratio`. Imports to reuse: `openExperimentStore` (`lib/experiments/store.mjs`), `aggregateByTaskId` (`lib/experiments/token-aggregate.mjs:62`), `buildNormalizedTrace` (`lib/lsl/route/build-trace.mjs:147`), `normalizeAgent`/`buildTraceSeam` (`lib/experiments/route-trace-resolve.mjs:34,113`).

**CLI acceptance grep (CLAUDE.md km-core rule):** the plan MUST include an acceptance grep for `ontologyDir` reachability — satisfied transitively because the CLI opens via `openExperimentStore()` (which sets `ontologyDir` at `store.mjs:46`). Do NOT construct `GraphKMStore` inline.

---

### `.data/ontologies-experiment/experiment-ontology.json` (config, modify)

**Analog:** the existing `Run` and `Outcome` class blocks in the same file (lines 17-34, 53-64).

**Add a `Score` class** mirroring the `Outcome` property-block shape (`experiment-ontology.json:53-64`):
```json
"Score": {
  "extends": "Contract",
  "description": "Semantic scoring of a Run: goal_aligned_ratio + 5-dim success rubric (judged) + corrected_* overrides (D-05/D-06).",
  "relationships": {},
  "properties": {
    "goalAlignedRatio": { "type": "number", "description": "toward/(toward+away) over consequential events (D-02); null when not scored" },
    "goalAchieved":     { "type": "number", "description": "0-1 judged; null when no evidence" },
    "codeQuality":      { "type": "number", "description": "0-1 judged" },
    "testCoverage":     { "type": "number", "description": "0-1 judged" },
    "regressions":      { "type": "number", "description": "0|1 judged" },
    "specDrift":        { "type": "number", "description": "0-1 judged; null/goal-only for freeform" }
  }
}
```

**Add the `scored` relation to `Run`** — extend the existing `Run.relationships` (`experiment-ontology.json:20`):
```json
"relationships": { "produces": ["Outcome"], "tookRoute": ["Route"], "belongsTo": ["Experiment"], "scored": ["Score"] }
```
Keep `meta.version` bump conventions consistent with the file's existing `"version": "1.0.0"`. Validate against `.data/ontologies/schemas/ontology-schema.json` (per Phase 71 canonical refs). The `corrected_*` / `overridden_by` / `overridden_at` fields ride in `metadata` (not declared ontology properties) — same approach `run-write.mjs` uses for heuristics (see `run-write.mjs:170` "Heuristics ride in metadata — no ontology edit").

---

### `scripts/measurement-stop.mjs` (orchestrator, modify)

**Analog:** itself — the existing step (3.5/3.6) heuristics + step (4) writeRun block (lines 263-285).

**Insertion point** — right after `writeRun` inside the existing `try` (lines 277-285):
```javascript
const store = await openExperimentStore();
let pendingCount;
try {
  await writeRun(store, { span, taskClass, pending, tags, totals, heuristics });
  // ── (4.5 NEW) gather evidence (D-01) → judge (D-03/D-04) → writeScore + scored edge ──
  const evidence = gatherEvidence({ span, phaseArg, repoRoot: REPO_ROOT });   // evidence-harness.mjs
  const consequential = trace ? filterConsequential(trace) : [];              // consequential-events.mjs
  const judgment = consequential.length === 0
    ? { not_scored: 'trivial' }                                               // D-04 trivial-run guard — no proxy call
    : await runJudge({ span, trace: consequential, evidence });               // judge.mjs (try/catch → pending on fail)
  await writeScore(store, { span, judgment });                               // score-write.mjs
  pendingCount = await countPending(store);
} finally {
  await store.close();
}
```
Reuse the already-computed `trace` (line 271) and `span` (with populated `goal_sentence`, lines 217-242). The judge must NOT throw out of the `try` — `runJudge` internally quarantines to `{ ...nulls, pending: true }` so the close completes (mirrors the existing "never hard-block" contract, lines 212-215). Keep all output on `process.stdout.write`/`process.stderr.write` (no-console-log, header lines 33-34).

---

### `lib/vkb-server/api-routes.js` — PATCH override endpoint (controller, modify)

**Analog:** `handleUpdateEntity` (the `PUT /api/entities/:name` handler) + `registerRoutes` (lines 55-91) in the same file. **Reuse this existing Express surface — do NOT stand up a new server** (D-07 + CONTEXT.md integration note).

**Route registration pattern** (`lib/vkb-server/api-routes.js:63-65`):
```javascript
app.post('/api/entities', (req, res) => this.handleCreateEntity(req, res));
app.put('/api/entities/:name', (req, res) => this.handleUpdateEntity(req, res));
app.delete('/api/entities/:name', (req, res) => this.handleDeleteEntity(req, res));
```
Add: `app.patch('/api/experiments/scores/:taskId', (req, res) => this.handleScoreOverride(req, res));`

**Handler structure** (validate → write → respond, with try/catch + `logger.error`) from `handleUpdateEntity` (lines ~ `handleUpdateEntity(req,res)` block shown in research):
```javascript
async handleScoreOverride(req, res) {
  try {
    const { taskId } = req.params;
    const { dimension, value, overridden_by } = req.body;
    if (!dimension || value === undefined) {
      return res.status(400).json({ error: 'Missing required fields', message: 'dimension and value are required' });
    }
    // open experiment store, find Score by run_task_id, set corrected_<dimension> + overridden_by/at,
    // strict-path putEntity (PRESERVING judged fields — D-06), close store.
    res.status(200).json({ success: true, taskId, dimension });
  } catch (error) {
    logger.error('Score override failed', { error: error.message });
    res.status(500).json({ error: 'Score override failed', message: error.message });
  }
}
```
**Important divergence:** `api-routes.js` writes to the *shared* observation store via `UKBDatabaseWriter` (constructor, lines 14-50). The Score override must instead write to the **dedicated experiment store** via `openExperimentStore()` (do not route Score writes through `UKBDatabaseWriter`/the shared KG). Reuse `writeScore`'s override-preservation path rather than re-implementing — ideally `handleScoreOverride` calls a small `applyOverride(store, {taskId, dimension, value, by})` exported from `score-write.mjs`.

> **Research flag for planner:** confirm which process actually mounts `ApiRoutes`/`api-routes.js` and whether it runs in-container (bind-mount/rebuild implications per CLAUDE.md) or host-side. If the VKB server cannot reach the host `.data/experiments/` LevelDB, the PATCH endpoint may belong on a host-side surface instead. Verify the mount + store reachability before locking the endpoint home.

---

## Shared Patterns

### taskType → Haiku routing
**Source:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/provider-registry.ts:223-257` (`getTierForTask`, `<TASKTYPE>_TIER` env override, `config.taskTiers`) + `src/config.ts:154` (`models.fast: 'claude-haiku-4-5'`).
**Apply to:** `judge.mjs`, `experiments-recompute-score.mjs`.
The proxy maps `taskType` → tier (`fast`/`standard`/`premium`); `fast` = `claude-haiku-4-5`. A new `taskType` resolves via `config.taskTiers` or a `<TASKTYPE>_TIER=fast` env override. **Guardrail (D-03 / CLAUDE.md):** after wiring, probe `/api/complete` and read back `provider`/`model` from the response to VERIFY it landed on Haiku — the `consolidator-mentions` lesson (MEMORY.md) shows overrides silently no-op when the key doesn't match. The proxy keys process-overrides by the `process` literal, tier by `taskType`.

### Idempotent km-core write (lookup → mint-or-reuse → strict putEntity + stable-key edge)
**Source:** `lib/experiments/run-write.mjs:64-72, 76-122, 158-163`.
**Apply to:** `score-write.mjs` (and the PATCH handler's override write).
Never use `task_id` as the entity id (`parseEntityId` requires UUIDv7 — `run-write.mjs:8-14`). Always `metadata.domain: 'experiment'` (exporter bucketing, `run-write.mjs:96-99`). Always supply a synthetic `provenance` (the store never invents one). Always give `addRelation` a stable `key`.

### km-core store access (mandatory ontologyDir)
**Source:** `lib/experiments/store.mjs:40-54` (`openExperimentStore`).
**Apply to:** `score-write.mjs`, `experiments-recompute-score.mjs`, the PATCH handler.
Open via `openExperimentStore()` ONLY (never `new GraphKMStore`); caller owns `try/finally { await store.close() }` (single-owner LevelDB). Acceptance grep for `ontologyDir` reachability is mandatory in any new CLI plan (CLAUDE.md).

### Null / pending / trivial tri-state (degradation markers)
**Source:** `lib/experiments/route-heuristics.mjs:13-16, 49-56` (`ALL_NULL_HEURISTICS`, the `0` vs `null` contract) + Phase 72 D-02/D-05.
**Apply to:** `judge.mjs`, `score-write.mjs`.
Keep all three distinguishable in storage: `null` (no evidence) ≠ `pending: true` (judge failed) ≠ `not_scored: 'trivial'` (D-04). Never coerce a missing dimension to `0`.

### no-console-log logging
**Source:** every module header (`run-write.mjs:22-23`, `route-heuristics.mjs:18-19`, `measurement-stop.mjs:33-34`).
**Apply to:** ALL new `.mjs` files.
Diagnostics via `process.stderr.write` / `process.stdout.write` only — never `console.*`. Do not dodge the rule with another raw-write API (CLAUDE.md constraint-dodging clause).

---

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| Judge prompt + structured-output schema (inside `judge.mjs`) | service (prompt design) | request-response | No existing single-call "ratio + per-event labels + 5-dim rubric + rationales" judge prompt in-repo. The closest is `buildSummaryRequest` (`backfill-raw-observations.mjs:57-91`) for the **message envelope shape** only; the prompt content + JSON-output contract + parse/validation is net-new (Claude's Discretion per CONTEXT.md D-03). Planner: design the structured-output schema and a defensive parser (the proxy returns `{ content }` as a string — parse + validate; on parse failure, quarantine to `pending` like a proxy failure). Reference the LOCKED rubric in `.planning/notes/v73-perf-measurement-exploration.md` §D5 (the 5 dimensions + ranges + per-dimension evidence sources) — do NOT redesign it. |

---

## Metadata

**Analog search scope:** `lib/experiments/`, `lib/lsl/route/`, `scripts/`, `lib/vkb-server/`, `.data/ontologies-experiment/`, `_work/rapid-llm-proxy/src/`.
**Files scanned (read in full or targeted):** `run-write.mjs`, `backfill-raw-observations.mjs` (1-130), `experiments-recompute-route.mjs`, `measurement-stop.mjs`, `store.mjs`, `route-heuristics.mjs` (1-75), `route-event.mjs`, `experiment-ontology.json`, `api-routes.js` (1-56 + handler/registration greps), `provider-registry.ts`/`config.ts` (targeted greps).
**Pattern extraction date:** 2026-06-28

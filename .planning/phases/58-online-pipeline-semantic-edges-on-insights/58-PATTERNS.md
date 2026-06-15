# Phase 58: Online Pipeline Semantic Edges on Insights — Pattern Map

**Mapped:** 2026-06-15
**Files analyzed:** 5 surfaces (1 unification, 1 new classifier, 1 new backfill, 1 atomicity contract within #1, 1 orphan bridge extension within #1)
**Analogs found:** 5 / 5 — every new surface has a strong codebase analog inside this repo.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/live-logging/ObservationConsolidator.js` — `_pushInsightToKG` refactor (D-06) | writer (consolidator → km-core, replaces VKB HTTP PUT) | request-response → kmStore.putEntity + addRelation loop | `src/live-logging/ObservationWriter.js` `writeInsight` (line 1178) + `_anchorEntity` (line 425) | **exact** (same writer surface, same kmStore API, same trusted-path convention) |
| `src/live-logging/ObservationConsolidator.js` — atomicity contract (D-04) inside `_pushInsightToKG` | writer ordering / microtask atomicity | single putEntity → synchronous addRelation loop | `ObservationWriter._anchorEntity` (line 425-443) — already does the 1-edge variant of D-04 | **exact** (just generalize to N edges) |
| `src/live-logging/ObservationConsolidator.js` — `_relinkOrphanOnlineInsights` extension (D-06.2) | periodic backfill within consolidator | scan + missing-edge detection + addRelation | same method (line 1907-1956) currently HTTP-PUT-based; new code uses kmStore primitives via the D-02 helper | **role-match** (same loop shape, swap the writer-edge generator) |
| **NEW** mentions-classifier helpers — same file as `ObservationConsolidator.js` OR sibling module under `src/live-logging/` | classifier (LLM, host-side) | request-response, rapid-llm-proxy `POST /api/complete` with `taskType` | `integrations/mcp-server-semantic-analysis/src/agents/llm-with-process.ts` `llmWithProcessComplete` (line 134) + `ontology-classification-agent.ts` `loadL2Classes` / `buildL2RefinementPrompt` / `extractL2FromLLMResponse` (lines 70-144) | **exact** (same proxy endpoint; same closed-set-from-registry candidate-catalog pattern; same token-boundary extraction guard) |
| **NEW** `scripts/backfill-insight-mentions.mjs` (D-05) | backfill-script (host-side, one-shot) | read JSON export → LLM classifier per Insight → kmStore.addRelation loop | `scripts/backfill-project-tag.mjs` (Phase 57-05; 441 LoC) + `scripts/backfill-raw-observations.mjs` (LLM-proxy host client at lines 40-106) + `scripts/backfill-edges-from-legacy.mjs` (edge backfill loop shape) | **exact** (same JSON-replay structure, same `ontologyDir` resolution, same `skipOntologyCheck` discipline) |

---

## Pattern Assignments

### 1. `src/live-logging/ObservationConsolidator.js` — `_pushInsightToKG` refactor (D-06)

**Analog:** `src/live-logging/ObservationWriter.js` lines 1178-1201 (`writeInsight`) + 385-443 (`_resolveAnchorId` + `_anchorEntity`).

**Why this analog:** The consolidator currently writes Insights via `fetch(PUT /api/entities/${topic})` against VKB on port 8080 (consolidator lines 547-551). ObservationWriter already implements the kmStore-native path that the writer-path unification (D-06) wants to converge on — same kmStore handle (injected via constructor `options.kmStore`, see consolidator line 107-112), same trusted-path putEntity (skipOntologyCheck:true), and `_anchorEntity` already lands the `capturedBy → LiveLoggingSystem` edge through `kmStore.addRelation`. The new code path adds the `mentions` edge loop next to the `_anchorEntity` call.

**Current HTTP-PUT shape to replace** (consolidator lines 547-585):
```javascript
const res = await fetch(
  `${vkbUrl}/api/entities/${encodeURIComponent(entry.topic)}`,
  { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
);
// ... handles ok/error, then issues:
await fetch(`${vkbUrl}/api/relations`, {
  method: 'POST',
  body: JSON.stringify({ from: projectName, to: entry.topic, type: 'has_insight', ... }),
});
```

**Target kmStore-native shape from `ObservationWriter.writeInsight`** (lines 1178-1201):
```javascript
async writeInsight(row) {
  if (!row || typeof row !== 'object') throw new Error('[ObservationWriter] writeInsight: row required');
  if (!row.id) throw new Error('[ObservationWriter] writeInsight: row.id required');
  const kmStore = await this._ensureKmStore();
  const ts = row.created_at || new Date().toISOString();
  try {
    const entity = legacyInsightToEntity(row, this._runId, ts);
    entity.ontologyClass = 'Detail';
    entity.metadata = { ...entity.metadata, source: 'auto' };
    const mintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
    await this._anchorEntity(kmStore, mintedId);   // ← capturedBy → LiveLoggingSystem
    return row.id;
  } catch (err) {
    process.stderr.write(`[ObservationWriter] km-core putEntity (insight ${row.id}) failed: ${err.message}\n`);
    throw err;
  }
}
```

**Constructor wiring already present** (consolidator lines 107-128):
```javascript
/**
 * @param {import('@fwornle/km-core').GraphKMStore} [options.kmStore] -
 *   Phase 44 Plan 17: pre-constructed km-core store. REQUIRED — the
 *   consolidator no longer lazy-constructs one (single-owner pattern
 *   mirrors ObservationWriter Plan 44-13). obs-api passes its own
 *   instance so consolidation reads + writes share one canonical store
 *   with the writer + typed-view reads.
 */
constructor(options = {}) {
  // ...
  this._kmStore = options.kmStore || null;
  // ...
}
```

**The `_kmStore` handle is therefore already available** — no constructor extension required. The unification just removes the `fetch(PUT)` block and calls `this._kmStore.putEntity(...)` + the new mentions-edge loop in the same try-block, mirroring `writeInsight`'s shape.

**Preserve the existing `has_insight` edge** (consolidator lines 565-580): translate from the existing `POST /api/relations` call to `this._kmStore.addRelation(...)` using the same Project anchor id `_ensureProjectAnchor` returns. The Project anchor resolution is unchanged.

**Landmines:**
- The consolidator's existing `_pushInsightToKG` is fire-and-forget — failures are swallowed (lines 1691 `try { ... } catch { /* swallowed */ }` and line 3341 `process.stderr.write('VKB push failed')`). The D-04.1 decision says LLM-classifier failures must NOT write the Insight; preserve fail-fast semantics for the classifier step but keep the existing swallow at the call-site so a single Insight failure doesn't abort the batch.
- Insight `topic` is currently used as the VKB entity name (HTTP path arg `entityName=${entry.topic}`); when switching to kmStore.putEntity, the consolidator's entity-shape construction needs an `id` field. `ObservationWriter.writeInsight` derives it from `row.id` — the consolidator's `entry` object does not currently have a stable id (uses `topic` as the unique key against VKB). Either generate a UUID at write-time or look up the existing entity via `kmStore.findByOntologyClass('Insight').find(e => e.name === entry.topic)` first (the existing `_synthesizeInsights` path already uses this — line 1546). Mirror the same lookup.
- Existing entity vs new entity: consolidator already has a `_similarMatch` and `mergeAttributes` branch (line 1572). Preserve.

---

### 2. `src/live-logging/ObservationConsolidator.js` — D-04 atomicity contract (single-tick putEntity + addRelation loop)

**Analog:** `ObservationWriter._anchorEntity` (lines 425-443).

**Why this analog:** The atomicity contract is "single putEntity + synchronous addRelation loop in the same microtask". `_anchorEntity` is the existing one-edge implementation of exactly this pattern. The Phase 58 task is generalizing N=1 to N=K (where K = `mentions[].length + 1 capturedBy + 1 has_insight`).

**Exact code pattern to copy** (ObservationWriter.js lines 425-443):
```javascript
async _anchorEntity(kmStore, fromId, relationType = 'capturedBy') {
  if (!fromId) return;
  const anchorId = await this._resolveAnchorId(kmStore);
  if (!anchorId) return;
  try {
    await kmStore.addRelation({
      from: fromId,
      to: anchorId,
      type: relationType,
      metadata: { source: 'observation-writer', anchoredAt: new Date().toISOString() },
    });
  } catch (err) {
    // Source/Target-not-found can race with a putEntity in-flight; treat
    // as benign. Other errors get one-line logged.
    process.stderr.write(
      `[ObservationWriter] anchor edge ${fromId}->${anchorId} failed (non-fatal): ${err.message}\n`
    );
  }
}
```

**`kmStore.addRelation` signature** from `lib/km-core/src/store/GraphKMStore.ts` lines 837-857:
```typescript
async addRelation(r: Relation & { key?: string }): Promise<void> {
  if (!this.graph.hasNode(r.from)) throw new Error(`Source node not found: ${String(r.from)}`);
  if (!this.graph.hasNode(r.to))   throw new Error(`Target node not found: ${String(r.to)}`);
  // ... graphology addEdge ...
  this.emit('relation:added', { relation: r });
  this.exporter.scheduleExport(this.graph.export() as SerializedGraph);   // ← 5s debounce
}
```

**Key implications:**
- **No transactional primitive exists.** `addRelation` is `async` only because km-core's whole surface is async-by-convention (Pattern S4); the underlying graphology call is synchronous. A `for` loop of `await kmStore.addRelation(...)` calls IS the atomic unit, because `exporter.scheduleExport` is debounced (5s) — within the same microtask burst, all addRelation calls share the same export tick. This matches CONTEXT D-04.
- **`addRelation` is NOT idempotent on `(from, to, type)`.** Looking at the implementation, it always issues `addEdge` (which uses graphology's generated key). The codebase deduplicates manually — see `reprojectFromOnlineStore.ts` lines 441-456:
  ```typescript
  const existing = await store.findRelations({ from: fromId, to: toId, type: 'aggregates' });
  if (existing.length > 0) return false;
  const relation: Relation = { type: 'aggregates', from: fromId, to: toId, createdAt: new Date().toISOString() };
  await store.addRelation(relation);
  ```
  **Planner: copy this dedup pattern for the `mentions` writer + backfill** (Phase 58 D-05 says backfill MUST be idempotent on re-run). Recommended: dedupe in-process before calling addRelation — find existing mentions for this insight, skip writes for any (from, to, type) already present.
- **Error handling for "Source node not found":** can race with putEntity in-flight. `_anchorEntity` treats it as benign — the planner should do the same for the mentions loop. The writer-side already enforces putEntity-before-addRelation ordering (the existing `_anchorEntity` call comes immediately after `mintedId = await kmStore.putEntity(...)` in `ObservationWriter.writeInsight`).

**Recommended Phase 58 atomic-write shape:**
```javascript
// Inside refactored _pushInsightToKG, after computing mentionsTargetIds (the LLM result):
const mintedId = await this._kmStore.putEntity(entity, { skipOntologyCheck: true });

// Synchronous addRelation loop — same microtask, no awaits between iterations
// beyond what kmStore enforces. The 5s exporter debounce in km-core means
// every addRelation lands in the same JSON-export tick as putEntity.
for (const targetId of mentionsTargetIds) {
  try {
    await this._kmStore.addRelation({
      from: mintedId,
      to: targetId,
      type: 'mentions',
      metadata: { source: 'observation-consolidator', classifiedAt: new Date().toISOString(), classifier: 'llm-haiku' },
    });
  } catch (err) {
    process.stderr.write(`[Consolidator] mentions edge ${mintedId}->${targetId} failed (non-fatal): ${err.message}\n`);
  }
}
await this._anchorEntity(this._kmStore, mintedId);   // existing capturedBy edge
// Existing has_insight from project anchor goes here next (kmStore.addRelation form, NOT the fetch(POST /api/relations) form).
```

---

### 3. NEW: mentions classifier helpers (D-02)

**Analog 1 (LLM proxy call):** `integrations/mcp-server-semantic-analysis/src/agents/llm-with-process.ts` lines 134-226 (`llmWithProcessComplete`). This is the canonical container-side proxy client; the host-side equivalent is `scripts/backfill-raw-observations.mjs` lines 40-106 (host-context, uses `localhost` rather than `host.docker.internal`).

**Analog 2 (closed-set candidate catalog from registry + token-boundary extraction):** `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` lines 70-144 (`loadL2Classes`, `buildL2RefinementPrompt`, `extractL2FromLLMResponse`).

**Why these analogs:**
- Phase 57 Plan 04 shipped an EXACT structural twin: a registry-driven closed-set classifier that runs through the same rapid-llm-proxy on the same `taskType` channel. The Phase 58 classifier replaces "10 L2 classes from coding.lower.json" with "645 L1+L2+L3 entities `entityType in {Component, SubComponent, Detail}`", but the structural shape — `load*()` builds the closed set from a known source, `build*Prompt()` renders the prompt, `extract*FromLLMResponse()` validates the LLM output against the closed set, embed-match tolerated — transfers verbatim.
- Plan 04 SUMMARY (lines 60-67) records this as the canonical pattern: *"Pure-function exports beside the agent class (loadL2Classes / buildL2RefinementPrompt / extractL2FromLLMResponse) — testable without instantiating the full classifier pipeline; mirrors the canonical-mapper pattern (toCanonicalEntity / augmentWithCanonical exported from the same module as the wave agents)."* — Phase 58 follows the same export shape.
- Token-boundary regex from `extractL2FromLLMResponse` (line 137-143) — `(^|[^A-Za-z0-9_])${escapeRegex(name)}([^A-Za-z0-9_]|$)` — directly applies to the mentions case: an Insight summary contains `EtmDaemon` as a token, but `SuperEtmDaemonX` (hallucination) is rejected.

**LLM proxy request shape (host-side variant, copied from `scripts/backfill-raw-observations.mjs`):**
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
  return resp.json();
}
```

**`taskType` routing convention (claude-haiku for cheaper bulk):**
- The Phase 58 mentions classifier hits the proxy with `taskType: 'mentions-classification'` (or similar) so the `processOverrides` config from `scripts/configure-wave-analysis-routing.sh` (or a new override added for `mentions-*`) routes the call to copilot+claude-haiku instead of the default expensive routing.
- From `scripts/resolve-observations-from-lsl.mjs` lines 150-158 — both `process` AND `taskType` are commonly set on the same call:
  ```javascript
  return {
    process: 'observation-resolution',
    taskType: 'observation-resolution',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  };
  ```

**URL-resolution helper to copy** (host-side variant — `scripts/resolve-observations-from-lsl.mjs` lines 101-113):
```javascript
function resolveProxyUrl() {
  if (process.env.RAPID_LLM_PROXY_URL) return process.env.RAPID_LLM_PROXY_URL;
  if (process.env.LLM_CLI_PROXY_URL) return process.env.LLM_CLI_PROXY_URL;
  if (process.env.LLM_PROXY_URL) return process.env.LLM_PROXY_URL;
  const port = process.env.LLM_CLI_PROXY_PORT || '12435';
  return `http://localhost:${port}`;
}

function joinProxyEndpoint(base) {
  const trimmed = base.replace(/\/+$/, '');
  if (trimmed.endsWith('/api/complete')) return trimmed;
  return `${trimmed}/api/complete`;
}
```

**Candidate-catalog construction pattern** (modelled on `loadL2Classes`, `ontology-classification-agent.ts` lines 70-82, BUT querying kmStore instead of the registry — since the candidates are LIVE entities, not classes):
```javascript
// Phase 58 candidate-catalog helper — pseudocode mapping the loadL2Classes shape
async function loadMentionCandidates(kmStore) {
  // Per CONTEXT D-03: L1+L2+L3 vertical — entityType in {Component, SubComponent, Detail}.
  // Current graph: 7 + 326 + 312 = 645 candidates. Fits in ~10K tokens of names+descriptions.
  const [components, subComponents, details] = await Promise.all([
    kmStore.findByOntologyClass('Component'),
    kmStore.findByOntologyClass('SubComponent'),
    kmStore.findByOntologyClass('Detail'),
  ]);
  // Same shape as ResolvedClass: { name, description }. Strip everything else
  // to keep the prompt tight.
  return [...components, ...subComponents, ...details].map(e => ({
    id: e.id,
    name: e.name,
    description: (typeof e.description === 'string' && e.description) ||
                 (Array.isArray(e.descriptionSegments) && e.descriptionSegments.map(s => s.text).join(' ')) ||
                 '',
  }));
}
```

**Prompt-building pattern** (modelled on `buildL2RefinementPrompt`, lines 95-114):
```javascript
function buildMentionsPrompt(insightSummary, candidates) {
  // Two-part system message per CONTEXT D-02.1 — ontology hint + candidate catalog.
  // User message is the Insight summary; response is a JSON array of entity names.
  // The classifier rejects any name not in the candidate set (no fabricated targets).
  const catalog = candidates.map(c => `- ${c.name}: ${c.description.slice(0, 120)}`).join('\n');
  return {
    process: 'consolidator-mentions',
    taskType: 'mentions-classification',   // routes to claude-haiku per CLAUDE.md
    messages: [
      {
        role: 'system',
        content:
          'You classify which entities an Insight discusses.\n' +
          'Pick a subset of entities from the catalog below whose subjects appear in the Insight.\n' +
          'Reply with a JSON array of entity names (e.g., ["EtmDaemon", "LiveLoggingSystem"]).\n' +
          'Reject hallucinated names — only emit names that appear verbatim in the catalog.\n' +
          'Empty array is acceptable if no entity clearly matches.\n\n' +
          'Candidate catalog (entityType in {Component, SubComponent, Detail}):\n' +
          catalog,
      },
      { role: 'user', content: `Insight summary:\n${insightSummary}\n\nReturn the mentions JSON array.` },
    ],
  };
}
```

**Extraction-with-rejection pattern** (modelled on `extractL2FromLLMResponse`, lines 129-144 — adapted to N-of-set rather than 1-of-set, and to JSON-array rather than embedded mention):
```javascript
function extractMentionsFromLLMResponse(rawText, candidates) {
  const validNamesById = new Map(candidates.map(c => [c.name, c.id]));
  let parsed;
  try {
    // First try JSON parse; the LLM may wrap in code fences.
    const json = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(json);
  } catch {
    // Fall back to token-boundary scan (same regex as Phase 57-04).
    const found = new Set();
    for (const name of validNamesById.keys()) {
      const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(name)}([^A-Za-z0-9_]|$)`);
      if (re.test(rawText)) found.add(name);
    }
    parsed = [...found];
  }
  if (!Array.isArray(parsed)) return [];
  // Reject hallucinated names; clamp to sanity-cap (CONTEXT D-02.2: ~20).
  const SANITY_CAP = 20;
  const validIds = [];
  for (const name of parsed) {
    if (typeof name !== 'string') continue;
    const id = validNamesById.get(name);
    if (id && !validIds.includes(id)) validIds.push(id);
    if (validIds.length >= SANITY_CAP) break;
  }
  return validIds;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
```

**Where to place these helpers:**
- **Option A (planner discretion):** New module `src/live-logging/MentionsClassifier.js` with the three helpers (`loadMentionCandidates`, `buildMentionsPrompt`, `extractMentionsFromLLMResponse`) plus a `classifyMentions(kmStore, summary)` wrapper that ties them together. Mirrors the Phase 57 ontology-classification-agent pattern of pure-function exports next to a thin orchestrating wrapper.
- **Option B:** Same helpers as private methods on `ObservationConsolidator` (e.g. `_loadMentionCandidates`, `_classifyInsightMentions`). Lower-ceremony but harder to unit-test independently. Phase 57-04 SUMMARY (line 22) explicitly favours the module-split approach: *"Pure-function exports beside the agent class — testable without instantiating the full classifier pipeline."*

**Recommended: Option A.** Tests in `src/live-logging/MentionsClassifier.test.js` mocking `kmStore.findByOntologyClass` + the proxy fetch (same shape as `ontology-classification-agent.test.ts`).

**Landmines:**
- **Don't confuse port 12435 (rapid-llm-proxy `/api/complete`) with port 3033 (health API).** Per CLAUDE.md, port 3033 will silently return `Cannot POST /api/complete` HTML, masking the bug. The mentions classifier MUST target port 12435.
- **Caching:** CONTEXT Claude's Discretion bullet 2 leaves the candidate-catalog caching decision to planner. Recommended: cache `candidates` on the consolidator instance for the lifetime of one consolidation run (a few seconds), invalidate at the next run. Aligns with the existing `_projectAnchorCache` pattern on consolidator line 592. **NOT a long-lived cache** — new Components/SubComponents/Details are written by the same consolidator, so a per-run cache stays warm without staleness risk.

---

### 4. NEW: `scripts/backfill-insight-mentions.mjs` (D-05)

**Analog:** `scripts/backfill-project-tag.mjs` (Phase 57-05, 441 LoC). Same JSON-replay + `ontologyDir` resolution + `skipOntologyCheck:true` + summary-artifact discipline. The `mentions` backfill differs from the project-tag backfill in TWO ways: (a) it writes edges, not entity metadata, and (b) it calls the LLM proxy per Insight rather than running pure derivation.

**Why this analog:**
- Per CONTEXT D-05: "*Idempotent — running twice doesn't duplicate edges*", "*logs to `.data/backfill-insight-mentions-<ts>.json` following the Phase 57-05 backfill summary convention*", "*write back through `kmStore.addRelation` with `skipOntologyCheck`*". Every one of these requirements is solved by 57-05.
- The same operational sequence (CONTEXT `<surrounding_context>` + Phase 57-05 SUMMARY operator runbook lines 269-299) — docker-compose stop coding-services + launchctl bootout obs-api + run backfill + launchctl bootstrap obs-api — applies verbatim.

**Skeleton to copy** (from `scripts/backfill-project-tag.mjs` lines 50-274):

```javascript
#!/usr/bin/env node
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GraphKMStore } from '@fwornle/km-core';

// CLI flag parsing — process.argv walk, no new deps.
function parseArgs(argv) {
  const args = {
    source: path.resolve(process.cwd(), '.data/knowledge-graph/exports/general.json'),
    logDir: path.resolve(process.cwd(), '.data'),
    limit: null,
    dryRun: false,
    help: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--source=')) args.source = path.resolve(a.slice('--source='.length));
    else if (a.startsWith('--log-dir=')) args.logDir = path.resolve(a.slice('--log-dir='.length));
    else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice('--limit='.length), 10);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return args;
}

// km-core ontologyDir resolution — VERBATIM from Phase 43 / 57-05.
async function resolveOntologyDir() {
  const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
  const kmCorePath = fileURLToPath(kmCoreEntry);
  let kmCoreRoot = path.dirname(kmCorePath);
  while (kmCoreRoot !== '/') {
    try { await fsp.access(path.join(kmCoreRoot, 'package.json')); break; }
    catch { kmCoreRoot = path.dirname(kmCoreRoot); }
  }
  const ontologyDir = path.join(kmCoreRoot, 'config', 'ontology');
  try { await fsp.access(ontologyDir); return ontologyDir; }
  catch { return path.resolve(process.cwd(), '.data/ontologies'); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // ... pre-flight, ontologyDir, source-read (same as backfill-project-tag.mjs) ...

  let store = null;
  if (!args.dryRun) {
    const exportDir = path.dirname(args.source);          // .data/knowledge-graph/exports
    const dataDir = path.dirname(exportDir);              // .data/knowledge-graph
    const dbPath = path.join(dataDir, 'leveldb');
    store = new GraphKMStore({
      dbPath, exportDir, ontologyDir,
      ontologyStrict: false, debounceMs: 0, domains: ['general'],
    });
    await store.open();
  }

  // Filter to Insight nodes that lack mentions edges.
  const insightNodes = nodes.filter(n => n?.attributes?.entityType === 'Insight');
  // Build a set of insightIds that already have ≥1 outgoing mentions edge (idempotency).
  const insightsWithMentions = new Set();
  for (const edge of (parsedExport.edges ?? [])) {
    if (edge?.attributes?.type === 'mentions') {
      insightsWithMentions.add(edge.attributes.from);
    }
  }
  const workingInsights = insightNodes.filter(n => !insightsWithMentions.has(n.attributes.id));

  // Per-Insight LLM call + addRelation loop.
  for (const node of workingInsights) {
    const insight = node.attributes;
    const summary = (insight.descriptionSegments?.[0]?.text) ?? insight.description ?? insight.name;
    const candidates = await loadMentionCandidates(store);   // shared helper from src/live-logging/MentionsClassifier.js
    const mentionIds = await classifyMentions(summary, candidates);  // → LLM call → array of entity ids
    if (args.dryRun) {
      // record forecast
      continue;
    }
    for (const targetId of mentionIds) {
      // Dedup before write — see reprojectFromOnlineStore.ts pattern.
      const existing = await store.findRelations({ from: insight.id, to: targetId, type: 'mentions' });
      if (existing.length > 0) continue;
      try {
        await store.addRelation({
          from: insight.id,
          to: targetId,
          type: 'mentions',
          metadata: {
            source: 'backfill-insight-mentions',
            classifiedAt: new Date().toISOString(),
            classifier: 'llm-haiku',
          },
        });
      } catch (err) {
        // Source/Target-not-found logs and continues — see _anchorEntity precedent.
        process.stderr.write(`[backfill-58] addRelation ${insight.id}->${targetId} failed: ${err.message}\n`);
      }
    }
  }

  // Write summary artifact (D-05.1).
  const summaryPath = path.join(args.logDir, `backfill-insight-mentions-${startedAt.replace(/[:.]/g, '-')}.json`);
  await fsp.writeFile(summaryPath, JSON.stringify({
    dryRun: args.dryRun,
    totalInsights: insightNodes.length,
    skipped: insightNodes.length - workingInsights.length,   // already had mentions
    classified: ...,
    edgesWritten: ...,
    errors: ...,
    perInsight: [...],   // {insightId, name, mentionsAdded, errors[]}
  }, null, 2));
}

main().catch((err) => { process.stderr.write(`[backfill-58] FATAL: ${err.stack}\n`); process.exit(3); });
```

**Reuse the classifier helpers from #3:** `import { loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, callProxy } from '../src/live-logging/MentionsClassifier.js'` (path will be `../src/live-logging/MentionsClassifier.js` from `scripts/`). This avoids the runtime drift between writer-path and backfill-path classifications — exactly what D-06.2 demands ("*Same backfill code path as D-05*").

**Critical operational sequence (from 57-05 SUMMARY lines 269-299 — copy verbatim):**

```bash
# 1. Defensive snapshot (cheap; lets you diff later).
cp .data/knowledge-graph/exports/general.json .data/knowledge-graph/exports/general.json.pre-58-mentions-$(date +%Y%m%d-%H%M%S)

# 2. Dry-run to inspect distribution.
node scripts/backfill-insight-mentions.mjs --dry-run

# 3. Release the LevelDB LOCK held by BOTH the container AND the host-side launchd daemon.
docker-compose -f docker/docker-compose.yml stop coding-services
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.coding.obs-api.plist

# 4. Run the live backfill.
node scripts/backfill-insight-mentions.mjs

# 5. Verify edge coverage (mirror SC#1 jq check shape from 57-05).
jq '[.edges[]? | select(.attributes.type == "mentions") | .attributes.from] | unique | length' \
  .data/knowledge-graph/exports/general.json
# Expect: ≥ 86 (i.e., ≥90% of the 96 Insights have ≥1 mentions edge — CONTEXT SC#1).

# 6. Restore services.
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.coding.obs-api.plist
docker-compose -f docker/docker-compose.yml start coding-services
```

**Landmines:**
- **TWO LOCKS, NOT ONE** — exactly as Phase 57-05 SUMMARY documents (deviation 4). The original 57-05 PLAN missed the host-side launchd `com.coding.obs-api` LOCK holder; the new plan must include the `launchctl bootout` step from day 1.
- **km-core hydrate-prefer-JSON patch must stay in place** (CLAUDE.md "km-core node_modules patch (snapshot-restore on restart)"). If the patch is wiped by an `npm install`, an obs-api restart mid-backfill can swap the source JSON underneath the script — see Phase 57-05 step 6 lines 228-231. **Defensive check before live run:** `grep -c "JSON has more nodes" node_modules/@fwornle/km-core/dist/store/persistence.js` ≥ 1; re-apply if absent.
- **LLM-call wall-clock:** CONTEXT D-05.2 estimates ~96 × 2s = ~3 min. With the launchd respawn race, keep the backfill < 60s of obs-api downtime or the watchdog (`com.coding.obs-api` per CLAUDE.md "launchd-managed daemons") may try to re-bootstrap and re-acquire the LOCK. If wall-clock exceeds the safe window, serialize: `--limit 30` slices.

---

### 5. `bridgeRemainingOrphans` periodic backfill extension (D-06.2)

**Actual method name in source:** `_relinkOrphanOnlineInsights` (line 1907) — CONTEXT labels it `bridgeRemainingOrphans` from the milestone-level vocabulary; the on-disk name is the `_relinkOrphanOnlineInsights` form.

**Current shape** (consolidator.js lines 1907-1956):
```javascript
async _relinkOrphanOnlineInsights() {
  const vkbUrl = process.env.VKB_API_URL || 'http://localhost:8080';
  // ... fetch /api/entities + /api/relations from VKB ...
  // ... for each unlinked online entity, POST a has_insight relation ...
}
```

**The extension scope is small** but it does mean migrating this method to kmStore-native too (the writer-path unification's D-06 logically requires this — otherwise the periodic backfill remains HTTP-PUT-based while the main writer is kmStore-native). Same translation pattern as `_pushInsightToKG`:

```javascript
async _relinkOrphanOnlineInsights() {
  if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
  const kmStore = this._kmStore;

  // Step 1 — existing capturedBy / has_insight orphan handling (kmStore-native version of the current code).
  // Step 2 — NEW: extend to also detect Insights missing mentions edges, then run the D-02 classifier.
  const insightEntities = await kmStore.findByOntologyClass('Insight');
  const allRelations = await Promise.all(
    insightEntities.map(i => kmStore.findRelations({ from: i.id, type: 'mentions' }))
  );
  const insightsMissingMentions = insightEntities.filter((_, idx) => allRelations[idx].length === 0);

  for (const insight of insightsMissingMentions) {
    const summary = (insight.descriptionSegments?.[0]?.text) ?? insight.description ?? insight.name;
    try {
      const mentionIds = await classifyMentions(summary, await loadMentionCandidates(kmStore));
      for (const targetId of mentionIds) {
        try {
          await kmStore.addRelation({
            from: insight.id, to: targetId, type: 'mentions',
            metadata: { source: 'consolidator-bridge', classifiedAt: new Date().toISOString(), classifier: 'llm-haiku' },
          });
        } catch (err) { /* benign — see _anchorEntity precedent */ }
      }
    } catch (err) {
      process.stderr.write(`[Consolidator] bridge: mentions classify for ${insight.id} failed: ${err.message}\n`);
    }
  }
}
```

**Landmine:** the bridge runs periodically (every consolidation cycle); it MUST NOT re-classify Insights that already have ≥1 mentions edge (the idempotency check above via `kmStore.findRelations({from, type: 'mentions'})`). Otherwise it would burn an LLM call per Insight per cycle.

---

## Shared Patterns

### Shared Pattern A — `kmStore.addRelation` write convention (3 sites in this phase)

**Source:** `lib/km-core/src/adapters/online/reprojectFromOnlineStore.ts` lines 441-456 + `src/live-logging/ObservationWriter.js` lines 430-435.

**Apply to:** D-04 atomicity contract, D-05 backfill loop, D-06.2 bridge extension.

**Concrete excerpt** (already shown in §1 + §2):
```javascript
// 1. Idempotency check FIRST (km-core's addRelation is NOT idempotent on the triple).
const existing = await kmStore.findRelations({ from: fromId, to: toId, type: 'mentions' });
if (existing.length > 0) continue;

// 2. Then write — wrap in try/catch because Source/Target-not-found can race.
try {
  await kmStore.addRelation({
    from: fromId,
    to: toId,
    type: 'mentions',
    metadata: {
      source: '<writer-identifier>',         // 'observation-consolidator' | 'backfill-insight-mentions' | 'consolidator-bridge'
      classifiedAt: new Date().toISOString(),
      classifier: 'llm-haiku',
    },
  });
} catch (err) {
  process.stderr.write(`[<writer>] edge ${fromId}->${toId} failed (non-fatal): ${err.message}\n`);
}
```

### Shared Pattern B — rapid-llm-proxy `/api/complete` call (2 sites)

**Source:** `scripts/backfill-raw-observations.mjs` lines 94-106 (host-side variant — both the new `MentionsClassifier.js` and the new `backfill-insight-mentions.mjs` are host-side, not container-side).

**Apply to:** classifier module (#3) and backfill script (#4) — both share the proxy client.

**Concrete excerpt** (already shown in §3): port 12435, `POST /api/complete`, body `{ process, taskType, messages }`, `AbortSignal.timeout(60000)`, throw on non-2xx with truncated body in message.

### Shared Pattern C — backfill summary artifact

**Source:** `scripts/backfill-project-tag.mjs` lines 281-290 + the summary-write at line 436-ish.

**Apply to:** Phase 58 backfill script (D-05.1 demands the artifact).

**Shape:**
```javascript
{
  dryRun: false,
  totalInsights: 96,
  skipped: 0,
  classified: 96,
  edgesWritten: 384,
  errors: 0,
  durationMs: 187500,
  perInsight: [
    { insightId: 'abc123...', name: 'Some Insight', mentionsAdded: 4, mentionIds: ['c1','c2','c3','c4'], errors: [] },
    // ... 95 more ...
  ],
  startedAt: '2026-06-15T21:00:00.000Z',
  endedAt: '2026-06-15T21:03:07.500Z',
}
```

### Shared Pattern D — no console.log (CLAUDE.md no-console-log constraint)

**Apply to:** all 3 new code surfaces (#1, #3, #4). Use `process.stderr.write(...)` — every analog file in this PATTERNS.md follows this convention. Phase 57-04 SUMMARY line 138 verifies this with `grep -c "console\.log\|console\.error" → 0`.

---

## No Analog Found

None. Every Phase 58 surface has a strong, recent, in-repo analog.

---

## Landmines (consolidated)

1. **km-core node_modules hydrate patch must stay in place** (CLAUDE.md "km-core node_modules patch (snapshot-restore on restart)") — required by both D-04 (writer-path) and D-05 (backfill). Defensive verify: `grep -c "JSON has more nodes" node_modules/@fwornle/km-core/dist/store/persistence.js` ≥ 1; re-apply per CLAUDE.md if absent. CONTEXT `<canonical_refs>` §km-core surfaces lines 125-126 calls this out explicitly.

2. **Two LOCK holders, not one** (Phase 57-05 SUMMARY deviation 4) — when running the live backfill: `docker-compose stop coding-services` AND `launchctl bootout ~/.../com.coding.obs-api.plist`. PLAN must include both steps day 1, unlike 57-05 which had to discover the launchd LOCK at live-execution time.

3. **Port 12435 vs port 3033** (CLAUDE.md "km-core LLM proxy endpoint") — the LLM proxy is `/api/complete` on **port 12435**. Port 3033 is the health-API and will silently return `Cannot POST /api/complete` HTML. The mentions classifier (#3) MUST target 12435.

4. **`kmStore.addRelation` is NOT idempotent on `(from, to, type)`** — dedup in-process before every write (see Shared Pattern A). Without this, D-05's "*idempotent re-runs*" requirement breaks and a re-run produces duplicate `mentions` edges.

5. **`_pushInsightToKG` is fire-and-forget at the call-site** (consolidator.js lines 1688-1695 — `Promise.race` with a 15s timeout and a swallow-catch). Preserve this semantic for the batch-level call; the D-04.1 fail-fast semantics apply INSIDE the writer (if the LLM call fails, the Insight is NOT written) but the caller still doesn't propagate.

6. **`addRelation` Source/Target-not-found errors are benign** when racing a putEntity — `_anchorEntity` (ObservationWriter.js lines 437-441) documents the pattern. Wrap each addRelation in its own try/catch with stderr log; don't let one missing target abort the mentions loop for an Insight.

7. **LLM-call wall-clock budget** — ~96 × 2s = ~3 min for the backfill. Keep obs-api downtime < 60s by chunking (`--limit 30`) or by running the LLM phase first (no kmStore handle) into a JSON spool, then running the addRelation phase second with obs-api stopped briefly. Planner discretion.

8. **Classifier candidate-catalog caching scope** — cache per-consolidation-run, not across runs. New L1/L2/L3 entities are emitted by the same consolidator (Phase 57 L2 refinement runs on the L1 emit path), so a long-lived cache goes stale within minutes. Mirror the per-run `_projectAnchorCache` scope (consolidator.js line 592).

9. **`integrations/mcp-server-semantic-analysis` is FATAL** (CONTEXT `<surrounding_context>` point 3) — but Phase 58 code runs host-side (consolidator + writer + new backfill script). The container failure is NOT a Phase 58 blocker; just don't try to add the new mentions classifier as a *container-side* agent. The classifier helpers live in `src/live-logging/` per #3 Option A.

---

## Metadata

**Analog search scope:**
- `src/live-logging/` (host-side writer + consolidator)
- `lib/km-core/src/store/` (addRelation signature, exporter debounce)
- `lib/km-core/src/adapters/online/` (reprojectFromOnlineStore — addRelation dedup pattern)
- `integrations/mcp-server-semantic-analysis/src/agents/` (llm-with-process, ontology-classification-agent)
- `scripts/` (backfill-project-tag, backfill-raw-observations, backfill-edges-from-legacy, resolve-observations-from-lsl)
- `.planning/phases/57-lower-ontology-project-tagging-foundation/` (Plan 04 + Plan 05 PLAN+SUMMARY — analog phase shape)

**Files scanned:** 12 source files + 5 backfill scripts + 2 prior-phase planning artifacts.

**Pattern extraction date:** 2026-06-15.

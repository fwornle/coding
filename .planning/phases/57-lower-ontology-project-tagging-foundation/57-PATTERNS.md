# Phase 57: Lower Ontology & Project Tagging Foundation - Pattern Map

**Mapped:** 2026-06-14
**Files analyzed:** 13 (3 new, 10 modified) + 1 ontology data file
**Analogs found:** 13 / 13 (all paths have strong analogs in-repo)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/km-core/src/types/project.ts` *(NEW)* | type / typeguard | branded-type | `lib/km-core/src/ids/branded.ts` + ontology `defaultLayer` enum precedent in `lib/km-core/src/types/entity.ts:27` | exact (branded scalar) |
| `.data/ontologies/coding.lower.json` *(NEW)* | ontology data | config | `.data/ontologies/coding-ontology.json` (same dir, same registry consumer) | exact |
| `scripts/backfill-project-tag.mjs` *(NEW)* | one-shot migration script | batch | `_work/rapid-automations/integrations/operational-knowledge-management/scripts/migrate-okm-json-to-kmcore.mjs` (Phase 43 D-G4.1 JSON-replay) — secondary: `scripts/migrate-sqlite-to-kmcore.mjs` (Phase 42 batch loop pattern) and `integrations/mcp-server-semantic-analysis/scripts/augment-team-field-42.2.mjs` (Phase 42.2 one-shot tag-augmentation precedent — most semantically close) | exact |
| `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts` *(MODIFIED)* | augmenter | request-response | self — extend existing `team` stamping at lines 78-83 + 160-167 | n/a (in-place) |
| `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts` *(MODIFIED)* | wave-agent caller | request-response | self — `augmentWithCanonical(entity, ontologyClass, this.runId, { team: this.team })` at line 369 | n/a (in-place) |
| `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts` *(MODIFIED)* | wave-agent caller | request-response | self — `augmentWithCanonical(entity, 'SubComponent', this.runId, { team: this.team })` at line 298 | n/a (in-place) |
| `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts` *(MODIFIED)* | wave-agent caller | request-response | self — `augmentWithCanonical(entity, 'Detail', this.runId, { team: this.team })` at line 275 | n/a (in-place) |
| `integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts` *(MODIFIED)* | km-core writer | request-response | self — `storeEntity()` at lines 395-487 (the actual `putEntity` call site for the whole semantic-analysis pipeline) | n/a (in-place) |
| `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` *(MODIFIED — likely no-op)* | legacy wrapper | request-response | NO direct putEntity in this file (writes route through km-core-adapter via wave-controller). Verify-and-document is the action. | n/a |
| `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` *(MODIFIED)* | classifier | request-response | self — `classifySingleObservation()` at lines 500-557; OntologyRegistry already wired (line 32) | n/a (in-place) |
| `lib/km-core/src/adapters/legacy-ingest.ts` *(MODIFIED — preserve)* | mapper | request-response | self — `legacyDigestToEntity` already stamps `metadata.project` at line 315; `legacyObservationToEntity` at line 265 stamps `meta.project ?? null` | n/a (verify-only) |
| `lib/km-core/src/adapters/online/mapper.ts` *(MODIFIED — preserve)* | mapper | request-response | self — already stamps `metadata.project = row.project` at lines 190-191 + 229-230 | n/a (verify-only) |
| `scripts/backfill-raw-observations.mjs` *(MODIFIED — verify only)* | one-shot script | batch | SQLite-only — does NOT call km-core `putEntity`. The km-core `metadata.project` stamping for backfilled rows happens later via `observations-api-server.mjs` → `legacyObservationToEntity()` (passes `meta.project ?? null`). No code change in this file. | n/a (verify-only) |
| `integrations/unified-viewer/src/graph/graph-builder.ts:519-521` *(MODIFIED)* | filter logic | request-response | self — `selectedTeams` filter reads `metadata.team` at line 519-521. **CONTEXT.md identifies viewer-store.ts:174-178 but that file only declares the state field; the actual filter expression is in graph-builder.ts.** | n/a (in-place) |

**Note on `code-graph-rag`** (CONTEXT D-04 bullet): `grep -rn "putEntity" integrations/code-graph-rag/src/` returns **zero hits**. code-graph-rag does NOT directly call km-core `putEntity`; its entities flow through `mcp-server-semantic-analysis` agents which already route through `km-core-adapter.storeEntity`. No code-graph-rag change is required in Phase 57 — recommend deleting that bullet from D-04 at plan-finalization time, or marking it as a verified no-op.

---

## Pattern Assignments

### `lib/km-core/src/types/project.ts` *(NEW, branded-type + typeguard)*

**Analog:** `lib/km-core/src/ids/branded.ts` (zero-runtime branded scalar) + the `Layer` literal-union convention in `lib/km-core/src/types/entity.ts:27`.

**Branded-type pattern** (`lib/km-core/src/ids/branded.ts:1-11`):
```typescript
/**
 * Branded `EntityId` type — compile-time tag that prevents raw `string`
 * values from being accidentally accepted where an entity identifier is
 * required (Phase 37 decision D-11).
 *
 * Zero runtime cost: the `__brand` field exists only in the type system.
 */
export type EntityId = string & { readonly __brand: 'EntityId' };
```

**Literal-union pattern (preferred for closed-set vocabularies)** (`lib/km-core/src/types/entity.ts:27`):
```typescript
export type Layer = 'evidence' | 'pattern';
```

**Recommended shape for `lib/km-core/src/types/project.ts`** — follows CONTEXT D-03 verbatim and combines the two patterns (closed-set `as const` array + derived literal type + typeguard):
```typescript
// Closed-set project vocabulary (Phase 57 D-03).
// Adding a new project = code change here; no silent drift via metadata.
export const PROJECTS = ['coding', 'okm', 'cap'] as const;

export type Project = typeof PROJECTS[number];

/** Runtime typeguard for `metadata.project` writers + readers. */
export function isProject(x: unknown): x is Project {
  return typeof x === 'string' && (PROJECTS as readonly string[]).includes(x);
}
```

**Optional helper (CONTEXT "Claude's Discretion" bullet 4)** — `MetadataWithProject` type. Recommendation: SKIP for Phase 57. The cost (one more import every writer touches) outweighs the benefit (compile-time `metadata.project` typing) given `Entity.metadata: Record<string, unknown>` is the locked shape (`lib/km-core/src/types/entity.ts:124`). Document the recommendation here; planner can re-decide.

**Barrel wiring** — add `export * from './types/project.js'` to `lib/km-core/src/types/index.ts` AND a re-export line in the root barrel `lib/km-core/src/index.ts` next to the existing `EntityId` export (precedent: `EntityId` is reachable as `@fwornle/km-core` root + `@fwornle/km-core/ids` subpath).

---

### `.data/ontologies/coding.lower.json` *(NEW, ontology data file)*

**Analog:** `.data/ontologies/coding-ontology.json` (same dir; loaded by the same `OntologyRegistry`).

**JSON shape** — the **actual** km-core ontology shape is `meta: { name, version, extends?, description }` + `classes: Record<string, OntologyClass>` (object/map, NOT array). CONTEXT.md D-08 sketched an array-of-objects shape — **planner should follow the existing on-disk shape, not the CONTEXT.md sketch**. See `lib/km-core/src/types/ontology.ts:42-50` for the locked TypeScript interface:

```typescript
export interface OntologyFile {
  meta: {
    name: string;
    version: string;
    extends?: string;
    description: string;
  };
  classes: Record<string, OntologyClass>;
}
```

**Concrete template — copy from `.data/ontologies/coding-ontology.json` lines 1-8** (header shape):
```json
{
  "meta": {
    "name": "coding-ontology",
    "version": "1.0.0",
    "description": "Lower ontology for the coding infrastructure project, ...",
    "extends": "upper"
  },
  "classes": {
    ...
  }
}
```

**Per-class shape — copy from `.data/ontologies/coding-ontology.json:9-55` (LSLSession example)**:
```json
"LSLSession": {
  "description": "A live session logging session with time-windowed conversation capture",
  "relationships": {},
  "extends": "File",
  "properties": { ... }
}
```

**Critical chain note (D-08 + D-09):** The classes `Component`, `SubComponent`, `Detail` are declared in `.data/ontologies/coding-ontology.json:687-733`, NOT in `upper.json` (upper.json has File / Service / Feature / Project / Contract / etc. but no Component-hierarchy classes). For Phase 57's `coding.lower.json` to use `Component` / `SubComponent` / `Detail` as L1 parents per D-09, the new file MUST chain through coding-ontology:

- Option A (recommended): `meta.extends = "coding-ontology"` — chains through both levels (coding.lower → coding-ontology → upper). The OntologyRegistry walks `extends` chains by `meta.name` matching (see `lib/km-core/src/ontology/registry.ts`).
- Option B: `meta.extends = "upper"` BUT then individual L2 classes can only `extends` upper classes, NOT Component/SubComponent/Detail. Reject — D-09 explicitly names Component/SubComponent/Detail as parents.

**Recommended `coding.lower.json` header**:
```json
{
  "meta": {
    "name": "coding.lower",
    "version": "1.0.0",
    "description": "Coding-project L2 lower ontology — concrete subsystem classes (LSL, Constraints, Online learning, KM, ...) extending the L1 Component-hierarchy in coding-ontology.json",
    "extends": "coding-ontology"
  },
  "classes": {
    ...
  }
}
```

**L1 parent mapping for the 10 L2 classes (D-08 "Claude's discretion") — RECOMMENDED:**

| L2 class | L1 parent | Reasoning |
|----------|-----------|-----------|
| `LiveLoggingSystem` | `Component` | Operator-visible top-level subsystem (LSL = a major architectural surface; comparable to "KnowledgeManagement"); has multiple sub-systems (transcript-monitor, classifier, exporter) → L1 not L2. |
| `ConstraintMonitor` | `Component` | Top-level subsystem (constraint monitor service on port 3030); has its own dashboard, rules, hooks — Component-tier surface. |
| `OnlineObservation` | `Detail` | Leaf-level data artifact (the online pipeline writes individual Observation entities; each one IS a leaf). NOT a subsystem itself. Same tier as `Observation` in `learning-artifacts.json`. |
| `OnlineDigest` | `Detail` | Same reasoning as OnlineObservation — leaf-level artifact, not an architectural subsystem. |
| `OnlineInsight` | `Detail` | Same reasoning — leaf-level synthesized artifact. (Note: `learning-artifacts.json` already declares `Insight extends LearningArtifact`. The `Online*` variants here are the project-grouped equivalent so the dashboard can distinguish online-learning leaves from wave-analysis leaves by L2 class.) |
| `KnowledgeManagement` | `Component` | Top-level architectural surface — km-core + observations DB + JSON exports + Qdrant; large enough to host SubComponents (ObservationConsolidator, ColdStoreReader, etc.). |
| `BatchSemanticAnalysis` | `Component` | Top-level: the manual UKB / wave-analysis pipeline (wave1/2/3 agents, persistence-agent, coordinator). Hosts SubComponents — Component-tier. |
| `RapidLlmProxy` | `Component` | Top-level external service (port 12435; routes calls for ETM + wave-analysis + others). Self-contained subsystem with its own SubComponents (token-usage, model-canonicalization, routing). |
| `DockerizedServices` | `Component` | Top-level deployment surface (coding-services container hosts dashboard, obs-api, lsl-resolver, etc.). Self-contained Component. |
| `EtmDaemon` | `SubComponent` | Mid-level — ETM is one piece of the LiveLoggingSystem surface (lives under it conceptually). Reasonable to argue Component if treated as standalone; recommendation is SubComponent given the LSL grouping but planner may upgrade to Component during plan-writing. |

**Provenance for this mapping:** Above mapping reflects the L1 conventions visible in `coding-ontology.json:687-733` (Component = top-level architectural subsystem; SubComponent = nested concern; Detail = leaf artifact) AND the existing online-learning convention in `learning-artifacts.json` (`Observation/Digest/Insight` are tier-3 leaf artifacts, not subsystems).

**Conflict audit (D-07 "ensure no conflicts with new L2 class names"):** `grep -l "LiveLoggingSystem\|ConstraintMonitor\|OnlineObservation\|OnlineDigest\|OnlineInsight\|KnowledgeManagement\|BatchSemanticAnalysis\|RapidLlmProxy\|DockerizedServices\|EtmDaemon" .data/ontologies/*.json` → only matches `coding.display.json` and `coding-ontology.json` (existing internal references, not class definitions). NO conflicts with the new L2 names. Safe to proceed.

---

### `scripts/backfill-project-tag.mjs` *(NEW, one-shot JSON-replay migration)*

**Primary analog:** `_work/rapid-automations/integrations/operational-knowledge-management/scripts/migrate-okm-json-to-kmcore.mjs` (Phase 43 D-G4.1 JSON-replay — same trusted-path-write pattern Phase 57 D-05 calls out).

**Closest in-repo analog:** `integrations/mcp-server-semantic-analysis/scripts/augment-team-field-42.2.mjs` (Phase 42.2 Plan 02 Gap 3 — same shape: read general.json, derive one metadata field, write back idempotently). **This is the cleanest pattern to copy from for Phase 57 because the semantics match almost exactly: "one-shot, idempotent, single metadata-field augmentation on already-persisted km-core entities."**

**Secondary analog (CLI flag scaffolding, --dry-run / --resume / --run-id):** `scripts/migrate-sqlite-to-kmcore.mjs:200-253` (batch loop with progress + error budget).

**Shebang + JSDoc header** (Phase 43 migrate-okm-json-to-kmcore.mjs:1-51 — adapt verbatim):
```javascript
#!/usr/bin/env node
/**
 * Phase 57 — One-shot `metadata.project` backfill (D-05).
 *
 * Reads `.data/knowledge-graph/exports/general.json`, derives `metadata.project`
 * per the 4-step precedence (existing project → existing team → legacyId heuristic
 * → default 'coding'), and writes each entity back through km-core's trusted path
 * (`putEntity(entity, { skipOntologyCheck: true })`). Idempotent — entities that
 * already carry `metadata.project` are no-op'd.
 *
 * Usage:
 *   node scripts/backfill-project-tag.mjs [--dry-run] [--limit N] [--source PATH]
 *
 * Output:
 *   .data/backfill-project-tag-<timestamp>.json — per-precedence-step counts +
 *                                                  ambiguous-default list.
 */
```

**km-core construction with ontologyDir** (Phase 43 migrate-okm-json-to-kmcore.mjs:108-137 — **MANDATORY** per CLAUDE.md "km-core scripts" rule):
```javascript
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
```

**Trusted-path write loop** (Phase 42 migrate-sqlite-to-kmcore.mjs:200-253 — copy the error-budget + progress-logging shape):
```javascript
for (let i = 0; i < entities.length; i++) {
  const entity = entities[i];
  // Idempotent step 1: skip if metadata.project already populated.
  if (typeof entity.metadata?.project === 'string' && entity.metadata.project.length > 0) {
    skipped++;
    continue;
  }
  // Step 2..4: derive project per precedence.
  const project = deriveProject(entity);  // returns 'coding' | 'okm' | 'cap' + precedenceStep
  const mutated = { ...entity, metadata: { ...entity.metadata, project } };

  if (dryRun) {
    migrated++;
  } else {
    try {
      await store.putEntity(mutated, { skipOntologyCheck: true });
      migrated++;
    } catch (err) {
      errors++;
      process.stderr.write(`[backfill-57] ${entity.id.slice(0, 8)}: putEntity failed - ${err.message}\n`);
    }
  }
  if ((i + 1) % 100 === 0) {
    process.stderr.write(`[backfill-57] ${i + 1}/${entities.length} processed\n`);
  }
}
```

**4-step precedence derivation** (D-05 — author from scratch, NO direct analog; reference the existing `augment-team-field-42.2.mjs` lines ~150-200 for a simpler 1-step version):
```javascript
function deriveProject(entity) {
  const meta = entity.metadata ?? {};
  // Step 1: already populated → no-op (handled by skip-check before we get here).
  // Step 2: carry forward existing team.
  if (typeof meta.team === 'string' && meta.team.length > 0) {
    return { project: meta.team, step: 'team' };
  }
  // Step 3: legacyId/system heuristic.
  if (entity.legacyId?.system === 'C') return { project: 'okm', step: 'legacyId-C' };
  // (Decide: B = wave-analysis = 'coding'; A = online = 'coding' (today; later split).)
  if (entity.legacyId?.system === 'B') return { project: 'coding', step: 'legacyId-B' };
  if (entity.legacyId?.system === 'A') return { project: 'coding', step: 'legacyId-A' };
  // Step 4: default + log.
  return { project: 'coding', step: 'default-ambiguous' };
}
```

**Log artifact** (D-06 — author from scratch; recommend JSON shape):
```javascript
const summary = {
  startedAt, finishedAt: new Date().toISOString(),
  totalEntities, skipped, migrated, errors,
  byPrecedenceStep: { 'team': N, 'legacyId-C': N, 'legacyId-B': N, 'legacyId-A': N, 'default-ambiguous': N },
  ambiguousDefaultIds: [...] // entity ids that fell to step 4 (operator review)
};
await fsp.writeFile(`.data/backfill-project-tag-${startedAt}.json`, JSON.stringify(summary, null, 2));
```

---

### `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts` *(MODIFIED)*

**Current `team` stamping pattern (lines 160-167)** — this is the foundation Phase 57 extends:
```typescript
// Phase 42.2 Plan 02 Gap 1 — stamp team identifier into metadata.team so
// km-core's per-team queries (`queryEntities({ team: 'coding' })`) match
// wave-emitted entities. The `length > 0` guard rejects empty-string and
// any non-string slip-through (the typeof check). Forensics report
// `report-42.2-00-canonical-emit.md` §1.3 locks this insertion point.
if (typeof options.team === 'string' && options.team.length > 0) {
  baseMetadata.team = options.team;
}
```

**Intended Phase 57 patch direction** — extend `CanonicalMapperOptions` with an optional `project` (line 69-84 region) AND add a parallel stamp using `isProject()` typeguard from `lib/km-core/src/types/project.ts`:
```typescript
// Phase 57 D-04 — stamp metadata.project on every canonical entity.
if (typeof options.project === 'string' && isProject(options.project)) {
  baseMetadata.project = options.project;
}
// Keep the team stamp (D-02 — legacy metadata.team is NOT rewritten this phase).
if (typeof options.team === 'string' && options.team.length > 0) {
  baseMetadata.team = options.team;
}
```

**Add to interface** (line 78-83 region): a new optional `project?: Project` (import `Project` and `isProject` from `@fwornle/km-core`).

**Decision point for planner:** whether wave agents pass `project: this.team` (mapping the workflow `parameters.team` directly to project) OR a separate `parameters.project` is plumbed through. Recommendation: re-use `this.team` and add a TODO note to split when okm/cap teams come online — matches CONTEXT D-04's "stamping coding everywhere" expectation for Phase 57.

---

### `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts` *(MODIFIED)*

**Current call site (line 367-370)**:
```typescript
const canonicalEntities = allEntities.map((entity) => {
  const ontologyClass = entity.level === 0 ? 'Project' : 'Component';
  return augmentWithCanonical(entity, ontologyClass, this.runId, { team: this.team });
});
```

**Intended Phase 57 patch**: add `project: this.team` (or a dedicated project field if added to the wave-controller's parameters bag) to the options object:
```typescript
return augmentWithCanonical(entity, ontologyClass, this.runId, {
  team: this.team,
  project: this.team,  // Phase 57 D-04
});
```

**Same patch applies to wave2-component-agent.ts (line ~298) and wave3-detail-agent.ts (line ~275).** All three sites are 1-line changes once `canonical-mapper.ts` accepts the new option.

---

### `integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts` *(MODIFIED)*

**Current `team` stamping pattern (lines 436-466)** — defence-in-depth dual-stamp (canonical-mapper AND adapter both stamp team for the same entity):
```typescript
// Phase 42.2 Plan 02 Gap 4 — explicitly merge `team` from the options
// bag into the metadata literal. Defence-in-depth: the underscore-prefixed
// `_options` previously silently dropped the team value...
const teamFromOptions =
  typeof options.team === 'string' && options.team.length > 0
    ? options.team
    : undefined;

// ...later, inside the metadata literal:
metadata: {
  ...sourceMetadata,
  subsystem: 'wave-analysis',
  ...(typeof (sourceMetadata as { team?: unknown }).team === 'string' &&
  ((sourceMetadata as { team?: string }).team?.length ?? 0) > 0
    ? { team: (sourceMetadata as { team: string }).team }
    : teamFromOptions !== undefined
    ? { team: teamFromOptions }
    : {}),
  ...
}
```

**Intended Phase 57 patch direction**: replicate the same defence-in-depth `project` stamp. Add a `projectFromOptions` derivation + a parallel ternary in the metadata literal. Use `isProject(...)` for type-narrowing.

```typescript
// Phase 57 D-04 — also stamp metadata.project (defence-in-depth like team).
const projectFromOptions = isProject(options.project) ? options.project : undefined;

metadata: {
  ...sourceMetadata,
  subsystem: 'wave-analysis',
  // ...existing team block...
  // Phase 57 D-04 — prefer sourceMetadata.project (canonical-mapper stamp), fall back to options.
  ...(isProject((sourceMetadata as { project?: unknown }).project)
    ? { project: (sourceMetadata as { project: string }).project }
    : projectFromOptions !== undefined
    ? { project: projectFromOptions }
    : {}),
  ...
}
```

**Function signature update**: `storeEntity(source, options: { team: string; project?: Project })` — the `team` field stays for back-compat (D-02), `project` is the additive field.

---

### `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` *(MODIFIED, classifier prompt + default stamp)*

**Existing classifier integration point (lines 500-557)** — `classifySingleObservation()` builds the OntologyClassification result. Phase 57 D-10 changes:

1. Load the 10 L2 classes via OntologyRegistry. The agent already constructs `OntologyRegistry` (line 32 import) so this is additive — the classes auto-load when `coding.lower.json` lands. Confirm by reading `this.registry.getResolvedClasses()` (Phase 38 D-29 surface) — the new L2 classes will appear in the same map as existing ones.

2. **Prompt update** — inject the 10 L2 class names + descriptions into the prompt fed to `this.classifier.classify(...)` (line 512). Exact prompt wording is planner discretion (CONTEXT "Claude's Discretion" bullet 2). Recommendation: include a "REFINEMENT STEP" instruction after L1 classification — "If the L1 class is one of [Component / SubComponent / Detail], try to refine to a more specific L2 class from this list: [coding.lower class names]. Decline if none fit (return L1 only)."

3. **Default-stamp behavior (D-04 last bullet)** — currently when `classifier.classify(...)` returns null, the agent stamps `ontologyClass: 'Unclassified'` (line 523). Phase 57 should NOT change this default. Instead, ADD a `metadata.project` stamp in the classifier-output path when the agent's caller doesn't already supply it. Simpler alternative: leave the project stamp to `canonical-mapper.ts` + `km-core-adapter.ts` (D-04 already covers both); the classifier just emits `ontologyClass` and doesn't touch project. **Recommended: skip the classifier project stamp; rely on canonical-mapper + adapter (defence-in-depth there is sufficient).**

**Critical**: success criterion #3 ("≥18 of 20 online entities carry L2") is a runtime gate. Planner should add a smoke test that constructs 20 synthetic observations covering all 10 L2 classes and asserts the classifier emits L2 (not L1) for ≥18. Test file location: `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.test.ts`.

---

### `lib/km-core/src/adapters/online/mapper.ts` *(MODIFIED — preserve)*

**Existing `metadata.project` stamping (lines 188-192)** — already correct:
```typescript
if (row.quality !== undefined) {
  metadata.quality = row.quality;
}
if (row.project !== undefined) {
  metadata.project = row.project;
}
```

**Same at lines 229-230 for insights:**
```typescript
if (row.project !== undefined) {
  metadata.project = row.project;
}
```

**Phase 57 action**: NO CODE CHANGE. Add an acceptance grep gate in the plan: `grep -c "metadata.project = row.project" lib/km-core/src/adapters/online/mapper.ts` must equal **2** (one for Digest, one for Insight; Observation already has the equivalent path). If the count regresses, the plan fails.

---

### `lib/km-core/src/adapters/legacy-ingest.ts` *(MODIFIED — preserve)*

**Existing project plumbing (already present per CONTEXT canonical refs)**:
- Line 109: `LegacyDigestRow.project?: string | null`
- Line 125: `LegacyInsightRow.project?: string | null`
- Line 265: `legacyObservationToEntity` writes `project: meta.project ?? null` into metadata
- Line 315: `legacyDigestToEntity` writes `project: row.project ?? meta.project ?? null`
- Line 358 region: `legacyInsightToEntity` writes `project: row.project ?? meta.project ?? null`

**Phase 57 action**: NO CODE CHANGE. Add acceptance grep: `grep -cE "project:\s*(row\.project|meta\.project)" lib/km-core/src/adapters/legacy-ingest.ts` must be ≥ 3.

**One small upgrade opportunity (optional)**: tighten the `null` fallback to a typed `Project | null` when `lib/km-core/src/types/project.ts` lands. Reject silently invalid project strings via `isProject()`. Out-of-scope for Phase 57 unless planner adopts the optional MetadataWithProject helper (see types/project.ts section).

---

### `integrations/unified-viewer/src/graph/graph-builder.ts:519-521` *(MODIFIED — transitional read)*

**Current filter (lines 514-522)**:
```typescript
// 2026-06-11: Teams predicate. Empty set = "all visible" (same convention
// as LayerFilter / OntologyFilter). The sentinel `__none__` means "none
// visible" — emitted by the TeamsFilter "None" button.
if (store.selectedTeams && store.selectedTeams.size > 0) {
  if (store.selectedTeams.has('__none__')) return 'filter-hidden'
  const meta = attrs.metadata as { team?: string } | undefined
  const team = meta?.team ?? 'coding'
  if (!store.selectedTeams.has(team)) return 'filter-hidden'
}
```

**Intended Phase 57 patch (D-11 — narrow surgery, read `project ?? team`)**:
```typescript
if (store.selectedTeams && store.selectedTeams.size > 0) {
  if (store.selectedTeams.has('__none__')) return 'filter-hidden'
  const meta = attrs.metadata as { team?: string; project?: string } | undefined
  // Phase 57 D-11 transitional read — prefer project (new writers) over team (legacy).
  const team = meta?.project ?? meta?.team ?? 'coding'
  if (!store.selectedTeams.has(team)) return 'filter-hidden'
}
```

**Important**: CONTEXT.md identifies `viewer-store.ts:174-178` as the patch site, but inspection shows that file only declares the state shape — the actual filter expression lives in `graph-builder.ts:519-521`. Planner must update the path reference in PLAN.md.

**NOT in scope for Phase 57 (D-11 explicit)**: renaming `selectedTeams → selectedProjects` (Phase 60 territory). The change is one-line: `meta?.project ?? meta?.team ?? 'coding'`.

---

## Shared Patterns

### Submodule Build Pipeline (CLAUDE.md)

**Source:** Project `CLAUDE.md` §"Rebuilding After Code Changes" — applies to every change in `integrations/mcp-server-semantic-analysis/src/`.

**Apply to:** All `wave*-agent.ts`, `canonical-mapper.ts`, `km-core-adapter.ts`, `ontology-classification-agent.ts` modifications.

**Pattern (verbatim from CLAUDE.md):**
```bash
cd integrations/mcp-server-semantic-analysis && npm run build
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
```

Every plan that modifies a semantic-analysis source file MUST include both steps as explicit acceptance tasks. Skipping `npm run build` leaves `dist/` stale → container runs old code.

**Special case for `integrations/unified-viewer/`** — bind-mounted, no Docker rebuild needed; just `npm run build` inside the submodule + the container picks up the new `dist/` via the bind mount.

---

### km-core Local Patch Re-Apply (CLAUDE.md)

**Source:** Project `CLAUDE.md` §"km-core node_modules patch" — `node_modules/@fwornle/km-core/dist/store/persistence.js` `hydrate()` is locally patched.

**Apply to:** ANY plan that runs `npm install` in coding-services Docker rebuild path.

**Action:** After Phase 57's km-core src changes (`lib/km-core/src/types/project.ts`) are built and the container is rebuilt, re-verify the patch is still in place. The patch is a workaround until upstream km-core fixes `persistGraph` to debounce-on-mutation. **Planner: include a verification grep in the plan that asserts the patched line exists post-install.**

---

### km-core Script ontologyDir Construction (CLAUDE.md)

**Source:** Project `CLAUDE.md` §"Mandatory Rules" — "km-core scripts MUST construct `GraphKMStore` with an `ontologyDir`".

**Apply to:** `scripts/backfill-project-tag.mjs` (new).

**Pattern (verbatim from Phase 43 migrate-okm-json-to-kmcore.mjs:110-137):**
```javascript
async function resolveOntologyDir() {
  const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
  const kmCorePath = fileURLToPath(kmCoreEntry);
  let kmCoreRoot = path.dirname(kmCorePath);
  while (kmCoreRoot !== '/') {
    try { await fsp.access(path.join(kmCoreRoot, 'package.json')); break; }
    catch { kmCoreRoot = path.dirname(kmCoreRoot); }
  }
  return path.join(kmCoreRoot, 'config', 'ontology');
  // Fallback to .data/ontologies/ if the package-shipped dir is missing.
}
```

**Acceptance grep gate (planner add to plan):** `grep -c "ontologyDir" scripts/backfill-project-tag.mjs` must be ≥ 2 (one for the resolution helper, one for the `new GraphKMStore({ ontologyDir, ... })` construction).

---

### Trusted-Path Write Convention (Phase 43 D-G4.1)

**Source:** `scripts/migrate-sqlite-to-kmcore.mjs:228` and `_work/.../migrate-okm-json-to-kmcore.mjs` — pattern Phase 57 backfill follows.

**Apply to:** `scripts/backfill-project-tag.mjs` write loop.

**Pattern:**
```javascript
await store.putEntity(mutated, { skipOntologyCheck: true });
```

**Why `skipOntologyCheck: true`**: existing entities already have their `ontologyClass` populated — we're only setting `metadata.project`, not changing the classification. The strict path (default `skipOntologyCheck: false`) would re-validate the ontology class and reject entities whose existing class isn't in the current registry (which is fine for new writes, but counter-productive for a metadata-only backfill).

---

### Idempotency Pattern (Phase 42.2 augment-team-field-42.2.mjs)

**Source:** `integrations/mcp-server-semantic-analysis/scripts/augment-team-field-42.2.mjs:17` — "Idempotent — entities that already carry `metadata.team` are skipped."

**Apply to:** `scripts/backfill-project-tag.mjs` step 1 of derivation.

**Pattern:**
```javascript
if (typeof entity.metadata?.project === 'string' && entity.metadata.project.length > 0) {
  skipped++;
  continue;  // step 1 of precedence — already populated, no-op.
}
```

---

### Read-Side Fallback (D-11 narrow scope reminder)

**Source:** D-11 explicitly limits the read-side fallback to `viewer-store.ts:174-178` (correction: `graph-builder.ts:519-521`).

**Apply to:** ONLY `graph-builder.ts:519-521`. Do NOT touch other `metadata.team` read sites in Phase 57.

**Other read sites discovered (planner awareness, NOT in scope for Phase 57):**

| File:Line | Description | Phase to handle |
|-----------|-------------|-----------------|
| `integrations/unified-viewer/src/panels/HistorySidebar.tsx:12` | Comment only — no actual read | none |
| `integrations/unified-viewer/src/panels/filters/TeamsFilter.tsx:6` | Comment only — no actual read of metadata.team in the component (renders the Set) | none |
| `integrations/memory-visualizer/src/components/KnowledgeGraph/HistorySidebar.tsx:305` | Renders `entity.metadata.team` directly. Will not break (legacy team stays per D-02), but eventually needs fallback. | Phase 60 (LOWERONTO-03) or deferred follow-up |
| `integrations/memory-visualizer/src/components/KnowledgeGraph/NodeDetails.tsx:448-451` | Renders `selectedNode.metadata.team` directly. Same. | Phase 60 or deferred |
| `integrations/memory-visualizer/src/store/slices/graphSlice.ts:137,172,256` | Three teamCounts aggregations on `entity.metadata.team`. Same. | Phase 60 or deferred |

**Critical:** memory-visualizer is the legacy VKB at `:8080` (per CLAUDE.md "VKB: vkb command opens http://localhost:8080"). Per CONTEXT.md D-11 it is OUT OF SCOPE for Phase 57. Surface this list in `STATE.md` after Phase 57 ships so Phase 60 knows where to also apply the fallback.

---

## No Analog Found

All Phase 57 files have strong in-repo analogs. Zero "no-analog" entries.

---

## Audit Findings (Planner Action Items)

### `grep -rn "putEntity" integrations/ lib/ scripts/` — comprehensive call-site audit

Per CONTEXT D-04's "Any other call site of `putEntity` discovered by `grep -rn`" bullet:

| File:Line | Context | Already in D-04 list? | Action |
|-----------|---------|----------------------|--------|
| `integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts:485` | The actual production write call site (every wave agent → wave-controller → km-core-adapter → `store.putEntity`) | NOT in CONTEXT D-04 explicit list (but covered transitively because canonical-mapper stamping flows through here). | **Add to plan — modify directly (defence-in-depth project stamp).** |
| `lib/km-core/src/pipeline/IngestPipeline.ts:247, 253, 346, 351` | Phase 40 4-stage pipeline — used by online learning. The `provenance` is the only writer-side stamp; project must be on the entity BEFORE the pipeline calls putEntity. | Not modified — the pipeline doesn't stamp metadata; it just forwards the entity. Stamping happens upstream in the extractor stage. | No code change needed in IngestPipeline itself; verify upstream extractors (e.g. legacy-ingest.ts mappers) stamp project. |
| `lib/km-core/src/backfill/index.ts:245` | Phase 39 backfill library function | Out of scope — used by Phase 39 entity-data-model backfill, NOT the Phase 57 project backfill. | No change. |
| `lib/km-core/src/adapters/online/reprojectFromOnlineStore.ts:420` | Phase 41 online re-projection | Reads from online-mapper.ts which already stamps project. | Verify via grep gate; no source change. |
| `scripts/observations-api-server.mjs:604, 656, 1059` | Patch-in-place writes for legacy observation mutations | Already routes through `legacyObservationToEntity` which preserves `meta.project`. | No source change. Verify via grep that project survives the mutate-and-replay cycle. |
| `scripts/migrate-sqlite-to-kmcore.mjs:228` | One-shot migration script (Phase 42 era) | Historic — does NOT need to be re-run. | No change. |
| `integrations/code-graph-rag/src/` | **ZERO HITS** | CONTEXT D-04 last bullet lists code-graph-rag, but no putEntity calls exist there. | **Remove the code-graph-rag bullet from D-04 (or mark verified no-op) at plan-finalization.** |

### `grep -rn "metadata.team" integrations/` — comprehensive read-side audit (D-11 awareness)

Covered fully in "Read-Side Fallback" shared-pattern section above. **Summary: 5 additional read sites in memory-visualizer + 0 in system-health-dashboard. All flagged out-of-scope for Phase 57.**

### `grep -rn "metadata.project" integrations/` — comprehensive read-side audit

Existing read sites that already read `metadata.project`:

| File:Line | Description | Phase 57 implication |
|-----------|-------------|----------------------|
| `integrations/mcp-server-semantic-analysis/src/agents/vibe-history-agent.ts:506` | Reads `metadata.project` for routing | Already works — Phase 57 increases coverage. |
| `integrations/mcp-constraint-monitor/src/dashboard-server.js:495,498,499,511` | Reads `metadata.project` for constraint-violation routing | Already works — Phase 57 increases coverage. |

Both surfaces become more reliable when Phase 57 lands (more entities carry the field they're already reading).

---

## Verification One-Liners (planner: codify into PLAN acceptance)

```bash
# CONTEXT.md "Specific Idea" — operator success-criterion-1 inspection.
jq '.nodes[] | select(.attributes.metadata.project) | .attributes.metadata.project' \
  .data/knowledge-graph/exports/general.json | sort | uniq -c

# After Phase 57 lands, the distinct project values should be a subset of
# {'coding', 'okm', 'cap'} and the total count should equal node count (every
# entity tagged). Verify via:
jq '[.nodes[] | select(.attributes.metadata.project)] | length' \
  .data/knowledge-graph/exports/general.json
# vs:
jq '.nodes | length' .data/knowledge-graph/exports/general.json
# These two numbers must be equal post-backfill.

# Lower-ontology load smoke test (D-09 success criterion floor).
node -e "
  const { OntologyRegistry } = require('@fwornle/km-core');
  const r = new OntologyRegistry({ directory: '.data/ontologies' });
  const required = ['LiveLoggingSystem','ConstraintMonitor','OnlineObservation','OnlineDigest','OnlineInsight','KnowledgeManagement','BatchSemanticAnalysis','RapidLlmProxy','DockerizedServices','EtmDaemon'];
  for (const c of required) {
    const cls = r.getClass(c);
    if (!cls) throw new Error('missing L2 class: ' + c);
    console.log(c, '->', cls.extends);
  }
"
```

---

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/coding/lib/km-core/src/` (full)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/` (wave + canonical-mapper + persistence + ontology-classification)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/storage/` (km-core-adapter)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/scripts/` (augment-team-field-42.2 — direct analog for backfill)
- `/Users/Q284340/Agentic/coding/integrations/unified-viewer/src/` (graph-builder + viewer-store + panels/filters)
- `/Users/Q284340/Agentic/coding/integrations/code-graph-rag/src/` (verified zero putEntity sites)
- `/Users/Q284340/Agentic/coding/scripts/` (migrate-* analogs for backfill scaffolding)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/scripts/` (migrate-okm-json-to-kmcore — Phase 43 D-G4.1 template)
- `/Users/Q284340/Agentic/coding/.data/ontologies/` (upper.json + coding-ontology.json + learning-artifacts.json shape verification)

**Files scanned (Read):** 15
**Files grep-scanned:** 30+
**Pattern extraction date:** 2026-06-14

---

*Phase: 57-lower-ontology-project-tagging-foundation*
*PATTERNS produced 2026-06-14*

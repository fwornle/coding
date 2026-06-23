# Phase 71: Experiment KB & Task Taxonomy - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 11 new/extended
**Analogs found:** 10 / 11 (1 config-format-only, no behavioral analog needed)

> RESEARCH.md already carries file:line evidence and code skeletons for nearly every file.
> This document confirms the analogs against the live codebase and pins the exact
> excerpts the planner should have each plan copy from. Where RESEARCH supplies a
> skeleton, the analog here is the *existing repo file the skeleton mirrors* — prefer
> the real repo pattern over the skeleton when they differ.

## File Classification

| New/Extended File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.data/ontologies-experiment/experiment-ontology.json` | config (ontology) | transform (schema def) | `.data/ontologies/coding-ontology.json` | exact (same `meta`+`classes` shape) |
| `.data/ontologies-experiment/upper.json` (copy) | config (ontology) | transform | `.data/ontologies/upper.json` | exact (verbatim copy) |
| `config/task-taxonomy.yaml` | config | transform | `config/llm-providers.yaml` | format-match (YAML config precedent) |
| `lib/experiments/store.mjs` (`openExperimentStore`) | utility (store factory) | request-response | `scripts/backfill-project-tag.mjs` (lines 109-134, 255-274) | exact (GraphKMStore + `import.meta.resolve` ontologyDir) |
| `lib/experiments/token-aggregate.mjs` | service | CRUD (read-only) | `scripts/backfill-task-id-by-timestamp.mjs` (lines 38-64, 192-200; runSweep params 131-173) | exact (better-sqlite3 readonly + parameterized) |
| `lib/experiments/taxonomy.mjs` | utility | transform | RESEARCH skeleton + `config/task-taxonomy.yaml` | role-match (no existing verb→class analog; deterministic, unit-testable) |
| `lib/experiments/run-write.mjs` (`writeRun`) | service | event-driven (write on close) | `scripts/backfill-project-tag.mjs` (putEntity/iterate usage) + km-core `GraphKMStore.d.ts` | role-match (idempotent putEntity; mint+metadata.task_id) |
| `scripts/measurement-stop.mjs` (EXTENDED) | controller (orchestrator) | event-driven | itself (existing 47-line file) + `scripts/measurement-start.mjs` (LOCAL-dist import) | exact (extends in place) |
| `scripts/experiments-query.mjs` | controller (CLI reader) | CRUD (read) | `scripts/backfill-project-tag.mjs` (CLI arg parse + store open/iterate/close) | role-match |
| `scripts/experiments-classify.mjs` | controller (CLI writer) | CRUD (update) | `scripts/backfill-project-tag.mjs` + `node:readline` | role-match |
| `tests/experiments/*.test.mjs` | test | — | `scripts/backfill-task-id-by-timestamp.mjs` (lines 213-289, node:test self-test + import-guard) | exact (node:test + temp-DB fixture) |

## Pattern Assignments

### `lib/experiments/store.mjs` — `openExperimentStore()` (utility, store factory)

**Analog:** `scripts/backfill-project-tag.mjs` — THE canonical coding-side `GraphKMStore` + CLAUDE.md-mandated `ontologyDir` resolution. Use this, not the RESEARCH skeleton's `process.env.CODING_REPO` form: the repo's locked pattern resolves ontologyDir via `import.meta.resolve('@fwornle/km-core')` + walk-to-package-root.

**ontologyDir resolution — VERBATIM repo pattern** (`backfill-project-tag.mjs:115-134`):
```javascript
async function resolveOntologyDir() {
  const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
  const kmCorePath = fileURLToPath(kmCoreEntry);
  let kmCoreRoot = path.dirname(kmCorePath);
  while (kmCoreRoot !== '/') {
    try { await fsp.access(path.join(kmCoreRoot, 'package.json')); break; }
    catch { kmCoreRoot = path.dirname(kmCoreRoot); }
  }
  // ... falls back to project .data/ontologies/ if package config/ontology absent
}
```
> **Phase-71 deviation:** D-02 requires a DEDICATED ontologyDir holding ONLY `upper.json` (copied) + `experiment-ontology.json` so the experiment registry's class catalog is exactly the 7 classes + upper bases. So `openExperimentStore()` must point `ontologyDir` at `.data/ontologies-experiment/` (NOT the km-core package dir, NOT the shared `.data/ontologies/`). Keep the `import.meta.resolve` walk only if you also need the km-core package root for anything else; otherwise resolve the experiment ontologyDir directly off `CODING_REPO`/repo root. **The CLAUDE.md acceptance grep for `ontologyDir` must still pass** — the literal token must appear in the constructor.

**Store construction** (`backfill-project-tag.mjs:261-269`):
```javascript
store = new GraphKMStore({
  dbPath,           // .data/experiments/leveldb  (Phase 71)
  exportDir,        // .data/experiments/exports  (Phase 71)
  ontologyDir,      // .data/ontologies-experiment/  (Phase 71, D-02)
  ontologyStrict: false,   // matches repo precedent; RESEARCH Pitfall 2 warns malformed lower is skipped, not fatal
  debounceMs: 0,           // CLI opens→writes→close() flushes; 0 = no debounce wait (repo precedent)
  domains: ['experiment'], // per-domain export bucket == lower meta.name (RESEARCH); repo uses ['general']
});
await store.open();
```
> Import is bare `import { GraphKMStore } from '@fwornle/km-core';` (`backfill-project-tag.mjs:55`) — NOT the local `lib/km-core/dist` path. km-core is consumed from node_modules (no submodule build).

**Close/flush** (`backfill-project-tag.mjs:386`): always `try { await store.close(); } catch {}` in a finally — `close()` flushes the debounced export.

---

### `lib/experiments/token-aggregate.mjs` — `aggregateByTaskId()` (service, read-only CRUD)

**Analog:** `scripts/backfill-task-id-by-timestamp.mjs` — the locked host-side `better-sqlite3` open pattern for `token-usage.db`.

**Import + require pattern** (`backfill-task-id-by-timestamp.mjs:38-45`):
```javascript
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
```

**Data-dir / db-path resolution** (`backfill-task-id-by-timestamp.mjs:56-64`):
```javascript
function resolveDataDir() {
  return process.env.LLM_PROXY_DATA_DIR || '/Users/Q284340/Agentic/coding/.data';
}
function resolveDbPath(override) {
  return override || path.join(resolveDataDir(), 'llm-proxy', 'token-usage.db');
}
```
> RESEARCH skeleton uses `CODING_REPO`; repo precedent uses `LLM_PROXY_DATA_DIR` with the hard-coded `.data` fallback. **Match the repo precedent** — same env var the backfill + proxy use.

**Read-only open** (`backfill-task-id-by-timestamp.mjs:195`):
```javascript
db = new Database(dbPath, { readonly: dryRun, fileMustExist: true });
```
> Phase 71 ALWAYS `readonly: true` (never a second writer — Security V5, anti-pattern in RESEARCH). Wrap query in `try { ... } finally { db.close(); }`.

**Parameterized query — MANDATORY** (`backfill-task-id-by-timestamp.mjs:131-147`): every `WHERE task_id = ?` uses bound `?` params via `db.prepare(...).get(taskId)` / `.run(...)`. NEVER string-interpolate task_id (SQL-injection mitigation, Security V5). The RESEARCH §"token_usage read-only aggregation" skeleton is correct and matches this.

---

### `scripts/measurement-stop.mjs` — close orchestrator (controller, EXTENDED in place)

**Analog:** itself (existing 47-line file at `scripts/measurement-stop.mjs`) + `scripts/measurement-start.mjs` for the LOCAL-dist import convention. D-07 extends this exact file; do NOT create a parallel orchestrator.

**LOCAL proxy-dist import (the load-bearing convention)** (`measurement-stop.mjs:25-30`):
```javascript
const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR
  || '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';
async function main() {
  const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
  const { stopMeasurement, resolveMeasurementPaths } = await import(modUrl);
  const archived = stopMeasurement();
  ...
}
```
> `stopMeasurement` / `SpanRecord` are imported from the LOCAL proxy dist via `LLM_PROXY_DIST_DIR`, NOT from node_modules (which pins old v1.0.0). RESEARCH confirms. The existing file already calls `stopMeasurement()` and reads `resolveMeasurementPaths()` — the extension wires steps (2)-(5) AFTER line 39's archive: read span JSON → derive/prompt task_class → enforce closed-6 → `aggregateByTaskId` → `writeRun` against `openExperimentStore()`.

**Top-level error envelope** (`measurement-stop.mjs:44-47`): `main().catch(err => { process.stderr.write(\`FATAL: ${err.stack||err.message}\n\`); process.exit(1); })`. Keep this. D-06: a missing task_class on a headless close must NOT throw here — it writes `unclassified`+`pending` instead.

> **Output style:** this file uses `process.stdout.write` / `process.stderr.write` (NOT `console.log`) — required by the `no-console-log` constraint (CLAUDE.md). All new CLI output in Phase 71 must follow.

---

### `lib/experiments/run-write.mjs` — `writeRun()` (service, idempotent entity write)

**Analog:** `scripts/backfill-project-tag.mjs` (store `putEntity`/`iterate` usage against a GraphKMStore) + RESEARCH §"Idempotent Run write" skeleton (Pattern 2). No exact repo analog for the mint-UUIDv7 + `metadata.task_id` idempotency scan — it is novel but small and unit-tested.

**Key contract points (from RESEARCH, VERIFIED against km-core dist):**
- Mint id via `mintEntityId()` from `@fwornle/km-core` — NEVER use `task_id` as the entity `id` (`parseEntityId` requires UUIDv7; `telem-live-68` throws). [Pitfall 1]
- Idempotency: scan `for await (const e of store.iterate({ entityType: 'Run' }))` and match `e.metadata?.task_id === span.task_id` BEFORE deciding mint-vs-update.
- Strict-path `putEntity(entity, { provenance })` — supply a synthetic `ProvenanceStamp` (`{ provider:'coding-measure-stop', model:'n/a', runId:span.task_id, timestamp }`); the store never invents one.
- All 8 tags ALWAYS in `metadata` (D-13): `task_hash, task_class, agent, model, framework, spec_level(null), snapshot_id(null), trace_id` + `pending` flag.
- Outcome stub: second `putEntity(entityType:'Outcome')` + `store.addRelation({ type:'produces', from:runId, to:outcomeId })` (D-12).

---

### `scripts/experiments-query.mjs` — query CLI (controller, read)

**Analog:** `scripts/backfill-project-tag.mjs` for CLI shape (arg parse → `openExperimentStore()` → iterate → `close()` in finally).

**Core read pattern** (RESEARCH §"query CLI canned queries", D-03/D-06):
```javascript
for await (const e of store.iterate({ entityType: 'Run' })) {
  if (e.metadata?.pending === true) continue;           // D-06 quarantine exclusion
  if (filterClass && e.metadata?.task_class !== filterClass) continue;
  if (filterAgent && e.metadata?.agent !== filterAgent) continue;
  runs.push(e);
}
```
> Opens the store via the shared `openExperimentStore()` (satisfies the mandatory `ontologyDir` grep). 2-3 canned queries: "runs by task_class", "agent vs model cost" (join Outcome.totalTokens).

---

### `scripts/experiments-classify.mjs` — quarantine resolver CLI (controller, update)

**Analog:** `scripts/backfill-project-tag.mjs` (store open + entity update + close) + `node:readline` for the interactive assign prompt (D-08).

**Flow (D-08):** list Runs where `metadata.pending === true` → operator assigns a closed-6 `task_class` (validate via `lib/experiments/taxonomy.mjs isValidClass`) → `putEntity`/`mergeAttributes` flips `task_class` + `pending:false` (re-includes in queries). Surface a pending count.

---

### `.data/ontologies-experiment/experiment-ontology.json` (config, ontology)

**Analog:** `.data/ontologies/coding-ontology.json` (lines 1-12 = exact `meta` block shape; each class = `{ description, extends?, relationships: {}, properties: {} }`).

**`meta` block shape** (`coding-ontology.json:1-7`):
```json
{ "meta": { "name": "...", "version": "1.0.0", "description": "...", "extends": "upper" }, "classes": { ... } }
```

**Per-class shape** (`coding-ontology.json:9-12` pattern):
```json
"LSLSession": { "description": "...", "relationships": {}, "extends": "File", "properties": { ... } }
```
> **CRITICAL (RESEARCH Pitfall 2/3):** use ONLY the km-core `meta`+`classes` shape. Do NOT use the legacy `name/version/type/entities` shape that `.data/ontologies/schemas/ontology-schema.json` validates — km-core's `loadOntologyFile` throws `missing meta or classes` on it and the registry SKIPS the file. `relationships` is `Record<string, string[]>` (e.g. `{ "produces": ["Outcome"] }`), NOT the rich `_legacy` relation-object shape. Do NOT validate this file against `ontology-schema.json`.
> **`extends` targets verified present in upper.json:** `Feature`, `Revision`, `Process`, `Contract`, `File`, `Service`, `Config` all exist — the 7 classes' `extends` (Experiment→Feature, Run→Revision, Route/Step→Process, Decision/Outcome→Contract, Report→Feature) are all valid upper classes. Use the full skeleton in RESEARCH §"experiment-ontology.json skeleton".

---

### `.data/ontologies-experiment/upper.json` (config, verbatim copy)

**Analog / source:** `.data/ontologies/upper.json` — copy it verbatim. km-core's `OntologyRegistry.loadFromDisk()` REQUIRES `upper.json` present in the ontologyDir, then loads every other `.json` as a lower (RESEARCH, registry.js:46-74). Copying keeps the experiment store's catalog isolated to upper + the 7 experiment classes (D-02). (Assumption A4: copy preferred over symlink/shared-dir; both work.)

---

### `config/task-taxonomy.yaml` (config)

**Analog (format only):** `config/llm-providers.yaml` — confirms YAML config files are an established repo convention in `config/`. No behavioral analog needed; this is a static data file.

**Content:** RESEARCH §"task-taxonomy.yaml" supplies the full 6-class file (`version: 0`, each class = `definition` + `keywords[]`). Single source of truth (D-10) read by the validator (D-09), the verb→class heuristic (D-11), and docs. Parse with `yaml` or `js-yaml` (both installed). Closed-6 enum `{refactor, bugfix, new-feature, migration, debug, docs}` — NO `unclassified` here (that's the quarantine sentinel, not a taxonomy class).

---

### `lib/experiments/taxonomy.mjs` (utility, transform)

**Analog:** none in repo (novel deterministic heuristic) — use RESEARCH §"verb→class heuristic" skeleton directly. Exports `loadTaxonomy()` (parse the YAML), `isValidClass(cls)` (closed-6 check for D-09 enforcement), `deriveClassFromText(text, taxonomy)` (zero-LLM keyword scorer, D-11). Hyphenated keywords matched as substrings; bare keywords matched on tokenized word set. Pure + unit-testable.

---

### `tests/experiments/*.test.mjs` (test)

**Analog:** `scripts/backfill-task-id-by-timestamp.mjs:213-289` — the node:test self-test + temp-DB fixture + import-guarded `main()` pattern.

**Conventions to copy:**
- Framework: `node:test` via `node --test tests/experiments/<file>.test.mjs`.
- Temp fixtures: a synthetic archived span JSON + a seeded temp `token-usage.db` (mirror the backfill self-test's temp-DB construction).
- Temp store: a temp `dbPath` + temp `ontologyDir` (upper.json + experiment-ontology.json) for run-write/enforcement tests.
- **argv gotcha (MEMORY.md):** `node --test <file> --live` silently drops trailing argv per-file. Gate any live-only test on an ENV VAR (e.g. `EXPERIMENTS_LIVE=1`), NEVER a CLI flag.
- Import-guard the orchestrator so importing it in a test doesn't run `main()` (mirror backfill's `pathToFileURL(process.argv[1])` guard).

---

## Shared Patterns

### km-core store open (ontologyDir mandatory)
**Source:** `scripts/backfill-project-tag.mjs:55, 115-134, 261-269, 386`
**Apply to:** `lib/experiments/store.mjs` (the single factory) — `run-write`, `experiments-query`, `experiments-classify` all call `openExperimentStore()`, never `new GraphKMStore` inline.
- Import: `import { GraphKMStore, mintEntityId } from '@fwornle/km-core';` (node_modules, not lib/km-core/dist).
- The literal token `ontologyDir` MUST appear in the constructor (CLAUDE.md acceptance grep is mandatory in the CLI plan).
- Always `await store.open()` then `try/finally { await store.close(); }`.

### better-sqlite3 read-only + parameterized
**Source:** `scripts/backfill-task-id-by-timestamp.mjs:38-45, 56-64, 131-147, 195`
**Apply to:** `lib/experiments/token-aggregate.mjs`
- `createRequire(import.meta.url)` + `require('better-sqlite3')`.
- `new Database(dbPath, { readonly: true, fileMustExist: true })` — Phase 71 is ALWAYS read-only (no second writer to the proxy DB).
- `db.prepare('... WHERE task_id = ?').get(taskId)` — bound params only, `db.close()` in finally.

### LOCAL proxy-dist SDK import
**Source:** `scripts/measurement-stop.mjs:25-30` (and `measurement-start.mjs`)
**Apply to:** `scripts/measurement-stop.mjs` (extended) — `stopMeasurement`, `resolveMeasurementPaths`, `SpanRecord` via `LLM_PROXY_DIST_DIR` + `pathToFileURL(...measurement-span.js)`. NOT from node_modules.

### no-console-log output convention
**Source:** `scripts/measurement-stop.mjs` and `backfill-*.mjs` throughout
**Apply to:** ALL new `.mjs` in this phase — `process.stdout.write(...)` / `process.stderr.write(...)`, never `console.log` (CLAUDE.md constraint; constraint-monitor fires on Edit/Write to `.mjs`).

### ontology authoring — `meta`+`classes` only
**Source:** `.data/ontologies/coding-ontology.json:1-12`, `.data/ontologies/upper.json`
**Apply to:** `experiment-ontology.json` — `meta`+`classes`, `relationships: Record<string,string[]>`, NEVER the legacy `entities` shape, NEVER validated against `ontology-schema.json`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `lib/experiments/taxonomy.mjs` (`deriveClassFromText`) | utility | transform | No existing verb→class / keyword-scorer in the repo. Novel but deterministic, small, fully unit-testable; use the RESEARCH skeleton. Format precedent for the config it reads = `config/llm-providers.yaml`. |
| `/gsd run-end auto-invoke hook` | (wiring) | event-driven | RESEARCH A1/A5: no `/gsd` run-end hook found in this checkout's `.claude/commands/`. The CLI works standalone (`node scripts/measurement-stop.mjs`); the auto-invoke wiring is a thin add-on the planner must confirm with the user. NOT a code analog gap — a missing integration point. |

## Metadata

**Analog search scope:** `scripts/`, `lib/`, `config/`, `.data/ontologies/`, `bin/`, plus km-core dist (`node_modules/@fwornle/km-core/dist/ontology/defaultDir.js`).
**Files scanned (read for excerpts):** `scripts/backfill-project-tag.mjs`, `scripts/backfill-task-id-by-timestamp.mjs`, `scripts/measurement-stop.mjs`, `.data/ontologies/coding-ontology.json`, `node_modules/@fwornle/km-core/dist/ontology/defaultDir.js`; greps confirmed `config/llm-providers.yaml` (YAML precedent), `.data/ontologies/upper.json` class names, and all repo-wide `new GraphKMStore` + `ontologyDir` call sites.
**Key cross-check vs RESEARCH:** RESEARCH's `openExperimentStore` skeleton used `process.env.CODING_REPO`; the repo's LOCKED pattern (`backfill-project-tag.mjs`) resolves ontologyDir via `import.meta.resolve('@fwornle/km-core')` walk-to-root and uses `LLM_PROXY_DATA_DIR` for the DB path — planner should prefer the repo patterns documented here.
**Pattern extraction date:** 2026-06-23

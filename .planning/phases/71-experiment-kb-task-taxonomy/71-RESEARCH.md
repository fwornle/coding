# Phase 71: Experiment KB & Task Taxonomy - Research

**Researched:** 2026-06-23
**Domain:** km-core (Graphology+LevelDB) second-store wiring, ontology authoring, SQLite read-aggregation, deterministic CLI taxonomy enforcement
**Confidence:** HIGH (all load-bearing surfaces read from installed source: km-core dist `.d.ts`/`.js`, the proxy TELEM contract, the existing measurement CLIs, and the ontology files)

## Summary

Phase 71 has exactly one genuinely novel risk — a **second, independent `GraphKMStore`** — and that risk is fully de-risked by reading the installed km-core source: the constructor is a pure object-form (`{ dbPath, exportDir, ontologyDir, domains?, debounceMs? }`), every path is caller-supplied (km-core "never resolves against process.cwd implicitly"), and pointing it at `.data/experiments/` + a dedicated `ontologyDir` gives a clean store with zero coupling to the churned `.data/knowledge-graph/` store. The fuzzy-name dedup, the 5s exporter, and the `persistence.js` hydrate patch are all properties of the *obs-api process that owns the shared store* — none of them touch a second store opened on-demand in a CLI. [VERIFIED: node_modules/@fwornle/km-core/dist/store/GraphKMStore.d.ts:12-44]

Everything else is assembly of already-locked contracts. The ontology must use km-core's **`meta` + `classes`** shape (NOT the `name/version/type/entities` shape that `.data/ontologies/schemas/ontology-schema.json` validates — that schema is for legacy OKB tooling; km-core's `loadOntologyFile` reads `meta`+`classes` and throws on anything else). [VERIFIED: dist/ontology/loader.js:18-25] The Run-write reads the archived span JSON (`.data/measurements/<task_id>.json`) plus a thin read-only `WHERE task_id=X` aggregation over the proxy-owned `token-usage.db` (reusing `backfill-task-id-by-timestamp.mjs`'s `better-sqlite3` open pattern). The close orchestrator extends the existing `scripts/measurement-stop.mjs` precedent, which already imports `stopMeasurement()` from the LOCAL proxy dist.

**Primary recommendation:** Build five net-new pieces — (1) `.data/ontologies/experiment-ontology.json` (meta+classes, `extends: upper`, 7 classes); (2) `config/task-taxonomy.yaml` (single source of truth, 6 closed classes); (3) a shared `lib/experiments/` module (store-open helper + token aggregator + taxonomy loader/validator + verb→class heuristic + Run-write); (4) the close orchestrator wired into `measurement-stop.mjs`; (5) two read CLIs (`experiments query`, `experiments classify`). Idempotency (D-14): mint a UUIDv7 once, store `task_id` in `metadata.task_id`, and look it up via `iterate({entityType:'Run'})` before writing — do NOT use `task_id` as the km-core `id` (it fails `parseEntityId`, which requires a UUIDv7).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (LOCKED):** Run entities live in a **dedicated, independent km-core GraphKMStore** (e.g. `.data/experiments/`), NOT the shared `.data/knowledge-graph/` observation store. The shared store is actively churned by wave-analysis fuzzy-name dedup, the 5s-debounced exporter, and the `persistence.js` hydrate patch — those would mangle immutable, append-only Run records. No existing precedent for a second store; new plumbing (km-core requires an explicit `ontologyDir`).
- **D-02 (LOCKED):** The 7 classes ship as a **new standalone lower ontology file** (e.g. `.data/ontologies/experiment-ontology.json`, `extends: "upper"`), loaded as the dedicated store's `ontologyDir`. Experiment classes kept OUT of `coding-ontology.json` so the obs-api / wave-analysis classifier never sees them.
- **D-03 (LOCKED):** Queryability = **query helper + a few canned queries**. Thin CLI/SDK reader over the experiment store PLUS 2-3 pre-baked example queries ("runs by task_class", "agent vs model cost").
- **D-04 (LOCKED):** **Experiment = implicit/optional grouping.** Every Run stands alone. An Experiment is an OPTIONAL named grouping attached later; NOT required to write a Run. The class + relation may ship in the ontology but is populated lazily/never this phase.
- **D-05 (LOCKED):** **Auto-derive for /gsd runs, prompt for freeform.** /gsd runs infer a candidate `task_class` from phase/PLAN context and confirm; freeform runs prompt the operator at "Stop measurement."
- **D-06 (LOCKED):** **Quarantine queue (not silent)** for background/headless runs. The Run IS written with `task_class='unclassified'` + a pending flag, and is **EXCLUDED from all query/comparison results** until resolved. NOT a hard block, NOT a silent guess.
- **D-07 (LOCKED):** **Close orchestration lives coding-side.** A coding-repo run-close path (CLI subcommand e.g. `coding measure stop`, auto-invoked at /gsd run-end) calls the proxy's `stopMeasurement()`, then runs derive/prompt + enforcement + Run-write against the experiment store. The generic `rapid-llm-proxy` submodule stays free of task-taxonomy / experiment-store knowledge.
- **D-08 (LOCKED):** **Quarantine resolver = `coding experiments classify` CLI + surfaced count.** Lists pending Runs, lets operator assign `task_class` (re-including them in queries). A pending count is surfaced.
- **D-09 (LOCKED):** **Closed enum, exactly 6 classes** — `{refactor, bugfix, new-feature, migration, debug, docs}`. Anything else rejected at write. Adding a 7th is a versioned change (v1).
- **D-10 (LOCKED):** **Dedicated taxonomy config file** is the single source of truth (`config/task-taxonomy.yaml` or `.json`): id + definition + disambiguation examples per class. Read by write-path validator AND auto-derive AND docs.
- **D-11 (LOCKED):** **Deterministic keyword heuristic** for /gsd derivation (zero-LLM). Maps phase name / goal-sentence verbs to a class using the taxonomy file's disambiguation hints. Operator confirms/overrides.
- **D-12 (LOCKED):** **Populate Run + a basic Outcome stub only.** Define all 7 classes (KB-01), but WRITE only Run entities (with tags) + a basic Outcome stub (token totals / closed-state). `Route / Step / Decision / Report` stay schema-only.
- **D-13 (LOCKED):** **All 8 tags always written; null/empty where no source.** `task_hash, task_class, agent, model, framework, spec_level, snapshot_id, trace_id` always present. `snapshot_id` (→ Phase 67) and `spec_level` written explicitly empty/null.
- **D-14 (LOCKED):** **Run keyed by `task_id`, with refreshable totals.** One Run per measurement span; stable id = the span's `task_id` → idempotent (re-close updates, never duplicates). Token aggregates (re)computed by querying `token_usage WHERE task_id=X`.

### Claude's Discretion (researched below — see numbered research answers)
- Per-tag sourcing table (guardrail: all 8 in schema regardless — D-13).
- Dedicated-store wiring mechanics (guardrail: must NOT share `.data/knowledge-graph/` or its churning paths — D-01).
- `token_usage` aggregation helper shape (guardrail: read the proxy-owned DB read-only; no second writer).
- Heuristic verb→class mapping table (guardrail: driven by taxonomy config disambiguation hints — D-10).
- Outcome stub contents (guardrail: no route/score data — Phases 72-73).

### Deferred Ideas (OUT OF SCOPE)
- Route / Step / Decision instance population (schema-only this phase — D-12; data in 72-73).
- `Report` entity + saved-query workflow (Phase 74, KB-04).
- Richer quarantine/pending-runs dashboard view (Phase 74).
- `snapshot_id` population (Phase 67 repro rig; tag written null — D-13).
- Taxonomy v1 (>6 classes).
- Experiment grouping population (class may ship; instances lazy/never — D-04).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KB-01 | A km-core ontology defines `Experiment / Run / Route / Step / Decision / Outcome / Report` entities and their relations. | §Research Q2 (ontology authoring against km-core's `meta`+`classes` `OntologyFile` shape, `extends: upper`, relations as `Record<string,string[]>`). Loader contract verified at dist/ontology/loader.js:18-25. |
| KB-02 | A Run-write path materializes each run as an independent, queryable km-core entity with rich tags sourced from `token_usage` + span. | §Research Q1 (second-store wiring), Q3 (per-tag sourcing), Q4 (token aggregation), Q7 (close orchestration), Q8 (Outcome stub). Idempotency pitfall (§Pitfall 1). |
| KB-03 | A task taxonomy v0 (6 classes) defined with definitions, enforced as required tag at run-end. | §Research Q5 (verb→class heuristic), Q6 (taxonomy config format), Q7 (enforcement + quarantine path D-06). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Experiment ontology definition | Storage (km-core ontologyDir) | — | km-core's OntologyRegistry loads it; it is the class catalog the second store validates against (KB-01). |
| Run entity persistence | Storage (dedicated `.data/experiments/` GraphKMStore) | — | D-01: isolated, append-only store; LevelDB + per-domain JSON export owned by the CLI process that opens it. |
| token_usage aggregation | Database read (proxy-owned `token-usage.db`, read-only) | — | Proxy is sole writer (Phase 70 principle). Coding reads via `better-sqlite3 {readonly:true}`. |
| Span lifecycle (`stopMeasurement`) | proxy SDK (`@rapid/llm-proxy` measurement-span) | coding CLI (consumer) | D-07: proxy stays generic; coding orchestrates. `stopMeasurement` is EXPORTED but UNWIRED — this phase is its first coding-side call site. |
| task_class derivation + enforcement | coding CLI (close orchestrator) | config (taxonomy yaml) | D-05/D-07/D-11: zero-LLM heuristic + closed-enum validator, both reading the taxonomy config. |
| Query / classify | coding CLI (read over experiment store) | — | D-03/D-08: thin readers; both MUST construct GraphKMStore with explicit `ontologyDir` (CLAUDE.md km-core rule). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fwornle/km-core` | 0.1.0 (installed) | `GraphKMStore` (Graphology+LevelDB+JSON export), `OntologyRegistry`, `mintEntityId`, types | The repo's canonical KB store. Already in `node_modules`. [VERIFIED: node_modules/@fwornle/km-core/package.json:2-3] |
| `@rapid/llm-proxy` | 2.0.0 (local dist) | `stopMeasurement`, `getActiveMeasurement`, `resolveMeasurementPaths`, `SpanRecord` | Phase-68 TELEM contract; the span source. Imported from LOCAL dist, NOT node_modules (which pins old v1.0.0). [VERIFIED: _work/rapid-llm-proxy/package.json:2-3; scripts/measurement-stop.mjs:25-30] |
| `better-sqlite3` | (transitively present; used by proxy + backfill) | Read-only `WHERE task_id=X` aggregation over `token-usage.db` | The locked host-side pattern. [VERIFIED: scripts/backfill-task-id-by-timestamp.mjs:44-45,195] |
| `yaml` or `js-yaml` | both installed | Parse `config/task-taxonomy.yaml` | Both present in node_modules. [VERIFIED: ls node_modules — `yaml` and `js-yaml` both present] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:readline` | builtin | Freeform-run task_class prompt (D-05) | Interactive close only; headless path skips to quarantine (D-06). |
| `uuidv7` (via km-core `mintEntityId`) | bundled in km-core | Mint the Run entity id | Always — task_id is NOT a valid km-core id (see Pitfall 1). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `yaml` (config) | JSON (`config/task-taxonomy.json`) | JSON needs no parser dep and is git-diff-clean, but loses inline comments for disambiguation hints. **Recommend YAML** (Q6) — the disambiguation examples read far better with comments, and both parsers are already installed. |
| Strict-path `putEntity` with `provenance` | `skipOntologyCheck:true` trusted path | The trusted path bypasses ontology validation — defeats KB-01's "ontology enforces classes" intent. **Recommend strict path** with a synthetic `ProvenanceStamp` (Q1). |
| Idempotency via km-core `id = task_id` | Mint UUIDv7 + `metadata.task_id` lookup | Using task_id as id throws (`parseEntityId` requires UUIDv7). **Recommend mint + metadata lookup** (Pitfall 1). |

**Installation:**
```bash
# No new installs required — km-core (0.1.0), better-sqlite3, yaml/js-yaml all present.
# The proxy measurement-span SDK is imported from the local dist via LLM_PROXY_DIST_DIR
# (default /Users/Q284340/Agentic/_work/rapid-llm-proxy/dist), per measurement-stop.mjs.
```

**Version verification:**
```
@fwornle/km-core: 0.1.0   [VERIFIED: node_modules/@fwornle/km-core/package.json]
@rapid/llm-proxy: 2.0.0   [VERIFIED: _work/rapid-llm-proxy/package.json]
yaml + js-yaml:   present [VERIFIED: ls node_modules]
```

## Package Legitimacy Audit

> No external packages are installed by this phase. All dependencies (`@fwornle/km-core`, `@rapid/llm-proxy`, `better-sqlite3`, `yaml`/`js-yaml`, `uuidv7`) are already present in the repo's locked dependency tree. slopcheck N/A — zero new registry installs.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No new installs — phase uses only already-present deps. |

## Architecture Patterns

### System Architecture Diagram

```
  /gsd run-end hook  ──────────────┐         operator (freeform)  ──┐
  (auto-invoke)                     │                                │
                                    ▼                                ▼
                        ┌───────────────────────────────────────────────┐
                        │  coding measure stop  (close orchestrator)      │
                        │  scripts/measurement-stop.mjs (extended, D-07)  │
                        └───────────────────────────────────────────────┘
                                    │
              (1) stopMeasurement() │  ← @rapid/llm-proxy LOCAL dist
                                    ▼
              archived span  .data/measurements/<task_id>.json
                  { task_id, started_at, ended_at, goal_sentence?, meta? }
                                    │
              (2) derive/prompt     ▼  task_class
        ┌───────────────────────────────────────────┐
        │ verb→class heuristic (D-11, zero-LLM)      │◄── config/task-taxonomy.yaml (D-10)
        │  /gsd: derive+confirm | freeform: prompt   │     (definitions + disambiguation hints)
        │  headless+unsure: task_class='unclassified'│
        └───────────────────────────────────────────┘
                                    │
              (3) enforce (closed-6 validator, D-09) │  reject free strings
                                    ▼
              (4) token aggregation  ─────────────────► token-usage.db  (READ-ONLY)
                  WHERE task_id=X, GROUP BY agent/model/provider/granularity_tier
                  (better-sqlite3 {readonly:true})        [proxy is sole writer]
                                    │
              (5) Run-write          ▼
        ┌───────────────────────────────────────────────────────────┐
        │  DEDICATED experiment GraphKMStore (D-01)                  │
        │  dbPath:.data/experiments/leveldb  exportDir:.data/exp/exp │
        │  ontologyDir: .data/ontologies-experiment/ (upper+exp)     │
        │    putEntity(Run{8 tags, metadata.task_id}, {provenance})  │
        │    putEntity(Outcome stub) + addRelation(Run-produces->Out)│
        │    idempotent: iterate(Run) → find metadata.task_id first  │
        └───────────────────────────────────────────────────────────┘
                            ▲                         ▲
       coding experiments query (D-03)   coding experiments classify (D-08)
       runs-by-task_class, agent-vs-cost  list pending → assign → re-include
       (excludes task_class='unclassified')          (both open store w/ ontologyDir)
```

### Recommended Project Structure
```
.data/
├── experiments/              # D-01 dedicated store (NEW — gitignore the leveldb)
│   ├── leveldb/              #   dbPath
│   └── exports/              #   exportDir (per-domain JSON; git-trackable)
└── ontologies-experiment/    # D-02 dedicated ontologyDir (NEW)
    ├── upper.json            #   COPY of .data/ontologies/upper.json (km-core needs upper.json present)
    └── experiment-ontology.json   # NEW lower ontology (meta+classes, extends upper)

config/
└── task-taxonomy.yaml        # D-10 single source of truth (NEW)

lib/experiments/              # NEW shared module (imported by all CLIs)
├── store.mjs                 #   openExperimentStore() — the ontologyDir-correct constructor
├── taxonomy.mjs              #   loadTaxonomy() + isValidClass() + deriveClassFromText()
├── token-aggregate.mjs       #   aggregateByTaskId(db, taskId) — read-only WHERE task_id=X
└── run-write.mjs             #   writeRun(span, taskClass, totals) — idempotent putEntity

scripts/
├── measurement-stop.mjs      # EXTENDED (D-07) — close orchestrator wires (1)-(5)
├── experiments-query.mjs     # NEW (D-03)
└── experiments-classify.mjs  # NEW (D-08)
```

> **Why a separate `ontologyDir-experiment/`:** km-core's `OntologyRegistry.loadFromDisk()` reads `upper.json` (mandatory) then EVERY other `.json` in the dir as a lower ontology. [VERIFIED: dist/ontology/registry.js:46-74] If you point `ontologyDir` at the existing `.data/ontologies/` it will ALSO load `coding-ontology.json` into the experiment store's class catalog — harmless for validation but couples the two. A dedicated dir with just `upper.json` (copied) + `experiment-ontology.json` keeps the experiment store's catalog to exactly the 7 classes + the upper base classes. This also satisfies D-02's "kept OUT of coding-ontology.json" intent at the loader level.

### Pattern 1: Open the dedicated experiment store (the canonical second-store constructor)
**What:** The one place the second store is opened, with the mandatory explicit `ontologyDir` (CLAUDE.md km-core rule + the `parentChainOf`/`isValidClass` registry).
**When to use:** Every CLI (write, query, classify) calls this — never `new GraphKMStore` inline.
```javascript
// lib/experiments/store.mjs
// Source: dist/store/GraphKMStore.d.ts:12-44 (GraphKMStoreOptions),
//         dist/ontology/defaultDir.js:18-23 (import.meta walk-to-root pattern)
import path from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
import { GraphKMStore } from '@fwornle/km-core';

const REPO = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';

export async function openExperimentStore() {
  const store = new GraphKMStore({
    dbPath:     path.join(REPO, '.data', 'experiments', 'leveldb'),
    exportDir:  path.join(REPO, '.data', 'experiments', 'exports'),
    ontologyDir:path.join(REPO, '.data', 'ontologies-experiment'), // upper.json + experiment-ontology.json
    domains:    ['experiment'],   // per-domain export bucket name == lower meta.name
    // debounceMs default 5000 is fine — a CLI opens, writes, then close() flushes.
  });
  await store.open();
  return store;
}
```
> The CLAUDE.md rule says CLIs importing `resolveEntities` need `ontologyDir`. This phase does NOT call `resolveEntities` (no dedup/merge of Runs — they're immutable), but the **strict-path `putEntity` validates `entityType` against the registry** which only exists when `ontologyDir` is set. [VERIFIED: GraphKMStore.d.ts:70-80 — `get ontology()` returns undefined when ontologyDir omitted; putEntity JSDoc ":165" — ontology validation on entityType] So `ontologyDir` is mandatory here too. **Acceptance grep for `ontologyDir` in the CLI plan is required (CLAUDE.md).**

### Pattern 2: Idempotent Run write (mint UUIDv7, key on metadata.task_id)
**What:** D-14 idempotency without violating km-core's id contract.
**When to use:** Every Run-write and re-close.
```javascript
// lib/experiments/run-write.mjs
// Source: dist/store/GraphKMStore.d.ts:165-185 (putEntity strict path needs provenance),
//         dist/types/entity.d.ts:9-14 (ProvenanceStamp), dist/ids/parse.js:23-34 (task_id is NOT a UUIDv7)
import { mintEntityId } from '@fwornle/km-core';

export async function writeRun(store, { span, taskClass, pending, tags, totals }) {
  // 1. Idempotent lookup: find an existing Run carrying this task_id.
  let existingId;
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.task_id === span.task_id) { existingId = e.id; break; }
  }
  const id = existingId ?? mintEntityId();

  // 2. Synthetic provenance — the store NEVER invents one (D-30). This is a
  //    write by the close orchestrator, not an LLM extraction.
  const provenance = {
    provider: 'coding-measure-stop',
    model: 'n/a',
    runId: span.task_id,
    timestamp: new Date().toISOString(),
  };

  await store.putEntity({
    ...(existingId ? { id } : {}),       // re-close updates same node; first write mints
    name: span.task_id,                  // human-readable handle
    entityType: 'Run',                   // validated against experiment-ontology.json
    layer: 'evidence',
    description: span.goal_sentence ?? '',
    metadata: {
      task_id: span.task_id,             // ← the idempotency key (D-14)
      // ── 8 tags ALWAYS present (D-13) ──
      task_hash:   tags.task_hash,       // sha256(goal_sentence||prompt) — Q3
      task_class:  taskClass,            // closed-6 OR 'unclassified' (D-06/D-09)
      agent:       tags.agent,           // from token_usage rows — Q3
      model:       tags.model,           // from token_usage rows — Q3
      framework:   tags.framework,       // from span.meta or agent type — Q3
      spec_level:  null,                 // deferred (D-13)
      snapshot_id: null,                 // deferred → Phase 67 (D-13)
      trace_id:    tags.trace_id,        // span.task_id (stable correlation) — Q3
      pending:     pending === true,     // D-06 quarantine flag
      started_at:  span.started_at,
      ended_at:    span.ended_at,
    },
  }, { provenance });

  return id;
}
```

### Anti-Patterns to Avoid
- **Using `task_id` as the km-core entity `id`.** `parseEntityId` throws on anything that isn't a UUIDv7 (`telem-live-68` fails the position-14 `'7'` check). [VERIFIED: dist/ids/parse.js:31-33] Mint + store in `metadata.task_id`.
- **Opening the store without `ontologyDir`.** `putEntity` strict-path ontology validation silently degrades to noop-validator; `entityType:'Run'` would not be enforced (KB-01 regression). [VERIFIED: GraphKMStore.d.ts:70-80]
- **Authoring the ontology in the `name/version/type/entities` shape.** That is the `ontology-schema.json` (legacy OKB) shape — km-core's `loadOntologyFile` throws `missing meta or classes`. [VERIFIED: dist/ontology/loader.js:21-23]
- **Adding a second writer to `token-usage.db`.** Proxy is sole writer (Phase 70). Open `{ readonly: true }`.
- **Hard-blocking a headless close on a missing task_class.** D-06: write `task_class='unclassified'` + `pending:true` and exclude from queries — never crash the close path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graph persistence + JSON export | Custom LevelDB/JSON store | `GraphKMStore` | Handles LevelDB hydrate, per-domain export, atomic batch, debounced flush, events. [VERIFIED: GraphKMStore.d.ts] |
| Ontology load/validate/extends-merge | Hand JSON parsing + class resolution | `OntologyRegistry` (auto-wired when `ontologyDir` set) | Does `extends` property/relationship merging, alphabetical deterministic load, collision warnings. [VERIFIED: dist/ontology/registry.js:127-146] |
| Entity id generation | `crypto.randomUUID()` or task_id | `mintEntityId()` | km-core ids are branded UUIDv7; `getEntity`/`parseEntityId` assume it. [VERIFIED: dist/ids/mint.d.ts, parse.js] |
| token_usage open + timestamp join | New SQLite reader | `backfill-task-id-by-timestamp.mjs` pattern (`new Database(dbPath,{readonly,fileMustExist})`) | The locked, tested open pattern; also the orphan re-attribution that makes D-14 refresh necessary. [VERIFIED: scripts/backfill-task-id-by-timestamp.mjs:192-200] |
| Span archive / ended_at stamp | New close logic | proxy `stopMeasurement()` | Atomic temp-write+rename, single-reader contract. [VERIFIED: measurement-span.ts:207-230] |

**Key insight:** Phase 71 is ~90% wiring of locked contracts. The only new logic is the taxonomy heuristic + the read-only aggregation — both small, deterministic, and unit-testable.

## Runtime State Inventory

> This phase CREATES new runtime state (a second store + new config) rather than renaming existing state. No rename/migration of existing data. Listed for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | NEW: `.data/experiments/leveldb` (Run/Outcome entities). No existing data to migrate — Phase 71 starts the store empty. | Create dir on first store open (km-core mkdir's it). gitignore the leveldb; commit the `exports/*.json`. |
| Live service config | NONE consume the experiment store at runtime this phase (obs-api/wave-analysis do NOT see it — D-02). The Phase-74 dashboard will. | None now. |
| OS-registered state | NONE. The experiment store is opened on-demand per-CLI-invocation, NOT a launchd daemon (Q1). | Explicitly NO new launchd job (see Q1). |
| Secrets/env vars | NEW (optional): `LLM_PROXY_DIST_DIR` (already used by measurement CLIs), `CODING_REPO`. No secrets. | Document defaults; no key changes. |
| Build artifacts | km-core consumed from `node_modules` (no submodule build). The proxy measurement-span is consumed from the LOCAL proxy dist — if the proxy is rebuilt, the import path is unchanged. | None — no `dist/` of our own to rebuild (CLIs are `.mjs`). |

**Nothing found requiring data migration** — verified: `.data/experiments/` does not yet exist (`ls` → NOT PRESENT); this is greenfield store creation.

## Common Pitfalls

### Pitfall 1: task_id is not a valid km-core entity id
**What goes wrong:** `putEntity({ id: span.task_id, ... })` throws `SyntaxError: Not a UUIDv7` because `parseEntityId` asserts position-14 == `'7'`. [VERIFIED: dist/ids/parse.js:31-33]
**Why it happens:** D-14 says "Run keyed by task_id" — easy to read as "id = task_id".
**How to avoid:** Mint a UUIDv7 (`mintEntityId()`), store `task_id` in `metadata.task_id`, and resolve idempotency by scanning `iterate({entityType:'Run'})` for the matching `metadata.task_id` before deciding mint-vs-update.
**Warning signs:** First Run-write throws on the id parse; or duplicate Runs after a re-close.

### Pitfall 2: ontology shape mismatch (two formats coexist)
**What goes wrong:** Authoring `experiment-ontology.json` in the `name/version/type/entities` shape (matching `ontology-schema.json`) makes km-core's loader throw `Invalid ontology file: missing meta or classes` and the registry **skips the file with a stderr warning** (non-strict default) — so `entityType:'Run'` is then rejected as an unknown class. [VERIFIED: dist/ontology/loader.js:21-23, registry.js:68-73]
**Why it happens:** `coding-ontology.json` carries BOTH a top-level `meta`+`classes` (km-core) AND a `_legacy` block in the old shape; `ontology-schema.json` validates the OLD shape only. The new file must use ONLY the `meta`+`classes` shape.
**How to avoid:** Model strictly on the top-level `meta`+`classes` of `upper.json` / `coding-ontology.json`. Do NOT add `type`, `team`, `extendsOntology`, or an `entities` key. Per-class shape: `{ description, extends?, relationships: {relName: [targetClass,...]}, properties?: {propName: {type, description, ...}} }`. [VERIFIED: dist/types/ontology.d.ts:8-14]
**Warning signs:** A `[km-core/ontology-registry] skipping malformed ontology file 'experiment-ontology.json'` stderr line; `store.ontology.isValidClass('Run')` returns false.

### Pitfall 3: `relationships` is `Record<string, string[]>`, not the upper.json `_legacy` relation-object shape
**What goes wrong:** km-core's per-class `relationships` field is a map of relation-name → array-of-target-class-names (used by `getValidRelationships` and `getClassesForPrompt`). [VERIFIED: dist/types/ontology.d.ts:11, registry.js:163-165] Copying the rich `{description, sourceEntityClass, targetEntityClass, cardinality}` relation objects from upper.json's `_legacy.relationships` into a class's `relationships` will not match the consumed shape.
**How to avoid:** In each class, write `"relationships": { "produces": ["Outcome"], "groups": ["Run"] }` style. Keep relations co-located on the source class.
**Warning signs:** `getValidRelationships('Run')` returns malformed data; relations don't render in prompt formatter.

### Pitfall 4: late-attributed orphan token rows (the reason D-14 needs refresh)
**What goes wrong:** `backfill-task-id-by-timestamp.mjs` re-attributes `token_usage` rows AFTER a span closes (timestamp-join). A Run's totals computed at close time can be incomplete if some rows were still `task_id=''` then. [VERIFIED: scripts/backfill-task-id-by-timestamp.mjs:2-12]
**How to avoid:** Make `writeRun` idempotent (Pitfall 1) AND make `aggregateByTaskId` a pure recompute, so re-running the close (or a future `experiments refresh`) recomputes complete totals and `mergeAttributes`/`putEntity` updates the same Run node. The close orchestrator should optionally run the backfill sweep first.
**Warning signs:** Run token totals lower than the dashboard's per-task sum after a backfill.

### Pitfall 5: opening the store concurrently from two processes
**What goes wrong:** LevelDB is single-owner. If the obs-api daemon ever opened the experiment leveldb (it won't — D-02 keeps it out), or two CLIs run concurrently, the second `open()` errors with a lock.
**How to avoid:** The experiment store is opened on-demand per-CLI-invocation and `close()`d promptly (flushes the debounced export). Document that close orchestration and query/classify must not run concurrently against the same leveldb. This is acceptable for a low-frequency close path.
**Warning signs:** `LevelDB ... lock` / `IO error: lock held` on store open.

## Code Examples

### token_usage read-only aggregation (Q4)
```javascript
// lib/experiments/token-aggregate.mjs
// Source: scripts/backfill-task-id-by-timestamp.mjs:44-45,62-64,192-200 (open pattern),
//         _work/rapid-llm-proxy/src/token-usage.ts:122-127 (attribution columns)
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function dbPath() {
  const dir = process.env.LLM_PROXY_DATA_DIR
    || path.join(process.env.CODING_REPO || '/Users/Q284340/Agentic/coding', '.data');
  return path.join(dir, 'llm-proxy', 'token-usage.db');
}

export function aggregateByTaskId(taskId) {
  const db = new Database(dbPath(), { readonly: true, fileMustExist: true });
  try {
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens),0)     AS input_tokens,
        COALESCE(SUM(output_tokens),0)    AS output_tokens,
        COALESCE(SUM(total_tokens),0)     AS total_tokens,
        COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
        COUNT(*)                          AS calls
      FROM token_usage WHERE task_id = ?
    `).get(taskId);
    const byAgentModel = db.prepare(`
      SELECT agent, model, provider, granularity_tier,
             SUM(total_tokens) AS total_tokens, COUNT(*) AS calls
      FROM token_usage WHERE task_id = ?
      GROUP BY agent, model, provider, granularity_tier
      ORDER BY total_tokens DESC
    `).all(taskId);
    return { totals, byAgentModel };
  } finally {
    db.close();
  }
}
```
> Use the FIRST/dominant `byAgentModel` row to populate the Run's `agent`/`model` tags (Q3). Idempotent + self-healing: a re-run after a backfill recomputes complete totals (Pitfall 4).

### experiment-ontology.json skeleton (Q2 / KB-01) — km-core `meta`+`classes` shape
```jsonc
// .data/ontologies-experiment/experiment-ontology.json
// Source: dist/types/ontology.d.ts:8-23 (OntologyFile + OntologyClass shapes),
//         .data/ontologies/upper.json:2-7 (meta block), coding-ontology.json:2-7
{
  "meta": {
    "name": "experiment-ontology",
    "version": "1.0.0",
    "extends": "upper",
    "description": "Performance-measurement experiment KB: Run/Outcome materialized v0; Route/Step/Decision/Report schema-only stubs; Experiment optional grouping."
  },
  "classes": {
    "Experiment": {
      "extends": "Feature",
      "description": "An OPTIONAL named grouping of Runs (e.g. 'opus-vs-haiku-refactor-sweep'). Not required to write a Run (D-04); populated lazily.",
      "relationships": { "groups": ["Run"] },
      "properties": {
        "experimentName": { "type": "string", "description": "Human-readable grouping name" }
      }
    },
    "Run": {
      "extends": "Revision",
      "description": "A single coding-agent task run, materialized at close. The queryable unit (D2). Carries 8 tags sourced from token_usage + span.",
      "relationships": { "produces": ["Outcome"], "tookRoute": ["Route"], "belongsTo": ["Experiment"] },
      "properties": {
        "taskId":     { "type": "string", "description": "Measurement span task_id (idempotency key; stored also as metadata.task_id)" },
        "taskHash":   { "type": "string", "description": "Stable hash of goal_sentence/prompt" },
        "taskClass":  { "type": "string", "description": "Curated taxonomy class OR 'unclassified' (quarantine)",
                        "enum": ["refactor","bugfix","new-feature","migration","debug","docs","unclassified"] },
        "agent":      { "type": "string", "description": "Originating coding agent" },
        "model":      { "type": "string", "description": "Resolved model name" },
        "framework":  { "type": "string", "description": "Agent framework/harness" },
        "specLevel":  { "type": "string", "description": "Spec level (deferred — written null this phase)" },
        "snapshotId": { "type": "string", "description": "Phase-67 repro snapshot id (deferred — null)" },
        "traceId":    { "type": "string", "description": "Correlation id (== task_id this phase)" },
        "pending":    { "type": "boolean", "description": "Quarantine flag — excluded from queries until classified (D-06)" }
      }
    },
    "Route":   { "extends": "Process",  "description": "The sequence of steps a Run took (schema-only stub; populated Phase 72).", "relationships": { "hasStep": ["Step"] }, "properties": {} },
    "Step":    { "extends": "Process",  "description": "One step in a Route (schema-only stub; Phase 72).", "relationships": { "madeDecision": ["Decision"] }, "properties": {} },
    "Decision":{ "extends": "Contract", "description": "A decision point within a Step (schema-only stub; Phase 73).", "relationships": {}, "properties": {} },
    "Outcome": {
      "extends": "Contract",
      "description": "Run result. v0 stub: token totals + closed-state only (D-12). No route/score (Phases 72-73).",
      "relationships": {},
      "properties": {
        "totalTokens":     { "type": "number", "description": "Sum of total_tokens for the Run's task_id" },
        "inputTokens":     { "type": "number", "description": "Sum input_tokens" },
        "outputTokens":    { "type": "number", "description": "Sum output_tokens" },
        "reasoningTokens": { "type": "number", "description": "Sum reasoning_tokens" },
        "closedState":     { "type": "string", "description": "Close state", "enum": ["closed","quarantined"] }
      }
    },
    "Report": { "extends": "Feature", "description": "Saved query + stable results snapshot (schema-only stub; Phase 74 KB-04).", "relationships": {}, "properties": {} }
  }
}
```
> `extends` targets (`Feature`,`Revision`,`Process`,`Contract`) are upper.json classes — the registry merges parent `properties`+`relationships` into the child. [VERIFIED: registry.js:127-146; upper.json class list] If a cleaner base is wanted, classes may also be authored with NO `extends` (the registry handles absent-extends fine). Recommend extending upper classes so the experiment store stays consistent with the repo's ontology conventions.

### task-taxonomy.yaml (Q6 / D-10 / KB-03)
```yaml
# config/task-taxonomy.yaml — single source of truth (D-10).
# Read by: write-path validator (closed-6 enforcement D-09),
#          verb→class heuristic (D-11), and doc rendering.
version: 0
classes:
  refactor:
    definition: "Restructure existing code without changing externally observable behavior."
    keywords: [refactor, restructure, rename, extract, cleanup, simplify, deduplicate, reorganize]
  bugfix:
    definition: "Correct a defect so existing intended behavior works."
    keywords: [fix, bug, defect, repair, hotfix, patch, resolve, broken, regression]
  new-feature:
    definition: "Add new externally observable capability."
    keywords: [add, build, implement, create, introduce, feature, support, enable, new]
  migration:
    definition: "Move/convert code, data, or config from one system/format/version to another."
    keywords: [migrate, migration, upgrade, port, convert, move, cutover, transition]
  debug:
    definition: "Investigate/diagnose a problem (root-cause) without necessarily shipping a fix."
    keywords: [debug, investigate, diagnose, trace, reproduce, troubleshoot, analyze]
  docs:
    definition: "Author or update documentation."
    keywords: [docs, doc, documentation, readme, comment, changelog, guide, tutorial]
```

### verb→class heuristic (Q5 / D-11, zero-LLM)
```javascript
// lib/experiments/taxonomy.mjs (deriveClassFromText excerpt)
// Source: config/task-taxonomy.yaml keywords (D-10). Deterministic; no LLM.
export function deriveClassFromText(text, taxonomy) {
  const toks = String(text).toLowerCase().match(/[a-z][a-z-]+/g) ?? [];
  const tokenSet = new Set(toks);
  let best = null, bestScore = 0;
  for (const [cls, def] of Object.entries(taxonomy.classes)) {
    let score = 0;
    for (const kw of def.keywords) {
      if (kw.includes('-')) { if (text.toLowerCase().includes(kw)) score += 2; } // multiword/hyphenated literal
      else if (tokenSet.has(kw)) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = cls; }
  }
  return bestScore > 0 ? { taskClass: best, confident: bestScore >= 1 } : { taskClass: null, confident: false };
}
```
> **Tokenization:** lowercase, split on word boundaries, hyphenated keywords matched as substrings (so "new-feature" hints and multiword phrases survive). **/gsd input:** concatenate phase name + goal sentence (+ PLAN.md goal line if available). **Disambiguation precedence** (when scores tie or both match): the close orchestrator presents the top candidate for operator confirm (D-05). On headless+unconfident → `unclassified` + `pending` (D-06).

### Run + Outcome stub write with relation (Q8 / D-12)
```javascript
// inside writeRun (after the Run putEntity above)
import { mintEntityId } from '@fwornle/km-core';
const outcomeId = mintEntityId();
await store.putEntity({
  id: outcomeId, name: `${span.task_id}-outcome`, entityType: 'Outcome', layer: 'evidence',
  description: 'v0 token-totals + closed-state stub',
  metadata: {
    totalTokens: totals.total_tokens, inputTokens: totals.input_tokens,
    outputTokens: totals.output_tokens, reasoningTokens: totals.reasoning_tokens,
    closedState: pending ? 'quarantined' : 'closed',
  },
}, { provenance });
await store.addRelation({ type: 'produces', from: runId, to: outcomeId });
```

### query CLI canned queries (Q9 / D-03)
```javascript
// scripts/experiments-query.mjs (excerpt)
// runs-by-task_class (EXCLUDES quarantine per D-06):
const runs = [];
for await (const e of store.iterate({ entityType: 'Run' })) {
  if (e.metadata?.pending === true) continue;            // D-06 exclusion
  if (filterClass && e.metadata?.task_class !== filterClass) continue;
  if (filterAgent && e.metadata?.agent !== filterAgent) continue;
  runs.push(e);
}
// agent-vs-model cost: group runs by (agent, model), sum Outcome.totalTokens.
```
> Both query and classify CLIs open the store via `openExperimentStore()` (Pattern 1) — satisfying the mandatory-`ontologyDir` acceptance grep.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single shared GraphKMStore for everything | Per-domain dedicated stores (object-form constructor, caller-supplied paths) | km-core 0.1.0 (Phase 37 D-14) | A second store is a SUPPORTED first-class pattern, not a hack — every path is caller-supplied; no cwd magic. |
| Ontology as `name/version/type/entities` (OKB/`ontology-schema.json`) | `meta`+`classes` `OntologyFile` (km-core loader) | km-core Phase 38 | New ontology MUST use `meta`+`classes`; the old schema validator no longer governs km-core loads. |
| `task_id` as primary key | UUIDv7 entity id + `metadata.task_id`/`legacyId` lookup | km-core 0.1.0 | Idempotency via metadata scan, not id reuse. |

**Deprecated/outdated:**
- `.data/ontologies/schemas/ontology-schema.json` — does NOT validate km-core's loaded shape; it governs the `_legacy` block / OKB tooling only. Do not validate `experiment-ontology.json` against it.
- `exportToJson` / `resolveTokenExportPath` (proxy) — `@deprecated` in favor of per-window exports; irrelevant to this phase (we only READ the DB). [VERIFIED: token-usage.ts:160-174]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The /gsd run-end auto-invocation point exists (or can be added) as a hook that calls `coding measure stop`. The repo's `/gsd` commands live under a commands dir not found in `.claude/commands/` (empty for gsd). | Q7 | If no clean hook exists, /gsd auto-derive (D-05) degrades to manual `coding measure stop` invocation. The CLI itself is unaffected; only the auto-invocation wiring is at risk. **Planner: confirm the /gsd run-end hook surface with the user, or scope D-05 auto-invoke as a follow-up.** |
| A2 | `framework` tag source: span `meta` or agent type. No explicit `framework` column exists in token_usage; `agent` is the closest concrete source. | Q3 | If `framework` must be distinct from `agent`, it may be null this phase (allowed by D-13). Low risk — D-13 permits null. |
| A3 | `task_hash` = `sha256(goal_sentence || prompt_preview)`. `goal_sentence` is optional on the span; `prompt_preview` exists per-row in token_usage. | Q3 | If neither present, task_hash is null (D-13 permits). Low risk. |
| A4 | Copying `upper.json` into a dedicated `.data/ontologies-experiment/` dir is acceptable (vs. symlink or pointing ontologyDir at the shared dir). | Q1/structure | If the team prefers one ontology dir, point `ontologyDir` at `.data/ontologies/` and accept that coding-ontology classes also load into the experiment registry (harmless for validation). Low risk — both work; copy is cleaner per D-02. |
| A5 | `coding measure stop` / `coding experiments ...` are invoked as `node scripts/<name>.mjs` (matching the existing `measurement-start/stop.mjs` precedent), NOT as `bin/coding` subcommands (bin/coding is a bash agent-launcher with no subcommand dispatch). | Q7/Q9 | If the user wants true `bin/coding` subcommand dispatch, that bash router is additional (small) work. Medium risk on naming/UX, none on functionality. **Planner: confirm CLI invocation surface.** |

## Open Questions

1. **/gsd run-end hook point (A1/A5).**
   - What we know: the existing measurement CLIs are `node scripts/*.mjs`; `bin/coding` is a bash launcher with no subcommand dispatch; `.claude/commands/` has no gsd entries in this checkout.
   - What's unclear: the exact auto-invocation hook at /gsd run-end.
   - Recommendation: ship the close orchestrator as `scripts/measurement-stop.mjs` (extended) callable manually + by any hook; treat the auto-invoke wiring as a thin add-on the planner confirms with the user. Functionality (derive→enforce→write) does not depend on the auto-invoke.

2. **Optional pre-close backfill sweep.**
   - What we know: orphan rows get re-attributed post-close (Pitfall 4); D-14 wants refreshable totals.
   - Recommendation: have the close orchestrator optionally run `runSweep` (imported from `backfill-task-id-by-timestamp.mjs`, which guards its `main()`) before aggregating, and make aggregation a pure recompute so a future `experiments refresh` self-heals.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@fwornle/km-core` | store + ontology + ids | ✓ | 0.1.0 | — |
| `@rapid/llm-proxy` (local dist) | `stopMeasurement` | ✓ | 2.0.0 | `LLM_PROXY_DIST_DIR` override |
| `better-sqlite3` | token aggregation | ✓ | (proxy/backfill dep) | — |
| `yaml` / `js-yaml` | taxonomy config parse | ✓ | both present | use JSON config instead |
| `token-usage.db` | aggregation source | ✓ (created by running proxy) | — | aggregation returns zeros if absent (handle gracefully) |
| `.data/measurements/<task_id>.json` | span metadata | ✓ (written by stopMeasurement) | — | close orchestrator writes it via stopMeasurement |

**Missing dependencies with no fallback:** none — all required surfaces are present.

## Validation Architecture

> nyquist_validation is not disabled in `.planning/config.json` (key absent → enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (the repo + proxy convention; backfill self-test uses it) [VERIFIED: backfill-task-id-by-timestamp.mjs:218-219] |
| Config file | none — `node --test <file>` (NOTE the argv gotcha, see Wave 0) |
| Quick run command | `node --test tests/experiments/*.test.mjs` |
| Full suite command | `node --test tests/experiments/` |

### Phase Requirements → Test Map (observable signals proving SC-1..SC-4)
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 / KB-01 | Ontology defines 7 classes; loads without skip-warn; `store.ontology.getAllClassNames()` ⊇ {Experiment,Run,Route,Step,Decision,Outcome,Report} | unit | `node --test tests/experiments/ontology.test.mjs` | ❌ Wave 0 |
| SC-2 / KB-02 | A real span close materializes a Run with all 8 tags; agent/model/totals come from token_usage (not invented); re-close updates same node (idempotent) | integration | `node --test tests/experiments/run-write.test.mjs` | ❌ Wave 0 |
| SC-3 / KB-03 | Taxonomy config loads 6 classes each with a non-empty definition; `deriveClassFromText('migrate the db')==='migration'` etc. | unit | `node --test tests/experiments/taxonomy.test.mjs` | ❌ Wave 0 |
| SC-4 / KB-03 | A free-string class is rejected at write; a headless close with no class writes `task_class='unclassified'`+`pending:true`; `experiments query` EXCLUDES pending rows; `experiments classify` flips pending→false and re-includes | integration | `node --test tests/experiments/enforcement.test.mjs` | ❌ Wave 0 |
| KB-02 idemp. | token aggregation is read-only (`{readonly:true}`) and a re-run after a simulated backfill recomputes complete totals | unit | `node --test tests/experiments/token-aggregate.test.mjs` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test tests/experiments/<touched>.test.mjs`
- **Per wave merge:** `node --test tests/experiments/`
- **Phase gate:** Full experiments suite green + a LIVE blocking human-verify (mirror Phase 69/70): prove a real `coding measure stop` lands a Run in `.data/experiments/` with the enforced `task_class` + correct token totals, AND a headless run with no class lands in quarantine and is excluded from `experiments query` (specifics §"Specific Ideas" in CONTEXT.md).

### Wave 0 Gaps
- [ ] `tests/experiments/ontology.test.mjs` — covers SC-1/KB-01 (load + 7 classes + no skip-warn + isValidClass('Run'))
- [ ] `tests/experiments/taxonomy.test.mjs` — covers SC-3/KB-03 (6 defs + verb→class map)
- [ ] `tests/experiments/token-aggregate.test.mjs` — covers KB-02 read-only + recompute (use a temp DB fixture, mirror backfill self-test)
- [ ] `tests/experiments/run-write.test.mjs` — covers SC-2/KB-02 (8 tags + idempotency; use a temp store dir + temp ontologyDir)
- [ ] `tests/experiments/enforcement.test.mjs` — covers SC-4 (reject free string; quarantine; query-exclusion; classify re-include)
- [ ] Test fixtures: a synthetic archived span JSON + a seeded temp token-usage.db (reuse backfill self-test's temp-DB pattern)
- [ ] **argv gotcha guard** (MEMORY.md): `node --test <file> --live` drops trailing argv per-file; gate any live-only test on an env var (e.g. `EXPERIMENTS_LIVE=1`), NOT a CLI flag.

## Security Domain

> security_enforcement not disabled in config (absent → enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local CLI; no auth surface. |
| V3 Session Management | no | — |
| V4 Access Control | no | Local filesystem store; no remote access this phase. |
| V5 Input Validation | yes | task_id already sanitized by proxy `sanitizeTaskId` (charset `[A-Za-z0-9._-]`, basename'd) before it reaches the span file. [VERIFIED: measurement-span.ts:83-102] task_class validated against the closed-6 enum (D-09). SQL aggregation uses PARAMETERIZED `?` binds only — never string interpolation (mirrors backfill/getSummary invariant). |
| V6 Cryptography | no | `task_hash` is a non-security content hash (sha256 for stable identity, not secrecy). |

### Known Threat Patterns for {Node CLI + SQLite read}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via task_id in aggregation | Tampering | Parameterized `WHERE task_id = ?` (never interpolate). [VERIFIED: backfill runSweep:134-147 uses bound params] |
| Path traversal via task_id in filenames | Tampering | Proxy already sanitizes + basenames task_id before archive; coding reads the archived file by sanitized name. [VERIFIED: measurement-span.ts:83-102, 218-221] |
| Second writer corrupting token-usage.db | Tampering/DoS | Open `{ readonly: true }` — coding never writes the proxy DB. |
| Free-string task_class polluting WHERE-clause partitions | Integrity | Closed-6 enum validation at write (D-09); quarantine for unknowns (D-06). |

## Sources

### Primary (HIGH confidence)
- `node_modules/@fwornle/km-core/dist/store/GraphKMStore.d.ts` — constructor `GraphKMStoreOptions` (:12-44), `putEntity` strict-path provenance/ontology validation (:165-185), `get ontology()` (:70-80), `iterate`/`findByOntologyClass`/`mergeAttributes`.
- `node_modules/@fwornle/km-core/dist/ontology/loader.js` (:18-25) + `registry.js` (:46-74, 127-146, 163-165) — `meta`+`classes` requirement, upper.json-mandatory + every-other-json-as-lower discovery, `extends` merge, `relationships` as `Record<string,string[]>`.
- `node_modules/@fwornle/km-core/dist/types/ontology.d.ts` (:8-23) — `OntologyFile` / `OntologyClass` shapes.
- `node_modules/@fwornle/km-core/dist/types/entity.d.ts` (:9-14, 82-145) — `ProvenanceStamp`, `Entity`, `metadata`/`legacyId`.
- `node_modules/@fwornle/km-core/dist/ids/parse.js` (:23-34) + `mint.d.ts` — UUIDv7 id contract (task_id is NOT valid).
- `node_modules/@fwornle/km-core/dist/ontology/defaultDir.js` (:18-23, 45-47) — `import.meta`/walk-to-root + `KM_ONTOLOGY_DIR` override pattern.
- `_work/rapid-llm-proxy/src/measurement-span.ts` — `stopMeasurement` (:207-230), `SpanRecord` (:42-48), `sanitizeTaskId` (:83-102), `resolveMeasurementPaths` (:57-70).
- `_work/rapid-llm-proxy/src/token-usage.ts` — `TokenUsageRow` + attribution columns (:83-128), schema (:384-405, 549-567), read-only summary patterns (:852-1122).
- `_work/rapid-llm-proxy/src/index.ts` (:27-30) — barrel re-export of `stopMeasurement`/`SpanRecord`.
- `scripts/backfill-task-id-by-timestamp.mjs` — `better-sqlite3` open pattern (:44-45, 192-200), `runSweep` parameterized (:131-173), node:test self-test (:218-274), import-guard (:281-289).
- `scripts/measurement-start.mjs` / `measurement-stop.mjs` — the LOCAL-dist import precedent + CLI shape (:25-42).
- `.data/ontologies/upper.json` / `coding-ontology.json` — `meta`+`classes` template + `_legacy` coexistence.
- `.data/ontologies/schemas/ontology-schema.json` — the LEGACY (non-km-core) shape (do not validate against).
- `.data/measurements/telem-live-68.json` — concrete archived span shape.
- `.planning/REQUIREMENTS.md` (KB-01..03), `.planning/ROADMAP.md` §Phase 71 (4 SCs), `.planning/notes/v73-perf-measurement-exploration.md` (D2 rationale).

### Secondary (MEDIUM confidence)
- `bin/coding` (bash launcher — no subcommand dispatch; informs A5).
- `.planning/config.json` (nyquist + security enforcement state).

### Tertiary (LOW confidence)
- /gsd run-end hook location (A1) — not found in this checkout's `.claude/commands/`; needs user confirmation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library version verified from installed package.json + source.
- Architecture (second store, ontology, aggregation, idempotency): HIGH — read directly from km-core dist + proxy src; pitfalls verified against the id-parse + loader code.
- task_class heuristic + taxonomy config: HIGH design, MEDIUM exact-keyword tuning (the keyword lists are a recommended starting set; the operator-confirm loop (D-05) absorbs mismatches).
- /gsd auto-invoke hook + CLI invocation surface: MEDIUM — functionality is independent; only the auto-wiring/naming needs user confirmation (A1/A5).

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (km-core 0.1.0 + proxy 2.0.0 are pinned local builds — stable)

## RESEARCH COMPLETE

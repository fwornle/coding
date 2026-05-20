# Phase 38: Ontology Registry — Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 11 (4 create-new sources + 5 fixture files + 2 modify-existing in km-core; 1 modify-existing test)
**Analogs found:** 10 / 11 (1 net-new: synthetic `coding-ontology.json` fixture)

Phase 38 is an **almost-pure extraction** from OKM, parallel in shape to Phase 37's relationship with OKM. The base implementation lives at:

- OKM `src/ontology/registry.ts` (86 lines) — adopt as base with D-26..D-29 deltas
- OKM `src/ontology/loader.ts` (13 lines) — adopt almost verbatim
- OKM `src/types/ontology.ts` (29 lines) — adopt verbatim (no `EntityId` brand needed; class names are plain strings)
- OKM `tests/unit/ontology-loader.test.ts` (237 lines) — shape reference for vitest harness; class-count expectations change per Phase 38 fixtures
- OKM `ontology/{upper,kpifw,business,raas}.json` — copy verbatim into km-core `tests/fixtures/ontology/`

The km-core target shape (from Phase 37 Plan 04 SUMMARY + on-disk inspection) is authoritative for file layout, imports, and barrel patterns.

**Verified on disk at /Users/Q284340/Agentic/km-core/ as of 2026-05-20:**
- `src/` has `events/`, `ids/`, `store/`, `types/`, `validation/` (NO `ontology/` yet — Phase 38 creates it)
- `src/index.ts` is the root barrel (47 lines, already exports `OntologyValidator` + `noopOntologyValidator`)
- `src/types/index.ts` is a sub-barrel pattern (the only one — `ids/` and `validation/` use direct file imports, no `index.ts`)
- `src/validation/ontology.ts` (27 lines) declares the `OntologyValidator` interface that Phase 38's registry must satisfy
- `src/store/GraphKMStore.ts` (455 lines) — constructor at lines 124-136, putEntity validator call at line 241

## File Classification

### Source code (new — `~/Agentic/km-core/src/ontology/`)

| Action | Target | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| CREATE | `src/ontology/registry.ts` | service (registry class) | request-response (sync map lookup) | OKM `src/ontology/registry.ts` (86 lines) | EXACT (with D-26..D-29 deltas) |
| CREATE | `src/ontology/loader.ts` | utility (file-I/O reader) | file-I/O | OKM `src/ontology/loader.ts` (13 lines) | EXACT (adopt verbatim or inline into registry) |
| CREATE | `src/ontology/index.ts` (sub-barrel) | barrel | n/a | km-core `src/types/index.ts` (the only existing sub-barrel) | EXACT pattern |
| CREATE | `src/types/ontology.ts` | model (types) | n/a | OKM `src/types/ontology.ts` (29 lines) | EXACT (verbatim) |

### Source code (modify — existing km-core files)

| Action | Target | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| MODIFY | `src/index.ts` (root barrel) | barrel | n/a | self (current 47-line file) — add ontology re-exports following the existing pattern | EXACT |
| MODIFY | `src/store/GraphKMStore.ts` | service | CRUD + event-driven | self (lines 87-136 constructor; line 241 validate call) — add `ontologyDir?` to options, instantiate registry, expose `ontology` getter, auto-wire registry-backed validator | EXACT (incremental) |
| MODIFY | `src/validation/ontology.ts` | service interface | request-response | self (current 27-line file) — add `registryBackedValidator(registry)` factory; keep `noopOntologyValidator` as fallback | EXACT (additive) |

### Tests (new + modify in `~/Agentic/km-core/tests/`)

| Action | Target | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| CREATE | `tests/unit/ontology-registry.test.ts` | test (unit) | request-response | OKM `tests/unit/ontology-loader.test.ts` (237 lines, shape reference) + km-core `tests/unit/graph-store.test.ts` (vitest-with-tmpdir pattern) | composite |
| MODIFY | `tests/unit/graph-store.test.ts` | test (unit) | request-response | self (lines 184-216 strict-validation test) — add a sibling test using a real fixture-directory-based registry | EXACT (additive) |

### Fixtures (new — `~/Agentic/km-core/tests/fixtures/ontology/`)

| Action | Target | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| CREATE | `tests/fixtures/ontology/upper.json` | fixture | n/a | OKM `ontology/upper.json` (7809 bytes, 13 classes) | EXACT (copy verbatim) |
| CREATE | `tests/fixtures/ontology/kpifw.json` | fixture | n/a | OKM `ontology/kpifw.json` (2899 bytes, 5 classes, `meta.extends: "upper"`) | EXACT (copy verbatim) |
| CREATE | `tests/fixtures/ontology/business.json` | fixture | n/a | OKM `ontology/business.json` (3608 bytes, 5 classes) | EXACT (copy verbatim) |
| CREATE | `tests/fixtures/ontology/raas.json` | fixture | n/a | OKM `ontology/raas.json` (2889 bytes, 6 classes) | EXACT (copy verbatim) |
| CREATE | `tests/fixtures/ontology/coding-ontology.json` | fixture (synthetic) | n/a | B's `component-manifest.yaml` (semantic shape only) + OKM `kpifw.json` (JSON shape) | composite (NET-NEW JSON ontology, B-shape semantics) |

---

## Pattern Assignments

### `src/ontology/loader.ts` (utility, file-I/O — CREATE)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/loader.ts` (full file, 13 lines — adopt VERBATIM with import-path delta)

**Full excerpt to adapt (entire file):**

```typescript
import { readFileSync } from 'node:fs';
import type { OntologyFile } from '../types/ontology.js';

export function loadOntologyFile(path: string): OntologyFile {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as OntologyFile;

  if (!parsed.meta || !parsed.meta.name || !parsed.classes) {
    throw new Error(`Invalid ontology file at ${path}: missing meta or classes`);
  }

  return parsed;
}
```

**DELTAS vs OKM analog:** None functional — the file is generic. Only the `.js` extension on the import is already NodeNext-compatible (matches Phase 37 CF-D06).

**Landmines:**
- OKM uses **sync** `readFileSync`. CF-D14 says km-core's *store methods* are all async, but registry load is intentionally **sync** (Phase 37 SUMMARY line 47: "registry is sync (in-memory map) but exposed via async store API for consistency"). Keep the sync read here; only the calling `store.open()` is async.
- The `throw new Error(...)` is the canonical shape — do NOT swallow this; D-29 atomicity says one bad file shouldn't block the rest, but that's the **registry's** concern, not the loader's. Loader throws; registry catches and warns.

---

### `src/ontology/registry.ts` (service, registry class — CREATE)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/registry.ts` (full file, 86 lines — adopt as base with 5 deltas)

**Class skeleton + imports (lines 1-9 of analog):**

```typescript
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { loadOntologyFile } from './loader.js';
import type { OntologyFile, ResolvedClass } from '../types/ontology.js';

export class OntologyRegistry {
  private classes = new Map<string, ResolvedClass>();
  private loadedDomains = new Set<string>();
  // ...
}
```

**Auto-discovery + load pattern (lines 10-28 of analog) — the core algorithm to preserve:**

```typescript
load(ontologyDir: string): void {
  const upper = loadOntologyFile(join(ontologyDir, 'upper.json'));
  this.registerClasses(upper, 'upper');
  this.loadedDomains.add('upper');

  // Dynamically discover all other .json ontology files in the directory
  const files = readdirSync(ontologyDir).filter(
    (f) => f.endsWith('.json') && f !== 'upper.json',
  );
  for (const file of files.sort()) {              // ← alphabetical order is the D-27 contract
    try {
      const lower = loadOntologyFile(join(ontologyDir, file));
      this.registerClasses(lower, lower.meta.name);
      this.loadedDomains.add(lower.meta.name);
    } catch {                                     // ← DELTA: replace with stderr warn (D-27)
      // Lower ontology files are optional; warn but continue
    }
  }
}
```

**Extends + property merging (lines 35-52 of analog) — ONTO-02 implementation:**

```typescript
private registerClasses(file: OntologyFile, source: string): void {
  for (const [name, classDef] of Object.entries(file.classes)) {
    let merged = { ...classDef };

    if (classDef.extends) {
      const parent = this.classes.get(classDef.extends);
      if (parent) {
        merged = {
          ...classDef,
          relationships: { ...parent.relationships, ...classDef.relationships },
          properties: { ...parent.properties, ...classDef.properties },
        };
      }
    }

    this.classes.set(name, { ...merged, name, source });   // ← DELTA: emit collision warn (D-27)
  }
}
```

**Public lookup API (lines 54-85 of analog) — keep all 6 methods:**

```typescript
isValidClass(className: string): boolean { return this.classes.has(className); }
getClass(className: string): ResolvedClass | undefined { return this.classes.get(className); }
getAllClassNames(): string[] { return Array.from(this.classes.keys()); }
getDefaultLayer(className: string): 'evidence' | 'pattern' | undefined { /* ... */ }
getValidRelationships(className: string): Record<string, string[]> | undefined { /* ... */ }
getLoadedDomains(): string[] { return Array.from(this.loadedDomains); }
// getClassesForPrompt() — keep verbatim; LLM-context formatter used by Phase 40/42
```

**DELTAS the executor must apply (per CONTEXT.md D-26..D-29 + canonical-refs section):**

1. **Constructor-injected `ontologyDir`** (D-28) — replace OKM's free `load(ontologyDir)` method with an options-object constructor pattern matching Phase 37 D-14:

   ```typescript
   export interface OntologyRegistryOptions {
     ontologyDir: string;
     /** When true, malformed JSON files throw instead of warn+skip.
      *  Default: false (CONTEXT.md "Claude's Discretion" — atomic build per D-29). */
     strict?: boolean;
   }

   export class OntologyRegistry {
     private readonly ontologyDir: string;
     private readonly strict: boolean;
     private classes = new Map<string, ResolvedClass>();
     private loadedDomains = new Set<string>();

     constructor(opts: OntologyRegistryOptions) {
       this.ontologyDir = opts.ontologyDir;
       this.strict = opts.strict ?? false;
       this.loadFromDisk();
     }
     // ...
   }
   ```

2. **Add `reload()` method** (D-29) — atomic rebuild (build new maps fully, then swap):

   ```typescript
   /**
    * Re-scan ontologyDir and rebuild the class catalog atomically.
    * D-29: no fs.watch; consumer explicitly calls this on SIGHUP / UI
    * reload button / test fixture swap.
    *
    * Atomic: new maps are built fully before swapping. A concurrent
    * findByOntologyClass() sees either the old or the new — never half.
    */
   async reload(): Promise<void> {
     const newClasses = new Map<string, ResolvedClass>();
     const newDomains = new Set<string>();
     // ... (same body as loadFromDisk but writing to local maps) ...
     this.classes = newClasses;
     this.loadedDomains = newDomains;
   }
   ```

   Note: `reload()` is async to match Phase 37's "store methods are async" idiom even though the underlying ops are sync — leaves room for v0.2 to add a non-blocking impl.

3. **Replace silent `try/catch{}` with `process.stderr.write(...)`** (D-27 + repo-wide `no-console-log` constraint). OKM's line 24 has an empty catch; Phase 38 must emit:

   ```typescript
   } catch (err: unknown) {
     if (this.strict) throw err;
     const msg = err instanceof Error ? err.message : String(err);
     process.stderr.write(`[km-core/ontology-registry] skipping malformed ontology file '${file}': ${msg}\n`);
   }
   ```

4. **Emit collision warning when overwriting** (D-27) — wrap the `this.classes.set(name, ...)` in `registerClasses` with a prior-value check:

   ```typescript
   const prev = this.classes.get(name);
   if (prev && prev.source !== source) {
     process.stderr.write(
       `[km-core/ontology-registry] class '${name}' redefined: ${prev.source} → ${source} (last-loaded wins; see D-27 in 38-CONTEXT.md)\n`
     );
   }
   this.classes.set(name, { ...merged, name, source });
   ```

   The warning text is the suggested form from CONTEXT.md §Specific Ideas — keeps the doc-pointer in the operator-visible diagnostic.

5. **Expose extension provenance and parent-chain traversal** — per CONTEXT.md domain section bullet 3 ("extension provenance, list of loaded domains"). Add:

   ```typescript
   /** Returns the chain of parents (closest first), via the `extends` field. */
   parentChainOf(className: string): ResolvedClass[] {
     const chain: ResolvedClass[] = [];
     let cur = this.classes.get(className);
     while (cur?.extends) {
       const parent = this.classes.get(cur.extends);
       if (!parent) break;
       chain.push(parent);
       cur = parent;
     }
     return chain;
   }

   /** Returns the domain name of the file that registered this class. */
   provenanceOf(className: string): string | undefined {
     return this.classes.get(className)?.source;
   }

   /** Read-only view onto the resolved class catalog. */
   get classCatalog(): ReadonlyMap<string, ResolvedClass> {
     return this.classes;
   }

   /** Read-only view onto the loaded domain set. */
   get domains(): ReadonlySet<string> {
     return this.loadedDomains;
   }
   ```

**Landmines:**

- **OKM's silent catch** (line 24) is the exact pattern D-27 calls out as the improvement target. Do NOT carry it forward.
- **OKM does NOT emit collision warnings** — D-27 is a *behavioral upgrade*, not a bug-fix preservation. The test must assert the warning is emitted (via `vi.spyOn(process.stderr, 'write')`).
- **Alphabetical sort of lower files** (`files.sort()` at OKM line 19) is the D-27 deterministic-load-order contract. Preserve verbatim.
- **`upper.json` is mandatory**; lower ontologies are optional (OKM line 11 throws if `upper.json` is missing; lines 19-26 catch on lower files). Phase 38 keeps this contract — but D-29 atomicity may want to make upper-missing also non-fatal (planner decides; CONTEXT.md leaves it open under "Claude's Discretion").
- **No-console-log constraint** is repo-wide; the registry MUST use `process.stderr.write()` not `console.warn`/`console.error`. Phase 37 carried this through; Phase 38 must continue.
- **CONTEXT.md "Claude's Discretion"** flags 3 edge cases for the planner: per-class `extends` chains resolution timing (OKM resolves at load-time — adopt), property-type conflicts (child wins, no validation), malformed JSON (skip+warn with `strict: true` opt-in per the constructor option above).

---

### `src/types/ontology.ts` (model, types — CREATE)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/types/ontology.ts` (full file, 29 lines — adopt VERBATIM)

**Full file to adopt:**

```typescript
export interface OntologyProperty {
  type: string;
  required?: boolean;
  enum?: string[];
  format?: string;
}

export interface OntologyClass {
  extends?: string;
  description: string;
  relationships: Record<string, string[]>;
  properties?: Record<string, OntologyProperty>;
  defaultLayer?: 'evidence' | 'pattern';
}

export interface OntologyFile {
  meta: {
    name: string;
    version: string;
    extends?: string;
    description: string;
  };
  classes: Record<string, OntologyClass>;
}

export interface ResolvedClass extends OntologyClass {
  name: string;
  source: string;
}
```

**DELTAS vs OKM analog:** NONE. Class names are plain strings, not entity ids — no `EntityId` brand needed (CONTEXT.md task description initially mentioned brand where applicable; on inspection NONE applies — ontology classes are not entities).

**Landmines:**

- The `defaultLayer: 'evidence' | 'pattern'` literal union must match km-core's `Layer` type from `src/types/entity.ts`. Phase 37 Plan 02 defined `Layer = 'evidence' | 'pattern'`. Either import-and-reuse (`import type { Layer } from './entity.js'`) or keep the inline literal — recommend **import-and-reuse** to keep a single source of truth.
- The `extends?: string` on `OntologyClass` is the per-class chain (e.g. `KPIPipeline extends Pipeline`); the `extends?: string` on `OntologyFile.meta` is the ontology-level inheritance declaration (e.g. `kpifw extends upper`). Two different fields, same name — preserve both.

---

### `src/ontology/index.ts` (barrel — CREATE)

**Analog:** `/Users/Q284340/Agentic/km-core/src/types/index.ts` (the only existing sub-barrel — 21 lines, see Phase 37 layout)

**Excerpt of the analog pattern:**

```typescript
// Barrel re-exports for the `src/types/` module.
//
// `EntityId` is re-exported here (it logically belongs with the entity shape
// even though it lives in `src/ids/branded.ts`) so consumers can do a single
// `import type { Entity, EntityId } from '@fwornle/km-core/types'` if they
// only need the type surface.

export type {
  Entity, Relation, Layer, SerializedGraph,
  /* ...provenance subtypes... */
} from './entity.js';

export type { EntityId } from '../ids/branded.js';
```

**File to create:**

```typescript
// Barrel re-exports for the `src/ontology/` module (Phase 38).
//
// Consumers needing the full registry surface in one import:
//   import { OntologyRegistry } from '@fwornle/km-core/ontology';
//   import type { OntologyClass, ResolvedClass } from '@fwornle/km-core/ontology';

export { OntologyRegistry } from './registry.js';
export type { OntologyRegistryOptions } from './registry.js';
export { loadOntologyFile } from './loader.js';
export type {
  OntologyFile,
  OntologyClass,
  OntologyProperty,
  ResolvedClass,
} from '../types/ontology.js';
```

**DELTAS vs analog:** None — same shape, different module surface.

**Landmines:**

- Phase 37's `src/ids/` and `src/validation/` do NOT have an `index.ts` (verified on disk). Only `src/types/` does. The root barrel `src/index.ts` exports directly from the leaf files (e.g. `from './ids/branded.js'`, `from './validation/ontology.js'`). Phase 38 has a choice:
  - **Option A** (recommended): add `src/ontology/index.ts` to keep the surface tidy when consumers want JUST the registry.
  - **Option B**: skip the sub-barrel, have the root `src/index.ts` re-export directly from leaves (matches `ids/`/`validation/` precedent).
  - CONTEXT.md task description names `src/ontology/index.ts` explicitly → **go with Option A**, and treat the existing `types/index.ts` as the analog precedent.

---

### `src/index.ts` (root barrel — MODIFY)

**Analog:** SAME FILE — the existing 47-line root barrel that already exports `OntologyValidator` + `noopOntologyValidator` from `./validation/ontology.js`. Phase 38 appends the registry exports following the same pattern.

**Existing pattern excerpt (lines 44-46 of current root barrel):**

```typescript
// Pluggable ontology validator (D-19); v0.1 default is no-op.
export type { OntologyValidator } from './validation/ontology.js';
export { noopOntologyValidator } from './validation/ontology.js';
```

**Edit to apply — append AFTER line 46:**

```typescript
// Ontology registry (Phase 38, ONTO-01/02) — auto-discovery + extends-merging
// + extension provenance. Auto-wired into GraphKMStore when GraphKMStoreOptions
// .ontologyDir is set; standalone-usable via the OntologyRegistry class.
export { OntologyRegistry } from './ontology/registry.js';
export type { OntologyRegistryOptions } from './ontology/registry.js';
export { loadOntologyFile } from './ontology/loader.js';
export { registryBackedValidator } from './validation/ontology.js';
export type {
  OntologyFile,
  OntologyClass,
  OntologyProperty,
  ResolvedClass,
} from './types/ontology.js';
```

**DELTAS:** None — pure additive. Match the existing comment-block style ("D-19", "CORE-02" etc — Phase 38 uses "Phase 38, ONTO-01/02").

**Landmines:**

- Phase 37's barrel uses **mixed** `export type { ... }` and `export { ... }` blocks per category. Preserve that style; do NOT collapse into one giant block.
- The root barrel is the public package surface — anything not exported here is internal. Phase 38 MUST export `OntologyRegistry` (the class), `registryBackedValidator` (the factory), and the public types. `loadOntologyFile` is debatable — export it for Phase 42's adapter to reuse.

---

### `src/store/GraphKMStore.ts` (service, repository — MODIFY)

**Analog:** SAME FILE — Phase 37 Plan 04's final shape (455 lines). Specifically lines 87-103 (constructor options interface) and lines 124-136 (constructor body) and line 241 (`this.validator.validate(e.entityType)`).

**Existing constructor options (lines 87-103 of current GraphKMStore.ts):**

```typescript
export interface GraphKMStoreOptions {
  dbPath: string;
  exportDir: string;
  debounceMs?: number;
  domains?: readonly string[];
  ontologyValidator?: OntologyValidator;
}
```

**Existing constructor body (lines 124-136 of current GraphKMStore.ts):**

```typescript
constructor(opts: GraphKMStoreOptions) {
  super();
  this.graph = new MultiDirectedGraph<Entity, Relation>();
  this.persistence = new PersistenceManager(opts.dbPath, opts.exportDir, {
    domains: opts.domains,
  });
  this.exporter = new Exporter({
    exportDir: opts.exportDir,
    domains: opts.domains,
    debounceMs: opts.debounceMs,
  });
  this.validator = opts.ontologyValidator ?? noopOntologyValidator;
}
```

**Existing strict-validation call site (line 240-242 of current GraphKMStore.ts):**

```typescript
// D-19 validation — skipped on the trusted path.
if (!trusted) {
  this.validator.validate(e.entityType);
}
```

**Edits to apply:**

1. **Extend `GraphKMStoreOptions` with `ontologyDir`:**

   ```typescript
   export interface GraphKMStoreOptions {
     // ... existing fields ...

     /** Directory containing upper.json + lower ontology JSON files (Phase 38, D-28).
      *  When set, GraphKMStore instantiates an OntologyRegistry internally and
      *  auto-wires it as the validator (unless `ontologyValidator` is ALSO set,
      *  which takes precedence — allows tests to inject stubs).
      *
      *  Default behavior when omitted: no registry; falls back to `ontologyValidator`
      *  or `noopOntologyValidator`. The CONTEXT.md D-28 mention of "default
      *  `<consumer-cwd>/ontology/`" is explicitly NOT done by km-core itself — D-28
      *  forbids env-var/cwd pickup buried in helper code. Consumers wire defaults
      *  at the call site. */
     ontologyDir?: string;

     /** When true, treats malformed lower-ontology files as fatal instead of
      *  skip+warn. Default false (atomic-build-skip-bad-files per D-29). */
     ontologyStrict?: boolean;
   }
   ```

2. **Instantiate the registry and auto-wire the validator in the constructor:**

   ```typescript
   private readonly registry: OntologyRegistry | undefined;
   // ... existing private fields ...

   constructor(opts: GraphKMStoreOptions) {
     super();
     this.graph = new MultiDirectedGraph<Entity, Relation>();
     this.persistence = new PersistenceManager(opts.dbPath, opts.exportDir, {
       domains: opts.domains,
     });
     this.exporter = new Exporter({
       exportDir: opts.exportDir,
       domains: opts.domains,
       debounceMs: opts.debounceMs,
     });

     // Phase 38: Ontology registry (D-28 — constructor-injected, no env pickup).
     // Build the registry FIRST so the auto-wired validator below can reference it.
     if (opts.ontologyDir !== undefined) {
       this.registry = new OntologyRegistry({
         ontologyDir: opts.ontologyDir,
         strict: opts.ontologyStrict ?? false,
       });
     }

     // Validator resolution order (most-specific wins):
     //   1. Explicit opts.ontologyValidator (test stubs)
     //   2. Auto-wired registry-backed validator (when ontologyDir is set)
     //   3. noopOntologyValidator (legacy / unconfigured)
     this.validator =
       opts.ontologyValidator
       ?? (this.registry ? registryBackedValidator(this.registry) : noopOntologyValidator);
   }
   ```

3. **Add the `ontology` getter** (D-28 "exposes a getter `store.ontology`"):

   ```typescript
   /**
    * Read-only access to the OntologyRegistry instance. Undefined when
    * `ontologyDir` was not supplied at construction time.
    *
    * Use cases (Phase 39+):
    *   - `await store.ontology?.reload()` — pick up new ontology files (D-29)
    *   - `store.ontology?.getAllClassNames()` — enumerate valid classes for UI
    *   - `store.ontology?.parentChainOf(class)` — extension provenance
    */
   get ontology(): OntologyRegistry | undefined {
     return this.registry;
   }
   ```

4. **NO change to the `putEntity` validator call** (line 241 stays). The auto-wired `registryBackedValidator(registry)` conforms to the `OntologyValidator` interface, so the existing `this.validator.validate(e.entityType)` call works unchanged.

5. **NO change to the trusted-path bypass** (line 240 `if (!trusted)`). Per CONTEXT.md CF-D19 + BC-2, `skipOntologyCheck: true` bypasses BOTH `parseEntityId` AND the registry check — that semantics is preserved by the existing trusted-path branch.

6. **Add imports** at the top of the file (after line 72):

   ```typescript
   import { OntologyRegistry } from '../ontology/registry.js';
   import { registryBackedValidator } from '../validation/ontology.js';
   ```

**Landmines:**

- The `validator` field is currently `private`, initialized in the constructor. Keep it private; expose the registry via the `ontology` getter, not the validator (the validator is an internal detail; the registry is the consumer-facing API).
- The CONTEXT.md says "store instantiates the registry internally and exposes a getter (`store.ontology`)". `store.ontology` returns `OntologyRegistry | undefined` — the `undefined` case (no `ontologyDir` supplied) MUST be handled by callers. Phase 38 tests should assert both branches.
- Phase 37 Plan 04 "Behavior surprises" §6: `mergeAttributes` does NOT re-run ontology validation (T-37-04-06 accepted disposition). CONTEXT.md notes Phase 38 "may revisit when the ontology registry lands". **Decision for planner:** Phase 38 ships *without* revisiting (preserves the accepted disposition); a future phase can add a `validateOnMerge` option if needed. Do NOT silently change this behavior — it would invalidate Phase 37 contracts.
- The existing constructor instantiates `PersistenceManager` and `Exporter` first, then the validator. Phase 38's edit follows this ordering (registry then validator). Do NOT reorder PersistenceManager/Exporter creation — Plan 03 set that order deliberately.

---

### `src/validation/ontology.ts` (service interface — MODIFY)

**Analog:** SAME FILE — current 27-line file declares `OntologyValidator` interface + `noopOntologyValidator`. Phase 38 keeps both and ADDS a factory.

**Existing pattern (lines 10-26 of current file):**

```typescript
export interface OntologyValidator {
  /** Throws an Error if `entityType` is not a registered ontology class. */
  validate(entityType: string): void;
}

export const noopOntologyValidator: OntologyValidator = {
  validate(_entityType: string): void {
    /* no-op */
  },
};
```

**Edit to apply — append:**

```typescript
import type { OntologyRegistry } from '../ontology/registry.js';

/**
 * Phase 38 (ONTO-01/02): factory returning an OntologyValidator backed by
 * a live OntologyRegistry. The validator's `validate(entityType)` throws
 * iff the type is not in the registry's class catalog.
 *
 * Usage:
 *   const registry = new OntologyRegistry({ ontologyDir: '/path/to/ontology' });
 *   const validator = registryBackedValidator(registry);
 *   const store = new GraphKMStore({ ..., ontologyValidator: validator });
 *
 * For the common case (registry + store both managed by the store itself),
 * pass `ontologyDir` to `GraphKMStoreOptions` instead — the store auto-wires
 * this factory internally (see GraphKMStore constructor).
 *
 * The thrown error matches the shape used by the test stub at
 * tests/unit/graph-store.test.ts:187-192 ("Unknown ontology class: ${cls}").
 */
export function registryBackedValidator(registry: OntologyRegistry): OntologyValidator {
  return {
    validate(entityType: string): void {
      if (!registry.isValidClass(entityType)) {
        throw new Error(`Unknown ontology class: ${entityType}`);
      }
    },
  };
}
```

**DELTAS vs the noop pattern:** Same interface; new method. Keep `noopOntologyValidator` exported (consumers that don't want registry-backed validation still use it).

**Landmines:**

- The thrown error message **must** match the test stub's regex (`/Unknown ontology class/`) — Phase 37's existing `tests/unit/graph-store.test.ts:198` asserts this exact substring. If Phase 38 changes the message, the existing test breaks. Use `Unknown ontology class: ${entityType}` verbatim.
- Circular-import risk: `validation/ontology.ts` now imports `OntologyRegistry` from `../ontology/registry.js`, and `ontology/registry.ts` does NOT import from `validation/ontology.ts` (only the *factory* references the registry; the *registry* knows nothing about the validator interface). One-way dependency; safe. **DO NOT** make the registry implement `OntologyValidator` directly (would create the circle).

---

### `tests/unit/ontology-registry.test.ts` (test — CREATE)

**Analog (composite):**
1. `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/ontology-loader.test.ts` (237 lines — shape reference for the describe-blocks per fixture)
2. `/Users/Q284340/Agentic/km-core/tests/unit/graph-store.test.ts` (217 lines — vitest-with-tmpdir pattern; `makeStore()` factory; `beforeEach`/`afterEach`)

**OKM shape excerpt (lines 1-15 of OKM analog):**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { OntologyRegistry } from '../../src/ontology/registry.js';
import { loadOntologyFile } from '../../src/ontology/loader.js';
import type { OntologyFile } from '../../src/types/ontology.js';

const ONTOLOGY_DIR = join(import.meta.dirname, '../../ontology');

describe('OntologyRegistry', () => {
  let registry: OntologyRegistry;

  beforeAll(() => {
    registry = new OntologyRegistry();
    registry.load(ONTOLOGY_DIR);   // ← DELTA: km-core uses constructor-injected dir
  });
```

**km-core tmpdir pattern (lines 34-43 of graph-store.test.ts):**

```typescript
function makeStore(extra?: Partial<GraphKMStoreOptions>): Ctx {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-test-'));
  const store = new GraphKMStore({
    dbPath: path.join(tmpdir, 'leveldb'),
    exportDir: path.join(tmpdir, 'exports'),
    debounceMs: 0,
    ...extra,
  });
  return { store, tmpdir };
}
```

**Test structure to follow** — describe-block per concern, mirror OKM's section headings:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OntologyRegistry } from '../../src/ontology/registry.js';
import { loadOntologyFile } from '../../src/ontology/loader.js';

// Use FIXTURES dir — copied from OKM into km-core (deterministic for CI).
const FIXTURE_DIR = path.join(import.meta.dirname, '../fixtures/ontology');

describe('OntologyRegistry', () => {
  describe('auto-discovery (ONTO-01)', () => {
    it('loads upper.json + all sibling .json files dynamically', () => { /* ... */ });
    it('alphabetical load order is deterministic', () => { /* ... D-27 contract ... */ });
    it('throws if upper.json is missing', () => { /* ... */ });
    it('skip+warn on malformed lower file (default non-strict)', () => { /* ... */ });
    it('throw on malformed lower file (strict: true)', () => { /* ... */ });
  });

  describe('extends + property merging (ONTO-02)', () => {
    it('child class inherits parent relationships', () => { /* ... copied from OKM lines 86-100 ... */ });
    it('child properties override parent on conflict', () => { /* ... */ });
    it('per-class extends chain across upper→lower', () => { /* ... KPIPipeline extends Pipeline ... */ });
  });

  describe('public API (D-28 + canonical refs)', () => {
    it('isValidClass / getClass / getAllClassNames work', () => { /* ... */ });
    it('parentChainOf returns closest-first chain', () => { /* ... */ });
    it('provenanceOf returns source domain', () => { /* ... */ });
    it('domains getter exposes loaded ontology names', () => { /* ... */ });
    it('classCatalog is a ReadonlyMap', () => { /* ... */ });
  });

  describe('collision handling (D-27)', () => {
    it('last-loaded wins on duplicate class name', () => {
      // Use tmpdir + write 2 fixture files with the SAME class name
      // Assert the later (alphabetically) source wins
    });
    it('emits stderr warning on collision', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // ... load registry with colliding fixtures ...
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('redefined'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('last-loaded wins'));
      spy.mockRestore();
    });
  });

  describe('reload (D-29)', () => {
    it('reload() picks up newly-added ontology files', async () => {
      const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-ontology-'));
      fs.copyFileSync(path.join(FIXTURE_DIR, 'upper.json'), path.join(tmpdir, 'upper.json'));
      const reg = new OntologyRegistry({ ontologyDir: tmpdir });
      expect(reg.isValidClass('RPU')).toBe(false);          // raas not loaded yet
      fs.copyFileSync(path.join(FIXTURE_DIR, 'raas.json'), path.join(tmpdir, 'raas.json'));
      await reg.reload();
      expect(reg.isValidClass('RPU')).toBe(true);           // now loaded
      fs.rmSync(tmpdir, { recursive: true, force: true });
    });

    it('reload() forgets removed classes (D-29 last paragraph)', async () => { /* ... */ });
    it('reload() is atomic — concurrent lookup never sees half-built state', async () => { /* ... */ });
  });

  describe('coding-ontology fixture (SC#3 — B-shape proxy)', () => {
    it('loads upper + coding-ontology and resolves 8 L1 + 5 L2 classes', () => {
      const reg = new OntologyRegistry({ ontologyDir: FIXTURE_DIR });
      // Assert all 8 L1 component names are valid classes
      // Assert all 5 L2 classes have `extends: <L1 parent>`
    });
  });
});
```

**DELTAS vs OKM analog:**

1. **Constructor pattern:** OKM does `new OntologyRegistry()` + `.load(dir)`; km-core does `new OntologyRegistry({ ontologyDir })`. Single-step.
2. **Fixture path:** OKM uses `../../ontology` (the source-of-truth dir); km-core uses `../fixtures/ontology` (copied-in deterministic dir).
3. **Class counts** differ — OKM's tests assert "13 upper + 6 raas + 5 kpifw + 5 business = 29 classes". Phase 38's fixtures match OKM verbatim, so the SAME assertions hold — but the `coding-ontology.json` fixture adds 8 L1 + 5 L2 = 13 more (when loaded; in collision-free tests, exclude it).
4. **New test categories** that OKM doesn't have: collision warning emission (D-27), reload semantics (D-29), strict-mode malformed-file behavior. These are pure Phase 38 deltas.
5. **stderr spy** is new — OKM has no stderr expectations because its silent catch is the bug. Phase 38 must explicitly verify the warning emission.

**Landmines:**

- `vi.spyOn(process.stderr, 'write')` — `process.stderr.write` returns `boolean`; the mock impl must return `true` (otherwise Node's writable stream may complain). Pattern shown above.
- Fixture files copied into `tests/fixtures/ontology/` must be byte-identical to OKM's originals — DO NOT reformat (OKM's JSON has specific indentation; preserving it is a clean signal that the file is a verbatim copy).
- Tests using `fs.mkdtempSync` MUST clean up in `afterEach` or test-end (km-core's graph-store.test.ts pattern). Mirror that.
- `import.meta.dirname` — Node 22+ only. km-core CI matrix is `['22.x']` per Phase 37; safe to use.

---

### `tests/unit/graph-store.test.ts` (test — MODIFY)

**Analog:** SAME FILE — current 217-line file already has the strict-validation pattern at lines 184-216. Phase 38 adds **a sibling test** using a real fixture-directory-based registry.

**Existing strict-validation pattern (lines 184-199 of graph-store.test.ts):**

```typescript
test('strict ontology validation rejects unknown class', async () => {
  await ctx.store.close();
  fs.rmSync(ctx.tmpdir, { recursive: true, force: true });
  const validator: OntologyValidatorStub = {
    validate: (cls) => {
      if (!['Project', 'Component'].includes(cls)) {
        throw new Error(`Unknown ontology class: ${cls}`);
      }
    },
  };
  ctx = makeStore({ ontologyValidator: validator });
  await ctx.store.open();
  await expect(
    ctx.store.putEntity({ name: 'Bogus', entityType: 'Bogus' }),
  ).rejects.toThrow(/Unknown ontology class/);
});
```

**Edit to apply — append AFTER the existing `skipOntologyCheck flag bypasses validation` test (line 216):**

```typescript
test('ontologyDir option auto-wires registry-backed validator', async () => {
  await ctx.store.close();
  fs.rmSync(ctx.tmpdir, { recursive: true, force: true });

  ctx = makeStore({
    ontologyDir: path.join(import.meta.dirname, '../fixtures/ontology'),
  });
  await ctx.store.open();

  // Registry exposed via the new getter (D-28)
  expect(ctx.store.ontology).toBeDefined();
  expect(ctx.store.ontology!.isValidClass('Component')).toBe(true);
  expect(ctx.store.ontology!.isValidClass('RPU')).toBe(true);   // from raas.json
  expect(ctx.store.ontology!.isValidClass('Bogus')).toBe(false);

  // Validator is the registry — putEntity with valid class succeeds
  const ok = await ctx.store.putEntity({ name: 'Valid', entityType: 'Component' });
  expect(ok).toBeDefined();

  // Validator rejects unknown class
  await expect(
    ctx.store.putEntity({ name: 'Bogus', entityType: 'Bogus' }),
  ).rejects.toThrow(/Unknown ontology class/);
});

test('skipOntologyCheck bypasses registry validator (CF-D19 / BC-2)', async () => {
  await ctx.store.close();
  fs.rmSync(ctx.tmpdir, { recursive: true, force: true });
  ctx = makeStore({
    ontologyDir: path.join(import.meta.dirname, '../fixtures/ontology'),
  });
  await ctx.store.open();

  // skipOntologyCheck: true bypasses BOTH parseEntityId AND registry check
  const id = await ctx.store.putEntity(
    {
      id: 'not-a-uuid' as unknown as ReturnType<typeof mintEntityId>,
      name: 'TrustedBulk',
      entityType: 'NotInRegistry',
    },
    { skipOntologyCheck: true },
  );
  expect(id).toBe('not-a-uuid');
});
```

**DELTAS:** Pure additive — the existing test file works unchanged. The two new tests use the same `makeStore()` factory, the same tmpdir + cleanup pattern, the same `OntologyValidatorStub` test contract.

**Landmines:**

- The existing tests don't use `path.join(import.meta.dirname, ...)` — they only use `os.tmpdir()`. The new tests need to import `path` (already imported at line 23) and use `import.meta.dirname` (Node 22+). Verify that's fine; alternative is `fileURLToPath(new URL('.', import.meta.url))`.
- The `makeStore({ ontologyDir: ... })` invocation depends on Phase 38 having added `ontologyDir` to `GraphKMStoreOptions` (the modification documented above). Test depends on implementation — the planner must order tasks so the option is added BEFORE the test runs.
- The "skipOntologyCheck bypasses registry validator" test is the Phase 38 reinforcement of CF-D19 + BC-2 — both must remain in force. Don't accidentally tighten the trusted-path semantics.
- The existing test names (lines 58, 78, 90, ...) are GREP-VERIFIED elsewhere (Phase 37 Plan 04 SUMMARY: "all 11 verbatim test names from Plan 01 Task 3"). DO NOT modify any existing test name; only APPEND new tests.

---

### `tests/fixtures/ontology/{upper,kpifw,business,raas}.json` (fixtures — CREATE)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/ontology/{upper,kpifw,business,raas}.json` — **adopt verbatim by file copy**.

**Sizes (verified via `ls -la` on the OKM dir):**
- `upper.json` 7809 bytes, 13 classes (8 execution + 5 failure model)
- `kpifw.json` 2899 bytes, 5 classes, `meta.extends: "upper"`, includes per-class `KPIPipeline extends Pipeline`
- `business.json` 3608 bytes, 5 classes, `meta.extends: "upper"`
- `raas.json` 2889 bytes, 6 classes, `meta.extends: "upper"`, includes per-class `RPU extends Component`, `ArgoWorkflow extends Pipeline`, `S3DataPath extends DataAsset`

**Excerpt of upper.json structure (lines 1-22):**

```json
{
  "meta": {
    "name": "upper",
    "version": "2.0.0",
    "description": "Upper ontology v2 - streamlined execution and failure model (13 classes, down from 22)"
  },
  "classes": {
    "Component": {
      "defaultLayer": "evidence",
      "description": "A software component, module, or affected subsystem within the platform",
      "relationships": {
        "PART_OF": ["Service"],
        "DEPENDS_ON": ["Component"],
        "RUNS_ON": ["Infrastructure"],
        "AFFECTS": ["Incident"]
      },
      ...
    }
  }
}
```

**DELTAS:** **NONE.** Copy byte-identical. If any reformatting drift appears in the copy, the registry test loading them would still pass (JSON is whitespace-tolerant), but a verbatim-copy hash check is the cleanest signal that the fixtures are unmodified OKM artifacts. Use `cp` literally.

**Landmines:**

- These 4 files are the **reference shape** that the registry must load without error (CONTEXT.md §Specific Ideas bullet 1: "Phase 38's registry MUST load them as-is (zero modifications)").
- DO NOT add an `.gitkeep` or other sibling file in this dir during the copy — it would break the `readdirSync(...).filter(f => f.endsWith('.json'))` pattern only minimally (the filter handles it) but would clutter the canonical fixture set.
- The OKM fixtures use 2-space indent; preserving it via `cp` is automatic.

---

### `tests/fixtures/ontology/coding-ontology.json` (synthetic fixture — CREATE)

**Analog (composite):**
1. **Semantic shape:** `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/config/component-manifest.yaml` — B's 8 L1 components + 5 L2 components (CONTEXT.md §Domain bullet 3 of decisions: "synthetic — derived from B's component-manifest.yaml")
2. **JSON shape (skeleton):** OKM `ontology/kpifw.json` — the "lower ontology with `meta.extends: upper` + per-class `extends`" pattern

**B's manifest excerpt (lines 13-30 of component-manifest.yaml — L1 component shape):**

```yaml
components:
  - name: LiveLoggingSystem
    level: 1
    description: "Live session logging infrastructure capturing Claude Code conversations..."
    aliases: [LSL, live-logging, session-logging, SpecStory]
    keywords: [session, logging, transcript, LSL, classification, windowing, specstory]
    children: []
```

**OKM kpifw.json excerpt (lines 1-22 — the JSON skeleton to mirror):**

```json
{
  "meta": {
    "name": "kpifw",
    "version": "2.0.0",
    "extends": "upper",
    "description": "KPI-FW domain-specific lower ontology - KPI Framework concepts"
  },
  "classes": {
    "GrafanaDashboard": {
      "defaultLayer": "evidence",
      "description": "...",
      "relationships": {
        "DISPLAYS": ["KPIDefinition"],
        ...
      },
      "properties": { ... }
    }
  }
}
```

**Composite file to create — minimal skeleton:**

```json
{
  "meta": {
    "name": "coding",
    "version": "1.0.0",
    "extends": "upper",
    "description": "Synthetic coding-domain lower ontology — proxy for B's component-manifest.yaml (8 L1 + 5 L2). Phase 42 owns the real YAML→JSON conversion; this fixture exists purely so Phase 38 SC#3 can verify load + extends-merge works against B-shape data without forcing the YAML adapter."
  },
  "classes": {
    "LiveLoggingSystem": {
      "extends": "Component",
      "defaultLayer": "evidence",
      "description": "Live session logging infrastructure (LSL, SpecStory). L1 component from B's manifest.",
      "relationships": { /* keep minimal — empty {} acceptable, or one or two CAPTURES/EMITS rels */ }
    },
    "LLMAbstraction": { "extends": "Component", "defaultLayer": "evidence", "description": "...", "relationships": {} },
    "DockerizedServices": { "extends": "Component", "defaultLayer": "evidence", "description": "...", "relationships": {} },
    "Trajectory": { "extends": "Component", "defaultLayer": "evidence", "description": "...", "relationships": {} },
    "KnowledgeManagement": { "extends": "Component", "defaultLayer": "evidence", "description": "...", "relationships": {} },
    "ConstraintMonitoring": { "extends": "Component", "defaultLayer": "evidence", "description": "...", "relationships": {} },
    "WorkflowOrchestration": { "extends": "Component", "defaultLayer": "evidence", "description": "...", "relationships": {} },
    "DocumentationStyleSystem": { "extends": "Component", "defaultLayer": "evidence", "description": "...", "relationships": {} },

    "ManualLearning": { "extends": "KnowledgeManagement", "defaultLayer": "evidence", "description": "L2 sub-component of KnowledgeManagement.", "relationships": {} },
    "OnlineLearning": { "extends": "KnowledgeManagement", "defaultLayer": "evidence", "description": "L2 sub-component of KnowledgeManagement.", "relationships": {} }
    /* + 3 more L2 classes — total 5 L2 per CONTEXT.md D-26 verification */
  }
}
```

**DELTAS (relative to either analog — this is a NET-NEW composite):**

1. **B's aliases + keywords are DROPPED.** They don't have a natural home in C's JSON ontology shape; CONTEXT.md §Specific Ideas bullet 2: "Aliases/keywords don't have a natural home in the JSON ontology shape — drop them in the fixture; Phase 42 decides whether they survive the real conversion."
2. **L2 components use per-class `extends` to point at their L1 parent** — exercises the per-class `extends` resolution at load-time (the same path that `KPIPipeline extends Pipeline` exercises in `kpifw.json`).
3. **L1 components use per-class `extends: "Component"`** — exercises cross-ontology extends (lower `LiveLoggingSystem` extends upper `Component`). This is the ONTO-02 acceptance criterion under SC#3.
4. **Names must be 8 L1 + 5 L2** to match B's manifest count (CONTEXT.md D-26). The exact 8 L1 names from `component-manifest.yaml` are: LiveLoggingSystem, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, ConstraintMonitoring, WorkflowOrchestration, DocumentationStyleSystem. The 5 L2 names need to be picked from B's manifest's `children` arrays — the planner should grep `component-manifest.yaml` for the exact 5 children list and use them verbatim.

**Landmines:**

- The fixture is **synthetic** and **temporary** in spirit — Phase 42 will replace it with the actual YAML→JSON conversion output. Note this in the `meta.description` (the skeleton above does).
- 8 L1 + 5 L2 = 13 classes. When the registry loads `upper.json` + `coding-ontology.json` together, total class count is 13 + 13 = 26 (no collisions expected because L1 names don't appear in `upper`). If the planner sees a collision warning during the SC#3 test, that's a bug — investigate.
- The `relationships: {}` empty maps are valid per OKM's `OntologyClass` interface (`relationships: Record<string, string[]>` with no `?` — but an empty object satisfies the type). If TypeScript strict mode complains, the planner can add `{ "PART_OF": ["Coding"] }` or similar — but the simpler path is empty `{}`.
- The fixture file must be in `tests/fixtures/ontology/` alongside the 4 verbatim OKM copies. The directory layout is the contract for `readdirSync` auto-discovery — the registry loads ALL `.json` files in this dir except `upper.json` (which is loaded separately).
- **CRITICAL**: when the SC#3 test loads `tests/fixtures/ontology/`, the OKM kpifw/business/raas fixtures will ALSO be loaded (D-27 alphabetical order). To test JUST the coding-ontology against upper, use a **separate tmpdir** in the SC#3 test — copy `upper.json` + `coding-ontology.json` into it, then load. This isolates SC#3 from OKM-fixture cross-contamination.

---

## Shared Patterns

### Pattern S1: `process.stderr.write` for all diagnostics

**Source:** Phase 37 Plan 04 SUMMARY §"patterns-established" item 3: `"Zero console.* in src/ — CLAUDE.md no-console-log constraint preserved; existing process.stderr.write pattern (Plan 03) extended"`

**Apply to:** `src/ontology/registry.ts` (collision warning + skip-malformed warning per D-27)

**Concrete excerpt to use:**

```typescript
process.stderr.write(
  `[km-core/ontology-registry] class '${className}' redefined: ${prev.source} → ${source} (last-loaded wins; see D-27 in 38-CONTEXT.md)\n`
);
```

Use `[km-core/ontology-registry]` as the consistent prefix tag — matches Phase 37's `[km-core]` prefix used in the migrate-symlinks script. Operators grep these prefixes in stderr logs.

**Landmine:** `process.stderr.write` returns `boolean`. Don't await it; don't check the return value (Node guarantees synchronous write for short strings).

### Pattern S2: ESM with NodeNext `.js` import extensions

**Source:** Phase 37 Plan 04 SUMMARY §"patterns-established" item 1: `"ESM with NodeNext .js import extensions on internal imports"`

**Apply to:** ALL new `.ts` files in `src/ontology/` and `tests/unit/`.

**Concrete pattern:**

```typescript
// CORRECT (NodeNext + ESM, even though src files are .ts):
import { OntologyRegistry } from './registry.js';
import type { OntologyFile } from '../types/ontology.js';

// WRONG — will fail at runtime:
import { OntologyRegistry } from './registry';        // missing .js
import { OntologyRegistry } from './registry.ts';     // wrong extension
```

This is CF-D06 — non-negotiable.

### Pattern S3: Constructor options-object (D-14 / D-28)

**Source:** Phase 37 D-14 + Phase 38 D-28 — no positional args, no env-var pickup buried in helpers.

**Apply to:** `OntologyRegistry` (new), `GraphKMStore` (extension of existing options-object).

**Concrete pattern (mirroring `GraphKMStoreOptions`):**

```typescript
export interface OntologyRegistryOptions {
  ontologyDir: string;
  strict?: boolean;
}

export class OntologyRegistry {
  constructor(opts: OntologyRegistryOptions) { /* ... */ }
}
```

**Landmine:** Do NOT add `process.env.KM_ONTOLOGY_DIR ?? './ontology'` fallback inside the registry. CONTEXT.md D-28 final paragraph: "Consumers wire env-vars at the call site if needed."

### Pattern S4: Sync registry + async store API

**Source:** Phase 37 SUMMARY excerpt: `"registry is sync (in-memory map) but exposed via async store API for consistency"`

**Apply to:** OntologyRegistry methods are sync (`isValidClass`, `getClass`, etc.); `reload()` is async; the calling `GraphKMStore.open()` is async.

**Concrete pattern:**

```typescript
// In OntologyRegistry:
isValidClass(className: string): boolean { /* sync */ }
async reload(): Promise<void> { /* async — see D-29 note */ }

// In GraphKMStore (existing):
async open(): Promise<void> { /* registry already built in ctor; nothing to await for ontology */ }

// Consumer:
await store.ontology?.reload();   // async on the public surface
```

### Pattern S5: Vitest with tmpdir + cleanup

**Source:** km-core `tests/unit/graph-store.test.ts` lines 34-56 — `makeStore()` factory + `beforeEach`/`afterEach` cleanup.

**Apply to:** New `tests/unit/ontology-registry.test.ts` for any test needing fixture-mutation (collision, reload, malformed-file scenarios).

**Concrete pattern:**

```typescript
let tmpdir: string;
beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-ontology-test-'));
});
afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});
```

For tests using the static fixture dir (no mutation), `beforeAll` is fine — matches OKM analog.

---

## No Analog Found

Files with no exact match in either codebase:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/fixtures/ontology/coding-ontology.json` | fixture (synthetic) | n/a | Composite — semantically derived from B's YAML manifest, JSON-shape borrowed from OKM `kpifw.json`. Net-new artifact created for Phase 38 SC#3 verification; not present in either codebase. Phase 42 will replace it. |

---

## Cross-Cutting Reminders

1. **Phase 37 file-layout precedent (verified on disk 2026-05-20):**
   - `src/ids/` and `src/validation/` do NOT have `index.ts` sub-barrels
   - `src/types/` DOES have `index.ts`
   - Phase 38 CONTEXT.md names `src/ontology/index.ts` → follow the `types/` precedent
   - Root `src/index.ts` re-exports directly from leaf files (not via sub-barrels) for `ids/` and `validation/`. Phase 38 adds direct leaf re-exports for `ontology/*` alongside the new sub-barrel (consumers can use either).

2. **Phase 37 known-acceptance boundary (BC-2):** `skipOntologyCheck: true` bypasses BOTH `parseEntityId` AND the validator. Phase 38's `registryBackedValidator` integration preserves this — the trusted-path branch in `putEntity` (line 240 of GraphKMStore.ts) skips the `validator.validate` call entirely, so the registry never sees a trusted-bulk entity. **Do not change this** — Phase 39 backfill and Phase 42/43 migrations depend on it.

3. **Phase 37 known-acceptance T-37-04-06:** `mergeAttributes` does NOT re-run ontology validation. CONTEXT.md (canonical-refs final bullet) flags Phase 38 may revisit. **Planner decision:** Phase 38 ships *without* revisiting — preserves Phase 37 contract. A future phase can add a `validateOnMerge: true` option.

4. **`mergeAttributes` + registry validity stays unenforced.** If a consumer calls `mergeAttributes(id, { entityType: 'NotInRegistry' })`, the new class is NOT rejected. T-37-04-06 accepted disposition. Phase 38 documents this explicitly in the GraphKMStore JSDoc.

5. **No new dependencies.** All of Phase 38 uses only `node:fs`, `node:path`, and km-core's existing imports. `package.json` does NOT change (the OKM analog uses these same primitives).

6. **CI matrix unchanged.** Phase 37's `node-version: ['22.x']` covers `import.meta.dirname` and all `readdirSync`/`readFileSync` usage. No new CI configuration.

7. **Documentation/README skip.** Per the task description and the project rule "Do NOT Write report/summary/findings/analysis .md files", PATTERNS.md is the only doc artifact. The km-core README will be updated in a later phase if needed; Phase 38 does not require README changes.

---

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/registry.ts` (full read, 86 lines)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/loader.ts` (full read, 13 lines)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/types/ontology.ts` (full read, 29 lines)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/ontology-loader.test.ts` (full read, 237 lines)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/ontology/upper.json` (head, lines 1-30 of 207)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/ontology/kpifw.json` (head, lines 1-40 of 85)
- `/Users/Q284340/Agentic/km-core/src/validation/ontology.ts` (full read, 27 lines)
- `/Users/Q284340/Agentic/km-core/src/index.ts` (full read, 47 lines)
- `/Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts` (lines 1-120 + 120-249 + 249-284, non-overlapping; full constructor + putEntity body covered)
- `/Users/Q284340/Agentic/km-core/src/types/index.ts` (full read, 21 lines)
- `/Users/Q284340/Agentic/km-core/tests/unit/graph-store.test.ts` (full read, 217 lines)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/config/component-manifest.yaml` (head, lines 1-60 of full file — enough for L1 shape confirmation)
- On-disk verification: `ls -la /Users/Q284340/Agentic/km-core/src/`, `/Users/Q284340/Agentic/km-core/tests/`, `/Users/Q284340/Agentic/km-core/tests/fixtures/`, and the OKM ontology dir.

**Files scanned:** 12 distinct files, all non-overlapping reads. No file was re-read.

**Pattern extraction date:** 2026-05-20

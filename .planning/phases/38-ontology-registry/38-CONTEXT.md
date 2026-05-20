# Phase 38: Ontology Registry - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Land a single `OntologyRegistry` implementation inside `@fwornle/km-core` that:

1. Auto-discovers upper + N lower ontology JSON files from a configured directory at registry-load time.
2. Resolves `meta.extends` (ontology-level) and per-class `extends` chains into a merged class catalog with lower-ontology properties overriding upper ones on conflict.
3. Exposes a stable programmatic API: class lookup by name, parent-chain traversal, extension provenance, list of loaded domains.
4. Plugs into `GraphKMStore` via constructor injection so `putEntity({ ontologyClass })` strict-validation (Phase 37 D-19) gets its class catalog from this registry.

**Closes:** ONTO-01 (auto-discovery), ONTO-02 (extends + property merging).
**Does NOT close:** B's `component-manifest.yaml` adoption (deferred to Phase 42 per D-26 below). Phase 38 ships JSON-only; B's manifest stays untouched until Phase 42 rewrites the loader.

</domain>

<decisions>
## Implementation Decisions

### B's Component Manifest (load-bearing SC#3 decision)
- **D-26:** **Defer B-manifest support to Phase 42.** Phase 38 ships a clean JSON-only OntologyRegistry. SC#3 ("B's existing component-manifest (8 L1 + 5 L2) loads cleanly as a lower ontology against C's upper") is verified by hand-crafting a temporary `tests/fixtures/coding-ontology.json` that mirrors B's 8 L1 + 5 L2 structure in C's JSON shape. Phase 42 owns the YAML→JSON conversion (whether by adapter at load-time, one-shot migration, or rewrite — Phase 42 picks). Rationale: keeps Phase 38 surface narrow + JSON-only; B's manifest is structurally different enough (components+aliases+keywords vs classes+relationships+properties) that a YAML adapter would be a load-bearing decision deserving its own phase context.

### Name Collisions Across Lower Ontologies
- **D-27:** **Last-loaded wins + stderr warning.** When two lower ontologies declare a class with the same name, the second one overrides the first. Registry emits `process.stderr.write(...)` warning naming the source domains and class. Improves OKM's current silent-overwrite by adding visibility. Lower ontology load order is alphabetical by filename (deterministic) — consumers can rely on that for predictable conflict resolution.

### Configuration Injection
- **D-28:** **Constructor arg on `GraphKMStore`, passed through to the registry.** `new GraphKMStore({ ontologyDir, ... })`. The store instantiates the registry internally and exposes a getter (`store.ontology`) for direct access. Default `ontologyDir` is `<consumer-cwd>/ontology/` if omitted. This:
  - Matches Phase 37 D-14's options-object pattern (no positional args, no env-var pickup buried in helper code).
  - Lets tests pass `tmpdir/ontology/` deterministically.
  - Mirrors OKM's `OntologyRegistry.load(ontologyDir)` shape but moves the call inside the store ctor so consumers don't have to wire it twice.
  - Decision NOT to use env vars: Phase 37 has zero env-var pickup in km-core source. Consumers that need env-var-driven configuration wire it themselves at the call site (e.g., `new GraphKMStore({ ontologyDir: process.env.KM_ONTOLOGY_DIR ?? 'ontology' })`).

### Hot-Reload Semantics
- **D-29:** **Explicit `registry.reload()` API; no background file watcher.** Registry loads once during `store.open()`. To pick up new ontology JSON files, consumers call `await store.ontology.reload()` explicitly (e.g., on SIGHUP, dashboard reload button, test fixture swap). This:
  - Interprets SC#1 ("no code changes") as "no rebuild required" — process restart OR explicit `reload()` is acceptable.
  - Avoids `fs.watch` / chokidar race conditions (partial writes, editor swap-files, container bind-mount eventing quirks).
  - Keeps `reload()` atomic — registry builds the new class map fully before swapping, so a concurrent `findByOntologyClass()` either sees the old map or the new map, never a half-built one.
  - Behavior on `reload()` removing a class that's currently referenced by stored entities: registry forgets the class; `findByOntologyClass(removed)` returns `[]`; `putEntity({ ontologyClass: removed })` starts failing strict-validation. Storage of pre-existing entities is unaffected (entityType column is opaque to the registry). Phase 41/42/43 migrations will handle re-classification if needed; not a Phase 38 concern.

### Carrying Forward from Phase 37 (already locked, repeated here for downstream agents)
- **CF-D04:** Code lives in `~/Agentic/km-core/src/ontology/` (D-04, standalone repo).
- **CF-D06:** ESM-only, `type: module`, NodeNext resolution.
- **CF-D14:** All `GraphKMStore` methods are async; registry is sync (in-memory map) but exposed via async store API for consistency.
- **CF-D19:** `putEntity({ ontologyClass })` is strict-by-default with `skipOntologyCheck: true` opt-out. The store's strict path calls `registry.has(class)` or equivalent.
- **no-console-log:** All diagnostic output uses `process.stderr.write(...)`, never `console.*`.

### Claude's Discretion
- Per-class `extends` chains (e.g., `KPIPipeline extends Pipeline`): planner decides whether to resolve at load-time or lazily on lookup. OKM resolves at load-time — adopt unless researcher finds a reason to defer.
- Property-merge edge cases (type conflict between parent's `version: string` and child's `version: number`): planner decides — likely "child wins per D-27 + D-29 spirit, no validation".
- Malformed JSON handling: planner decides between strict-throw and skip+warn. OKM does silent skip; D-29's "atomic registry build" implies the planner should prefer skip+warn (one bad file shouldn't block the rest of the catalog) but add a `strict: true` option for production deployments. Researcher to confirm.
- Test harness for SC#3 (the synthetic `coding-ontology.json` fixture): planner decides whether the fixture lives in km-core tests or coding's lib/km-core/tests/fixtures/. Most likely km-core tests, since coding/ doesn't yet exercise the registry directly until Phase 42.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 38 anchor docs
- `.planning/ROADMAP.md` §Phase 38 — Phase goal, requirements (ONTO-01, ONTO-02), success criteria 1–4.
- `.planning/REQUIREMENTS.md` §"Ontology system (ONTO)" — ONTO-01/02 requirement text.
- `.planning/PROJECT.md` — v7.1 milestone vision, places ontology in v7.1 scope.

### Phase 37 inheritance (locked decisions still in force)
- `.planning/phases/37-km-core-foundation/37-CONTEXT.md` §Decisions D-01..D-23 — repo location, ESM/strict TS conventions, GraphKMStore options-object pattern, strict-by-default ontology validation.
- `.planning/phases/37-km-core-foundation/37-PATTERNS.md` — file-layout patterns inside km-core (`src/store/`, `src/types/`, `src/ids/`); apply the same shape for `src/ontology/`.
- `.planning/phases/37-km-core-foundation/37-04-SUMMARY.md` — `GraphKMStore.ts` final shape that Phase 38 will extend.
- `.planning/phases/37-km-core-foundation/37-VERIFICATION.md` — boundary case BC-2 (skipOntologyCheck also bypasses parseEntityId) is a known widened trusted-caller boundary; honor it in Phase 38's registry-validation path.

### OKM reference implementation (base — adopt with deltas)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/registry.ts` (86 lines) — closest analog; adopt as base with these deltas:
  - Move `load(ontologyDir)` body into constructor accepting `{ ontologyDir }`.
  - Add `reload()` method (D-29).
  - Replace silent `try/catch{}` with `process.stderr.write(...)` warnings (D-27 + no-console-log).
  - Emit collision warning when overwriting (D-27).
  - Expose `domains: ReadonlySet<string>`, `classes: ReadonlyMap<string, ResolvedClass>`, `parentChainOf(class)`, `provenanceOf(class)`.
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ontology/loader.ts` (13 lines) — JSON file loader; adopt verbatim or inline into registry.
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/types/ontology.ts` — `OntologyFile`, `ResolvedClass`, `OntologyMeta` types. Adopt to km-core's `src/types/ontology.ts` with `EntityId` branding where applicable.
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/unit/ontology-loader.test.ts` — shape reference for vitest tests against the registry.

### OKM ontology fixtures (4 JSON files — Phase 38 fixtures should mirror this shape)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/ontology/upper.json` (207 lines, 13 classes; v2 streamlined upper ontology).
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/ontology/kpifw.json` (85 lines; declares `meta.extends: "upper"` AND a per-class `extends: "Pipeline"` on `KPIPipeline`).
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/ontology/business.json`.
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/ontology/raas.json`.

### B's deferred manifest (for Phase 42 context only — Phase 38 does NOT load this)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/config/component-manifest.yaml` — B's 8 L1 + 5 L2 component hierarchy. Phase 38 ignores this; Phase 42 converts.
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/types/component-manifest.ts` — B's manifest TypeScript types.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **OKM's `OntologyRegistry`** (86 lines) — the entire shape is reusable. The "deltas vs OKM verbatim" pattern from Phase 37 Plans 02-03 applies here: lift the file, apply the specific changes listed under D-26..D-29, ship.
- **OKM's `loadOntologyFile()`** (13 lines) — JSON file reader with shape validation; adopt verbatim.
- **OKM's type definitions** in `src/types/ontology.ts` — `OntologyFile`, `OntologyMeta`, `ResolvedClass`, `PropertyDefinition` — adopt with the km-core `EntityId` brand where ontology classes reference entity types.
- **Phase 37's `noopOntologyValidator`** (km-core `src/validation/ontology.ts`) — the placeholder that Phase 38 replaces with a real validator backed by the registry. The barrel already exports the validator interface; Phase 38 swaps the implementation.

### Established Patterns
- **Phase 37 file layout**: `src/<feature>/` with `index.ts` re-export, one file per logical concern (e.g., `src/ids/{branded,mint,parse}.ts`). Phase 38 likely lands `src/ontology/{registry,loader,types}.ts` + barrel update.
- **Phase 37 test shape**: vitest in `tests/unit/<feature>.test.ts`. Each test file mirrors the source module. RED-then-GREEN cadence applies if Phase 38 follows TDD.
- **Phase 37 GraphKMStore constructor**: `new GraphKMStore({ dbPath, exportDir, debounceMs?, domains?, ontologyValidator? })`. Phase 38 adds `ontologyDir` to this options object; the validator option becomes registry-backed when `ontologyDir` is set.
- **No console.* constraint**: enforced repo-wide. Use `process.stderr.write(...)` for the collision warning (D-27) and any reload diagnostics.

### Integration Points
- **`GraphKMStore.putEntity()` strict-validation path**: currently calls the passed-in `ontologyValidator`. After Phase 38, when `ontologyDir` is configured, the validator is auto-wired to `(class) => registry.has(class)`. The opt-out `skipOntologyCheck: true` flag (Phase 37 D-19) still bypasses both the parseEntityId check (Phase 37 BC-2) and the new registry check.
- **`tests/unit/graph-store.test.ts`** — currently uses a stub `ontologyValidator` whitelisting `['Project','Component']`. Phase 38 likely adds a sibling test using a real fixture-directory-based registry.
- **`tests/fixtures/`** — the right place for Phase 38's hand-crafted `coding-ontology.json` (D-26 verification fixture for SC#3).

</code_context>

<specifics>
## Specific Ideas

- The 4 OKM ontology files (upper/kpifw/business/raas) are the canonical reference shape. Phase 38's registry MUST load them as-is (zero modifications). Researcher should verify by copying them into km-core's `tests/fixtures/ontology/` and writing an integration test that loads all four and asserts class counts + parent chains.
- The synthetic coding-ontology.json fixture for SC#3 should mirror B's component-manifest.yaml structure semantically but in C's JSON shape: 8 L1 components become 8 classes with `defaultLayer: "implementation"` (or similar), 5 L2 components become 5 classes with class-level `extends: "<L1 parent>"`. Aliases/keywords don't have a natural home in the JSON ontology shape — drop them in the fixture; Phase 42 decides whether they survive the real conversion.
- Collision warning text suggestion: `[ontology-registry] class '${className}' redefined: ${prevDomain} → ${newDomain} (last-loaded wins; see D-27 in 38-CONTEXT.md)` — gives operators a self-documenting pointer to the decision.

</specifics>

<deferred>
## Deferred Ideas

- **YAML/manifest adapter for B's component-manifest.yaml** — Phase 42 owns. Phase 38 ships JSON-only.
- **Namespace-prefixed class names** (e.g., `kpifw:Component`) to permanently solve collisions — considered and rejected per D-27. Could revisit in v7.2 if D-27's warn-and-override proves noisy in practice.
- **Background `fs.watch` / chokidar hot-reload** — considered and rejected per D-29. Could revisit if multi-tenant SaaS deployments need it; not a v7.1 driver.
- **Env var `KM_CORE_ONTOLOGY_DIR`** — considered and rejected per D-28. Consumers wire env-vars at the call site if needed.
- **Cross-class-extends across lower ontologies** (e.g., `kpifw.KPIPipeline extends business.Process` — pulling from a different lower domain, not just from upper). Not in OKM's current data — defer to Phase 41/42 if a real ontology needs it.
- **Migration of pre-existing entities when `reload()` removes a class** (per D-29 last paragraph) — Phase 41/42/43 maintenance ops own this. Phase 38 just exposes the registry state correctly.
- **`getRelations(fromClass, toClass)` lookup** beyond the existing `findByOntologyClass`. Researcher to confirm OKM's existing patterns; may already be covered.

### Reviewed Todos (not folded)
- **LLM-based semantic deduplication** (`.planning/todos/2026-03-09-llm-based-semantic-deduplication.md`) — keyword-matched but conceptually Phase 40 (Ingest Pipeline & Layered Dedup), not Phase 38. Deferred to Phase 40.
- **obs-api crashes on SIGTERM with libc++abi mutex error** (`.planning/todos/2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md`) — keyword-matched on "api"; unrelated to ontology. Phase 36/37 follow-up territory.

</deferred>

---

*Phase: 38-Ontology Registry*
*Context gathered: 2026-05-20*

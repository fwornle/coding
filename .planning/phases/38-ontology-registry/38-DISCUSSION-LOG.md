# Phase 38: Ontology Registry - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 38-Ontology Registry
**Areas discussed:** B's component-manifest format, name collisions, configuration injection, hot-reload semantics

---

## B's Component Manifest (load-bearing SC#3)

| Option | Description | Selected |
|--------|-------------|----------|
| Ship YAML→JSON adapter in km-core | OntologyRegistry supports BOTH .json and .yaml manifests. Adapter normalizes B's component shape into a synthetic class shape with sensible defaults. B keeps its existing config file. | |
| One-shot convert B's manifest to coding.json now | Phase 38 includes a migration step that writes coding/ontology/coding.json in C's JSON shape, deriving classes from B's L1/L2 hierarchy. | |
| Defer B-manifest support to Phase 42 | Phase 38 ships a clean JSON-only OntologyRegistry. SC#3 verified by hand-crafting a temporary coding.json fixture. Phase 42 (B migration) is where B actually starts using the registry. | ✓ |

**User's choice:** Defer to Phase 42.
**Notes:** Keeps Phase 38 surface narrow + JSON-only. B's manifest is structurally different enough (components+aliases+keywords vs classes+relationships+properties) that a YAML adapter would be a load-bearing decision deserving its own phase context. Phase 42 owns the conversion strategy.

---

## Name Collisions Across Lower Ontologies

| Option | Description | Selected |
|--------|-------------|----------|
| Throw on collision (strict) | Registry refuses to load conflicting classes; surfaces offending domains. Forces explicit resolution. | |
| Last-loaded wins + warn | Lower ontologies override earlier ones; emit a stderr warning naming the override. Matches OKM's current silent-overwrite but adds visibility. | ✓ |
| Namespace by domain (e.g., kpifw:Component) | Lookups by bare name fail when ambiguous; consumers must use fully-qualified names. | |

**User's choice:** Last-loaded wins + warn.
**Notes:** Improves OKM's silent overwrite. Load order is alphabetical by filename (deterministic). Warning text uses `process.stderr.write` per CLAUDE.md no-console-log constraint.

---

## Configuration Injection (Ontology Directory Location)

| Option | Description | Selected |
|--------|-------------|----------|
| Constructor arg on GraphKMStore (recommended) | `new GraphKMStore({ ontologyDir })`. Explicit, testable, matches Phase 37 D-14's options-object pattern. Default to `<consumer-cwd>/ontology/`. | ✓ |
| Env var with constructor override | `KM_CORE_ONTOLOGY_DIR` with constructor arg taking precedence. Lets Docker/launchd injection work without code changes. | |
| Convention only (no config) | Always reads `<consumer-cwd>/ontology/`. Simplest API; least flexible. | |

**User's choice:** Constructor arg.
**Notes:** Matches Phase 37 D-14 options-object pattern. Zero env-var pickup inside km-core source — consumers wire env-vars at the call site if needed (e.g., `new GraphKMStore({ ontologyDir: process.env.KM_ONTOLOGY_DIR ?? 'ontology' })`). Makes test isolation trivial.

---

## Hot-Reload Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Restart-required (no watcher) | Registry loads once on startup. Dropping a new file requires re-running the consumer process. | |
| Explicit reload() API | `registry.reload()` re-scans the directory and rebuilds the class map atomically. Consumer decides when to invoke. | ✓ |
| Background fs.watch with debounce | Registry runs chokidar/fs.watch with 200ms debounce; class map rebuilds on directory changes. | |

**User's choice:** Explicit `reload()` API.
**Notes:** Interprets SC#1's "no code changes" as "no rebuild required" — process restart OR explicit reload() is acceptable. Avoids fs.watch race conditions (partial writes, editor swap-files, container bind-mount eventing quirks). Atomic registry build: new class map fully constructed before swap, so concurrent `findByOntologyClass()` sees old-map-or-new-map, never half-built.

---

## Claude's Discretion

The following areas were intentionally NOT asked because they are implementation details that the researcher and planner can determine from OKM's existing patterns:

- Per-class `extends` chain resolution (load-time vs lazy) — OKM resolves at load-time.
- Property-merge edge cases (type conflicts between parent and child).
- Malformed JSON handling — strict-throw vs skip+warn (likely `strict: false` default, with a `strict: true` option for production).
- Test fixture location for SC#3 (`tests/fixtures/coding-ontology.json` vs `tests/fixtures/ontology/coding.json`).

## Deferred Ideas

- YAML/manifest adapter for B's component-manifest.yaml → Phase 42.
- Namespace-prefixed class names → considered + rejected per D-27; revisit in v7.2 if needed.
- Background fs.watch / chokidar → considered + rejected per D-29.
- Env var `KM_CORE_ONTOLOGY_DIR` → considered + rejected per D-28.
- Cross-class extends across lower ontologies (e.g., kpifw.KPIPipeline extends business.Process) → defer to Phase 41/42 if real data needs it.
- Migration of pre-existing entities when reload() removes a class → Phase 41/42/43 maintenance ops own this.
- TODOs reviewed but not folded: LLM-based semantic deduplication (Phase 40), obs-api libc++ mutex shutdown crash (Phase 36/37 follow-up).

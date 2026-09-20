# KmCoreOntologyResolution

**Type:** Detail

# KmCoreOntologyResolution — Technical Insight Document

## What It Is

KmCoreOntologyResolution is implemented as a single function, `resolveKmCoreOntologyDir()`, defined at module scope in `src/live-logging/ObservationWriter.js`. It is not a general-purpose path-resolution utility but a narrowly-scoped, defensive mechanism whose sole job is to locate the km-core ontology directory needed to construct a `GraphKMStore`. Its logic is a two-tier fallback: it first attempts the package-exported `defaultOntologyDir()` from `@fwornle/km-core`, and only if that call throws does it fall back to a manual path walk using `path.dirname(fileURLToPath(import.<COMPANY_NAME_REDACTED>.url))`, traversing upward (`'..', '..', 'lib', 'km-core', '.data', 'ontologies'`) from the file's own location. The function is explicitly commented as enforcing a "CLAUDE.md mandatory rule," tying it to prior incident-driving commits (87bc2f567/fd35c5350), and functions as an institutionalized guardrail against constructing a `GraphKMStore` without an ontology registry.

## Architecture and Design

As a child concern of its parent `ObservationWriter`, this resolver plugs into the broader hard-cutover design where all writes route through km-core's `putEntity` via the legacy-ingest adapters. Architecturally, several patterns stand out. First, **defense-in-depth fallback resolution**: a package-provided primary path backed by a manual, hardcoded secondary path, with the secondary explicitly documented as "should never fire." Second, **guardrail-as-code**: rather than relying purely on documentation or lint rules, the mandatory constraint (ontologyDir must be supplied) is encoded directly into application logic, reflecting a past production failure. Third, **fail-soft resolution**: on total failure, the function returns `null` rather than throwing, deferring the actual error surfacing to the downstream `GraphKMStore` constructor, which produces the message `opts.classes omitted but store has no ontology registry`. Fourth, a **lazy-vs-injected construction split** governed by the constructor options `kmStore` vs `kmStoreDbPath` — ontology resolution is entirely bypassed when a caller supplies a pre-built `kmStore`, meaning this component's logic is only exercised on the lazy-construction path.

## Implementation Details

The mechanics center on `resolveKmCoreOntologyDir()`'s try/fallback structure and the constructor branch that gates its invocation (`this._kmStore = options.kmStore || null; this._kmStoreDbPath = options.kmStoreDbPath || null`). When `kmStoreDbPath` is set and no `kmStore` is injected, the writer lazily constructs a `GraphKMStore`, and it is only at this point that ontology resolution runs. The fallback path's hardcoded relative traversal assumes a fixed directory depth of exactly two levels above `src/live-logging/`, which is brittle: if `ObservationWriter.js` is relocated or bundled differently, the fallback would silently compute a nonexistent path. Because the function is a free, unexported module-scope function, it is invisible outside `ObservationWriter.js` — other km-core consumers, such as `scripts/migrate-sqlite-to-kmcore.mjs` and `scripts/backfill-raw-observations.mjs`, must independently reimplement equivalent `import.<COMPANY_NAME_REDACTED>.resolve`-style walks, producing duplicated resolution logic rather than a shared helper.

## Integration Points

Downstream, the resolved ontology directory feeds directly into `GraphKMStore` construction, which is consumed by the legacy-ingest adapters — `legacyObservationToEntity`, `legacyDigestToEntity`, `legacyInsightToEntity` — imported from `@fwornle/km-core/adapters/legacy-ingest`, all ultimately invoking `putEntity`. This creates an implicit dependency chain: KmCoreOntologyResolution → GraphKMStore construction → adapter-based entity mapping → `putEntity`. A failure at the resolution step (e.g., a moved or missing `.data/ontologies` directory) does not fail where the fault originates; instead it manifests as an entity-classification error deeper in the adapters, complicating root-cause diagnosis. Within the parent `ObservationWriter`, this component operates independently of the sibling `ObservationWrittenEventBus`, which lives at module scope via `_observationEmitter` and governs subscriber timing rather than storage/ontology concerns — the two siblings address orthogonal lifecycle problems (event delivery vs. data-store initialization) within the same file.

## Usage Guidelines

Developers extending or reusing `ObservationWriter` should recognize that ontology resolution is only exercised when `kmStoreDbPath` is used for lazy construction; tests or callers using injected `kmStore` instances bypass this logic entirely, meaning it remains comparatively under-tested and only reliably exercised in integration contexts. Anyone relocating `ObservationWriter.js` must re-validate the fallback's hardcoded `../../lib/km-core/.data/ontologies` traversal. Any new module needing km-core-backed storage (following the pattern of the migrate/backfill scripts) should be aware that no shared ontology-resolution helper currently exists, and should consider factoring this logic out to avoid further duplication. Finally, because the resolver embodies a mandatory project rule rather than a soft convention, any refactor should preserve its fail-soft `null`-return contract and the downstream constructor's hard failure on missing `ontologyDir`, since this is the last line of defense against the incident class this component was built to prevent.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- Per the parent-entity observations, ObservationWriter.js's write path uses `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity` adapters that ultimately call GraphKMStore's `putEntity`, which is the consumer of whatever ontology directory was resolved. This creates an implicit dependency chain: KmCoreOntologyResolution → GraphKMStore construction → adapter-based entity mapping → putEntity — a failure in ontology resolution (e.g., a moved or missing `.data/ontologies` directory) would manifest downstream as an entity-classification error inside the adapters rather than at the resolution site itself, making root-cause diagnosis harder without knowledge of this chain.


## Hierarchy Context

### Parent
- [ObservationWriter](./ObservationWriter.md) -- src/live-logging/ObservationWriter.js routes all three write methods through km-core's putEntity via the legacy-ingest adapter (legacyObservationToEntity, legacyDigestToEntity, legacyInsightToEntity), per the Phase 44 hard-cutover decision (no dual-write, no feature flag).

### Siblings
- [ObservationWrittenEventBus](./ObservationWrittenEventBus.md) -- [LLM+CGR] The parent-context observation describing `_observationEmitter` as decoupling 'writer construction order from subscriber registration' is directly visible in src/live-logging/ObservationWriter.js: the module-level `EventEmitter` is instantiated at import time (`const _observationEmitter = new EventEmitter();`) rather than inside the `ObservationWriter` class or `init()` method. This means `subscribeObservationWritten()` can be called by the obs-api SSE route (`/api/coding/observations/stream`) before any `ObservationWriter` instance exists, because the emitter's lifecycle is tied to module load, not to writer construction. The code graph's `[CGR] ObservationWriter.js (module)` and `[CGR] ObservationWriter (class)` entries are distinct nodes precisely because this bus lives at module scope, outside the class boundary — a detail that would be invisible if only the class were graphed.


---

*Generated from 9 observations*

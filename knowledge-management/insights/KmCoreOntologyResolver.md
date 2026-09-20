# KmCoreOntologyResolver

**Type:** Detail

# KmCoreOntologyResolver — Technical Insight Document

## What It Is

`KmCoreOntologyResolver` refers to the `resolveKmCoreOntologyDir()` function defined in `src/live-logging/ObservationWriter.js`, a private, unexported helper whose sole responsibility is locating the on-disk km-core ontology directory needed to construct a `GraphKMStore`. It lives as a child concern of its parent component, `ObservationWriter` (the class defined in the same file), and is invoked only during that class's lazy-construction path in `init()` — specifically when the writer was not already handed a pre-built store via `options.kmStore`. As such, it is a narrowly-scoped, infrastructure-adjacent utility rather than a general-purpose module.

## Architecture and Design

The resolver implements a **two-tier fallback-chain pattern**: it first attempts the package-exported `defaultOntologyDir()` helper from `@fwornle/km-core`, and only on failure falls back to a hand-rolled relative-path walk-up — `path.resolve(here, '..', '..', 'lib', 'km-core', '.data', 'ontologies')` computed from `fileURLToPath(import.<COMPANY_NAME_REDACTED>.url)`. This is paired with a **fail-silent producer / fail-loud consumer** design: both branches are wrapped in bare `try/catch` blocks that swallow errors without logging, ultimately returning `null` on total failure. The real error-signaling burden is deferred to the downstream `GraphKMStore` constructor, which throws a loud, generic exception (`opts.classes omitted but store has no ontology registry`) if `ontologyDir` is missing — a documented CLAUDE.md mandatory rule from Phase 41 (commits `87bc2f567`/`fd35c5350`). The fallback branch is annotated with **defense-in-depth commenting** ("should never fire"), an explicit acknowledgment of an assumption the author flagged as unlikely but did not eliminate structurally.

## Implementation Details

The primary path relies on the package's own exported `defaultOntologyDir()`, decoupling correctness from directory structure. The secondary path, however, hardcodes a directory-depth assumption (`'..', '..', 'lib', 'km-core', '.data', 'ontologies'`), tightly coupling `ObservationWriter.js`'s location within `src/live-logging/` to the exact on-disk layout of `lib/km-core/.data/ontologies`. This same brittle pattern is duplicated — not centralized — across `scripts/backfill-raw-observations.mjs:40,95` and `scripts/observations-api-server.mjs:935`, per the function's own docstring. No shared utility module (e.g., under `lib/km-core/` or `lib/lsl/`) exists to unify this logic; each call site reimplements it independently, consistent with a broader local-helper-over-shared-abstraction tendency in this subsystem.

## Integration Points

The resolver's output feeds directly into `GraphKMStore` construction inside `ObservationWriter`'s `init()`, making it load-bearing for whether the writer can start at all on the lazy-init path — though this path is comparatively rare in production since obs-api's "preferred path" supplies its own shared `kmStore` (per the constructor's documentation), bypassing the resolver entirely. Within the same file, `KmCoreOntologyResolver` sits alongside sibling components `ObservationEventBus` and `AckPhraseGate`. Unlike `ObservationEventBus`'s deliberate module-level singleton (trading encapsulation for lifecycle simplicity so SSE subscribers needn't wait on writer construction) and `AckPhraseGate`'s dual-condition whitelist design, the ontology resolver's design trades diagnostic clarity for brevity — a narrower, more localized trade-off than its siblings'.

## Usage Guidelines

Developers should treat a `null` return from `resolveKmCoreOntologyDir()` as an urgent signal that either the `@fwornle/km-core` package export or the hardcoded relative path has broken — but expect no direct diagnostic; the actual failure surfaces only via `GraphKMStore`'s constructor error. Anyone modifying `src/live-logging/` directory depth, or restructuring `@fwornle/km-core`'s package layout, must audit all three duplicated call sites (`ObservationWriter.js`, `scripts/backfill-raw-observations.mjs`, `scripts/observations-api-server.mjs:935`) rather than assuming a single fix suffices. Given the "should never fire" comment reflects an untested assumption, any future refactor should consider centralizing this logic into a shared resolver utility and adding explicit logging before the silent-to-loud handoff, to avoid diagnosing production failures indirectly through an unrelated constructor's generic error message.


## Hierarchy Context

### Parent
- [ObservationWriter](./ObservationWriter.md) -- [CGR] ObservationWriter (class) in ObservationWriter.js

### Siblings
- [ObservationEventBus](./ObservationEventBus.md) -- [LLM+CGR] ObservationWriter.js implements a module-level `_observationEmitter` (a plain Node `EventEmitter`, `setMaxListeners(32)`) alongside exported `subscribeObservationWritten`, `_resetObservationEmitterForTests`, and `_emitObservationWrittenForTests` functions — this is the ObservationEventBus itself. The code graph's parent context confirms this is a deliberate Phase 55 Plan 06 Task 3 decision: rather than an instance-scoped emitter tied to the `ObservationWriter` class's lifecycle (which is constructed lazily by obs-api per the `_ensureObservationWriter` method noted in the parent CGR entities), a process-wide singleton lets the `/api/coding/observations/stream` SSE endpoint subscribe independently of when/whether a writer instance exists yet. The trade-off is explicit in the source comment: encapsulation purity is sacrificed for lifecycle simplicity.
- [AckPhraseGate](./AckPhraseGate.md) -- [LLM] The `_ACK_PHRASES` set in `src/live-logging/ObservationWriter.js` (class `ObservationWriter`, static field around the constructor) is a curated, length-capped whitelist of 40-ish whole-message acknowledgements ('y', 'ok', 'lgtm', 'thanks', 'go ahead', etc.) used as a pre-LLM triviality gate. The comment explicitly ties correctness to two conditions: the phrase must match the WHOLE message (not a substring) and the turn must have touched no files — this dual-condition design is what prevents a legitimately short request like 'go' (meaning 'go to line 40') from being misclassified as a filler acknowledgement, since the file-touch check acts as a corroborating signal beyond lexical matching alone.


---

*Generated from 9 observations*

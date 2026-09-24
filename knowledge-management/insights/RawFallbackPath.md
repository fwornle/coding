# RawFallbackPath

**Type:** Detail

## What It Is

RawFallbackPath is the behavior of ObservationWriter (in `src/live-logging/ObservationWriter.js`) that generates `[Raw]`-tagged observations when a proxy call times out mid-classification. The observations describing this component are entirely at the behavioral/session-record level — no source file containing ObservationWriter's actual fallback code was supplied. What is documented, with high confidence, is the *symptom*: observations on this path are logged as "storing" yet repeatedly fail to persist to the database. The actual implementation (the branch that constructs a `[Raw]` observation on timeout, and whatever write call it makes) is not present in any supplied file; it is only known to exist as a documented failure mode of its parent, ObservationWriter.

## Architecture and Design

The dominant architectural pattern here is **fail-open logging masking a fail-closed persistence bug**: the writer's log stream reports success ("storing") regardless of whether the row actually lands in the database. This decouples logging semantics from write-confirmation semantics — logging happens on attempt, not on confirmed persistence — which is precisely why the bug went undetected for so long.

This is one of at least two independent silent-loss mechanisms identified in ObservationWriter. The sibling mechanism, addressed by the evidence-floor gate (see WriterPathUnification/ObservationWriter's triviality-gate revision), involved semantic-dedup misclassifying legitimate turns as duplicates. That fix explicitly closed a 14-hour silent-drop window but, per the session record, does **not** address RawFallbackPath's proxy-timeout persistence gap — the two failure classes are orthogonal and both live inside the same writer.

## Implementation Details

Because ObservationWriter.js itself was not retrieved, the concrete mechanics of RawFallbackPath must be inferred from the closest available analog: `src/live-logging/MentionsClassifier.js`, a sibling module in the same directory. Its `callProxy()` wraps `fetch` in `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` and re-throws using `err.cause` rather than swallowing the error, specifically because undici collapses socket-level failures into the generic message `'fetch failed'`. If ObservationWriter's proxy call follows the same directory convention, its timeout-triggered fallback would need equivalent care to preserve the failure reason — but this is explicitly flagged as inference from a neighboring idiom, not a confirmed shared implementation.

The upstream data feeding any `[Raw]` fallback observation is built by `scripts/enhanced-transcript-monitor.js`'s `extractFileChanges()` and `toolCallArgs()`, which normalize four structurally divergent tool-call shapes (Claude/opencode's `input` object vs. pi's stringified `content`) into `{modifiedFiles, readFiles}`. Any gap in this normalization — the file's own noted history of pi producing 0-of-21 artifact captures — would starve a `[Raw]` fallback observation of the same signal it starves normal classification of, a failure mode independent of, but compounding, the persistence bug.

## Integration Points

The only verifiable wiring edge is ETM (`scripts/enhanced-transcript-monitor.js`) → ObservationWriter, via a top-level import (`ObservationWriter`, alongside `ObservationApiClient`) and the method `_initObservationWriter`. The body of `_initObservationWriter` — presumably the actual point where a proxy-timeout condition is handed to the writer to produce a `[Raw]` fallback — is not shown in any supplied excerpt, so only the dependency edge itself is confirmed.

RawFallbackPath shares its parent's exchange-normalization pipeline with sibling concerns: the same payload built by ETM feeds classification, fallback generation, and artifact extraction alike. No evidence supports an event-bus abstraction (ObservationEventBus is unconfirmed for this codebase) — the call from ETM into the writer appears synchronous/direct rather than pub/sub. Similarly, no unification layer (WriterPathUnification) between this and other writer paths (e.g., AnchorEdgeWriter) is evidenced in the supplied files.

## Usage Guidelines

Given the confirmed symptom, developers should **not** trust ObservationWriter's log output as evidence of durable storage specifically for `[Raw]`-tagged, proxy-timeout-derived observations — this is called out explicitly as differing from normally-classified observations. Anyone extending or debugging the evidence-floor gate work should recognize it addresses the semantic-dedup drop path, not this one; a separate persistence-confirmation fix is still needed for RawFallbackPath. When investigating, the natural next step is to actually retrieve `ObservationWriter.js` and confirm whether its proxy-timeout branch follows the `MentionsClassifier.js` `callProxy()`/`AbortSignal.timeout` convention, and whether it checks the DB write's actual result before logging "storing."

INSUFFICIENT_EVIDENCE is not warranted overall since the parent record does describe this component's behavior directly, but readers should treat every implementation-level claim above (as opposed to the documented symptom) as inference from sibling code, not confirmed fact.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The code graph confirms ObservationWriter (class, in ObservationWriter.js) is imported directly at the top of scripts/enhanced-transcript-monitor.js alongside ObservationApiClient, and lists `_initObservationWriter` as a method on enhanced-transcript-monitor.js — the wiring point where ETM would hand a proxy-timeout condition off to the writer. The supplied ETM excerpt shows the imports and the surrounding exchange-extraction code (extractFileChanges, toolCallArgs) but not `_initObservationWriter`'s body, so only the dependency edge ETM → ObservationWriter is verifiable here; the actual branch that constructs a [Raw] fallback observation on proxy timeout is not present in any supplied file.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent: [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist.
- Per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' work record, observations tagged [Raw] — generated specifically when a proxy call times out mid-classification — are logged by the pipeline as 'storing' yet have been repeatedly observed to silently fail to persist to the database. This is not an ordinary write failure: the code path actively reports success in its own log output while the row never lands, meaning the writer's log stream cannot be used as evidence of durable storage for this observation class specifically, as opposed to normally-classified observations.
- The 'ObservationWriter Triviality Gate — Evidence-Floor Filtering' record establishes that a later revision added an evidence-floor gate to ObservationWriter to stop valid work turns from being silently dropped, closing what it describes as a previously observed 14-hour silent-drop failure window. Read together with the raw-fallback record, this implies at least two independent silent-loss mechanisms have existed in the same writer: one via semantic-dedup misclassifying legitimate turns as duplicates, and one via the [Raw]-tagged proxy-timeout fallback path logging 'storing' without a confirmed write — the evidence-floor gate addresses the former, not the latter.

## Hierarchy Context

### Parent
- [ObservationWriter](./ObservationWriter.md) -- [SESSION] ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent: [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist.

### Siblings
- [AnchorEdgeWriter](./AnchorEdgeWriter.md) -- [LLM] None of the five supplied files (lib/lsl/adapters/claude-jsonl-tree.mjs, lib/lsl/token/stop-adapter-registry.mjs, scripts/enhanced-transcript-monitor.js, scripts/tmux-session-wrapper.sh, src/live-logging/MentionsClassifier.js) define, export, import, or even mention a class, function, or module named 'AnchorEdgeWriter'. The retrieval set was drawn from the parent ObservationWriter's neighbourhood (same src/live-logging/ directory and its ETM caller) rather than from this entity's own source, so this analysis is grounded in the parent's documented behavior and in filenames visible in the parent's code-graph listing, not in AnchorEdgeWriter's implementation.
- [ObservationEventBus](./ObservationEventBus.md) -- [LLM] None of the five supplied files define, export, or reference a class, module, or symbol named ObservationEventBus. scripts/enhanced-transcript-monitor.js imports ObservationWriter and ObservationApiClient directly (`import { ObservationWriter } from '../src/live-logging/ObservationWriter.js'; import { ObservationApiClient } from '../src/live-logging/ObservationApiClient.js';`) and appears to hand exchange data to the writer synchronously rather than through any publish/subscribe or event-emitter abstraction. If an ObservationEventBus exists in this codebase, it is not among the files retrieved for this component.
- [WriterPathUnification](./WriterPathUnification.md) -- [LLM] None of the supplied code files (claude-jsonl-tree.mjs, stop-adapter-registry.mjs, enhanced-transcript-monitor.js, tmux-session-wrapper.sh, MentionsClassifier.js) implement anything named WriterPathUnification, nor do they reference a unification layer between multiple writer paths. The only concrete tie to the parent ObservationWriter subject is the import edge in enhanced-transcript-monitor.js and MentionsClassifier's shared-module role described in the parent observations.


---

*Generated from 9 observations*

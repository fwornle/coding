# AckPhraseGate

**Type:** Detail

[LLM] Because `_ACK_PHRASES` is declared as a `static` class field (`ObservationWriter._ACK_PHRASES`), it is shared across every writer instance in a process rather than being per-configuration — this is efficient (one Set allocation regardless of how many `ObservationWriter` instances obs-api or the ETM construct) but also means the gate's behavior cannot vary between instances even if callers wanted, e.g., a stricter gate for one project and a looser one for another. Given the broader pattern in the file of instance-scoped state (the module-level `_observationEmitter` singleton is explicitly justified in the header comments as a deliberate 'trading encapsulation purity for lifecycle simplicity' choice), the ack-phrase set follows the same non-instance-scoped convention for a different resource type, suggesting a house style of using module/class statics for anything that is logically global config rather than per-instance state.

# AckPhraseGate — Technical Insight Document

## What It Is

AckPhraseGate is implemented in `src/live-logging/ObservationWriter.js` as a static class field, `ObservationWriter._ACK_PHRASES`, defined near the constructor of the `ObservationWriter` class. It is a curated, length-capped whitelist Set of roughly 40 whole-message acknowledgement phrases — things like `'y'`, `'ok'`, `'lgtm'`, `'thanks'`, `'go ahead'` — used as a pre-LLM triviality gate. Its purpose is to detect turns that are pure conversational filler so they can be discarded before any expensive downstream processing occurs. The gate's correctness rests on two conjoined conditions documented directly in the source comment: the phrase must match the **entire** message (not merely appear as a substring), and the turn must have touched **no files**. This dual-condition design is what allows a short but substantive message like `'go'` (meaning "go to line 40") to be correctly distinguished from a genuine filler acknowledgement — lexical matching alone would misfire on such cases, but the file-touch corroboration provides the missing signal.

## Architecture and Design

AckPhraseGate sits structurally upstream of the expensive summarization pipeline that `ObservationWriter` otherwise drives through the coding LLM proxy (`this.proxyUrl`, defaulting to `http://<CONNECTION_STRING_REDACTED> and only on failure falls back to a hand-rolled `import.<COMPANY_NAME_REDACTED>.resolve`-style walk-up that computes `path.resolve(here, '..', '..', 'lib', 'km-core', '.data', 'ontologies')` from `fileURLToPath(import.<COMPANY_NAME_REDACTED>.url)`. The comment explicitly labels this fallback path as one that 'should never fire' — an optimistic assumption that deserves scrutiny given the function's own docstring cites a CLAUDE.md mandatory rule (Phase 41 lesson, commits 87bc2f567/fd35c5350) stating that ANY host-side process constructing `GraphKMStore` MUST pass `ontologyDir`, since omitting it throws `opts.classes omitted but store has no ontology registry`.


---

*Generated from 9 observations*

# WindowLabelFileIdentityEmbedder

**Type:** Detail

Inferred from parent context (no source files available): the parent description states the window label is 'embedded directly in LSL metadata' and 'becomes part of the persisted file identity', meaning this embedder runs before the LSL entry is flushed to disk, coupling it tightly to HourlyWindowCalculator's output.

# WindowLabelFileIdentityEmbedder

## What It Is

`WindowLabelFileIdentityEmbedder` is a `Detail`-level component nested within `SessionWindowManager`'s ingestion pipeline. While no concrete source files are currently surfaced for this entity, its role is inferred directly from the parent context: it is the mechanism responsible for stamping hourly time-window labels (in the canonical `'0800-0900'` form) into LSL (Lab Streaming Layer) metadata at the precise moment a session entry transitions from in-memory state to persisted file form. In effect, the embedder is the bridge that converts a computed window classification into a permanent attribute of the file's identity.

The component's defining characteristic is that it operates at *write time*, not query time. Once an LSL entry has passed through the embedder, the window label is no longer a derived or annotated property — it is intrinsic to the file. This makes `WindowLabelFileIdentityEmbedder` the enforcement point for a strong invariant: every persisted LSL session record carries a canonical bucket string before it ever touches storage.

## Architecture and Design

The architectural approach evident here is a **write-time embedding** pattern, in contrast to a query-time annotation pattern. The parent `SessionWindowManager` could have chosen to compute window labels lazily when consumers requested them, but instead delegates label materialization to this embedder so that the label becomes "part of the persisted file identity." This is a deliberate trade-off favoring read-path simplicity and consumer trust over write-path flexibility.

The embedder appears to function as a **mandatory pipeline stage** within `SessionWindowManager`'s ingestion flow. Because no LSL entry can be persisted without a valid window label, the embedder acts as a gating step: input flows in from upstream (notably `HourlyWindowCalculator`, which produces the raw window classification), and output is the LSL metadata block ready for flushing. This pipeline positioning tightly couples the embedder to `HourlyWindowCalculator`'s output contract — the embedder must understand and faithfully serialize whatever bucket representation that calculator emits.

Design-wise, this reflects a **canonical-form-at-boundary** philosophy. The `'0800-0900'`-style string is established as the canonical bucket representation precisely at the storage boundary, ensuring that all downstream consumers — whether they read files directly or query through higher-level interfaces — see exactly the same label format without needing to re-derive it from raw timestamps.

## Implementation Details

Although no code symbols have been extracted for `WindowLabelFileIdentityEmbedder`, the component's responsibilities can be characterized from its position in the architecture. It must accept (at minimum) the output of `HourlyWindowCalculator` — the computed hourly bucket — and the LSL metadata structure being prepared for flush. Its core operation is to inject the bucket string into the LSL metadata such that the label travels with the file as part of its identity, not as an external sidecar or index entry.

Because the label becomes part of file identity, the embedder's correctness is **critical at write time**. A bug in the embedder cannot be patched by adjusting query logic later; any incorrect label produces a file whose name or metadata identity is wrong, and correcting it requires a file rename or re-creation operation. This implies the embedder must be deterministic, idempotent within a session's flush operation, and defensive against malformed or missing window inputs from `HourlyWindowCalculator`.

The embedder is invoked *before* the LSL entry is flushed to disk. This sequencing means it sits in a narrow but essential window of execution within `SessionWindowManager`: after window classification has occurred upstream, but before the I/O layer takes over. Any retroactive change to a label — for example, if window boundaries are redefined or if a session is reassigned to a different bucket — necessarily becomes a file-level operation (rename or re-create) rather than a metadata patch.

## Integration Points

The most direct integration is with the parent `SessionWindowManager`, which owns the embedder and orchestrates its invocation as part of LSL session ingestion. `SessionWindowManager` provides the surrounding context: it assigns entries to hourly buckets and depends on the embedder to make those assignments durable.

Upstream, the embedder is tightly coupled to `HourlyWindowCalculator`'s output. The embedder does not itself compute the window — it consumes the bucket the calculator produces and serializes it into LSL metadata. Any change to the calculator's output format (for instance, moving away from the `'0800-0900'` convention) would propagate through the embedder, since the embedder is responsible for preserving and persisting that canonical form.

Downstream, every consumer of persisted LSL files implicitly depends on the embedder having done its job correctly. Because the label is embedded rather than annotated, downstream readers can trust the label without reconstructing it from raw timestamps. This reduces complexity throughout the read path but concentrates correctness pressure on this single write-time component.

## Usage Guidelines

Developers working with `WindowLabelFileIdentityEmbedder` should treat it as a **correctness-critical, write-only chokepoint**. The most important rule is that no LSL entry should bypass this stage on its way to disk. The embedder enforces the invariant that every persisted record carries a canonical bucket string, and circumventing it would produce files that violate the system's identity contract.

When modifying the embedder, recognize that any change to its output format is effectively a **file format change**. Existing files carry the old format embedded in their identity; changing the embedder does not retroactively update them, and any migration must be planned as a file rename or re-creation operation. For this reason, the canonical `'0800-0900'`-style format should be treated as a stable contract shared across the system.

When debugging window-label issues, look upstream first: if a file carries an incorrect label, the question is whether `HourlyWindowCalculator` produced the wrong bucket or whether the embedder mis-serialized it. Because the embedder is positioned between calculation and persistence, errors at either side manifest as bad file identities.

Finally, do not attempt to "fix" labels by patching files in place at the metadata level if the label is part of the file's identity (e.g., its name). Treat label correctness as a write-time concern, and ensure that any new ingestion paths added to `SessionWindowManager` route through the embedder rather than introducing parallel persistence shortcuts.

---

**Summary of key analytical points:**

1. **Architectural patterns identified**: Write-time embedding (vs. query-time annotation), mandatory pipeline stage, canonical-form-at-boundary, gating/enforcement component within `SessionWindowManager`'s ingestion flow.

2. **Design decisions and trade-offs**: Embedding labels into file identity reduces read-path complexity and gives downstream consumers a trustworthy label, but makes write-time correctness critical and renders retroactive label changes into expensive file-rename or re-creation operations.

3. **System structure insights**: The embedder is the seam between `HourlyWindowCalculator`'s in-memory output and the on-disk LSL metadata, owned and orchestrated by `SessionWindowManager`. It is a narrow, single-responsibility component whose position in the pipeline is more important than its internal complexity.

4. **Scalability considerations**: As a per-entry, deterministic, write-path stage, it scales linearly with ingestion volume; it introduces no shared state and no cross-entry dependencies, making it cheap at scale. However, format migrations scale poorly because they require touching every previously persisted file.

5. **Maintainability assessment**: Maintainability hinges on keeping the canonical bucket format (`'0800-0900'`) stable and on preserving the tight contract with `HourlyWindowCalculator`. The lack of currently surfaced code symbols suggests the component is either lightly implemented or under-documented at the symbol level — adding explicit code-level documentation would significantly improve long-term maintainability given how much downstream trust rests on its correctness.


## Hierarchy Context

### Parent
- [SessionWindowManager](./SessionWindowManager.md) -- SessionWindowManager assigns LSL session entries to hourly time-window buckets (e.g., '0800-0900') that are embedded directly in LSL metadata, meaning the window label becomes part of the persisted file identity rather than a query-time annotation


---

*Generated from 3 observations*

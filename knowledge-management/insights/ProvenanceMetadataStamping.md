# ProvenanceMetadataStamping

**Type:** Detail

Referenced in the ManualLearning sub-component description: provenance metadata is the key distinguishing factor between human-curated facts and automatically extracted knowledge in the GraphKMStore (documented in docs/architecture/memory-systems.md as 'Graph-Based Knowledge Storage Architecture')

# ProvenanceMetadataStamping — Technical Insight Document

## What It Is

ProvenanceMetadataStamping is a design mechanism within the **ManualLearning** sub-component that attaches provenance metadata to knowledge entries written into the **GraphKMStore** (Graph-Based Knowledge Storage Architecture, documented in `docs/architecture/memory-systems.md`). Its core purpose is to mark the *origin* of a knowledge fact — distinguishing whether it was human-curated or automatically extracted by a pipeline — so that downstream merge and synchronization operations can make informed decisions about which data takes precedence.

This is not a standalone module so much as a stamping convention: a field or set of fields attached to graph nodes or edges at write time, whose presence and value governs merge behavior across the lifetime of that knowledge entry.

---

## Architecture and Design

The central design insight is that **provenance is the trust discriminator**. The GraphKMStore must support multiple writers — human annotators via ManualLearning and automated extraction pipelines — and without a provenance signal, later writes would silently overwrite earlier ones regardless of their epistemic <USER_ID_REDACTED>. By stamping each entry with its provenance at creation time, the store can implement **merge protection**: human-curated facts are shielded from being overwritten by pipeline-generated observations.

This implies an **immutable-at-provenance** design principle. Once a fact is stamped as human-curated, that designation is not subject to reclassification by automated processes. The provenance field is effectively a write-protection signal embedded in the data itself, rather than enforced by a separate access-control layer. This is a deliberate trade-off: it keeps protection logic data-local and portable, meaning the rule travels with the record.

The architecture described in `docs/architecture/cross-project-knowledge.md` extends this principle across project boundaries. When knowledge is synchronized between projects, the provenance stamp must survive the transfer intact — otherwise the merge protection guarantee breaks down at the federation layer. This suggests provenance metadata is treated as a **first-class, non-strippable attribute** of any knowledge record, not an optional annotation.

---

## Implementation Details

Based on the observations, the stamping mechanism operates at **write time** to the GraphKMStore. When ManualLearning records a human-curated fact, the provenance field is set to a value that identifies the entry as manually authored. Conversely, pipeline-generated observations carry a different provenance value. The merge logic — invoked during write operations — inspects this field before deciding whether to update an existing node or edge.

The practical mechanics likely involve:

- **A provenance field on graph nodes/edges** — a structured attribute (enum, string tag, or structured object) distinguishing at minimum `manual` vs. `automated` provenance classes.
- **A merge guard in write operations** — logic within GraphKMStore's write path that checks the existing provenance of a record before allowing an overwrite. If the existing record is stamped as human-curated, a pipeline write is rejected or routed to a separate observation layer rather than overwriting the canonical fact.
- **Propagation on sync** — when `cross-project-knowledge.md`'s synchronization mechanism copies records across project boundaries, the provenance stamp is carried along, preserving the merge protection guarantee in the receiving project's GraphKMStore instance.

No specific class names or file paths beyond the documentation references are available from the current observations, so the exact field names and class structures cannot be confirmed here.

---

## Integration Points

ProvenanceMetadataStamping sits at the intersection of three concerns within the broader architecture:

1. **ManualLearning (parent)** — This is where stamping is initiated. ManualLearning is the write path for human-curated facts, and it is responsible for ensuring that every entry it produces carries the correct provenance marker before committing to GraphKMStore.

2. **GraphKMStore** — The storage layer is the enforcement point. The merge protection behavior described in the observations implies GraphKMStore's write operations are provenance-aware; they do not treat all writes as equal but apply differential handling based on the stamp.

3. **Cross-project knowledge synchronization** (`docs/architecture/cross-project-knowledge.md`) — The synchronization layer must respect provenance stamps when reconciling knowledge graphs from multiple projects. This makes ProvenanceMetadataStamping a **contract that spans system boundaries**, not just an internal implementation detail.

---

## Usage Guidelines

Developers working with ManualLearning or GraphKMStore should treat provenance stamps as **invariants**, not advisory metadata. The following principles follow from the design:

**Never strip provenance on copy or sync.** Any serialization, export, or cross-project transfer of knowledge records must preserve the provenance field. Losing it degrades a human-curated fact to an unprotected entry, making it vulnerable to pipeline overwrites.

**Automated pipelines must not claim human provenance.** The integrity of merge protection depends entirely on the honesty of the stamp. Any pipeline process that writes to GraphKMStore must use the correct automated-origin provenance value, even when it is processing or enriching a record that originated from ManualLearning.

**Merge logic belongs in the store, not in callers.** Since provenance-based merge protection is described as a behavior of the write operation itself, callers should not need to pre-check provenance before writing. The store should enforce the invariant internally, making the protection robust against callers that are unaware of the convention.

**Treat provenance as a required field, not optional.** Records lacking a provenance stamp are ambiguous to the merge logic and to cross-project sync. Validation at write time should reject or flag unprovenance-stamped entries rather than defaulting to a potentially destructive assumption.

---

### Architectural Patterns and Trade-offs Summary

| Concern | Decision | Trade-off |
|---|---|---|
| Trust discrimination | Data-embedded provenance field | Portable & self-describing, but relies on writer honesty |
| Merge protection | Store-level enforcement at write time | Centralizes protection logic; callers remain simple |
| Cross-project portability | Stamp survives synchronization | Requires sync layer to treat provenance as non-strippable |
| Human vs. automated knowledge | Distinct provenance classes | Clean separation; extensible to additional provenance classes if needed |


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are distinguished from automatically extracted knowledge by provenance metadata, ensuring human-curated facts are not overwritten by pipeline-generated observations during merge operations


---

*Generated from 3 observations*

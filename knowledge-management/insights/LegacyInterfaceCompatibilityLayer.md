# LegacyInterfaceCompatibilityLayer

**Type:** Detail

LegacyInterfaceCompatibilityLayer in `legacy-ontology-adapter.ts` implements shim methods such as `validateOntology()` and `classifyOntology()` that map deprecated parameter signatures expected by `OntologyValidator` and `OntologyClassifier` to the current `km-core` API contracts.

# LegacyInterfaceCompatibilityLayer — Technical Reference

---

## What It Is

`LegacyInterfaceCompatibilityLayer` is implemented inside `legacy-ontology-adapter.ts` as a contained logical layer within the broader `LegacyOntologyAdapter` component. Its sole responsibility is to expose shim methods — specifically `validateOntology()` and `classifyOntology()` — that accept the deprecated parameter signatures historically expected by `OntologyValidator` and `OntologyClassifier`, then translate those calls into the current `km-core` API contracts without requiring any modification to those downstream consumers.

It is not a standalone service or module boundary; it is a design layer contained within `LegacyOntologyAdapter`, which itself wraps `km-core`'s `OntologyRegistry` behind a legacy-compatible interface. The compatibility layer is the specific mechanism through which that wrapping is achieved at the method-signature level.

---

## Architecture and Design

**Pattern: Adapter / Shim**

The dominant architectural pattern here is the *Adapter* (also called shim or wrapper). `LegacyInterfaceCompatibilityLayer` sits between two interface contracts: the legacy signatures expected by `OntologyValidator` and `OntologyClassifier`, and the current `km-core` API. The layer absorbs all signature mismatch complexity, leaving both sides of the boundary untouched.

A notable design decision is the deliberate *scoping* of the compatibility contract. Rather than attempting to reproduce the full legacy API surface, the compatibility layer is explicitly bounded to the two protected consumers — `OntologyValidator` and `OntologyClassifier`. This is a conscious trade-off: it limits the maintenance burden and prevents the adapter from becoming an unbounded legacy accumulation point, at the cost of requiring any future legacy consumer to be explicitly added to the contract surface.

The parent component `LegacyOntologyAdapter` establishes the migration boundary for Phase 42-03. The `LegacyInterfaceCompatibilityLayer` is the internal mechanism that makes that boundary hold at runtime — it is the "how" to the adapter's "what." The two should be understood together: `LegacyOntologyAdapter` defines the isolation strategy; `LegacyInterfaceCompatibilityLayer` implements the translation mechanics.

**Design Trade-off: Isolation vs. Transparency**

By routing calls through shim methods rather than modifying `OntologyValidator` and `OntologyClassifier` directly, the design preserves the integrity of those components and avoids coupling them to migration timing. The trade-off is an additional indirection layer that must be maintained and eventually removed when the migration completes.

---

## Implementation Details

Within `legacy-ontology-adapter.ts`, the `LegacyInterfaceCompatibilityLayer` provides at minimum two shim methods:

- **`validateOntology()`** — Accepts the deprecated parameter signature expected by `OntologyValidator` and remaps it to the equivalent call on `km-core`'s `OntologyRegistry`.
- **`classifyOntology()`** — Accepts the deprecated parameter signature expected by `OntologyClassifier` and similarly delegates to the current `km-core` API.

The translation logic in each shim is responsible for parameter remapping — reshaping argument shapes, reordering parameters, or converting legacy identifiers to current equivalents — so that `km-core` receives well-formed calls regardless of what the legacy callers pass in. The shims act as the single point where knowledge of both the old and new contracts coexists.

Because no source symbols are currently indexed, the precise internal mechanics of the parameter transformations (e.g., field renames, type coercions, default value injection) are not yet observable. However, the structural role of each method is clear from the bounded consumer contract.

---

## Integration Points

`LegacyInterfaceCompatibilityLayer` has two integration surfaces:

1. **Upstream (legacy consumers):** `OntologyValidator` and `OntologyClassifier` call `validateOntology()` and `classifyOntology()` respectively using their legacy parameter expectations. These components are explicitly protected — they must not need modification as a result of the `km-core` migration.

2. **Downstream (current API):** Each shim method delegates to `km-core`'s `OntologyRegistry`, which represents the authoritative current implementation of ontology lookup and classification behavior.

The containment relationship — `LegacyOntologyAdapter` contains `LegacyInterfaceCompatibilityLayer` — means the compatibility layer is not directly instantiated or referenced by consumers. Instead, consumers interact with `LegacyOntologyAdapter` as a whole, and the compatibility layer is an internal implementation concern of that adapter.

---

## Usage Guidelines

**Do not expand the compatibility surface without explicit scoping.** The layer is intentionally bounded to `OntologyValidator` and `OntologyClassifier`. Adding shims for other legacy callers should be a deliberate decision, documented against a specific migration phase, not a convenience measure.

**Treat this layer as temporary infrastructure.** `LegacyInterfaceCompatibilityLayer` exists to support Phase 42-03 migration. Once `OntologyValidator` and `OntologyClassifier` are updated to call `km-core` directly, this layer — and likely `LegacyOntologyAdapter` itself — should be retired. Code in this layer should not be reused or extended for non-migration purposes.

**All translation logic belongs here, nowhere else.** If a parameter mapping or signature conversion is needed to bridge legacy calls to `km-core`, it must live in the shim methods within `legacy-ontology-adapter.ts`. Distributing that logic into `OntologyValidator`, `OntologyClassifier`, or `km-core` itself would defeat the purpose of the isolation boundary.

**Changes to `km-core`'s `OntologyRegistry` API must be reflected here first.** Since this layer is the sole translation point, any upstream API evolution in `km-core` that affects `validateOntology()` or `classifyOntology()` behavior must be absorbed by updating the shim methods — not by modifying the protected consumers.

---

### Scalability and Maintainability Assessment

The design is intentionally narrow in scope, which is its primary maintainability strength. A bounded, two-consumer compatibility layer with a clear retirement condition is far more maintainable than a generalized legacy facade. The risk to maintainability is scope creep — if additional legacy consumers are added to the contract without discipline, the layer accumulates complexity and its retirement becomes increasingly costly. The explicit Phase 42-03 scoping in the parent `LegacyOntologyAdapter` description is the primary guard against this, and that constraint should be preserved in any future documentation or planning.


## Hierarchy Context

### Parent
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- Wraps km-core's OntologyRegistry behind a legacy-compatible interface, isolating the migration boundary so that OntologyValidator and OntologyClassifier continue to function without modification during Phase 42-03


---

*Generated from 3 observations*

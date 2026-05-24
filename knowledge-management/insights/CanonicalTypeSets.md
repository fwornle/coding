# CanonicalTypeSets

**Type:** Detail

Semantic constraint detection logic, documented in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` and its companion design document `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md`, validates runtime usage against these canonical sets to catch drift at the point of code authoring rather than at deployment.

# CanonicalTypeSets: Technical Insight Document

## What It Is

CanonicalTypeSets is the authoritative, closed vocabulary of permitted type identifiers within the system, governed and documented in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` (the "Constraint Configuration Guide"). This document serves as the single source of truth for which type identifiers are permitted, making it both a specification artifact and an operational gating mechanism. Any type identifier referenced at runtime that does not appear in this canonical set is treated as a constraint violation by the monitoring infrastructure documented in `integrations/mcp-constraint-monitor/README.md`.

As a child of the ClosedVocabularyPattern, CanonicalTypeSets represents the concrete data — the enumerated lists themselves — that the broader pattern enforces. Where its sibling MigrationScripts provides the mechanical enforcement pathway for vocabulary changes, CanonicalTypeSets provides the content being enforced: the fixed sets of approved identifiers that scripts and validators consult.

## Architecture and Design

The architecture reflects a deliberate **closed-world assumption**: the set of valid types is finite, explicitly enumerated, and centrally governed. This contrasts with an open-world approach where new types could be inferred or discovered at runtime. By committing to a closed vocabulary, the system gains predictability and verifiability at the cost of requiring explicit governance for every vocabulary extension.

The design follows a **specification-as-enforcement** pattern. The same document (`constraint-configuration.md`) that humans read to understand the vocabulary is the reference that the constraint monitor uses to validate code. This eliminates the drift that typically occurs when documentation and runtime behavior are maintained separately. The semantic constraint detection logic — documented in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` and its companion design document `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md` — is the runtime component that operationalizes this specification.

A key architectural choice is **shift-left validation**: validation occurs at the point of code authoring rather than at deployment or runtime in production. This positions CanonicalTypeSets as a developer-experience contract as much as a system contract. The monitoring infrastructure intercepts type usage early in the development lifecycle, surfacing violations when they are cheapest to fix.

## Implementation Details

The canonical sets themselves are codified in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. The Constraint Configuration Guide enumerates the approved type identifiers and serves as the input data structure consulted by validators. Because the document is the source of truth, changes to the canonical set are governance events — they require explicit edits to this file, which by design must be accompanied by the corresponding migration work managed through the sibling MigrationScripts component.

The semantic constraint detection logic compares observed type usage in code against this canonical reference. As described in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`, this is not mere lexical matching: the detection is "semantic," meaning it understands the context in which a type identifier is being used (e.g., as a declaration versus a reference, as a graph node type versus a generic label). The design rationale, captured in `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md`, drives this dual-document structure — one explaining the operational detection behavior, the other documenting the underlying design reasoning.

The MCP constraint monitor itself, introduced in `integrations/mcp-constraint-monitor/README.md`, is the runtime host for this logic. When type usage is observed that does not appear in CanonicalTypeSets, the monitor raises a constraint violation. This makes the implementation cleanly tripartite: (1) the canonical data in the configuration guide, (2) the detection logic that consults it, and (3) the monitor harness that surfaces violations.

## Integration Points

CanonicalTypeSets integrates upward into its parent ClosedVocabularyPattern, which encapsulates the broader design philosophy of fixed, governed vocabularies. The pattern owns both CanonicalTypeSets (the data) and MigrationScripts (the change-management mechanism), giving it a complete model for vocabulary lifecycle management.

The primary downstream integration is with the semantic constraint detection subsystem in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`. This subsystem reads CanonicalTypeSets as authoritative input and produces violation signals as output. The detection logic is tightly coupled to the configuration guide format, meaning the configuration document is effectively a machine-readable contract as well as a human-readable reference.

A second integration point is with MigrationScripts. When the canonical set must change — typically to admit a new type identifier — MigrationScripts is the mechanism through which the change propagates safely across the system. This sibling relationship ensures that CanonicalTypeSets is never modified in isolation; any vocabulary extension is accompanied by a migration that brings existing data and code into conformance.

The monitoring infrastructure described in `integrations/mcp-constraint-monitor/README.md` is the runtime integration surface. It is the consumer of CanonicalTypeSets in production tooling and the entity that enforces the closed-vocabulary contract on developers.

## Usage Guidelines

**Treat the canonical sets as immutable from a developer's perspective.** New types cannot be introduced ad hoc — any type identifier not present in the canonical set defined in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` will be flagged as a violation. If a new type is genuinely needed, it must be added through explicit edits to the Constraint Configuration Guide, accompanied by the appropriate MigrationScripts work.

**Consult the Constraint Configuration Guide before introducing new type identifiers.** Because the document is the authoritative reference, developers should treat it as required reading when working in areas of the codebase that declare or reference types. The guide is not advisory; it is enforced.

**Resolve violations at authoring time, not deployment time.** The semantic constraint detection is designed to catch drift early. Developers should respond to constraint monitor warnings immediately rather than deferring them, since deferred violations indicate genuine vocabulary drift that will compound over time.

**Understand the dual nature of changes to the canonical set.** A change to CanonicalTypeSets is simultaneously a documentation change and a runtime-behavior change. Reviews of edits to `constraint-configuration.md` should evaluate both the conceptual fit of the new type within the vocabulary and the migration implications handled by MigrationScripts.

**Architectural patterns identified**: closed-world vocabulary, specification-as-enforcement, shift-left validation, single-source-of-truth configuration.

**Design trade-offs**: governance overhead for every vocabulary change is accepted in exchange for predictability, verifiability, and elimination of doc/code drift.

**Scalability considerations**: the closed-vocabulary model scales well in terms of correctness guarantees but introduces a coordination bottleneck — every new type requires a governance step. For systems with rapid type evolution this may become a friction point; for systems prioritizing stability it is a feature.

**Maintainability assessment**: maintainability is high because the vocabulary is centralized, the enforcement is automated, and the documentation is the implementation. The main maintenance burden is keeping the Constraint Configuration Guide synchronized with the semantic detection logic's parsing expectations and ensuring MigrationScripts evolves in lockstep with vocabulary additions.


## Hierarchy Context

### Parent
- [ClosedVocabularyPattern](./ClosedVocabularyPattern.md) -- The migration scripts in integrations/mcp-constraint-monitor/docs/constraint-configuration.md enforce fixed canonical type sets

### Siblings
- [MigrationScripts](./MigrationScripts.md) -- Explicitly identified in the `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` ('Constraint Configuration Guide') as the mechanism that enforces fixed canonical type sets, making them the primary gating control for vocabulary changes across the system.


---

*Generated from 3 observations*

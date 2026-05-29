# TwoLevelOntologyHierarchy

**Type:** Detail

The separation into two files (rather than one unified ontology) allows independent updates to upper or lower tiers, supporting extensibility described in the system architecture docs (docs/architecture/system-overview.md).

# TwoLevelOntologyHierarchy: Technical Insight Document

---

## What It Is

TwoLevelOntologyHierarchy is a foundational structural design within the **Ontology** component of the SemanticAnalysis system. Rather than maintaining a single monolithic ontology definition, the system deliberately partitions its ontological knowledge into two distinct tiers — **upper** and **lower** — each backed by a separate definition file. This separation is documented as a core architectural decision in `docs/RELEASE-2.0.md` (Release 2.0 - Ontology Integration System), signaling that this hierarchy was not an incidental implementation detail but a deliberate foundational choice made at a major system milestone.

The upper tier is intended to capture broad categorical concepts — abstract, cross-domain classifications that provide the structural backbone of the ontology. The lower tier holds domain-specific concepts that are more granular and subject to change as the system's knowledge domain evolves. Together, the two tiers form a complete ontological model, but their physical separation into distinct files is what gives the design its architectural flexibility.

---

## Architecture and Design

The central architectural insight of TwoLevelOntologyHierarchy is the **deliberate decoupling of conceptual granularity from physical file structure**. By splitting the ontology into upper and lower definition files, the design acknowledges that these two tiers have fundamentally different rates of change and different ownership concerns. Upper-tier concepts — broad categorical abstractions — are stable and unlikely to require frequent revision. Lower-tier concepts are domain-specific and naturally evolve as the system's semantic coverage expands. Keeping them in separate files means that updating domain knowledge does not risk destabilizing the foundational categorical structure, and vice versa.

This separation is reinforced by its sibling component, **OntologyConfigManager**, which manages the file paths to both the upper and lower ontology definition files. OntologyConfigManager acts as the indirection layer between the hierarchy's physical files and the rest of the system — neither the upper nor the lower ontology file path is hardcoded into application logic. This means the two-tier structure is not only logically separated but also **runtime-reconfigurable**: the actual files backing each tier can be swapped without any code changes, a property explicitly described in the parent **Ontology** component's architecture documentation (`docs/architecture/system-overview.md`).

The design follows a clear **separation of concerns** principle: TwoLevelOntologyHierarchy defines *what the tiers are and what they mean semantically*, while OntologyConfigManager handles *where those tiers live on disk and how they are located at runtime*. This division prevents the structural definition of the hierarchy from becoming entangled with deployment or configuration concerns.

---

## Implementation Details

The implementation consists of at least two ontology definition files — one for the upper tier and one for the lower tier — whose paths are externalized through OntologyConfigManager rather than embedded in code. No specific file paths for the definition files themselves are surfaced in the available observations, but the architecture documented in the parent Ontology component makes clear that OntologyConfigManager is the authoritative source for resolving these paths at runtime.

The upper ontology file encodes broad categorical concepts that serve as the classification backbone across domains. The lower ontology file encodes domain-specific concepts that reference or extend upper-tier categories. This implies a **hierarchical dependency**: lower-tier concepts are expected to be grounded in or related to upper-tier categories, making the upper ontology a logical prerequisite for correctly interpreting the lower one.

No code symbols (classes, functions, or interfaces) are directly attributed to TwoLevelOntologyHierarchy in the current observations, which is consistent with this being primarily a **data/configuration architecture pattern** rather than a code module. The hierarchy's existence is structural — expressed through file organization and configuration management — rather than through a dedicated class hierarchy.

---

## Integration Points

TwoLevelOntologyHierarchy sits within the **Ontology** component and is directly dependent on **OntologyConfigManager** for runtime resolution of its constituent files. Any system component that needs to access ontological classifications — whether upper-tier categories or lower-tier domain concepts — does so through the Ontology component, which in turn relies on OntologyConfigManager to locate the correct definition files. This means TwoLevelOntologyHierarchy is effectively transparent to consumers of the Ontology component; they interact with a unified ontological model without needing to know which tier a given concept originates from.

The hierarchy's role as a foundational decision for the SemanticAnalysis component (per `docs/RELEASE-2.0.md`) implies that any semantic analysis pipeline consuming ontological classifications is implicitly dependent on this two-tier structure being coherent and correctly configured. Changes to the upper ontology in particular carry system-wide risk, since upper-tier concepts likely serve as anchors for lower-tier definitions throughout the semantic analysis workflows.

---

## Usage Guidelines

**Treat the upper and lower tiers as having different change governance.** The upper ontology should be modified conservatively, as it defines the categorical foundation that lower-tier concepts and potentially downstream semantic analysis logic depend upon. The lower ontology is the appropriate place for domain-specific additions or refinements, and updates there carry lower systemic risk.

**Always route ontology file configuration through OntologyConfigManager.** The design explicitly avoids hardcoding file paths to either tier. Bypassing OntologyConfigManager — for example, by referencing ontology files directly in application code — undermines the runtime reconfigurability that is a stated goal of this architecture and would couple code to deployment-specific file layouts.

**Validate tier coherence when updating either file.** Since lower-tier concepts are expected to relate to upper-tier categories, updating one tier in isolation without verifying consistency with the other risks introducing semantic gaps or broken references in the ontological model. Any release or deployment process that touches the ontology files should include a coherence validation step covering both tiers together.

**Leverage independent tier updates for staged deployments.** The explicit extensibility afforded by separate files means it is architecturally valid to update the lower ontology (domain-specific concepts) in production without touching the upper ontology. This supports incremental knowledge expansion without full ontology redeployment, which is particularly valuable as the SemanticAnalysis component's domain coverage grows over time.


## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- The system maintains a two-level ontology hierarchy (upper/lower) with separate definition files, paths to which are managed by OntologyConfigManager, allowing the classification tier to be reconfigured without code changes

### Siblings
- [OntologyConfigManager](./OntologyConfigManager.md) -- Referenced in the Ontology sub-component description as the mechanism that decouples ontology file paths from code, allowing runtime reconfiguration of both upper and lower ontology tiers.


---

*Generated from 3 observations*

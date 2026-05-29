# OntologyConfigManager

**Type:** Detail

Based on docs/RELEASE-2.0.md ('Release 2.0 - Ontology Integration System'), the ontology integration was introduced as a versioned release, suggesting OntologyConfigManager was a deliberate architectural addition to support swappable ontology files.

# OntologyConfigManager — Technical Insight Document

---

## What It Is

`OntologyConfigManager` is a configuration management component residing within the `Ontology` sub-component of the broader `SemanticAnalysis` system. Its primary responsibility is to decouple ontology file paths from application code, enabling the two-tier ontology hierarchy — upper and lower — to be reconfigured at runtime without requiring code changes. This makes it the authoritative registry for resolving *where* ontology definitions live on disk, separating that concern entirely from the logic that consumes those definitions.

`OntologyConfigManager` directly owns a child component, `SingletonOntologyConfig`, which is the concrete runtime representation of the loaded configuration state. Together, these two components form the configuration layer that underpins the `TwoLevelOntologyHierarchy`, its sibling component within the `Ontology` sub-component.

---

## Architecture and Design

### Decoupling via Configuration Indirection

The central architectural insight of `OntologyConfigManager` is **path indirection**: rather than hardcoding references to ontology definition files within classifier or validator logic, all file path resolution flows through this manager. This mirrors a classic *configuration object* pattern, where a dedicated component owns all environment-sensitive values, and the rest of the system treats those values as injected dependencies. The practical consequence is that swapping ontology files — for instance, upgrading the lower ontology to a new domain-specific taxonomy — requires only a configuration change, not a code deployment.

This design was a deliberate architectural addition, introduced as part of the versioned Release 2.0 Ontology Integration System (documented in `docs/RELEASE-2.0.md`). The versioned release framing signals that the team consciously recognized the need for ontology *swappability* as a first-class requirement, and built `OntologyConfigManager` as the mechanism to fulfill it, rather than retrofitting ad-hoc path management later.

### Two-Path Configuration Model

Because the system maintains a `TwoLevelOntologyHierarchy` — with upper-level ontologies covering broad categorical classifications and lower-level ontologies covering domain-specific definitions — `OntologyConfigManager` necessarily holds at least two distinct path configurations. This mirrors the structural split in its sibling component: the upper and lower tiers are treated as independently configurable units. A developer can therefore update the lower ontology (e.g., swapping in a new domain vocabulary) without touching the upper ontology (e.g., broad entity type classifications), and vice versa.

### Singleton Enforcement for Config Stability

The most significant design decision embedded in this component is the use of the **Singleton pattern**, implemented through its child `SingletonOntologyConfig`. The motivation is explicitly tied to batch run lifecycle: preventing *mid-run config drift* between classifier and validator instances. In a system where multiple components (`SemanticAnalysis` classifiers, validators) may independently attempt to access ontology configuration, a non-singleton approach risks a scenario where one instance loads one version of the config while another loads a different state — a subtle but serious correctness hazard in batch processing. The singleton enforces that all consumers within a run share a single, consistent configuration snapshot.

This is a deliberate trade-off: the singleton sacrifices some flexibility (e.g., running two parallel batch jobs with different ontology configs in the same process would be difficult) in exchange for strong consistency guarantees within a single run's lifecycle.

---

## Implementation Details

### OntologyConfigManager

`OntologyConfigManager` acts as the public interface for retrieving ontology path configurations. Based on the two-tier hierarchy, it is expected to expose — at minimum — separate accessors or configuration slots for the upper ontology path and the lower ontology path. These paths point to the definition files consumed by the `TwoLevelOntologyHierarchy` at classification time.

> **Note:** No code symbols or specific file paths were surfaced in the available observations. The mechanics described here are grounded in the structural and behavioral descriptions provided. Developers should inspect the actual source files for precise method signatures and path resolution logic.

### SingletonOntologyConfig

`SingletonOntologyConfig` is the child component owned by `OntologyConfigManager` and represents the singleton-enforced, loaded state of the configuration. Its singleton nature means it is instantiated once — at the start of a batch run — and that same instance is returned to all subsequent consumers. The explicit design goal, as documented in its description, is to prevent classifier and validator instances from operating with divergent configuration states during a run. This implies that `SingletonOntologyConfig` likely implements a standard singleton guard (e.g., a class-level instance check or a module-level cached instance, depending on the implementation language), and that `OntologyConfigManager` delegates to it for all actual config state storage and retrieval.

The relationship between `OntologyConfigManager` and `SingletonOntologyConfig` follows a **Facade + Singleton** compound pattern: `OntologyConfigManager` provides the semantic interface (e.g., `get_upper_ontology_path()`, `get_lower_ontology_path()`), while `SingletonOntologyConfig` provides the underlying singleton state management. This separation means the singleton mechanics are encapsulated away from callers, who only interact with the manager's interface.

---

## Integration Points

`OntologyConfigManager` sits at the intersection of two containing systems: `SemanticAnalysis` (the broader analysis pipeline) and `Ontology` (the ontology management sub-component). Within `Ontology`, it is the sibling of `TwoLevelOntologyHierarchy` — meaning the hierarchy component depends on paths that `OntologyConfigManager` resolves, but the two are architecturally separated: the hierarchy defines *structure and logic*, while the config manager defines *file locations*.

Any component within `SemanticAnalysis` that needs to load or reference ontology definition files should route that request through `OntologyConfigManager` rather than constructing paths independently. This is the intended integration contract. Classifiers and validators within `SemanticAnalysis` are the primary consumers, and the singleton enforcement ensures they all operate on the same resolved paths.

The introduction of `OntologyConfigManager` in Release 2.0 implies it may have replaced a prior pattern of hardcoded or locally managed paths in the classifier/validator components. New integrations should assume `OntologyConfigManager` is the *sole* authoritative source for ontology file paths.

---

## Usage Guidelines

**Always access ontology paths through `OntologyConfigManager`.** Direct path construction or hardcoded ontology file references in classifier or validator code undermine the decoupling this component provides and create fragility when ontology files are relocated or replaced.

**Treat configuration as immutable within a batch run.** Because `SingletonOntologyConfig` is designed around batch run lifecycle stability, developers should not attempt to reload or mutate the configuration mid-run. Configuration should be resolved once at run initialization and remain stable for the duration. Any need for different ontology configurations should be expressed as separate batch runs.

**Understand the two-path model.** When configuring the system for a new environment or domain, both upper and lower ontology paths must be explicitly set. The upper path governs broad classifications; the lower path governs domain-specific definitions. Providing only one without the other will result in an incomplete configuration for the `TwoLevelOntologyHierarchy`.

**Respect the singleton boundary.** Avoid instantiating `SingletonOntologyConfig` directly outside of `OntologyConfigManager`. The manager is the intended entry point; bypassing it risks creating a second configuration instance that escapes the singleton contract, reintroducing the config drift problem the architecture was designed to prevent.

**Consider environment-specific configuration files.** Since `OntologyConfigManager` was designed to support runtime reconfiguration, the natural operational pattern is to maintain separate configuration files per environment (development, staging, production), each specifying the appropriate upper and lower ontology paths for that environment. This keeps ontology versioning and environment management clean and auditable.


## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- The system maintains a two-level ontology hierarchy (upper/lower) with separate definition files, paths to which are managed by OntologyConfigManager, allowing the classification tier to be reconfigured without code changes

### Children
- [SingletonOntologyConfig](./SingletonOntologyConfig.md) -- Described in parent context as 'implemented as a singleton' specifically to prevent 'mid-run config drift between classifier and validator instances', indicating a deliberate architectural decision tied to batch run lifecycle.

### Siblings
- [TwoLevelOntologyHierarchy](./TwoLevelOntologyHierarchy.md) -- The parent sub-component description explicitly states 'upper/lower' as the two tiers, with separate definition files for each, indicating a deliberate separation of broad categorical concepts from domain-specific ones.


---

*Generated from 3 observations*

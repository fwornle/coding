# SingletonOntologyConfig

**Type:** Detail

Described in parent context as 'implemented as a singleton' specifically to prevent 'mid-run config drift between classifier and validator instances', indicating a deliberate architectural decision tied to batch run lifecycle.

## SingletonOntologyConfig — Technical Insight Document

---

## What It Is

`SingletonOntologyConfig` is a configuration object implemented with singleton semantics, housed within `OntologyConfigManager`. Its primary purpose is to provide a single, immutable view of ontology configuration that is shared across all agents participating in a given batch run of the SemanticAnalysis pipeline. Rather than being a traditional process-scoped singleton (one instance for the lifetime of the process), it is **batch-scoped**: the configuration is locked at the moment a batch run begins and remains constant until that run completes.

---

## Architecture and Design

The central architectural decision here is the deliberate choice of **batch-scoped singleton semantics** over either process-scoped singletons or per-instance configuration objects. This distinction matters because the SemanticAnalysis pipeline runs multiple agent types — specifically classifier and validator instances — that must agree on how ontology terms are resolved. Without a shared, locked configuration, two agents operating concurrently within the same batch could theoretically diverge if configuration were mutable or independently sourced, producing inconsistent classifications and validations against different ontology term definitions. This class of bug — **mid-run config drift** — is explicitly the threat this design guards against.

The parent component, `OntologyConfigManager`, acts as the owning container and lifecycle manager for `SingletonOntologyConfig`. The manager is responsible for initializing and locking the singleton at batch start, making `OntologyConfigManager` the single authoritative entry point for any agent that needs ontology configuration. This containment relationship is architecturally significant: it means configuration access is always mediated through the manager, preventing agents from constructing or mutating configuration independently.

The design reflects a **consistency-over-flexibility** trade-off. By locking configuration at batch start, the system sacrifices the ability to hot-reload or update ontology terms mid-run in exchange for a strong guarantee that every resolution decision made by any agent in the batch is made against the same ontology snapshot. This is the correct trade-off for a batch pipeline where auditability and reproducibility of results are paramount.

---

## Implementation Details

No code symbols are directly available for inspection, so the following is derived from documented behavior. `SingletonOntologyConfig` is instantiated (or finalized) at batch initialization time by `OntologyConfigManager`. Once initialized, the configuration is treated as effectively immutable for the duration of the run — agents read from it but do not write to it. The batch-scoped lifecycle means that across multiple sequential batch runs within the same process, a new `SingletonOntologyConfig` instance may be created for each run, distinguishing this from a naive process-level singleton that would persist stale configuration across batches.

The coordination between the classifier and validator agents is the concrete use case that motivated this design. Both agent types consume ontology term definitions from `SingletonOntologyConfig` to perform their respective tasks. Because they share the exact same configuration object (via `OntologyConfigManager`), any term resolution performed by the classifier is guaranteed to be consistent with the validation logic applied by the validator — they are operating on the same ontological ground truth for that batch.

---

## Integration Points

`SingletonOntologyConfig` integrates primarily through its parent, `OntologyConfigManager`, which serves as the access facade for the rest of the pipeline. Classifier and validator agents are the documented consumers. Any agent in the SemanticAnalysis pipeline that needs to resolve, look up, or validate ontology terms should obtain configuration exclusively through `OntologyConfigManager` rather than constructing configuration independently.

The batch lifecycle boundary is a critical integration contract: whatever system component initiates a batch run is responsible for triggering `OntologyConfigManager` to lock a fresh `SingletonOntologyConfig`. Downstream agents must not cache references to a `SingletonOntologyConfig` across batch boundaries, as the instance may be replaced at the start of each new batch.

---

## Usage Guidelines

**Always access ontology configuration through `OntologyConfigManager`.** Agents should never instantiate or source ontology configuration independently, as this would bypass the singleton guarantee and reintroduce the config drift problem the design explicitly solves.

**Do not hold cross-batch references.** Because the singleton is batch-scoped rather than process-scoped, references obtained in one batch run may become stale or incorrect in a subsequent run. Agents should resolve their configuration reference at batch initialization time through the manager.

**Treat the configuration as read-only at runtime.** The design intent is immutability after batch start. Any agent that attempts to mutate configuration during a run violates the consistency guarantee and risks introducing exactly the mid-run drift this architecture was built to prevent.

**Understand the scope boundary when debugging.** If classifier and validator results appear inconsistent with respect to ontology term resolution, the first diagnostic question should be whether both agents are correctly obtaining their configuration from `OntologyConfigManager` rather than from a stale or independently constructed source.

---

## Architectural Patterns and Trade-Off Summary

| Dimension | Decision |
|---|---|
| **Pattern** | Batch-scoped singleton |
| **Owning container** | `OntologyConfigManager` |
| **Primary threat addressed** | Mid-run config drift across classifier/validator agents |
| **Key trade-off** | Consistency guaranteed; no mid-run config updates possible |
| **Scope** | Batch run lifetime, not process lifetime |
| **Consumers** | Classifier and validator agents in SemanticAnalysis pipeline |


## Hierarchy Context

### Parent
- [OntologyConfigManager](./OntologyConfigManager.md) -- Implemented as a singleton to ensure all pipeline agents share identical ontology configuration throughout a batch run, preventing mid-run config drift between classifier and validator instances


---

*Generated from 3 observations*

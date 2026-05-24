# PostPersistenceInsightTrigger

**Type:** Detail

Consuming already-written KG data (rather than raw pipeline input) implies Insights can be re-run or retried against the same committed graph state without re-ingesting source data, enabling idempotent insight regeneration as documented in the agents.md architecture description.

# PostPersistenceInsightTrigger

## What It Is

The `PostPersistenceInsightTrigger` is a design boundary documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` that defines *when* and *against what data* insight generation activates within the system. Rather than being a mid-pipeline interceptor or transformer, it explicitly marks insight generation as a **post-persistence concern** — meaning the trigger fires only after Knowledge Graph (KG) writes have been fully committed to durable storage.

As a child of the `Insights` parent component, this trigger establishes the operational contract under which all insight-generating agents run: they consume already-written KG data rather than raw pipeline input. This positions Insights agents in a strictly read-only relationship with the Knowledge Graph, operating against a stable, committed snapshot of the graph state rather than volatile in-flight data flowing through ingestion.

In practical terms, `PostPersistenceInsightTrigger` is the conceptual gate that separates the system's write-path (raw pipeline ingestion into the KG) from its read-path (insight consumption from the KG). It is less a single code symbol and more an architectural rule — codified in the agents.md documentation — that shapes how Insights agents are scheduled, isolated, and recovered.

## Architecture and Design

The architectural pattern evident here is a **write/read path separation** with a clean post-commit boundary. The KG ingestion pipeline owns the write path and is responsible for parsing, normalizing, and persisting source data. Once a write is committed, the `PostPersistenceInsightTrigger` boundary is crossed, and only then can the `Insights` parent component begin its work. This is a classic decoupling pattern that treats persistence as the synchronization point between two otherwise independent concerns.

This design enforces a **fault-isolation guarantee** between ingestion and analysis. Because insight generation never participates in the write path, any failure, latency, exception, or resource exhaustion within an Insights agent cannot corrupt or block KG writes. The primary pipeline remains durable and forward-progressing regardless of downstream analytical health — a critical property for systems where data ingestion correctness must not be held hostage to analytical complexity.

The pattern also reflects an **eventual-analysis** model rather than a synchronous-analysis model. Insights are not computed inline as data arrives; they are computed against the committed graph state at some point *after* arrival. This is consistent with the documentation in agents.md, which classifies insight generation as something that activates *after* KG writes are committed, not as a transformation layer riding on the pipeline itself.

## Implementation Details

The observations do not surface specific code symbols — there are 0 code symbols indexed and no key files beyond the architecture documentation itself. The trigger is therefore best understood as a **policy boundary** documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` rather than a single class or function. Its enforcement is distributed: ingestion code does not call into insight code, and insight code only reads from the persisted KG.

Mechanically, this means insight generation operates over a **committed graph state**. Because the KG has already absorbed the writes by the time the trigger condition is satisfied, Insights agents can perform graph <USER_ID_REDACTED>, traversals, or pattern-matching operations with the confidence that the underlying data is stable and complete with respect to whatever write batch preceded the trigger. There is no need for read-locks against an in-flight pipeline buffer or for snapshot isolation against partially-applied changes.

A key implementation property derived from this design is **idempotent insight regeneration**. Because Insights agents consume already-written KG data, the same insight computation can be re-run or retried against the same committed graph state without requiring re-ingestion of source data. This makes recovery, backfill, and reprocessing straightforward: rerunning an insight produces the same result for the same graph state, decoupling insight correctness from pipeline replay.

## Integration Points

The most explicit integration point is the relationship with the parent `Insights` component, which contains `PostPersistenceInsightTrigger` as documented in agents.md. The trigger defines *when* `Insights` agents may run; the `Insights` component defines *what* they do once running. Together they form the post-persistence analytical surface of the system.

On the upstream side, the trigger integrates implicitly with the Knowledge Graph write path — but only through the persistence layer, never through direct coupling. The KG itself is the integration medium: writes commit, and the committed state becomes the input contract for insight generation. There are no documented hooks, callbacks, or message-bus integrations described in the observations; the contract is purely temporal and data-mediated.

On the downstream side, insight outputs (not detailed in the observations) presumably flow into whatever consumers the `Insights` parent exposes. The trigger itself does not participate in output handling — it only defines the read-only entry condition for the analytical workload.

## Usage Guidelines

Developers working on or around `PostPersistenceInsightTrigger` should respect the foundational rule it encodes: **insight logic must never reach into the write path**. Any temptation to enrich, intercept, or transform data mid-pipeline violates the fault-isolation guarantee and dissolves the boundary that makes the system's ingestion path durable. If a transformation must occur during ingestion, it belongs in the pipeline, not in Insights.

Developers should also treat the KG as the **sole input source** for any Insights agent. Reading from raw pipeline buffers, ingestion queues, or pre-persistence caches is explicitly out of scope and would couple Insights to volatile, potentially inconsistent state. The contract is: if the data is not in the committed graph, it is not visible to insight generation.

Because insight generation is post-persistence and operates against committed state, developers can and should design Insights agents to be **idempotent and retry-safe**. Re-running an insight against an unchanged graph state should yield the same result, and partial failures should be recoverable by simple re-invocation rather than by replaying the upstream pipeline. This property, called out in the agents.md architecture description, is one of the primary benefits unlocked by the post-persistence trigger model.

Finally, when adding new insight capabilities under the `Insights` parent, developers should confirm that the new capability fits the read-only, post-commit contract. New capabilities that require synchronous awareness of in-flight data, mid-pipeline intervention, or write-back into the ingestion path do not belong here — they indicate either a redesign of the pipeline itself or a new component entirely outside the `PostPersistenceInsightTrigger` boundary.

---

### Summary of Key Architectural Properties

1. **Architectural patterns identified:** Write/read path separation; post-commit boundary; eventual-analysis (rather than inline-analysis); read-only consumer pattern against a persisted store.
2. **Design decisions and trade-offs:** Trades off real-time insight availability for fault isolation and durability of the write path. Accepts a latency gap between ingestion and insight visibility in exchange for ingestion robustness and idempotent reprocessing.
3. **System structure insights:** The KG itself serves as the integration medium between ingestion and analysis; there is no direct coupling between the two subsystems. The `Insights` parent contains this trigger as the gating boundary for all its agents.
4. **Scalability considerations:** Because Insights agents operate read-only against committed state, they can be scaled, parallelized, retried, or rescheduled independently of ingestion throughput. Insight workloads cannot back-pressure or stall the write path.
5. **Maintainability assessment:** The clear policy boundary documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` makes the contract explicit and enforceable by convention. Idempotent regeneration simplifies operational recovery, and the lack of mid-pipeline coupling means insight logic can evolve without risk to ingestion correctness.


## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- Insight generation operates as a post-persistence concern, consuming already-written KG data rather than raw pipeline input, as described in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md


---

*Generated from 4 observations*

# ProcessTagAttribution

**Type:** Detail

The comment atop cost-model.ts states data flows in from GET /api/token-usage/cost, which is raw token sums grouped including by process — implying the tag is set upstream at completion time (llm-with-process.ts) rather than derived in the cost model itself.

# ProcessTagAttribution — Technical Insight Document

## What It Is

ProcessTagAttribution is a data-tagging convention that originates in **llm-with-process.ts**, part of the **ProxyCompletionClient** component, and terminates as the `process: string` field on the `CostRow` interface defined in **cost-model.ts**. It represents the practice of labeling each completion request with a process identifier at the point of origin, so that downstream cost aggregation can group and report token usage "by month × provider × model × process," as documented in the header comment of cost-model.ts.

## Architecture and Design

The design follows a **tag-at-source, trust-downstream** pattern. Rather than inferring or deriving which process a given cost row belongs to after the fact, the system attaches the process identifier at the earliest possible point — when ProxyCompletionClient (via llm-with-process.ts) issues a completion request. This upstream tagging decision means cost-model.ts is a pure consumer of pre-labeled data; it does not attempt to reconstruct or validate process attribution itself.

This is evident from the data flow described in cost-model.ts's header comment: data enters via `GET /api/token-usage/cost` as raw token sums already grouped by process, provider, and model. The cost model layer's responsibility is therefore limited to shaping and computing over already-attributed rows, not attributing them. This separation of concerns keeps the cost math logic (in cost-model.ts) decoupled from the request-tagging logic (in llm-with-process.ts), which is a parent-child relationship mediated through ProxyCompletionClient.

## Implementation Details

The core data structure is the `CostRow` interface, which declares `process: string` alongside sibling fields `provider`, `model`, and `subscription`. This flat, denormalized row shape is the unit of computation throughout the cost model.

A key implementation detail is the behavior of `isSynthetic(r: CostRow)`, a filter function that inspects `model` and `provider` fields to determine whether a row represents synthetic/test data — but it explicitly leaves `process` untouched. This is a deliberate omission: it signals that process attribution is considered authoritative and reliable by the time rows reach the cost math layer, so no filtering or correction logic needs to be applied to it. The absence of process-related logic in isSynthetic is itself an architectural statement about trust boundaries.

## Integration Points

ProcessTagAttribution's primary integration point is the boundary between request-time tagging (llm-with-process.ts, under ProxyCompletionClient) and the analytics/cost layer (cost-model.ts). The `GET /api/token-usage/cost` endpoint is the transport mechanism connecting these two layers — it delivers pre-aggregated, pre-tagged token sums into the cost model's world. Any consumer of `CostRow` (such as reporting or filtering functions like `isSynthetic`) implicitly depends on the correctness of tagging performed far upstream in the completion client, making this a cross-cutting concern spanning request handling and financial/usage reporting.

## Usage Guidelines

Developers extending or debugging cost attribution should recognize that **process correctness must be enforced at the source** (llm-with-process.ts / ProxyCompletionClient), not retrofitted into cost-model.ts. If process tags are missing or incorrect, the fix belongs in the completion-tagging layer, not in downstream filters like `isSynthetic`. Conversely, if new filtering or validation logic for `process` is needed in the cost model, that represents a deviation from the current trust-based design and should be considered carefully, since it changes an implicit architectural contract. When adding new grouping dimensions to CostRow, follow the existing pattern: tag at the origin, and treat cost-model.ts as a downstream aggregator only.


## Hierarchy Context

### Parent
- [ProxyCompletionClient](./ProxyCompletionClient.md) -- llm-with-process.ts tags each completion request with a process identifier, which downstream shows up as CostRow.process in cost-model.ts


---

*Generated from 3 observations*

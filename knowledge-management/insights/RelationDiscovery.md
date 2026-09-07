# RelationDiscovery

**Type:** Detail

Defined as the 'relate' entry in AGENT_SUBSTEPS['semantic_analysis'] with inputs ['Entities', 'Context windows'] and outputs ['Entity relations', 'Relation types']

# RelationDiscovery — Technical Insight Document

## What It Is

RelationDiscovery is defined as the `relate` entry within `AGENT_SUBSTEPS['semantic_analysis']`, declared in `multi-agent-graph.tsx`. It is the third of four ordered sub-steps in the semantic analysis pipeline (parse, extract, relate, enrich). Its declared contract is straightforward: it consumes `Entities` and `Context windows` as inputs and produces `Entity relations` and `Relation types` as outputs. Functionally, it represents the stage where previously extracted entities are analyzed against their surrounding context to infer how they relate to one another.

## Architecture and Design

The architecture follows a linear, declarative pipeline pattern where each sub-step is defined as a data structure entry (within `AGENT_SUBSTEPS['semantic_analysis']`) rather than as a standalone class or service. This is an inputs/outputs contract model: each step declares what it needs and what it emits, and ordering within the array (`parse → extract → relate → enrich`) implicitly encodes data-flow dependencies rather than relying on explicit orchestration code. RelationDiscovery's position immediately after EntityExtraction is architecturally significant — it depends on entities already being identified before relations between them can be discovered, and it explicitly requires "Context windows," indicating that relation inference is context-sensitive rather than purely based on entity co-occurrence.

The `llmUsage: 'standard'` designation combined with the `techNote: 'Contextual relation extraction'` suggests this step relies on an LLM-driven approach, applied at a standard (non-specialized) tier of model usage, distinguishing it from potentially more intensive or more lightweight steps elsewhere in the pipeline.

## Implementation Details

There are no discrete code symbols or classes associated with RelationDiscovery in the current observations — it exists purely as a metadata entry (`relate`) inside the `AGENT_SUBSTEPS['semantic_analysis']` structure in `multi-agent-graph.tsx`. Its technical behavior is described declaratively via its inputs, outputs, `llmUsage`, and `techNote` fields rather than through explicit implementation code. This suggests the actual execution logic (e.g., prompt construction, LLM invocation, context-window slicing) is handled generically by whatever pipeline runner interprets these `AGENT_SUBSTEPS` entries, with RelationDiscovery only supplying its configuration/contract.

## Integration Points

RelationDiscovery sits within the Pipeline entity as a child component, specifically as one of the four ordered sub-steps under `semantic_analysis`. Upstream, it depends on EntityExtraction, consuming the `Entities` output that step produces alongside `Context windows`. Downstream, it feeds its own output — `Entity relations` — forward into the ContextEnrichment step, making it a mid-pipeline bridge between raw entity identification and enriched contextual understanding. Its sibling steps in the ordered sequence are parse (likely producing the initial parsed structure), extract (EntityExtraction), and enrich (ContextEnrichment), with RelationDiscovery filling the "relate" slot between extraction and enrichment.

## Usage Guidelines

Given its declarative, inputs/outputs-driven definition, any modification to RelationDiscovery should preserve its contract: it must continue to accept `Entities` and `Context windows`, and must continue emitting `Entity relations` and `Relation types` so that ContextEnrichment (its downstream consumer) is not broken. Because ordering in `AGENT_SUBSTEPS['semantic_analysis']` encodes pipeline dependencies, RelationDiscovery must remain positioned after EntityExtraction and before ContextEnrichment. Developers extending this step should be mindful that its `llmUsage: 'standard'` setting and `'Contextual relation extraction'` tech note imply the intended design is LLM-based contextual reasoning rather than rule-based or purely statistical relation extraction — deviating from this approach would represent a departure from the documented design intent.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- AGENT_SUBSTEPS['semantic_analysis'] in multi-agent-graph.tsx defines four ordered sub-steps: parse, extract, relate, enrich, each with declared inputs/outputs


---

*Generated from 3 observations*

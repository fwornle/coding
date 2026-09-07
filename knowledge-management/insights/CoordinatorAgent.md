# CoordinatorAgent

**Type:** Detail

CoordinatorAgent sequences pipeline execution by first invoking extraction logic in semantic-analysis-agent.ts and then passing its output as input to ontology-classification-agent.ts for classification.

# CoordinatorAgent — Technical Insight Document

## What It Is

CoordinatorAgent is the sequencing component within the L2 Pipeline responsible for orchestrating a two-stage workflow across two distinct agent implementations: `semantic-analysis-agent.ts` and `ontology-classification-agent.ts`. Rather than performing extraction or classification logic itself, CoordinatorAgent's role is purely coordinative — it invokes the extraction stage first, then feeds that output forward as input to the classification stage. This makes it the connective tissue in the SemanticAnalysis pipeline's documented "extraction/classification split."

## Architecture and Design

The design reflects a simple, linear pipeline orchestration pattern rather than a parallel or event-driven architecture. CoordinatorAgent acts as a controller that enforces ordering: extraction must complete in `semantic-analysis-agent.ts` before classification begins in `ontology-classification-agent.ts`. This sequential dependency is a deliberate architectural choice — classification logically requires extracted semantic units as its input, so the coordinator encodes this data-flow dependency directly in its execution order rather than leaving it to the caller or a more generic scheduler.

As a child of the Pipeline entity, CoordinatorAgent embodies the Pipeline's stage-based structure at a finer grain: where Pipeline defines the overall multi-stage process, CoordinatorAgent is the concrete mechanism that walks through those stages for the SemanticAnalysis flow specifically. This suggests a pattern where coordinator-style agents may be a recurring structural role within Pipeline, with CoordinatorAgent as the instance handling the semantic extraction/classification sequence.

## Implementation Details

The core mechanic is straightforward: CoordinatorAgent first invokes the extraction logic housed in `semantic-analysis-agent.ts`, then takes the resulting output and passes it as the input argument to the classification logic in `ontology-classification-agent.ts`. This two-call handoff is the entirety of its documented behavior — there is no indication of branching, retries, or parallel execution paths in the observations. The implementation is effectively a thin orchestration layer sitting above two otherwise independent agent modules.

## Integration Points

CoordinatorAgent's primary integration points are its two sibling agent files: `semantic-analysis-agent.ts` (upstream, extraction) and `ontology-classification-agent.ts` (downstream, classification). Its dependency direction is unidirectional — extraction output flows into classification input — establishing a clear contract between the two stages. At the higher level, CoordinatorAgent is contained within Pipeline, meaning any changes to Pipeline's stage definitions or execution model would directly affect how CoordinatorAgent is invoked and sequenced.

## Usage Guidelines

Developers modifying either `semantic-analysis-agent.ts` or `ontology-classification-agent.ts` must preserve the output/input contract that CoordinatorAgent relies on, since it passes extraction output directly as classification input without an apparent transformation layer. Because CoordinatorAgent enforces strict ordering, any changes introducing asynchronous or parallel extraction would require corresponding updates to the coordinator's sequencing logic. Given its minimal, single-purpose role, CoordinatorAgent should remain a thin orchestration layer — additional business logic belongs in the two agent modules it coordinates, not in the coordinator itself.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- Pipeline stages include a coordinator agent that sequences execution across semantic-analysis-agent.ts and ontology-classification-agent.ts, matching the two-stage extraction/classification split described for SemanticAnalysis


---

*Generated from 3 observations*

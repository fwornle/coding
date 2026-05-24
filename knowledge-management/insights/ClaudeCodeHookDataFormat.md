# ClaudeCodeHookDataFormat

**Type:** Detail

The coexistence of `CLAUDE-CODE-HOOK-FORMAT.md` (event ingestion) and `integrations/mcp-constraint-monitor/docs/status-line-integration.md` (UI feedback) reveals a two-stage pipeline: raw hook payloads are received, constraint evaluation occurs, and results are surfaced to developers via status line output.

# ClaudeCodeHookDataFormat

## What It Is

The `ClaudeCodeHookDataFormat` is a specification document located at `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` that defines the payload schema emitted by Claude Code when invoking the constraint monitor as a downstream hook consumer. It establishes the contract for the primary ingestion boundary of the `MCPConstraintMonitor` system, codifying exactly what data structure flows across the integration seam between Claude Code and the constraint enforcement pipeline.

As a Detail-type artifact under the `MCPConstraintMonitor` parent component, this format specification is foundational rather than operational — it does not execute logic itself but rather governs the shape of every interaction that downstream constraint-evaluation logic must handle. Without this schema being honored, no constraint can be evaluated, because the monitor would have no reliable way to parse what Claude Code has sent.

The document sits alongside other integration documentation in the `integrations/mcp-constraint-monitor/docs/` directory, where it forms one half of a coherent integration story: defining what comes in, while companion documents like `status-line-integration.md` define what goes out.

## Architecture and Design

The presence of `ClaudeCodeHookDataFormat` reveals a fundamentally **reactive, event-driven architectural model**. The constraint monitor does not poll Claude Code or proactively inspect its state; instead, Claude Code pushes structured payloads to the monitor when relevant events occur. This hook-based integration pattern, which aligns with the component-level event-driven design described in `integrations/mcp-constraint-monitor/README.md`, decouples the monitor's execution lifecycle from Claude Code's internal operation while ensuring the monitor sees every event of interest in real time.

The coexistence of `CLAUDE-CODE-HOOK-FORMAT.md` (ingestion) and `integrations/mcp-constraint-monitor/docs/status-line-integration.md` (UI feedback) reveals a clear **two-stage pipeline architecture**:

1. **Ingestion stage**: Raw hook payloads conforming to `ClaudeCodeHookDataFormat` are received from Claude Code.
2. **Evaluation and surfacing stage**: Constraint evaluation occurs on the parsed payload, and results are surfaced to developers via status line output.

This pipeline separation reflects a classic **boundary-isolation pattern**: by formalizing the input contract in a dedicated document, the system localizes the impact of any upstream changes from Claude Code to a single, well-defined translation point. Internal constraint-evaluation logic — including any work performed by the sibling `SemanticConstraintDetection` component — can operate on a stable internal representation derived from the hook payload, insulated from upstream churn.

## Implementation Details

The `ClaudeCodeHookDataFormat` itself is a specification rather than executable code, so its implementation is the schema definition contained in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. This document establishes the field-level structure that Claude Code commits to emitting and that the constraint monitor commits to accepting.

Mechanically, this schema serves as the deserialization target for hook invocations. When Claude Code triggers the monitor as a downstream hook consumer, the payload arrives in the format prescribed here, and the monitor's ingestion layer parses it into in-memory structures suitable for constraint evaluation. Because the format is documented separately from the consuming code, it functions as a stable interface artifact: changes to the schema require explicit document updates, providing a deliberate friction point that helps prevent silent contract drift.

The format specification is intentionally narrow in scope — it covers only the inbound hook payload. Downstream concerns such as how constraints are detected (the domain of `SemanticConstraintDetection`, documented across `semantic-constraint-detection.md` and `semantic-detection-design.md`) and how results are presented (covered by `status-line-integration.md`) are handled by separate artifacts. This separation keeps the schema document focused and authoritative.

## Integration Points

The most significant integration point is the boundary with **Claude Code itself**, which acts as the producer of payloads conforming to `ClaudeCodeHookDataFormat`. Claude Code invokes the constraint monitor as a downstream hook consumer, and this format defines what Claude Code must send and what the monitor will accept.

Within the `MCPConstraintMonitor` parent module, the format feeds directly into the constraint-evaluation pipeline. The sibling component `SemanticConstraintDetection` — which has both an operational guide (`semantic-constraint-detection.md`) and a separate design rationale (`semantic-detection-design.md`) — consumes the parsed representation of these payloads when performing its semantic analysis work. The format therefore acts as the upstream contract that semantic detection depends upon.

On the output side, the pipeline terminates in the status line integration described in `integrations/mcp-constraint-monitor/docs/status-line-integration.md`. Although `ClaudeCodeHookDataFormat` does not directly interact with the status line, it is the originating data source whose evaluation outcomes ultimately drive that feedback channel. Any field present in the hook payload may influence what developers see in their status line.

## Usage Guidelines

Developers extending or maintaining the `MCPConstraintMonitor` should treat `ClaudeCodeHookDataFormat` as the **canonical reference** for what hook data looks like. Any new constraint-evaluation logic, including additions to `SemanticConstraintDetection`, should consult this document first to confirm which fields are available and how they are structured, rather than relying on ad-hoc inspection of runtime payloads.

When changes to the hook payload are required — either because Claude Code has evolved its emission format or because the monitor needs new information — the schema document must be updated alongside the code. Because the format defines the ingestion boundary of the entire system, undocumented changes carry the risk of breaking constraint evaluation system-wide. Treat schema updates as breaking-change candidates and verify that all downstream consumers (semantic detection, status line surfacing) handle the new shape correctly.

Finally, given the reactive, push-based nature of the integration, developers should not introduce polling or pull-based mechanisms that bypass the hook channel. The architectural choice to operate reactively on Claude Code-pushed events is intentional and consistent throughout the `MCPConstraintMonitor`; alternative ingestion paths would fragment the data model and undermine the value of having a single, well-defined hook format.

---

### Summary Insights

1. **Architectural patterns identified**: Reactive, event-driven hook consumption; two-stage ingestion-then-surfacing pipeline; boundary-isolation via a dedicated schema document.
2. **Design decisions and trade-offs**: Choosing push-based hooks over polling trades some control over invocation timing for guaranteed event coverage and reduced overhead; documenting the format separately from code trades minor duplication for a stable, auditable contract.
3. **System structure insights**: The format sits at the upstream edge of `MCPConstraintMonitor`, feeding a pipeline that includes `SemanticConstraintDetection` and terminates at status-line output, giving the module a clear input-process-output shape.
4. **Scalability considerations**: Because the monitor reacts to events rather than polling, its workload scales naturally with Claude Code activity; the well-defined schema also enables future batching or asynchronous processing without changing the contract.
5. **Maintainability assessment**: Strong — the dedicated specification document makes the ingestion contract explicit, the separation between format, detection, and surfacing concerns keeps each artifact focused, and the parallel documentation of sibling components (operational vs. design rationale) suggests a mature documentation culture that should ease long-term maintenance.


## Hierarchy Context

### Parent
- [MCPConstraintMonitor](./MCPConstraintMonitor.md) -- The MCPConstraintMonitor module in integrations/mcp-constraint-monitor/README.md monitors and enforces constraints

### Siblings
- [SemanticConstraintDetection](./SemanticConstraintDetection.md) -- Documented across two distinct files — `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` and `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md` — indicating this feature is complex enough to require both an operational guide and a separate design rationale document.


---

*Generated from 3 observations*

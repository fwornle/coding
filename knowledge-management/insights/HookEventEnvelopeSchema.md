# HookEventEnvelopeSchema

**Type:** Detail

By isolating the envelope schema in a dedicated format document (CLAUDE-CODE-HOOK-FORMAT.md) rather than embedding it in implementation code, the design allows the constraint monitor dashboard (integrations/mcp-constraint-monitor/dashboard/) and other consumers to reference a single authoritative format definition.

# HookEventEnvelopeSchema

## What It Is

The `HookEventEnvelopeSchema` is a structured data contract defined in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` (titled "Claude Code Hook Data Format"). It specifies the canonical envelope format that standardizes how hook event data is represented and transmitted from Claude Code into the MCP Constraint Monitor integration. Rather than existing as an implementation artifact in code, the schema lives as a format specification document, establishing a normative reference for all producers and consumers of hook event data.

As a child of the `StructuredEventEnvelopePattern`, this schema represents the concrete realization of that broader pattern for the Claude Code hook domain. It defines the top-level fields every hook event must carry, providing a uniform shape that downstream components can rely on regardless of which specific hook event type is being transmitted underneath.

## Architecture and Design

The architectural approach centers on a **contract-first design**: the envelope schema is documented in `CLAUDE-CODE-HOOK-FORMAT.md` as a shared interface specification rather than being embedded inside implementation source code. This documentation-as-contract pattern decouples the producer (Claude Code's hook emitter) from the various consumers within `integrations/mcp-constraint-monitor/`, allowing each side to evolve independently as long as they conform to the documented envelope.

The schema follows an **envelope pattern**, where a stable outer structure carries variable inner payloads. This separation means consumers can reliably parse top-level metadata fields (routing, identification, timing) without needing to understand every possible hook event type variant. The envelope acts as the boundary contract between the hook-emitting subsystem and the constraint-monitoring subsystem.

This design inherits directly from its parent, `StructuredEventEnvelopePattern`, which generalizes the principle of wrapping event data in a structured outer container. Where the parent pattern describes the abstract concept, the `HookEventEnvelopeSchema` is the domain-specific instantiation tailored to Claude Code hooks.

## Implementation Details

Because the schema is defined as a specification document rather than executable code, its "implementation" is the format definition itself, located at `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. There are no code symbols, classes, or functions associated with the schema directly — instead, it is realized by every component that produces or consumes hook events conforming to its shape.

The mechanics are straightforward: producers (the Claude Code hook emitter) construct payloads matching the envelope structure described in `CLAUDE-CODE-HOOK-FORMAT.md`, and consumers within `integrations/mcp-constraint-monitor/` parse those payloads according to the same document. This indirection through a written specification means the schema is treated as authoritative, with implementations validated against it rather than against each other.

The decision to externalize the schema into documentation rather than encoding it as a runtime artifact (such as a JSON Schema file or TypeScript interface) implies that the contract is intentionally readable and language-agnostic. Any consumer — whether the dashboard, monitoring logic, or future integrations — can reference the same document as the single source of truth.

## Integration Points

The envelope schema serves as the **shared contract between the Claude Code hook emitter and the MCP Constraint Monitor integration** under `integrations/mcp-constraint-monitor/`. This is its primary integration boundary: it standardizes the wire format flowing between these two systems.

A key downstream consumer is the constraint monitor dashboard at `integrations/mcp-constraint-monitor/dashboard/`. Because the schema is defined in an authoritative external document rather than buried in producer code, the dashboard and any other consumers can independently parse and visualize hook events without depending on internal implementation details of the emitter.

Within the entity hierarchy, this schema is contained by `StructuredEventEnvelopePattern`, which provides the broader architectural rationale for the envelope approach. Other concrete envelope schemas that may exist as siblings under the same pattern would share the same structural philosophy — a stable outer shape with variable inner content — even if their specific fields differ.

## Usage Guidelines

Developers integrating with hook events should treat `CLAUDE-CODE-HOOK-FORMAT.md` as the authoritative source for envelope structure. When implementing a new consumer inside `integrations/mcp-constraint-monitor/` or elsewhere, parse against the documented top-level fields rather than inferring structure from sample payloads or producer code.

When emitting hook events, producers must conform to the envelope's top-level fields so that all consumers — present and future — can route, filter, and interpret events consistently. Variations or extensions should be added to the inner payload portion of the envelope rather than altering the outer envelope shape, preserving backward compatibility for consumers that only read the standardized fields.

Because the schema is documented rather than codified, any change to the envelope structure should be reflected first in `CLAUDE-CODE-HOOK-FORMAT.md`, with implementations updated to match. This documentation-first workflow is essential for maintaining the integrity of the contract between the hook emitter and the constraint monitor.

## Architectural Patterns Identified

- **Envelope Pattern**: a stable outer structure wraps variable inner event data, enabling uniform parsing across heterogeneous event types.
- **Contract-First / Documentation-as-Contract**: the schema lives in a specification document (`CLAUDE-CODE-HOOK-FORMAT.md`) rather than implementation code, serving as the authoritative interface definition.
- **Shared Schema Boundary**: the envelope formalizes the seam between the Claude Code hook emitter and the `integrations/mcp-constraint-monitor/` consumer subsystem.

## Design Decisions and Trade-Offs

The decision to externalize the schema into a Markdown specification rather than a runtime artifact (e.g., JSON Schema, Zod, TypeScript types) trades automated validation tooling for language-agnostic readability and a single human-authoritative reference. This favors documentation clarity and cross-implementation consistency at the cost of compile-time or runtime enforcement.

Placing the schema under `integrations/mcp-constraint-monitor/docs/` rather than a shared top-level location signals that the constraint monitor integration is the primary steward of the format, even though the producer (Claude Code) lies outside that directory. This colocation with the consumer is pragmatic but means the document's authority must be respected by external producers.

## System Structure Insights

The `HookEventEnvelopeSchema` operates as the canonical seam between event production (Claude Code) and event consumption (`integrations/mcp-constraint-monitor/` and its `dashboard/`). Its position as a child of `StructuredEventEnvelopePattern` reveals a deliberate layering: the abstract envelope concept at the top, with domain-specific instantiations beneath. This structure encourages additional envelope schemas to follow the same pattern when new event domains are introduced.

## Scalability Considerations

A documentation-based schema scales well in terms of new consumers — any number of downstream components (dashboard, alerting, audit pipelines) can read the same authoritative spec without coupling to producer internals. However, it scales less gracefully in terms of enforcement: as the number of consumers grows, drift between documented and actual payload shapes becomes a risk without complementary validation tooling. Adoption of programmatic schema validation derived from `CLAUDE-CODE-HOOK-FORMAT.md` would be a natural evolution if scale demands it.

## Maintainability Assessment

Maintainability is strong on the clarity axis: a single Markdown document in `integrations/mcp-constraint-monitor/docs/` serves as the unambiguous source of truth, making onboarding and cross-team alignment straightforward. The risk lies in the lack of mechanical enforcement — changes to the document do not automatically propagate to code, so disciplined practice is required to keep producers and consumers in sync. The envelope pattern itself aids maintainability by isolating top-level structural changes from inner payload evolution, allowing the schema to grow without breaking existing consumers that only depend on the standardized outer fields.


## Hierarchy Context

### Parent
- [StructuredEventEnvelopePattern](./StructuredEventEnvelopePattern.md) -- The CLAUDE-CODE-HOOK-FORMAT.md document specifies the structured event envelope format


---

*Generated from 3 observations*

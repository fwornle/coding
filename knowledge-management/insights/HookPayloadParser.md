# HookPayloadParser

**Type:** Detail

integrations/mcp-constraint-monitor/docs/constraint-configuration.md likely defines how extracted fields (tool name, file paths, session context) map to constraint check inputs, connecting the parser output to the constraint evaluation pipeline

# HookPayloadParser — Technical Insight Document

## What It Is

`HookPayloadParser` is a component residing within the `HookConfigurationLayer`, responsible for deserializing and normalizing the JSON payloads that Claude Code emits at hook lifecycle points. The authoritative contract for these payloads is documented in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`, which defines the exact JSON schemas emitted at each hook lifecycle point (at minimum pre- and post-tool invocation). The parser sits at the boundary between raw hook events and the constraint evaluation pipeline, extracting structured fields — tool name, file paths, session context — that downstream components can act upon.

## Architecture and Design

**Boundary Role within HookConfigurationLayer**

`HookPayloadParser` occupies a narrow, well-defined role as the inbound data translator inside `HookConfigurationLayer`. Its parent component's responsibility, as grounded in the observations, is to both configure hook behavior and parse incoming hook data; the parser specifically handles the latter concern. This separation suggests the `HookConfigurationLayer` follows a parsing-then-dispatch pattern: raw JSON arrives, `HookPayloadParser` normalizes it into a typed structure, and that structure is forwarded to the constraint evaluation pipeline whose inputs are defined in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`.

**Schema Multiplicity as a Core Design Challenge**

The most significant architectural pressure on this component is that different hook lifecycle points emit structurally different JSON shapes. Pre-tool-invocation and post-tool-invocation payloads likely carry distinct fields (e.g., the post-invocation payload may include tool output or exit status that the pre-invocation payload cannot). The parser must therefore discriminate on lifecycle point identity before applying the appropriate field-extraction logic. This naturally points toward a variant/discriminated-union parsing approach — where the lifecycle type acts as a discriminator key — rather than a single flat schema that attempts to cover all cases with optional fields.

**Contract-Driven Design**

The grounding of the parser in a dedicated format document (`CLAUDE-CODE-HOOK-FORMAT.md`) reflects a contract-first design philosophy. The schema is externally specified and separately documented, meaning the parser is explicitly downstream of that contract. This is a deliberate trade-off: it makes the parser's correctness dependent on keeping implementation aligned with the documentation, but it provides a single source of truth that can be referenced across multiple consumers without duplicating schema definitions.

## Implementation Details

No code symbols or implementation files were resolved in the current analysis pass, so the following is inferred from the structural observations rather than direct code inspection.

**Field Extraction Targets**

Based on the observations, the parser's output surface covers at least three categories of extracted fields:

1. **Tool name** — identifying which Claude Code tool triggered the hook
2. **File paths** — paths to files involved in the tool invocation, which become inputs to file-level constraint checks
3. **Session context** — session-scoped metadata (session ID, user context, or similar) that may gate or <USER_ID_REDACTED> constraint evaluation

These three field categories map directly to the inputs consumed by the constraint configuration layer described in `constraint-configuration.md`, establishing a clean data flow: raw JSON → `HookPayloadParser` → structured fields → constraint evaluator.

**Lifecycle-Aware Parsing**

Because the hook format documentation specifies different shapes per lifecycle point, the parser likely routes parsing through lifecycle-specific handlers or schema branches. The pre-invocation path would extract prospective context (what tool is *about to* run, what paths it *will* touch), while the post-invocation path would additionally extract outcome data. This lifecycle awareness is not merely a parsing convenience — it determines which constraint checks are meaningful to invoke (pre-invocation checks can block; post-invocation checks can audit).

## Integration Points

The primary upstream dependency is the Claude Code hook emission mechanism, whose contract is fully specified in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. Any change to the JSON schema Claude Code emits must be reflected in this parser; the format document is therefore a critical change-coupling point.

The primary downstream consumer is the constraint evaluation pipeline, whose input expectations are described in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. The parser's output schema must satisfy whatever field contract the constraint evaluator requires — meaning these two documents together (`CLAUDE-CODE-HOOK-FORMAT.md` and `constraint-configuration.md`) bracket the parser's full interface contract: one defines what comes in, the other defines what must come out.

Within the `HookConfigurationLayer`, the parser is a subordinate component. The configuration layer presumably manages hook registration and routing in addition to parsing, so the parser's output is consumed internally before any external dispatch occurs.

## Usage Guidelines

**Treat `CLAUDE-CODE-HOOK-FORMAT.md` as the single source of truth.** When Claude Code updates its hook payload schema, this document should be updated first, and parser changes should be derived from it — not the reverse. Developers should not infer schema structure from observed runtime payloads alone, as undocumented fields may be unstable.

**Do not flatten lifecycle variants into a single permissive schema.** Given that pre- and post-invocation payloads differ structurally, using a single schema with all fields marked optional trades compile-time safety for parsing convenience. The preferred approach is explicit branching on lifecycle type, producing distinct typed outputs per lifecycle point, even if those types share common fields through composition.

**Validate extracted fields before forwarding.** Since the parser sits at a trust boundary (Claude Code is an external emitter), missing or malformed fields in the payload should be handled defensively. Fields like file paths and tool names that become constraint check inputs should be validated for presence and basic structural integrity before the constraint pipeline receives them — failures should surface as parse errors, not as silent null/undefined values propagating into constraint logic.

**Keep parser logic free of constraint evaluation concerns.** The parser's responsibility ends at field extraction and normalization. Logic that determines *whether* a constraint applies belongs in the constraint evaluation layer, informed by `constraint-configuration.md`. Mixing constraint logic into the parser would couple two concerns that have different rates of change and different configuration ownership.


## Hierarchy Context

### Parent
- [HookConfigurationLayer](./HookConfigurationLayer.md) -- integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md documents the exact JSON schema Claude Code emits at each hook lifecycle point, which the configuration layer must parse to extract tool name, file paths, and session context


---

*Generated from 3 observations*

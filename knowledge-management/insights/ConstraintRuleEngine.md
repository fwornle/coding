# ConstraintRuleEngine

**Type:** SubComponent

integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md and semantic-detection-design.md indicate the engine supports semantic (meaning-based) constraint matching beyond simple pattern rules, using LLM-assisted classification

## What It Is

The ConstraintRuleEngine is a sub-component of the ConstraintSystem, implemented within the `integrations/mcp-constraint-monitor/` package. It is responsible for evaluating tool calls and file operations against configured constraint rules, determining whether actions violate defined policies. The engine employs a dual-strategy evaluation approach: syntactic (pattern-based) rule matching and semantic (meaning-based) constraint detection.

## Architecture and Design

The engine is structured around two distinct evaluation strategies. Syntactic rule matching handles deterministic pattern-based checks, while semantic detection leverages LLM-assisted classification for meaning-based constraint evaluation (as documented in `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md`).

![ConstraintRuleEngine — Architecture](images/constraint-rule-engine-architecture.png)

The engine delegates configuration loading to RuleConfigLoader, which validates against the schema defined in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. This schema includes rule types, scopes, and enforcement modes. The SemanticConstraintDetector handles the LLM-assisted classification path for constraints that cannot be expressed as simple patterns.

![ConstraintRuleEngine — Relationship](images/constraint-rule-engine-relationship.png)

Within the broader ConstraintSystem, the engine receives evaluation requests from HookInterceptor (which captures pre-tool and post-tool events) and operates alongside MCPConstraintMonitorIntegration which exposes the system as an MCP server.

## Implementation Details

The configuration schema (per `constraint-configuration.md`) supports multiple rule types, scoping mechanisms, and enforcement modes. Rules can target specific tools, file paths, or broader behavioral patterns. Enforcement modes likely range from blocking to warning/audit-only.

The semantic detection layer (`semantic-constraint-detection.md`) extends evaluation beyond what regex or glob patterns can express—detecting intent-level violations where the tool call's meaning, not just its syntax, matters.

## Integration Points

- **Upstream**: Receives structured hook payloads from HookInterceptor containing tool call context
- **Downstream**: Returns violation determinations to the ConstraintSystem for persistence and dashboard display
- **Configuration**: RuleConfigLoader ingests rule definitions at startup
- **External**: SemanticConstraintDetector calls an LLM for classification when semantic rules are triggered

## Usage Guidelines

Constraint rules should be configured per the schema in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. Prefer syntactic rules for deterministic, performance-sensitive checks. Reserve semantic detection for constraints that genuinely require meaning-based evaluation, as it introduces LLM latency and non-determinism. Scope rules as narrowly as possible to minimize unnecessary evaluation overhead.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It operates primarily through a hook-based architecture where hooks intercept agent tool calls (pre-tool, post-tool events) and evaluate them against constraint rules, capturing any violations for persistence and dashboard display. The system integrates with the MCP (Model Context Protocol) infrastructure via the mcp-constraint-monitor integration, and bridges live session activity with persistent violation history storage.

### Children
- [SemanticConstraintDetector](./SemanticConstraintDetector.md) -- integrations/mcp-constraint-monitor/docs/semantic-detection-design.md describes the design for LLM-assisted semantic matching of tool calls against constraint rules
- [RuleConfigLoader](./RuleConfigLoader.md) -- integrations/mcp-constraint-monitor/docs/constraint-configuration.md ('Constraint Configuration Guide') defines the full configuration schema this loader must validate against, including rule types, scopes, and enforcement modes

### Siblings
- [HookInterceptor](./HookInterceptor.md) -- integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md defines the wire format for hook payloads exchanged between Claude Code and the constraint monitor, covering pre-tool and post-tool event structures
- [MCPConstraintMonitorIntegration](./MCPConstraintMonitorIntegration.md) -- integrations/mcp-constraint-monitor/README.md describes the integration package that wraps constraint monitoring as an MCP-compatible server component


---

*Generated from 3 observations*

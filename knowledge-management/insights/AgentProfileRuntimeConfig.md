# AgentProfileRuntimeConfig

**Type:** Detail

The core convention established by this sub-component is that config/agent-profiles.json owns model identity and runtime tuning, while agent wiring and topology definitions live in separate files; this boundary is described as intentional in the Agent Architecture documentation at integrations/mcp-server-semantic-analysis/docs/architecture/agents.md.

# AgentProfileRuntimeConfig

## What It Is

AgentProfileRuntimeConfig is the runtime behavioral configuration layer for agents, implemented in `config/agent-profiles.json` within the `integrations/mcp-server-semantic-analysis` project. It owns the fields that determine *how an agent thinks and behaves at inference time*—specifically model identity, inference tuning parameters, and capability declarations—while deliberately excluding any concerns about *how agents are wired together* or *what topology they participate in*.

The authoritative schema for this configuration is documented at `integrations/mcp-server-semantic-analysis/docs/configuration.md`, which defines which fields legitimately belong in `agent-profiles.json` versus fields that should live in topology or integration configuration files. The boundary between these concerns is treated as a first-class architectural rule rather than an incidental file split, and is described as intentional in the Agent Architecture documentation at `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`.

As a Detail under its parent ConfigurationSeparationConventions, AgentProfileRuntimeConfig represents the "behavioral configuration" half of a deliberate two-sided separation: behavioral config here, topology and orchestration elsewhere. This makes the file a focused, single-purpose surface for operators tuning agent behavior.

## Architecture and Design

The architectural pattern in play is **separation of concerns by configuration file**, where each configuration artifact owns one axis of variability. `agent-profiles.json` owns the behavioral axis (model, parameters, capabilities), while sibling configuration files own the structural axis (agent graph definitions, orchestration pipelines, integration wiring). This is a classic configuration-as-data design where the schema boundaries enforce architectural boundaries.

This design directly serves the parent ConfigurationSeparationConventions principle that runtime behavioral configuration must be isolated from topology concerns. By making `agent-profiles.json` the sole home for model selection and inference tuning, the project ensures that no behavioral knob leaks into topology files and—conversely—no topology decision contaminates a profile entry. The schema reference in `docs/configuration.md` and the architectural rationale in `docs/architecture/agents.md` act as the two anchoring documents that make this convention enforceable through review rather than only through code.

The design is complementary to its sibling, TieredModelSelectionPolicy (documented at `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`). Where AgentProfileRuntimeConfig defines the *mechanism* for assigning a model to a specific agent profile, TieredModelSelectionPolicy proposes a *policy* for choosing between lightweight and full-capability models per profile rather than applying a single global model. The tiered proposal is only viable *because* AgentProfileRuntimeConfig already provides per-profile model selection as a first-class field—the two design elements reinforce each other.

## Implementation Details

The implementation centers on a single JSON file, `config/agent-profiles.json`, structured as a collection of profile entries. Each entry encapsulates three categories of fields as enumerated in `docs/configuration.md`:

- **Model selection** — identifies which underlying model an agent profile should use.
- **Parameters** — inference-time tuning knobs (temperature, token limits, and similar values that affect generation behavior).
- **Capabilities** — declarative flags or descriptors of what the profile is allowed or expected to do.

Notably absent from the file—by design—are any references to agent graph edges, orchestration sequencing, message routing, or integration endpoints. Those concerns are externalized to separate configuration files as documented in `docs/architecture/agents.md`. The schema reference in `docs/configuration.md` serves both as developer documentation and as the implicit contract that reviewers check entries against.

Because there are no associated code symbols for this sub-component (it is purely a data file plus a documented schema), the "implementation" is essentially the JSON structure itself plus the discipline of keeping it pure. The mechanics of loading and consuming `agent-profiles.json` live in code paths owned by other components; AgentProfileRuntimeConfig's responsibility ends at the file boundary.

## Integration Points

AgentProfileRuntimeConfig is consumed by whatever runtime layer instantiates and operates agents within `integrations/mcp-server-semantic-analysis`. The profile data feeds into model client construction and inference parameter passing, while the capabilities fields presumably gate or annotate what each agent is permitted to do at runtime.

The most important integration *boundary*—the one defined by the convention rather than by code—is its relationship with topology configuration. Agent graph definitions and orchestration pipelines live in separate files and reference profiles by identity, never by inlining behavioral fields. This means that integration between profile data and topology data happens through profile identifiers, keeping the two domains loosely coupled.

Within the documentation graph, AgentProfileRuntimeConfig is anchored by two files: `docs/configuration.md` (schema authority) and `docs/architecture/agents.md` (rationale and boundary description). It sits under ConfigurationSeparationConventions as the behavioral-side detail, and it provides the per-profile model field that the sibling TieredModelSelectionPolicy proposal at `docs/TIERED-MODEL-PROPOSAL.md` builds upon.

## Usage Guidelines

When working with `agent-profiles.json`, treat the file as the *only* place to change agent behavioral characteristics. To swap a model for a given agent, edit that profile's model field. To adjust inference parameters such as temperature or token limits, edit the corresponding parameter fields. To change what capabilities a profile declares, modify its capabilities list. None of these operations should require touching agent graph definitions, orchestration pipelines, or integration configuration files.

Conversely, never introduce topology, routing, or wiring fields into `agent-profiles.json`. If a proposed change feels like it belongs in a profile but is really about *how agents connect or sequence*, it belongs in a topology file instead. The schema reference in `integrations/mcp-server-semantic-analysis/docs/configuration.md` is the source of truth for which fields are legitimate here; consult it before adding new keys.

The operational benefit of respecting this convention is a substantially reduced blast radius for tuning changes. Because behavioral config is isolated from topology, operators can swap models or adjust inference parameters by editing `agent-profiles.json` entries alone—orchestration pipelines and agent graph definitions remain untouched, untested-paths stay unexercised, and the risk surface of a tuning change stays small. This property is the primary justification cited in the Agent Architecture documentation for maintaining the separation.

Finally, when planning model-assignment strategies that go beyond a single global model—such as the tiered approach outlined in TieredModelSelectionPolicy—the right place to express the per-agent assignments is within `agent-profiles.json` itself, leveraging its existing model selection field. Higher-level policies should be documented separately (as the tiered proposal is at `docs/TIERED-MODEL-PROPOSAL.md`) but realized through profile entries, preserving the file's role as the single home for behavioral configuration.


## Hierarchy Context

### Parent
- [ConfigurationSeparationConventions](./ConfigurationSeparationConventions.md) -- config/agent-profiles.json holds runtime behavioral configuration for agents (model selection, parameters, capabilities), deliberately separated from topology concerns.

### Siblings
- [TieredModelSelectionPolicy](./TieredModelSelectionPolicy.md) -- The proposal is documented at integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md, which outlines assigning lightweight versus full-capability models per agent profile rather than applying a single global model setting across all agents.


---

*Generated from 3 observations*

# TeamDefinitionSchema

**Type:** Detail

The AGENT_NAME environment variable (documented in project docs) maps to agent identity fields within these team JSON files, linking runtime agents to their declared roles

## What It Is

`TeamDefinitionSchema` refers to the JSON-based schema structure used for individual team definition files residing in the `config/teams/` directory. Each file in this directory declares a team's composition — specifying which agents participate and what roles they fulfill. These files are the authoritative source of team identity within the system, referenced across `docs/architecture/system-overview.md`, `docs/architecture-report.md`, and `docs/architecture/adding-new-agent.md`.

As a schema, `TeamDefinitionSchema` is not a code class or runtime object in isolation — it is a declarative contract expressed in JSON, consumed by the broader system to assemble and configure agent teams at runtime.

---

## Architecture and Design

`TeamDefinitionSchema` is a child concern of `DeclarativeTeamComposition`, which governs the `config/teams/` directory as a whole. The relationship is straightforward: `DeclarativeTeamComposition` is the organizational pattern (the directory and the convention of using JSON for team definitions), while `TeamDefinitionSchema` is the structural contract each individual JSON file must satisfy.

The core design decision here is **configuration-as-data**: team membership and agent roles are not hardcoded into application logic but are instead declared externally in versioned JSON files. This creates a clean separation between agent behavior (implemented in code) and team topology (declared in configuration). The system reads these files to understand *who* is on a team and *what role* each participant plays, rather than embedding those decisions in procedural code.

This approach follows a **declarative composition** pattern — teams are defined by stating their desired shape, not by imperatively constructing them. The `config/teams/` directory acts as the registry of all valid team configurations, making the full topology of the system visible and auditable from a single location.

---

## Implementation Details

Each JSON file in `config/teams/` encodes at minimum the agent identities and their associated roles within a team. A critical integration point is the `AGENT_NAME` environment variable, which maps a running agent process to its declared identity within these JSON files. This means the schema must include an identity field (likely a name or ID field) that corresponds exactly to what `AGENT_NAME` resolves to at runtime — serving as the binding key between the static declaration and the live process.

This binding mechanism implies that the schema has at least two conceptual layers:
1. **Identity fields** — values that `AGENT_NAME` can match against to resolve which agent definition applies to a given running process.
2. **Role/capability fields** — values that describe what the agent does within the team context.

Since no code symbols were found, the schema is enforced by convention and documentation rather than by a compiled validator, though the architecture documentation in `docs/architecture/adding-new-agent.md` provides the canonical procedure for correctly authoring these files.

---

## Integration Points

The primary integration is with `DeclarativeTeamComposition`, which treats the `config/teams/` directory as its data source. Every team the system recognizes is backed by a corresponding JSON definition conforming to `TeamDefinitionSchema`.

The `AGENT_NAME` environment variable creates a runtime coupling between these static JSON definitions and live agent processes. When an agent starts, its `AGENT_NAME` value is resolved against the identity fields in the team JSON files to establish its role context. This means the schema is not merely a documentation artifact — it is actively consumed during agent initialization, making schema correctness operationally critical.

The `docs/architecture/adding-new-agent.md` document serves as the procedural interface between developers and this schema: it defines the workflow for extending the system by adding new entries to `config/teams/`, making the schema's conventions a gate for new agent onboarding.

---

## Usage Guidelines

**When adding a new agent**, developers must follow the process described in `docs/architecture/adding-new-agent.md`, which includes adding the appropriate entry to the relevant file(s) in `config/teams/`. The identity field in the JSON must exactly match the value that will be assigned to `AGENT_NAME` in the agent's runtime environment — any mismatch will break the binding between the running process and its declared role.

**Schema consistency is non-negotiable for runtime correctness.** Because there is no evidence of a compiled schema validator enforcing structure, correctness relies on developer discipline and documentation adherence. Teams working on this system should treat the `config/teams/` files as high-sensitivity configuration: errors here affect agent identity resolution at runtime, not just static configuration.

**The `config/teams/` directory is the single source of truth** for team topology. Any architectural reasoning about which agents participate in which teams should begin here, and any changes to team composition must be reflected in these files before they are operationally effective. This makes the directory an important artifact for both system operation and architectural documentation.

---

## Architectural Patterns Identified

| Pattern | Evidence |
|---|---|
| Declarative configuration | Team topology defined in JSON, not code |
| Configuration-as-registry | `config/teams/` as the canonical agent/team registry |
| Environment-variable binding | `AGENT_NAME` links runtime processes to schema declarations |
| Documentation-driven onboarding | `adding-new-agent.md` gates schema extension |

**Key trade-off:** Flexibility and auditability of JSON-based team definitions come at the cost of losing compile-time or test-time validation. The system gains a human-readable, version-controllable topology map but must compensate with disciplined documentation and procedural conventions to prevent runtime misconfigurations.


## Hierarchy Context

### Parent
- [DeclarativeTeamComposition](./DeclarativeTeamComposition.md) -- config/teams/ directory holds JSON files that define which agents participate in a team and their roles, as described in the architecture documentation


---

*Generated from 3 observations*

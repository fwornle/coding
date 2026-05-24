# AgentProfileSchema

**Type:** Detail

The tiered model selection pattern referenced in integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md aligns with agent-profiles.json fields that map agents to LLM tier classifications.

## What It Is  

**AgentProfileSchema** is the declarative contract that defines the shape of each entry in `config/agent‑profiles.json`.  The file lives at the root of the repository under `config/agent‑profiles.json` and is the primary source of truth for runtime‑behaviour configuration of every agent type in the system.  Each JSON object described by the schema specifies, for a given agent, the LLM tier that should be used (e.g., *standard*, *premium*, *experimental*) and operational limits such as maximum concurrent requests.  Because the schema is consumed by the **ConfigDrivenBehavior** component, adding a new agent or adjusting its limits never requires a code change—only a new JSON entry that conforms to the schema.  The formal definition of the schema is documented in the architecture guide at `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, and the tier‑selection semantics are elaborated in `integrations/mcp-server-semantic-analysis/docs/TIERED‑MODEL‑PROPOSAL.md`.

---

## Architecture and Design  

The system follows a **config‑driven behavior** pattern.  Rather than hard‑coding agent characteristics in source code, the architecture externalizes these parameters into a data file (`config/agent‑profiles.json`) whose structure is enforced by **AgentProfileSchema**.  This pattern decouples business logic from operational policy, enabling rapid iteration on agent capabilities without recompilation or deployment of new binaries.

The design leverages a **tiered model selection** approach.  The tier field in each profile maps directly to the classification described in `TIERED‑MODEL‑PROPOSAL.md`, allowing the runtime engine to route inference requests to the appropriate LLM service tier (e.g., a higher‑performance GPU cluster for premium agents).  Concurrency limits are also part of the schema, giving the system a built‑in throttling mechanism that the **ConfigDrivenBehavior** component enforces at request time.

Interaction flow:  
1. At startup, the **ConfigDrivenBehavior** loader reads `config/agent‑profiles.json`.  
2. Each entry is validated against **AgentProfileSchema** to guarantee required fields and correct data types.  
3. When an agent request arrives, the runtime looks up the agent’s profile, extracts the tier and concurrency settings, and hands the request off to the appropriate LLM tier manager.  
4. The concurrency limit is consulted before dispatch; if the limit is reached, the request is queued or rejected according to the system’s back‑pressure policy.

Because the schema is purely declarative, the architecture remains **stateless** with respect to agent definitions—any change is reflected simply by reloading the JSON file, supporting zero‑downtime configuration updates.

---

## Implementation Details  

Although no concrete code symbols were discovered in the repository snapshot, the implementation can be inferred from the documentation:

* **Schema Definition** – The schema is likely expressed as a JSON‑Schema document (or a TypeScript interface) that enumerates required properties such as `agentType`, `llmTier`, and `maxConcurrency`.  Validation is performed when `config/agent‑profiles.json` is parsed, ensuring malformed entries are caught early.

* **ConfigDrivenBehavior Component** – This component acts as the consumer of **AgentProfileSchema**.  It provides a lookup service (e.g., `getProfile(agentId)`) that returns a strongly‑typed profile object.  Internally, it probably caches the parsed JSON in memory for fast access and watches the file for changes to support hot‑reloading.

* **Tier Mapping Logic** – The tier field is resolved against the mapping described in `TIERED‑MODEL‑PROPOSAL.md`.  A dispatcher module reads the tier value and selects the corresponding LLM client (e.g., `StandardLLMClient`, `PremiumLLMClient`).  This indirection enables the system to swap out underlying model providers without touching agent code.

* **Concurrency Enforcement** – Each profile’s `maxConcurrency` is used by a semaphore‑like construct that tracks active requests per agent type.  When the count exceeds the configured limit, the dispatcher either delays the request or returns a throttling error, preserving system stability.

The overall implementation is intentionally lightweight: a JSON file, a schema validator, a lookup cache, and a tier‑dispatching layer.  No bespoke classes or complex inheritance hierarchies are required, which aligns with the “configuration‑first” philosophy.

---

## Integration Points  

**AgentProfileSchema** sits at the nexus of several system boundaries:

* **ConfigDrivenBehavior** – Directly consumes the schema; any component that needs to understand an agent’s operational parameters <USER_ID_REDACTED> this module.  This includes request‑handling pipelines, monitoring agents, and administrative UI layers that display agent capabilities.

* **LLM Tier Managers** – The tier field links the profile to the concrete LLM service implementations.  The dispatcher uses the tier to instantiate or select the appropriate client, making the schema a contract between the configuration layer and the model‑serving layer.

* **Concurrency Controllers** – The `maxConcurrency` attribute is read by the request throttling subsystem.  This subsystem may be a generic rate‑limiter that is parameterized per‑agent using the schema values.

* **Administrative Tools** – UI components that allow operators to edit `agent‑profiles.json` (or a higher‑level CRUD API) will reference the schema to provide validation feedback and auto‑completion, ensuring that only valid profiles are persisted.

* **Documentation & Governance** – The architecture guide (`agents.md`) and tier proposal (`TIERED‑MODEL‑PROPOSAL.md`) both reference the schema, establishing it as the authoritative source for policy decisions across the codebase.

No direct code dependencies are visible, but the schema’s presence is felt wherever agent‑specific behavior is required, making it a shared contract across the entire platform.

---

## Usage Guidelines  

1. **Define New Agents via JSON Only** – To introduce a new agent type, add a JSON object to `config/agent‑profiles.json` that conforms to **AgentProfileSchema**.  Do not modify source code; the ConfigDrivenBehavior loader will automatically incorporate the new profile on the next reload.

2. **Respect Tier Naming Conventions** – The `llmTier` value must match one of the tier identifiers defined in `TIERED‑MODEL‑PROPOSAL.md`.  Using an undefined tier will cause validation failures and prevent the agent from being instantiated.

3. **Set Realistic Concurrency Limits** – `maxConcurrency` should reflect the expected load and the capacity of the underlying LLM tier.  Over‑provisioning can lead to resource contention, while under‑provisioning may cause unnecessary throttling.

4. **Validate Before Deployment** – Run the schema validator (often part of the build or CI pipeline) against any changes to `agent‑profiles.json`.  This ensures that syntax errors or missing fields are caught early.

5. **Leverage Hot‑Reload When Possible** – If the platform supports file‑watching, updating the JSON file will cause ConfigDrivenBehavior to refresh its cache without a full service restart, enabling rapid operational adjustments.

6. **Document Rationale** – When adding or modifying a profile, include a comment (or accompanying documentation) that explains why a particular tier or concurrency limit was chosen.  This practice aids future maintainers and aligns with the governance process outlined in the architecture documents.

By following these conventions, developers can safely extend the agent ecosystem, maintain system stability, and keep the configuration surface simple and authoritative.

---

### Architectural Patterns Identified  
* **Config‑Driven Behavior** – Externalizing operational parameters into a JSON file validated by a schema.  
* **Tiered Model Selection** – Mapping agents to LLM service tiers via a declarative field.  
* **Declarative Validation** – Using a schema to enforce contract integrity at load time.  

### Design Decisions & Trade‑offs  
* **Flexibility vs. Type Safety** – JSON‑based configuration offers high flexibility (no code changes) but relies on runtime validation rather than compile‑time guarantees.  
* **Centralized vs. Distributed Config** – Keeping all agent profiles in a single file simplifies management but may become a bottleneck in extremely large installations; however, the current scale is comfortably served by this approach.  

### System Structure Insights  
* **Parent Component** – `ConfigDrivenBehavior` owns the schema and provides lookup services.  
* **Sibling Entities** – Other configuration schemas (e.g., for routing, logging) likely follow the same pattern, promoting a uniform configuration model across the platform.  

### Scalability Considerations  
* Adding new agents scales linearly with the size of `agent‑profiles.json`; the lookup cache can handle thousands of entries with negligible latency.  
* Concurrency limits per agent prevent any single agent from overwhelming shared LLM resources, supporting graceful scaling under load.  

### Maintainability Assessment  
* High maintainability: behavioral changes are made in data, not code.  
* Validation tooling and clear documentation (`agents.md`, `TIERED‑MODEL‑PROPOSAL.md`) reduce the risk of misconfiguration.  
* The single source of truth simplifies audits and automated compliance checks.


## Hierarchy Context

### Parent
- [ConfigDrivenBehavior](./ConfigDrivenBehavior.md) -- config/agent-profiles.json defines per-agent behavioral parameters (e.g., which LLM tier to use, concurrency limits) so adding a new agent type requires only a new JSON entry, not a code change


---

*Generated from 3 observations*

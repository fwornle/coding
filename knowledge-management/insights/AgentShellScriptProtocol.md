# AgentShellScriptProtocol

**Type:** Detail

Environment variables such as LLM_PROXY_URL, RAPID_LLM_PROXY_URL, and LLM_CLI_PROXY_URL are listed as key documented components, suggesting agent scripts select and export the appropriate proxy endpoint as part of their environment-specific setup

# AgentShellScriptProtocol — Technical Reference

## What It Is

AgentShellScriptProtocol defines the mandatory declaration contract that every per-agent shell script residing under `config/agents/` must satisfy. It is not a runtime library or abstract class but a **convention-enforced protocol**: a set of required exports and environment-variable assignments that each shell script must provide so that the broader agent system can discover, validate, and invoke any agent in a uniform way. The authoritative written specification for this protocol lives in `docs/architecture/adding-new-agent.md`, which serves as the step-by-step registration guide that codifies exactly what a compliant script must declare.

AgentShellScriptProtocol is one of two sibling components housed within the AgentConfigConventions parent. Where its sibling AgentAbstractionAPI (documented at `docs/architecture/agent-abstraction-api.md`) defines the runtime contract that consumers of an agent must program against, AgentShellScriptProtocol defines the *configuration-time* contract that the shell script author must satisfy before an agent can be registered at all. Together these two siblings form the complete two-sided convention: one side for producers (shell script authors), one side for consumers (API callers).

---

## Architecture and Design

The design reflects a **declarative registration pattern**: rather than requiring dynamic agent discovery or runtime reflection, the system demands that each agent shell script statically declare its identity and dependencies through named exports. This keeps the registration mechanism portable (plain shell), auditable (human-readable text files), and side-effect-free at parse time.

Two exports are identified as the canonical required components:

- **`AGENT_NAME`** — a string identifier that names the agent within the registry. This is the key by which other parts of the system reference this agent.
- **`AGENT_REQUIRES_COMMANDS`** — a declaration of external command dependencies the agent needs present in the execution environment. This functions as a lightweight dependency manifest, allowing pre-flight validation before an agent is invoked.

The protocol deliberately separates *identity* (`AGENT_NAME`) from *capability prerequisites* (`AGENT_REQUIRES_COMMANDS`), which is a clean separation-of-concerns decision: any tooling that validates agent availability can check command presence without needing to understand what the agent actually does.

The third design axis is **endpoint selection**: scripts are expected to inspect and export one of `LLM_PROXY_URL`, `RAPID_LLM_PROXY_URL`, or `LLM_CLI_PROXY_URL`. The existence of three distinct proxy endpoint variables suggests the system supports multiple latency or throughput tiers (e.g., a standard proxy, a rapid/low-latency proxy, and a CLI-oriented proxy). By pushing the selection logic into the per-agent shell script, the protocol grants each agent the autonomy to choose the appropriate endpoint for its workload characteristics without requiring a central routing layer.

This is a deliberate **decentralization trade-off**: endpoint routing intelligence lives in each agent script rather than in shared infrastructure. The benefit is simplicity and agent-level control; the cost is that changes to available endpoints require updating every affected agent script individually.

---

## Implementation Details

Each file under `config/agents/` is a shell script that, when sourced or executed, must produce the following observable side effects in the environment:

1. **Set `AGENT_NAME`** to a string that uniquely identifies the agent. This value is the primary key used by any tooling or orchestration layer that iterates over registered agents.

2. **Set `AGENT_REQUIRES_COMMANDS`** to an enumeration (likely a space- or newline-delimited list, as is idiomatic in shell) of CLI tools or executables the agent depends on. Pre-flight checks can iterate this list and abort with a meaningful error if a dependency is absent, rather than failing mid-execution.

3. **Select and export an LLM proxy endpoint** from among `LLM_PROXY_URL`, `RAPID_LLM_PROXY_URL`, and `LLM_CLI_PROXY_URL`. The agent script applies environment-specific logic to determine which endpoint is appropriate, then exports it so downstream invocation code can use it without needing to know which tier was chosen.

The use of shell scripts (rather than, say, YAML or JSON manifests) means the endpoint-selection logic can be fully dynamic — an agent could, for example, test for the presence of an environment variable and fall back to an alternative endpoint. This is more expressive than a static config file, at the cost of making the scripts harder to parse programmatically without executing them.

The `docs/architecture/adding-new-agent.md` document is the single source of truth for the exact syntax, ordering, and naming of these declarations. Developers adding a new agent should treat this document as the schema definition for the shell script format.

---

## Integration Points

AgentShellScriptProtocol is the entry point through which a new agent enters the AgentConfigConventions ecosystem. The parent component, AgentConfigConventions, governs the `config/agents/` directory as a whole; AgentShellScriptProtocol defines the per-file rules within it.

The sibling AgentAbstractionAPI represents the downstream consumer of what AgentShellScriptProtocol produces. Once a shell script correctly declares `AGENT_NAME` and `AGENT_REQUIRES_COMMANDS` and selects its proxy endpoint, the AgentAbstractionAPI contract governs how calling code invokes that agent at runtime. A script that satisfies AgentShellScriptProtocol but violates AgentAbstractionAPI (or vice versa) will be partially broken — both protocols must be satisfied for an agent to be fully functional.

The three proxy environment variables (`LLM_PROXY_URL`, `RAPID_LLM_PROXY_URL`, `LLM_CLI_PROXY_URL`) represent integration points with whatever LLM proxy infrastructure the system runs. Agent shell scripts do not own the values of these variables — they read from the ambient environment and select among them — which means the proxy infrastructure is an external dependency injected at execution time.

---

## Usage Guidelines

**When adding a new agent**, `docs/architecture/adding-new-agent.md` is the mandatory starting point. Skipping or partially following this document will produce a non-compliant script that may silently fail pre-flight checks or be invisible to agent-discovery tooling.

**`AGENT_NAME` must be unique** across all scripts in `config/agents/`. Since this is a shell-convention system with no enforced namespace collision detection at the language level, authors must manually verify uniqueness against existing scripts.

**`AGENT_REQUIRES_COMMANDS` should be exhaustive**. Under-declaring dependencies means pre-flight validation passes on an environment that will still fail at runtime. Over-declaring is safer but may cause the agent to be incorrectly marked unavailable on systems where some optional tools are absent.

**Proxy endpoint selection should be explicit and deterministic**. Scripts should not silently fall through to an unintended endpoint. A clear conditional (e.g., prefer `RAPID_LLM_PROXY_URL` if set, otherwise fall back to `LLM_PROXY_URL`) with a final guard that fails loudly if no valid endpoint is resolvable is preferable to silent fallback behavior that makes debugging difficult.

**Treat the shell script as configuration, not logic**. The expressiveness of shell can tempt authors to embed complex business logic in these scripts. The protocol's intent is declaration and environment setup — heavy logic belongs in the agent's runtime implementation, governed by the AgentAbstractionAPI contract, not in the registration script.

---

## Architectural Patterns & Design Assessment

| Dimension | Assessment |
|---|---|
| **Pattern** | Declarative convention-over-configuration registration |
| **Coupling** | Low — shell scripts are independent files with no import graph |
| **Scalability** | Linear — adding agents requires one new file per agent, no central registry to modify |
| **Maintainability** | Dependent on `adding-new-agent.md` staying current; drift between docs and actual scripts is the primary risk |
| **Trade-off** | Shell expressiveness vs. parseability — dynamic endpoint selection is powerful but not statically analyzable |


## Hierarchy Context

### Parent
- [AgentConfigConventions](./AgentConfigConventions.md) -- config/agents/ directory holds per-agent shell scripts that declare environment-specific setup, with docs/architecture/adding-new-agent.md codifying the step-by-step convention for registering a new provider

### Siblings
- [AgentAbstractionAPI](./AgentAbstractionAPI.md) -- docs/architecture/agent-abstraction-api.md is explicitly listed as 'Agent Abstraction API Reference', making it the canonical contract document that agent shell scripts in config/agents/ must conform to


---

*Generated from 3 observations*

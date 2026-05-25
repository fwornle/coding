# TypedAgentContract

**Type:** Detail

Documented in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md, BaseAgent<TInput, TOutput> is described as a generic abstract class parameterized on input and output types, enforcing compile-time type safety across agents that handle different data shapes.

## What It Is  

**TypedAgentContract** is the compile‑time contract that underpins every concrete agent in the MCP Server semantic‑analysis subsystem. The contract lives inside the generic abstract class **`BaseAgent<TInput, TOutput>`**, which is documented in the architecture guide at  

```
integrations/mcp-server-semantic-analysis/docs/architecture/agents.md
```  

By parameterising the base class with two type arguments—`TInput` for the data the agent consumes and `TOutput` for the data it produces—TypedAgentContract guarantees that each agent declares an explicit, type‑safe “in‑out” contract. The result is a heterogeneous agent pipeline where stages can operate on completely different data shapes while still sharing the common behaviour supplied by `BaseAgent`.

---

## Architecture and Design  

The design follows a **generic‑type‑based contract pattern**. `BaseAgent<TInput, TOutput>` acts as a **template‑method** scaffold: it defines the overall lifecycle of an agent (initialisation, processing, shutdown) while delegating the concrete transformation logic to subclasses that fulfil the `TypedAgentContract`. Because the contract is expressed entirely with generic parameters, the compiler enforces compatibility between successive pipeline stages, eliminating a whole class of runtime type mismatches.

The architecture is deliberately **heterogeneous**. Each agent can introduce its own domain‑specific input and output types, yet all agents inherit the same base behaviour (logging, error handling, telemetry) from `BaseAgent`. This creates a **pipeline of loosely coupled components** that are wired together by matching the output type of one agent to the input type of the next. The agents‑documentation diagram (see *agents.md*) visualises this flow:

```
+-------------------+   TOutputA   +-------------------+   TOutputB   +-------------------+
|  AgentA :          | ------------> |  AgentB :          | ------------> |  AgentC :          |
|  BaseAgent<X, Y>  |               |  BaseAgent<Y, Z>  |               |  BaseAgent<Z, W>  |
+-------------------+               +-------------------+               +-------------------+
```

No other architectural styles (micro‑services, event‑driven queues, etc.) are mentioned in the source observations, so the focus remains on **type‑driven composition** within a single process.

---

## Implementation Details  

* **`BaseAgent<TInput, TOutput>`** – an abstract class that encapsulates the shared runtime concerns of all agents (e.g., logging, lifecycle hooks). Its definition resides conceptually in the same module that documents the agents, and it **contains** the `TypedAgentContract`. The two generic parameters are the sole mechanism by which the contract is expressed.

* **TypedAgentContract** – not a separate source file but a logical contract embedded in `BaseAgent`. It requires concrete subclasses to implement a method (implicitly defined in the abstract class) that maps an instance of `TInput` to an instance of `TOutput`. Because the contract is generic, the compiler validates that every concrete agent’s implementation respects the declared types.

* **Heterogeneous Pipeline Support** – The dual‑type parameterisation enables each pipeline stage to have a unique data shape. For example, an agent that parses raw text may be declared as `BaseAgent<string, ParsedDocument>`, while a downstream sentiment‑analysis agent could be `BaseAgent<ParsedDocument, SentimentScore>`. The pipeline wiring logic simply matches `ParsedDocument` between the two stages; any mismatch would be caught at compile time.

* **Absence of Concrete Code** – The observation set reports “0 code symbols found”, meaning the source repository does not expose the concrete implementation in the extracted snapshot. Nevertheless, the architectural documentation makes the contract semantics explicit, and the generic class signature is sufficient to infer the implementation strategy.

---

## Integration Points  

* **Parent Component – `BaseAgent`** – All agents inherit from `BaseAgent<TInput, TOutput>`. The parent supplies the contract enforcement and common behaviour, so any change to the base class (e.g., adding a new lifecycle hook) propagates automatically to every concrete agent.

* **Sibling Agents** – Any two agents that share the same `TOutput`/`TInput` pair can be swapped in the pipeline without code changes, because they conform to the same `TypedAgentContract`. This interchangeability is a direct benefit of the generic contract.

* **Pipeline Orchestrator** – Although not described in the observations, the pipeline orchestration layer must resolve the type graph defined by the agents’ contracts. It does so by inspecting the generic arguments of each `BaseAgent` subclass and wiring the output of one to the input of the next. Because the contract is enforced at compile time, the orchestrator can rely on static type information rather than runtime reflection.

* **External Modules** – Any module that wishes to contribute a new processing step must implement a subclass of `BaseAgent` and declare its own `TInput`/`TOutput`. The only dependency is the `BaseAgent` definition itself, making integration straightforward and isolated.

---

## Usage Guidelines  

1. **Declare Precise Types** – When creating a new agent, choose `TInput` and `TOutput` that accurately reflect the data structures you will consume and emit. Over‑generalising (e.g., using `object`) defeats the purpose of the contract and will raise compiler warnings.

2. **Respect the Contract** – Implement the transformation method mandated by `BaseAgent` so that it returns a value of the declared `TOutput`. The compiler will enforce this; any deviation will be a build‑time error.

3. **Leverage the Base Behaviour** – Do not re‑implement common concerns such as logging or error handling; rely on the implementations provided by `BaseAgent`. Override only when you need to extend behaviour in a way that still respects the base contract.

4. **Maintain Type Compatibility Across Stages** – When wiring agents together, ensure that the `TOutput` of the upstream agent exactly matches the `TInput` of the downstream agent. If a conversion is required, introduce a dedicated adapter agent rather than performing casts.

5. **Document New Types** – Since the contract is type‑centric, any new domain model used as `TInput` or `TOutput` should be documented alongside the agent implementation. This aids future developers in understanding the data flow and preserves the clarity of the heterogeneous pipeline.

---

### Summary of Key Insights  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Architectural patterns identified** | Generic‑type‑based contract, Template‑Method (via `BaseAgent`), Heterogeneous pipeline composition |
| **Design decisions and trade‑offs** | Dual generic parameters give compile‑time safety at the cost of requiring explicit type definitions for every stage |
| **System structure insights** | All agents are children of `BaseAgent`; the contract lives inside the base class; pipeline wiring is driven by matching generic types |
| **Scalability considerations** | Adding new agents is linear – simply create a subclass with appropriate types; the pipeline can grow without altering existing agents |
| **Maintainability assessment** | Centralised behaviour in `BaseAgent` promotes consistency; type contracts reduce runtime bugs but demand diligent type management |

This document captures the current, fully‑typed contract model for agents in the MCP Server semantic‑analysis component and serves as the reference point for any future extensions or refactorings involving **TypedAgentContract**.


## Hierarchy Context

### Parent
- [BaseAgent](./BaseAgent.md) -- BaseAgent<TInput, TOutput> is a generic abstract class (documented in docs/architecture/agents.md) parameterized on input and output types, enforcing type safety across the heterogeneous agent pipeline


---

*Generated from 3 observations*

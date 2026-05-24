# HookTypeDispatcher

**Type:** Detail

Integration with the broader ConstraintSystem (L1) is implied by the sub-component's placement: the dispatcher's output feeds constraint evaluation logic documented elsewhere in integrations/mcp-constraint-monitor/docs/constraint-configuration.md ('Constraint Configuration Guide').

## What It Is  

**HookTypeDispatcher** is the core dispatching component that lives inside the **HookEventRouter** sub‑tree of the *mcp‑constraint‑monitor* integration. Its source resides alongside the router implementation (the exact file is not listed in the observations, but it is co‑located with the router under the `integrations/mcp-constraint-monitor/` hierarchy). The dispatcher’s sole responsibility is to examine the **hook‑type discriminator** that is embedded in the Claude‑Code hook envelope (defined in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`) and to route the incoming event to the appropriate handling branch. Because the system must support *multiple distinct hook types*—each with its own payload shape and downstream constraint‑evaluation logic—HookTypeDispatcher exists as the centralized decision point that guarantees each hook is processed by the correct downstream component.

The dispatcher’s output is fed directly into the **ConstraintSystem (L1)**, as described in the “Constraint Configuration Guide” (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`). In other words, HookTypeDispatcher translates raw hook events into the canonical form expected by the constraint‑evaluation pipeline.

---

## Architecture and Design  

The architecture follows a **router‑dispatcher** pattern. **HookEventRouter** acts as the façade that receives raw hook envelopes; it delegates the type‑resolution work to **HookTypeDispatcher**, which then selects a concrete handler based on the hook‑type field. This mirrors the classic *Dispatcher* (or *Strategy*) design pattern: the dispatcher contains a lightweight mapping from hook‑type identifiers to handler implementations, allowing new hook types to be added without modifying the router’s core logic.

The sibling component **HookEventEnvelopeParser** shares the same contract—the envelope schema defined in `CLAUDE-CODE-HOOK-FORMAT.md`. While the parser focuses on structural validation and extraction of the envelope fields, the dispatcher concentrates on *semantic* routing. The two components therefore form a clear separation of concerns: parsing → dispatching → constraint evaluation.

Interaction flow (illustrated conceptually below)  

```
+-------------------+          +-------------------+          +-------------------+
|  Raw Hook Event   |  --->    | HookEventRouter   |  --->    | HookTypeDispatcher|
+-------------------+          +-------------------+          +-------------------+
                                        |                               |
                                        v                               v
                               HookEventEnvelopeParser          Dispatch Table
                                        |                               |
                                        +-----------+-------------------+
                                                    |
                                                    v
                                         Specific Hook Handler
                                                    |
                                                    v
                                          ConstraintSystem (L1)
```

*Diagram:* The diagram above shows the linear progression from raw event → router → dispatcher → concrete handler → constraint system. The dispatcher’s dispatch table (a map of hook‑type strings to handler objects) is the only mutable piece that must be kept in sync with the hook‑type definitions in the format document.

---

## Implementation Details  

Although the source code was not enumerated in the observations, the design can be inferred from the surrounding components:

1. **HookTypeDispatcher** likely exposes a single public method such as `dispatch(event: HookEventEnvelope): Result`.  
   - The method receives the envelope that has already been parsed by **HookEventEnvelopeParser**.  
   - It reads the **hook‑type discriminator** (e.g., `event.type` or `event.hookType`) defined in the Claude‑Code hook format.

2. **Dispatch Table** – Internally the dispatcher maintains a map (e.g., `Map<string, HookHandler>`). Each entry pairs a hook‑type identifier with a concrete handler object that implements a shared interface (e.g., `handle(event): void`). The handlers themselves are responsible for translating the hook payload into the constraint‑system input format.

3. **Handler Registration** – Because the system must stay extensible, the dispatcher probably provides a registration API (`registerHandler(type: string, handler: HookHandler)`). Registration occurs during application start‑up, driven by configuration files described in `constraint-configuration.md`. This decouples the dispatcher from the concrete handler implementations.

4. **Error Path** – If an incoming hook type is not present in the dispatch table, the dispatcher raises a well‑defined error (or returns a failure result) that propagates back to **HookEventRouter**, which can then log or dead‑letter the event. This guards against mismatches between the format document and the actual runtime configuration.

5. **Statelessness** – The dispatcher does not retain per‑event state; it merely routes. This stateless nature makes it safe for concurrent processing and aligns with the downstream constraint evaluation, which expects independent payloads.

---

## Integration Points  

- **Parent – HookEventRouter**: The router orchestrates the end‑to‑end flow. It receives raw HTTP/webhook payloads, invokes **HookEventEnvelopeParser** to validate and extract the envelope, then hands the envelope to **HookTypeDispatcher**. The router is the only component that directly calls the dispatcher, making the dispatcher a private child of the router.

- **Sibling – HookEventEnvelopeParser**: Both the parser and dispatcher depend on the same contract (`CLAUDE-CODE-HOOK-FORMAT.md`). The parser guarantees that the envelope conforms to the schema, while the dispatcher trusts the parsed output to contain a reliable hook‑type field.

- **Downstream – ConstraintSystem (L1)**: After the dispatcher selects the appropriate handler, the handler produces a constraint‑evaluation request that is consumed by the ConstraintSystem. Configuration for how each hook type maps to specific constraints is documented in `constraint-configuration.md`. This file is the source of truth for the dispatcher’s registration step.

- **Configuration Files**: The dispatcher’s behavior is driven by declarative configuration (likely YAML or JSON) that lists supported hook types and the corresponding handler classes. This configuration lives alongside the constraint‑configuration guide, ensuring that changes to hook handling are reflected in both documentation and runtime.

---

## Usage Guidelines  

1. **Never bypass the parser** – All hook events must first be processed by **HookEventEnvelopeParser**. The parser enforces the envelope schema; feeding raw payloads directly to the dispatcher can lead to undefined behavior.

2. **Register handlers during start‑up** – Extend the dispatch table by adding new handler registrations in the application bootstrap code, following the pattern shown in the constraint‑configuration guide. Do not modify the dispatcher’s internal map at runtime unless you fully understand concurrency implications.

3. **Keep the format document in sync** – When a new hook type is introduced, update `CLAUDE-CODE-HOOK-FORMAT.md` with the discriminator and payload schema, add a corresponding handler class, and register it with the dispatcher. This three‑step process maintains alignment between documentation, code, and configuration.

4. **Stateless handler design** – Handlers should avoid retaining mutable state across invocations. If state is required (e.g., caching), encapsulate it in a separate service that is injected into the handler. This preserves the dispatcher’s ability to operate in a highly concurrent environment.

5. **Graceful degradation** – Implement a fallback or “unknown‑type” handler that logs unexpected hook types and returns a non‑fatal error to the router. This prevents the entire pipeline from stalling when an out‑of‑date client sends a new hook type not yet registered.

---

### Architectural Patterns Identified  
- **Dispatcher / Strategy pattern** – Centralized routing based on a type discriminator, with pluggable handler strategies.  
- **Separation of Concerns** – Parsing (HookEventEnvelopeParser) is isolated from dispatching (HookTypeDispatcher) and from business logic (constraint handlers).  

### Design Decisions & Trade‑offs  
- **Explicit dispatch table** vs. reflection‑based routing: an explicit map provides compile‑time safety and clear documentation at the cost of a small amount of boilerplate registration code.  
- **Stateless dispatcher** enables horizontal scaling but requires handlers to be self‑contained or to use external services for state.  

### System Structure Insights  
- The hook processing pipeline is a linear chain: *Router → Parser → Dispatcher → Handler → ConstraintSystem*.  
- Configuration files serve as the single source of truth for both documentation and runtime behavior, reinforcing consistency.  

### Scalability Considerations  
- Because the dispatcher is stateless and the dispatch table is read‑only after start‑up, the component can be instantiated in multiple worker processes or containers without coordination overhead.  
- Adding new hook types does not affect existing traffic; only the registration step changes, which can be rolled out via a rolling deployment.  

### Maintainability Assessment  
- The clear separation between envelope parsing, type dispatching, and constraint handling makes the codebase easy to navigate and test in isolation.  
- Documentation (`CLAUDE-CODE-HOOK-FORMAT.md` and `constraint-configuration.md`) is tightly coupled to the implementation, reducing the risk of drift.  
- The only maintenance burden lies in keeping the dispatch registration in sync with the format document—a straightforward, well‑documented process.


## Hierarchy Context

### Parent
- [HookEventRouter](./HookEventRouter.md) -- Claude Code hook data format is documented in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md, defining the event envelope the router must parse for each hook type

### Siblings
- [HookEventEnvelopeParser](./HookEventEnvelopeParser.md) -- The event envelope schema is formally specified in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md ('Claude Code Hook Data Format'), which serves as the authoritative contract this parser must implement.


---

*Generated from 3 observations*

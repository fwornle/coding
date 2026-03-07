# RoutingTableManager

**Type:** Detail

The RoutingTableManager implements a routing algorithm that selects the best provider based on the routing rules, which is used to route requests to the appropriate provider

## What It Is  

The **RoutingTableManager** is the core component that drives request routing inside the *TierBasedRouter* subsystem. It is instantiated when the `TierBasedRouter` starts up and immediately loads the `routing‑table.json` file – the declarative source of all routing rules. By exposing a registration API that forwards provider data to the **ProviderRegistry**, the manager maintains a live view of which providers are available. When a request arrives, the manager invokes the **RoutingAlgorithm** to evaluate the loaded rules against the registered providers and returns the “best” provider for that request. In short, the RoutingTableManager is the glue that binds static routing configuration, dynamic provider registration, and the decision‑making logic that selects a provider at runtime.

## Architecture and Design  

The design follows a **modular composition** pattern: the `TierBasedRouter` composes three sibling collaborators – **RoutingTableManager**, **ProviderRegistry**, and **RoutingAlgorithm** – each with a single, well‑defined responsibility. The manager’s responsibility is to own the routing‑rule artefact (`routing‑table.json`) and to orchestrate the flow from rule loading to provider selection. The presence of a separate **ProviderRegistry** indicates a **registry pattern**, allowing providers to be added or removed without touching the routing logic. The **RoutingAlgorithm** embodies a **strategy pattern**, encapsulating the decision‑making process that can be swapped or extended independently of the manager. Interaction proceeds in a clear pipeline: the manager loads rules, queries the registry for current provider metadata, and delegates the selection to the algorithm, which finally returns the chosen provider back to the router.

## Implementation Details  

* **Rule Loading** – During the initialization of `TierBasedRouter`, the manager reads `routing‑table.json`. This file is the sole source of routing rules, implying that the manager contains a JSON‑parsing routine that materialises the rule set into an in‑memory structure (e.g., a list or map). Because the observation explicitly mentions “loaded during the initialization of the TierBasedRouter,” the loading step occurs once at start‑up, ensuring that the rule set is immutable for the lifetime of the router instance.  

* **Provider Registration** – The manager offers a registration façade that forwards provider descriptors to the **ProviderRegistry**. The registry, as described, uses an internal data structure (likely a hash map keyed by provider ID) to store provider information. Registration is therefore a two‑step process: the manager validates or transforms the incoming provider data, then calls a method on the registry such as `registerProvider(providerInfo)`.  

* **Routing Decision** – When a request must be routed, the manager invokes the **RoutingAlgorithm**. The algorithm consumes two inputs: the pre‑loaded routing rules and the current provider snapshot from the registry. It applies a decision‑making process—potentially rule matching, tier evaluation, or weight‑based selection—to determine the “best” provider. The manager then returns this provider to the caller (the `TierBasedRouter`) which forwards the request accordingly.  

* **No Direct Children** – The observations do not list any child components beneath the manager; its responsibilities are fulfilled entirely through collaboration with its siblings (registry and algorithm) and the parent router.

## Integration Points  

The **RoutingTableManager** sits at the heart of the routing pipeline. Its primary integration points are:  

1. **TierBasedRouter (Parent)** – The router creates the manager, triggers rule loading, and receives the selected provider for each request. The manager’s lifecycle is tightly coupled to the router’s initialization and shutdown.  

2. **ProviderRegistry (Sibling)** – The manager’s registration API is a thin wrapper around the registry’s `registerProvider` and `lookupProvider` methods. The manager depends on the registry to maintain an up‑to‑date view of available providers.  

3. **RoutingAlgorithm (Sibling)** – The manager delegates the selection logic to the algorithm. The algorithm may be injected (e.g., via constructor) allowing different strategies (e.g., round‑robin, latency‑aware) without altering the manager.  

4. **routing‑table.json (External Asset)** – This JSON file is the static configuration source. Any change to routing behavior requires updating this file and restarting the router so the manager can reload the new rules.  

No other system components are mentioned, so the manager’s external dependencies are limited to these three collaborators and the JSON configuration file.

## Usage Guidelines  

* **Initialize Early** – Because the manager loads `routing‑table.json` at router start‑up, developers should ensure the JSON file is present and syntactically correct before the `TierBasedRouter` is instantiated. Failure to do so will prevent the manager from establishing a rule set, leading to routing failures.  

* **Register Providers Through the Manager** – All provider registrations should be performed via the manager’s public registration API rather than directly invoking the ProviderRegistry. This guarantees that any future validation or transformation logic remains centralized.  

* **Treat Routing Rules as Immutable** – The current design loads rules once; therefore, any dynamic modification of routing behavior must be performed by redeploying an updated `routing‑table.json` and restarting the router. If runtime rule changes are required, the architecture would need to be extended.  

* **Prefer Pluggable Algorithms** – When custom routing logic is needed, implement a new **RoutingAlgorithm** adhering to the existing interface and inject it into the manager (or the parent router). This respects the strategy pattern and avoids modifying the manager’s core code.  

* **Monitor Provider Registry State** – Since the manager’s decisions depend on the registry’s snapshot, developers should keep the registry’s data consistent (e.g., deregister providers that become unavailable) to avoid routing to stale or unhealthy endpoints.

---

### 1. Architectural patterns identified  
* **Registry pattern** – ProviderRegistry stores and retrieves provider metadata.  
* **Strategy pattern** – RoutingAlgorithm encapsulates selectable routing logic.  
* **Composition (modular) pattern** – TierBasedRouter composes RoutingTableManager, ProviderRegistry, and RoutingAlgorithm as peer collaborators.  

### 2. Design decisions and trade‑offs  
* **Static rule loading** – Simplicity and fast start‑up at the cost of runtime rule flexibility.  
* **Separate registry** – Decouples provider lifecycle from routing rules, enabling independent scaling of provider management.  
* **Pluggable algorithm** – Allows future routing strategies without touching the manager, but introduces an extra indirection layer that can affect debugging.  

### 3. System structure insights  
The system is organized as a three‑tier hierarchy: the **TierBasedRouter** (parent) orchestrates request flow; the **RoutingTableManager** (core) bridges static rules, dynamic providers, and the decision engine; the **ProviderRegistry** and **RoutingAlgorithm** (siblings) each own a focused concern. This clear separation yields a clean dependency graph and promotes single‑responsibility adherence.  

### 4. Scalability considerations  
* **ProviderRegistry scaling** – Since the registry holds provider metadata in memory, its size grows linearly with the number of providers. For very large provider pools, a more scalable storage (e.g., concurrent map or external cache) may be needed.  
* **RoutingAlgorithm performance** – The algorithm is invoked for every request; its complexity should be bounded (e.g., O(1) or O(log n)) to avoid bottlenecks as request volume rises.  
* **Rule reloading** – Because rules are static, scaling out (adding more router instances) simply requires copying the same `routing‑table.json` to each node, which is straightforward.  

### 5. Maintainability assessment  
The clear separation of concerns—static rule handling, provider registration, and routing decision—makes the codebase easy to understand and modify. Adding new routing criteria involves updating `routing‑table.json` and, if needed, extending the **RoutingAlgorithm** without touching the manager. However, the immutability of the rule set means any change mandates a restart, which could be a maintenance friction point in environments that demand hot‑reloading of routing policies. Overall, the design favors maintainability through modularity, with the main trade‑off being reduced runtime configurability.


## Hierarchy Context

### Parent
- [TierBasedRouter](./TierBasedRouter.md) -- TierBasedRouter uses a routing table (routing-table.json) to define the routing rules

### Siblings
- [ProviderRegistry](./ProviderRegistry.md) -- The ProviderRegistry uses a data structure to store provider information, which is populated during the registration process
- [RoutingAlgorithm](./RoutingAlgorithm.md) -- The RoutingAlgorithm uses a decision-making process to select the best provider, which is based on the routing rules and provider information


---

*Generated from 3 observations*

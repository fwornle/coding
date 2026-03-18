# CircuitBreaker

**Type:** SubComponent

The CircuitBreaker class is responsible for detecting when a provider is not responding and preventing further requests, as seen in the CircuitBreaker class (lib/llm/circuit-breaker.ts)

## What It Is  

The **CircuitBreaker** sub‑component lives in the source tree at `lib/llm/circuit-breaker.ts`. It is instantiated and held by the **LLMAbstraction** layer, which in turn is used by the higher‑level `LLMService` (found in `lib/llm/llm‑service.ts`). The class’ core responsibility is to guard calls to external LLM providers: it watches for repeated failures, opens the circuit to stop further requests, and later resets the circuit once the provider appears healthy again. The implementation is explicitly *threshold‑based* – a configurable number of consecutive failures triggers the open state – and it is driven by a small internal **state machine** (see the reference to a “StateManager” child component). In addition, the breaker works together with a request‑level cache that lives inside `LLMService`, reducing the number of outbound calls that need to be evaluated by the breaker.

## Architecture and Design  

The design of the CircuitBreaker follows a classic **state‑machine pattern**. The class maintains an internal `StateManager` (its child component) that tracks three logical states – *Closed*, *Open*, and *Half‑Open* – and transitions between them based on failure counts and a reset timeout. This explicit state handling makes the behaviour deterministic and easy to test.  

Configuration is exposed through constructor arguments or setter methods that allow callers to specify the **failure threshold** and the **reset timeout** (Observation 6). By keeping these values external, the component can be tuned per‑provider without code changes, supporting the broader **dependency‑injection** philosophy of the parent `LLMAbstraction` (as described in the hierarchy context).  

Error handling is baked into the breaker’s workflow. When a request to a provider throws an exception, the CircuitBreaker captures the error, increments the failure counter, and may transition to the Open state (Observations 1 and 5). The surrounding `LLMService` also wraps calls in a try/catch block, ensuring that any uncaught errors do not propagate past the service boundary.  

Performance optimisation is achieved through a **cache** that lives in `LLMService` (Observation 4). The cache sits in front of the breaker, so repeated identical requests can be served without invoking the breaker’s state logic, reducing latency and the load on the state machine. This separation of concerns – cache in the service, circuit logic in the breaker – keeps each class focused on a single responsibility.

## Implementation Details  

The `CircuitBreaker` class (in `lib/llm/circuit-breaker.ts`) defines several key members:

* **threshold** – the maximum number of consecutive failures allowed before opening the circuit.  
* **resetTimeoutMs** – the period the breaker stays open before moving to the Half‑Open state and attempting a test request.  
* **stateManager** – an instance that encapsulates the current state (`Closed`, `Open`, `Half‑Open`) and the logic for state transitions.  

Typical public methods include:

* `execute<T>(fn: () => Promise<T>): Promise<T>` – wraps a provider call. It first checks the current state via `stateManager`. If the circuit is Open, it rejects immediately; if Half‑Open, it allows a single trial call; otherwise it proceeds normally.  
* `recordSuccess()` and `recordFailure()` – invoked by `execute` after the wrapped call resolves or rejects. They update the failure counter and possibly trigger a state change.  
* `reset()` – forces the breaker back to the Closed state, used when a provider is known to have recovered (Observation 3).  

The **StateManager** (the child component) implements the transition rules:

* **Closed → Open** when `failureCount >= threshold`.  
* **Open → Half‑Open** after `resetTimeoutMs` elapses (a timer is started when the circuit opens).  
* **Half‑Open → Closed** on a successful trial request, or **Half‑Open → Open** on another failure.  

The surrounding `LLMService` (in `lib/llm/llm-service.ts`) holds an instance of `CircuitBreaker` per provider and also maintains a request cache. When `LLMService` receives a request, it first checks the cache; if a cached response exists, it returns it directly. Otherwise, it delegates to the breaker’s `execute` method, which in turn calls the underlying provider. Any exception bubbling out of the breaker is caught by `LLMService`, logged, and transformed into a controlled error response, satisfying Observation 5.

## Integration Points  

* **Parent – LLMAbstraction**: The abstraction layer constructs the `CircuitBreaker` (and its `StateManager`) and injects it into `LLMService`. Because `LLMAbstraction` is built with dependency injection, different breaker configurations can be supplied for different providers without altering service code.  

* **Sibling – ProviderRegistry**: The `ProviderRegistry` (found in `lib/llm/provider-registry.ts`) supplies the concrete provider objects that `LLMService` will call through the breaker. The registry’s knowledge of provider health can be complemented by the breaker’s state; for example, a provider marked “unavailable” by the registry could be automatically placed in an Open state.  

* **Sibling – BudgetTracker**: While the `BudgetTracker` monitors cost, it may also respect the breaker’s Open state to avoid unnecessary spend on a failing provider. Both components read from the same `LLMService` request flow, ensuring coordinated behavior.  

* **Sibling – LLMController**: The controller (extending `EventEmitter`) forwards incoming API calls to `LLMService`. It therefore indirectly triggers the breaker logic whenever a request reaches the service layer.  

* **Child – StateManager**: All state transitions and timers are encapsulated here. The breaker delegates to the manager for any decision about whether to allow a request, making the state logic reusable and testable in isolation.  

The cache in `LLMService` is the only other shared artifact; it reduces the number of times the breaker is consulted, which in turn lowers the frequency of state checks and timer resets.

## Usage Guidelines  

1. **Configure per provider** – When wiring up a new LLM provider, instantiate a `CircuitBreaker` with a failure threshold and reset timeout that reflect the provider’s SLA. The parent `LLMAbstraction` should inject these instances via its DI container.  

2. **Do not bypass the breaker** – All provider calls must go through `CircuitBreaker.execute`. Directly calling a provider from `LLMService` defeats the protection against cascading failures.  

3. **Leverage the cache** – For idempotent or frequently repeated prompts, rely on the `LLMService` cache. This not only improves latency but also reduces the chance of tripping the breaker due to redundant requests.  

4. **Handle breaker rejections** – When the circuit is Open, `execute` will reject immediately. Callers (e.g., `LLMController`) should catch this specific error and translate it into a user‑friendly response (such as “Service temporarily unavailable”).  

5. **Reset on external signals** – If an external health‑check indicates that a provider has recovered, invoke `circuitBreaker.reset()` to move it back to the Closed state without waiting for the timeout. This is useful for automated monitoring systems.  

6. **Monitor state transitions** – Because the breaker emits state changes via the `StateManager`, logging these events can help operators understand failure patterns and tune thresholds.  

---

### 1. Architectural patterns identified  
* **State‑Machine pattern** – encapsulated in `StateManager` to manage Closed/Open/Half‑Open states.  
* **Dependency Injection** – the parent `LLMAbstraction` injects configured breaker instances into `LLMService`.  
* **Cache‑Aside pattern** – `LLMService` checks a local cache before invoking the breaker.  

### 2. Design decisions and trade‑offs  
* **Threshold‑based opening** provides a simple, deterministic trigger but may be too coarse for bursty failures; the trade‑off is simplicity versus granularity.  
* **Separate cache** isolates performance optimisation from failure detection, improving single‑responsibility but adds an extra lookup step.  
* **Explicit reset API** gives operators fast recovery at the cost of exposing internal state manipulation; this is mitigated by keeping the API limited to trusted callers.  

### 3. System structure insights  
* The CircuitBreaker sits one level below the **LLMAbstraction** parent and above the **StateManager** child, forming a clear vertical slice: abstraction → breaker → state manager → provider.  
* Sibling components (`ProviderRegistry`, `BudgetTracker`, `LLMController`) all interact with the breaker indirectly via `LLMService`, reinforcing a **layered** architecture where the service is the sole gateway to external providers.  

### 4. Scalability considerations  
* Because each provider gets its own `CircuitBreaker` instance, the system scales horizontally with the number of providers; state is isolated, preventing a noisy provider from affecting others.  
* The cache reduces request volume to the breaker, allowing the state machine to handle high QPS without becoming a bottleneck.  
* The timer‑based reset logic is lightweight; however, a very large number of open circuits could generate many timers, which should be monitored in extremely large deployments.  

### 5. Maintainability assessment  
* The clear separation between **CircuitBreaker**, **StateManager**, and the surrounding service makes unit testing straightforward; each piece can be mocked independently.  
* Configuration parameters are externalized, so tuning does not require code changes.  
* The reliance on explicit file paths (`lib/llm/circuit-breaker.ts`, `lib/llm/llm-service.ts`) and simple method names (`execute`, `reset`) keeps the public API small and easy to document.  
* The only potential maintenance risk is the coupling to the cache in `LLMService`; any change to cache semantics must be coordinated with breaker expectations, but this is mitigated by the service’s single responsibility for both concerns.

## Diagrams

### Relationship

![CircuitBreaker Relationship](images/circuit-breaker-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/circuit-breaker-relationship.png)


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component's architecture is designed with dependency injection in mind, as seen in the LLMService class (lib/llm/llm-service.ts), which allows for the incorporation of various trackers and classifiers. This design decision enables a high degree of flexibility and testability, as different components can be easily swapped out or mocked. For instance, the budget tracker and sensitivity classifier can be replaced with mock implementations for testing purposes. The use of dependency injection also facilitates the addition of new providers, as the core service logic remains unchanged. The LLMService class extends EventEmitter, which provides a way to handle initialization, mode resolution, and completion requests in an event-driven manner.

### Children
- [StateManager](./StateManager.md) -- The CircuitBreaker class (lib/llm/circuit-breaker.ts) likely contains the StateManager's implementation, given its responsibility for detecting provider responsiveness.

### Siblings
- [LLMController](./LLMController.md) -- The LLMController class extends EventEmitter, which provides a way to handle initialization, mode resolution, and completion requests in an event-driven manner, as seen in the LLMService class (lib/llm/llm-service.ts)
- [ProviderRegistry](./ProviderRegistry.md) -- The ProviderRegistry class is responsible for managing the registration and availability of different LLM providers, as seen in the ProviderRegistry class (lib/llm/provider-registry.ts)
- [BudgetTracker](./BudgetTracker.md) -- The BudgetTracker class is responsible for managing the budget and tracking the costs associated with the LLM requests, as seen in the LLMService class (lib/llm/llm-service.ts)


---

*Generated from 7 observations*

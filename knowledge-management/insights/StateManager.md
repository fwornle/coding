# StateManager

**Type:** Detail

The StateManager's behavior would be influenced by the ThresholdManager, as suggested by the parent analysis, to determine the threshold for opening or closing the circuit.

## What It Is  

**StateManager** is the core component that drives the behaviour of the circuit‑breaker mechanism used by the LLM provider layer.  The implementation lives inside the **CircuitBreaker** class found at `lib/llm/circuit-breaker.ts`.  Within that file the StateManager is responsible for tracking the current circuit state (e.g., *closed*, *open*, *half‑open*) and for deciding when the circuit should transition based on runtime signals.  Its decision‑making is directly influenced by two collaborating collaborators – **ThresholdManager** (which supplies the numeric limits that trigger state changes) and **ResetManager** (which governs the timing and conditions for resetting a broken circuit).  

Because the observations explicitly state that “CircuitBreaker contains StateManager” and that the StateManager “would be influenced by the ThresholdManager” and “work closely with the ResetManager,” we can treat StateManager as the *state‑holding* and *state‑transition* engine embedded in the circuit‑breaker class.

---

## Architecture and Design  

The architecture follows a **composition‑based separation of concerns**.  The high‑level `CircuitBreaker` class composes three distinct responsibilities:

1. **StateManager** – holds the current circuit state and encapsulates the transition logic.  
2. **ThresholdManager** – provides the configurable thresholds (e.g., failure count, error‑rate) that the StateManager consults to decide when to open or close the circuit.  
3. **ResetManager** – manages the reset schedule (e.g., timeout, back‑off) that tells the StateManager when a previously opened circuit may be probed again.

This decomposition mirrors the classic **State pattern** (the circuit can be in one of several states and the behaviour changes accordingly) even though the pattern name is not explicitly mentioned in the source.  By extracting threshold evaluation and reset timing into their own managers, the design avoids a monolithic `CircuitBreaker` implementation and makes each concern independently testable.

Interaction flow (as inferred from the observations):

* The `CircuitBreaker` receives a request to the LLM provider.  
* The `StateManager` checks the current state. If the circuit is *open*, the request is rejected immediately.  
* If the request proceeds, any response (success or failure) is reported back to the `StateManager`.  
* The `StateManager` queries the **ThresholdManager** to see whether the failure metrics exceed the configured limits. If they do, the StateManager transitions the circuit to *open*.  
* When the circuit is *open*, the **ResetManager** starts a timer or back‑off sequence. Upon expiry, it signals the StateManager that a *probe* may be attempted, potentially moving the circuit to a *half‑open* state.  

The design therefore relies on **clear interfaces** between the three managers, allowing each to evolve (e.g., swapping a simple count‑based ThresholdManager for a more sophisticated statistical one) without impacting the others.

---

## Implementation Details  

* **Location** – All of the logic lives in `lib/llm/circuit-breaker.ts`.  The file defines the `CircuitBreaker` class, which internally instantiates a `StateManager`.  Although the exact class name for the manager is not listed, the observation that “CircuitBreaker contains StateManager” tells us the manager is a private or protected member of the `CircuitBreaker` implementation.  

* **State Representation** – The StateManager likely maintains an enum or string field representing the circuit’s current mode (`CLOSED`, `OPEN`, `HALF_OPEN`).  This field is the single source of truth for request gating.  

* **Threshold Interaction** – When a request fails, the StateManager forwards the failure count (or error‑rate) to the ThresholdManager.  The ThresholdManager returns a boolean (or a numeric comparison) indicating whether the failure metric has crossed the configured limit.  This decouples the threshold policy (fixed count, percentage, time‑window) from the state‑transition logic.  

* **Reset Coordination** – Upon entering the *open* state, the StateManager delegates timing responsibilities to the ResetManager.  The ResetManager could expose methods such as `scheduleReset()` or `isReadyToProbe()`.  When the reset condition is satisfied, the ResetManager notifies the StateManager, which then attempts a probe request and may transition to *half‑open* based on the outcome.  

* **State Transition Logic** – The StateManager contains the core transition rules:
  * **Closed → Open** – triggered when `ThresholdManager` reports that the failure threshold is exceeded.  
  * **Open → Half‑Open** – triggered by `ResetManager` after the reset interval expires.  
  * **Half‑Open → Closed** – if the probe request succeeds; otherwise, the circuit reverts to *open*.  

Because the observations do not list concrete method signatures, the description stays at the level of responsibilities and interactions rather than exact code.

---

## Integration Points  

* **Parent – CircuitBreaker** – The `CircuitBreaker` class is the public façade exposed to the rest of the LLM provider stack.  All external callers interact with `CircuitBreaker` (e.g., `execute(request)`).  Internally, `CircuitBreaker` forwards state‑related queries to its `StateManager`.  

* **Sibling – ThresholdManager & ResetManager** – Both managers are peers to the StateManager within the same `CircuitBreaker` composition.  They are injected or instantiated alongside the StateManager, and each provides a well‑defined interface (`checkThreshold()`, `scheduleReset()`, etc.) that the StateManager consumes.  

* **Downstream – LLM Provider** – When the StateManager reports a *closed* state, the request proceeds to the actual LLM provider.  Conversely, an *open* state short‑circuits the call, returning an error or fallback response.  

* **Upstream – Application Code** – Application components that rely on LLM calls import the `CircuitBreaker` from `lib/llm/circuit-breaker.ts`.  They do not need to be aware of the internal StateManager; they simply handle the success or circuit‑open error as part of normal error‑handling logic.  

No additional external dependencies are mentioned in the observations, so the integration surface is limited to the three managers and the provider they protect.

---

## Usage Guidelines  

1. **Instantiate via CircuitBreaker** – Developers should never create a `StateManager` directly.  Use the exported `CircuitBreaker` class (`new CircuitBreaker(...)`) which will internally wire the StateManager, ThresholdManager, and ResetManager together.  

2. **Configure Thresholds Early** – If the system allows passing a custom `ThresholdManager` (or configuration object) to the `CircuitBreaker` constructor, set realistic failure limits that match the provider’s SLA.  Overly aggressive thresholds will cause premature circuit opening, while lax thresholds may delay protection.  

3. **Respect Reset Timing** – The `ResetManager` determines how long the circuit stays open.  Adjust its parameters (e.g., exponential back‑off) based on the expected recovery time of the provider.  Changing these values after the circuit is already open may lead to inconsistent behaviour.  

4. **Handle Circuit‑Open Errors** – When a request is rejected because the circuit is open, the calling code should treat it as a transient failure and optionally fallback to a cached response or a degraded mode.  Do not treat it as a permanent provider error.  

5. **Monitor State Transitions** – For observability, log or emit metrics whenever the `StateManager` changes state.  This helps operators understand the health of the LLM provider and tune the ThresholdManager/ResetManager settings.  

---

### Architectural Patterns Identified  

* **Composition over Inheritance** – `CircuitBreaker` composes `StateManager`, `ThresholdManager`, and `ResetManager`.  
* **State Pattern (implicit)** – The circuit’s behaviour changes based on an internal state held by `StateManager`.  
* **Separation of Concerns** – Threshold evaluation and reset timing are isolated into their own managers.

### Design Decisions & Trade‑offs  

* **Modularity vs. Simplicity** – Splitting threshold logic and reset timing into separate managers adds modularity and testability but introduces extra indirection.  
* **Flexibility of Thresholds** – By delegating to a `ThresholdManager`, the system can support simple count‑based thresholds or more sophisticated statistical models without altering the StateManager.  
* **Reset Strategy Centralization** – Keeping reset logic in a dedicated `ResetManager` allows sophisticated back‑off policies but requires careful coordination to avoid race conditions when the circuit moves from *open* to *half‑open*.  

### System Structure Insights  

The circuit‑breaker subsystem is a self‑contained unit under `lib/llm/`.  Its hierarchy is:

```
CircuitBreaker (public façade)
 ├─ StateManager (holds current state, decides transitions)
 ├─ ThresholdManager (provides failure limits)
 └─ ResetManager (handles timing for resets)
```

All three live in the same file, suggesting a tightly coupled but clearly partitioned implementation.

### Scalability Considerations  

* Because the state is held in memory within a single `CircuitBreaker` instance, scaling horizontally (multiple service instances) will result in **independent circuit states** per instance.  If a global view of provider health is required, an external shared store would be needed – a decision not reflected in the current design.  
* The lightweight composition (no heavy external dependencies) means the circuit‑breaker adds minimal overhead per request, supporting high‑throughput scenarios.

### Maintainability Assessment  

The explicit separation into three managers makes the codebase **highly maintainable**:

* **Unit testing** – Each manager can be tested in isolation (state transitions, threshold calculations, reset timing).  
* **Future extensions** – New threshold strategies or reset policies can be introduced by implementing the same manager interfaces without touching the StateManager logic.  
* **Readability** – Keeping the StateManager’s responsibilities focused on state tracking reduces cognitive load for developers reviewing the circuit‑breaker logic.  

Overall, the design inferred from the observations demonstrates a clean, modular approach that balances flexibility with simplicity, while staying grounded in the concrete file `lib/llm/circuit-breaker.ts` and its constituent managers.


## Hierarchy Context

### Parent
- [CircuitBreaker](./CircuitBreaker.md) -- The CircuitBreaker class is responsible for detecting when a provider is not responding and preventing further requests, as seen in the CircuitBreaker class (lib/llm/circuit-breaker.ts)


---

*Generated from 3 observations*

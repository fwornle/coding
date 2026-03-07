# BudgetTracker

**Type:** SubComponent

The tracker interacts with the LLMProviderManager to ensure cost constraints are respected, as seen in the llm-provider-manager.ts file

## What It Is  

**BudgetTracker** is a TypeScript sub‑component that lives inside the **LLMAbstraction** package. Its core implementation resides in `src/budget-tracker/budget-tracker.ts`, while the supporting logic is split across three dedicated modules:

* `src/budget-tracker/budgeting-algorithm.ts` – contains the **BudgetingAlgorithm** that implements the core budget‑tracking rules.  
* `src/budget-tracker/cost-estimation-strategy.ts` – provides a **CostEstimationStrategy** used to predict the monetary impact of upcoming LLM calls.  
* `src/budget-tracker/budget-updates.ts` – orchestrates asynchronous budget‑update flows with `async/await`.

The class `BudgetTracker` is instantiated by the parent **LLMAbstraction** component via dependency injection, receiving a concrete **SensitivityClassifier** (injected from the sibling `SensitivityClassifier` component). At runtime the tracker collaborates with `LLMProviderManager` (`src/llm-provider-manager/llm-provider-manager.ts`) to enforce cost ceilings before any LLM provider is invoked.  

In short, BudgetTracker is the gatekeeper that continuously monitors, estimates, and enforces budget constraints for all LLM operations, leveraging TypeScript’s static typing to keep the logic safe and maintainable.

---

## Architecture and Design  

The observable architecture of **BudgetTracker** follows a **composition‑over‑inheritance** style, where the tracker aggregates two child services – **BudgetingAlgorithm** and **CostEstimationStrategy** – each encapsulated in its own file. This modular split mirrors the **strategy pattern**: the cost‑estimation logic can be swapped by providing a different implementation of `CostEstimationStrategy` without touching the tracker itself.  

Dependency injection is the primary wiring mechanism. The parent **LLMAbstraction** component injects the **SensitivityClassifier** into `BudgetTracker` (as noted in the observation about “dependency injection to set the sensitivity classifier”). This mirrors the injection approach used by sibling components such as `LLMProviderManager` (which receives a `ProviderRegistry`) and `ModeResolver` (which receives a `ModeRegistry`). By centralising object creation at the parent level, the system achieves loose coupling and easier testability.

Interaction flow: when an LLM request is about to be issued, the caller asks **BudgetTracker** for permission. The tracker first runs the **BudgetingAlgorithm** to check current spend, then invokes the **CostEstimationStrategy** to predict the cost of the pending request. If the projected spend stays within the limits enforced by `LLMProviderManager`, the request proceeds; otherwise the tracker rejects or throttles the operation. All of this occurs asynchronously, as demonstrated by the `async/await` pattern in `budget-updates.ts`, aligning with the broader asynchronous design of the parent component.

---

## Implementation Details  

### Core Class – `BudgetTracker` (`budget-tracker.ts`)  
* Declared as `export class BudgetTracker`.  
* Constructor receives injected collaborators: a `SensitivityClassifier`, a concrete `BudgetingAlgorithm`, and a `CostEstimationStrategy`.  
* Public methods such as `async updateBudget(request: LLMRequest): Promise<BudgetResult>` (inferred from `budget-updates.ts`) perform the async budget‑update cycle.  

### Budgeting Algorithm (`budgeting-algorithm.ts`)  
* Implements the logical rules for budget consumption, e.g., decrementing remaining credits, handling roll‑overs, and resetting periods.  
* Exposes a method like `isWithinBudget(estimatedCost: number): boolean` that the tracker calls after cost estimation.  

### Cost Estimation Strategy (`cost-estimation-strategy.ts`)  
* Encapsulates the logic for forecasting the monetary cost of an LLM operation based on token counts, model pricing, and any sensitivity‑based multipliers.  
* Designed as a pluggable strategy; the file name and observation imply a single concrete implementation, but the pattern allows alternative strategies (e.g., a “conservative” vs. “aggressive” estimator).  

### Asynchronous Updates (`budget-updates.ts`)  
* Contains helper functions that wrap the budgeting workflow in `async` functions.  
* Uses `await` when calling external services such as `LLMProviderManager` to fetch current provider rates or when persisting budget state to a datastore.  

### TypeScript Typing  
All modules leverage TypeScript interfaces and types (e.g., `IBudgetingAlgorithm`, `ICostEstimationStrategy`, `LLMRequest`, `BudgetResult`). This static typing enforces contract compliance between the tracker and its children, reduces runtime errors, and aids IDE tooling for maintainability.

---

## Integration Points  

1. **Parent – LLMAbstraction**: The parent component instantiates `BudgetTracker` and injects the required `SensitivityClassifier`. Because LLMAbstraction already employs dependency injection for its other children (e.g., `ModeResolver`, `ProviderRegistry`), BudgetTracker fits naturally into the same inversion‑of‑control container.  

2. **Sibling – LLMProviderManager** (`llm-provider-manager.ts`): BudgetTracker calls into `LLMProviderManager` to query or enforce cost caps. The manager, in turn, uses a `ProviderRegistry` to resolve the concrete LLM provider that will execute the request. This bidirectional relationship ensures that budget constraints are respected before any provider is invoked.  

3. **Sibling – SensitivityClassifier**: The classifier influences budgeting decisions, possibly by applying higher cost multipliers to sensitive prompts. The injected classifier is used inside `BudgetTracker` when evaluating whether a request should be allowed.  

4. **Children – BudgetingAlgorithm & CostEstimationStrategy**: Both are pure domain services that the tracker delegates to. Their public APIs are defined by TypeScript interfaces, enabling the tracker to remain agnostic of the internal algorithmic details.  

5. **External Persistence (implicit)**: While not explicitly listed, the async update flow in `budget-updates.ts` suggests interaction with a datastore (e.g., a JSON file, DB, or in‑memory cache) to persist the current budget state.  

All integration points are type‑safe and rely on explicit interfaces, reinforcing compile‑time guarantees across component boundaries.

---

## Usage Guidelines  

* **Instantiate via the DI container** – never `new BudgetTracker()` directly in application code; let `LLMAbstraction` supply the instance so that the correct `SensitivityClassifier`, `BudgetingAlgorithm`, and `CostEstimationStrategy` are wired.  
* **Prefer the async API** – call `await budgetTracker.updateBudget(request)` rather than any synchronous shortcut; this ensures that the latest provider rates and persisted budget state are taken into account.  
* **Do not modify child implementations in place** – if you need a different cost‑estimation behaviour, implement a new class that satisfies the `ICostEstimationStrategy` interface and register it with the DI container. This respects the strategy pattern and avoids breaking existing callers.  
* **Handle rejection gracefully** – the `updateBudget` method will resolve to a `BudgetResult` indicating success or failure. Consumers should check this result and fallback (e.g., degrade model quality or delay the request) rather than assuming the operation will always succeed.  
* **Keep TypeScript typings up‑to‑date** – any change to the shape of `LLMRequest` or `BudgetResult` must be reflected in the corresponding interfaces; this prevents subtle mismatches between the tracker and its collaborators.

---

### Architectural patterns identified  

1. **Dependency Injection** – used by the parent `LLMAbstraction` to inject `SensitivityClassifier`, `BudgetingAlgorithm`, and `CostEstimationStrategy` into `BudgetTracker`.  
2. **Strategy Pattern** – embodied by `CostEstimationStrategy` (and potentially by alternative budgeting algorithms).  
3. **Composition over Inheritance** – `BudgetTracker` composes child services rather than extending a base class.  
4. **Asynchronous Programming (async/await)** – all budget updates are performed asynchronously, matching the broader async nature of LLM operations.  

### Design decisions and trade‑offs  

* **Explicit DI vs. Service Locator** – the choice to inject collaborators at construction time improves testability and clarity but adds boilerplate in the DI configuration.  
* **Separate Cost Estimation Strategy** – isolates pricing logic, making it replaceable, but introduces an additional indirection layer that can slightly increase call‑stack depth.  
* **Async budget updates** – ensures up‑to‑date state but requires callers to handle promises, potentially complicating synchronous code paths.  
* **Strong typing with TypeScript** – boosts maintainability and IDE support, at the cost of a steeper learning curve for developers unfamiliar with advanced type features.  

### System structure insights  

The system is organised as a hierarchy: **LLMAbstraction** (parent) → **BudgetTracker** (sub‑component) → **BudgetingAlgorithm** & **CostEstimationStrategy** (children). Sibling components (e.g., `LLMProviderManager`, `SensitivityClassifier`) share the same DI container and asynchronous conventions, reinforcing a consistent architectural language across the codebase. The registry‑based approach seen in `ProviderRegistry` and `ModeRegistry` mirrors the way `BudgetTracker` registers its strategies, suggesting a broader pattern of “registry + strategy” throughout the project.

### Scalability considerations  

* **Pluggable estimation** – new pricing models or token‑based cost formulas can be introduced by adding a new `CostEstimationStrategy` implementation without touching the tracker, supporting horizontal scaling of pricing logic.  
* **Async I/O** – budget checks and updates are non‑blocking, allowing the system to handle many concurrent LLM requests without thread starvation.  
* **Stateless Tracker Core** – since the tracker delegates state persistence to external services (e.g., a database accessed in `budget-updates.ts`), multiple tracker instances could be run behind a load balancer, facilitating vertical scaling.  

Potential bottlenecks include the latency of the external persistence layer and the cost‑estimation computation; both should be kept lightweight or cached if necessary.

### Maintainability assessment  

The use of **TypeScript interfaces**, **dependency injection**, and **strategy encapsulation** yields a highly maintainable codebase. Each concern (budget logic, cost prediction, sensitivity handling) lives in its own file, enabling focused unit tests and straightforward refactoring. The explicit async flow makes side‑effects visible, reducing hidden state bugs. However, maintainability hinges on keeping the DI configuration accurate; mismatched injections could surface only at runtime if type assertions are bypassed. Overall, the architecture promotes clear separation of concerns, testability, and extensibility, aligning well with long‑term maintenance goals.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- Key patterns observed in the LLMAbstraction component include dependency injection, used to set the mode resolver, budget tracker, and sensitivity classifier, and the strategy pattern, applied in the provider registry to manage the different LLM providers. The component's architecture is also characterized by the use of asynchronous programming, promises, and async/await syntax to handle the inherently asynchronous nature of LLM operations. Furthermore, the code utilizes TypeScript, benefiting from its type system to ensure better code maintainability and scalability.

### Children
- [BudgetingAlgorithm](./BudgetingAlgorithm.md) -- The budgeting-algorithm.ts file is expected to contain the implementation of the BudgetingAlgorithm, which would define the core logic for budget tracking and management
- [CostEstimationStrategy](./CostEstimationStrategy.md) -- The CostEstimationStrategy would likely be implemented as a separate module or class, allowing for easy modification or replacement of the estimation logic

### Siblings
- [LLMProviderManager](./LLMProviderManager.md) -- LLMProviderManager uses a provider registry to manage the different LLM providers, as seen in the provider-registry.ts file
- [SensitivityClassifier](./SensitivityClassifier.md) -- SensitivityClassifier uses a classification algorithm to classify input prompts, as seen in the classification-algorithm.ts file
- [ModeResolver](./ModeResolver.md) -- ModeResolver uses a mode registry to manage the different modes, as seen in the mode-registry.ts file
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses a registry-based approach to manage the different LLM providers, as seen in the provider-registry.ts file


---

*Generated from 6 observations*

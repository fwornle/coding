# CodingConventions

**Type:** SubComponent

The CodingConventions sub-component uses a strategy pattern to select the appropriate coding convention based on the context, as seen in coding-conventions/strategy.ts.

## What It Is  

The **CodingConventions** sub‑component lives under the `coding-conventions/` directory and is a concrete implementation of the broader *CodingPatterns* component. Its core responsibilities are to define, enforce, and persist coding‑style rules across a codebase. The component interacts with the graph‑database layer via the `createEntity()` method found in **`storage/graph-database-adapter.ts`** – the same adapter used by sibling components such as *DesignPatterns* and *BaseAgent*. Internally, the sub‑component is organized around a handful of focused modules:

* **`coding-conventions/rules.ts`** – a rules‑engine that codifies the standards to be checked.  
* **`coding-conventions/visitor.ts`** – a visitor implementation that walks the abstract syntax tree (AST) of source files.  
* **`coding-conventions/strategy.ts`** – a strategy selector that chooses the appropriate rule‑set based on context (e.g., language, project type).  
* **`coding-conventions/dry.ts`** – utilities that enforce the DRY principle across the rule definitions and visitor logic.  

Together, these files give *CodingConventions* a well‑encapsulated, rule‑driven workflow that can be stored, retrieved, and versioned through the graph database.

---

## Architecture and Design  

### Design Patterns in Play  

1. **BaseAgent pattern (`base-agent.ts`)** – *CodingConventions* inherits the standardized agent contract supplied by **BaseAgent**. This pattern centralises response handling, error propagation, and logging, ensuring that all sub‑components (including *DesignPatterns* and *GraphDatabaseAdapter*) behave consistently when they act as agents that request or modify data.  

2. **Visitor pattern (`coding-conventions/visitor.ts`)** – The sub‑component uses a classic visitor to traverse the AST of each source file. By decoupling the traversal logic from the concrete rule checks, new language constructs can be supported without altering the visitor core.  

3. **Strategy pattern (`coding-conventions/strategy.ts`)** – Context‑sensitive rule selection is delegated to interchangeable strategy objects. For example, a *JavaScript* strategy may load a different rule set than a *Python* strategy, while the surrounding infrastructure remains unchanged.  

4. **Rules‑based engine (`coding-conventions/rules.ts`)** – The rule definitions themselves constitute a declarative, data‑driven approach to enforce coding standards. Each rule is expressed as a predicate that can be evaluated by the visitor during traversal.  

5. **DRY utilities (`coding-conventions/dry.ts`)** – Common helper functions and abstractions are factored out to avoid duplication across rule definitions and visitor implementations, embodying the “Don’t Repeat Yourself” principle.  

### Component Interaction  

*The flow* begins when an external client (e.g., a CI job) invokes the *CodingConventions* agent. The agent, built on **BaseAgent**, calls into the **Strategy** module to resolve the appropriate rule set for the target project. The **Visitor** then walks the source tree, invoking each rule from **`rules.ts`**. When a rule violation is detected, the visitor records a diagnostic object that is ultimately persisted via **`storage/graph-database-adapter.ts`**’s `createEntity()` method. This persistence step is shared with sibling components—*DesignPatterns* and *GraphDatabaseAdapter*—highlighting a common storage contract across the *CodingPatterns* family.  

Because *EntityStorage* is a child component of *CodingConventions*, it encapsulates the low‑level CRUD operations that the visitor’s diagnostics rely on. The parent *CodingPatterns* component provides the overarching modular design, allowing each sub‑component (including *CodingConventions*) to focus on its domain while reusing the same graph‑database adapter.

---

## Implementation Details  

### `storage/graph-database-adapter.ts` – `createEntity()`  

The adapter abstracts a graph‑database (e.g., Neo4j) behind a thin API. `createEntity()` receives a plain JavaScript object representing a coding‑convention entity (such as a rule violation) and translates it into a graph node with appropriate relationships (e.g., *violates*, *belongsTo*). The same method is called by *DesignPatterns* to store pattern entities, confirming a shared persistence contract.  

### `base-agent.ts` – BaseAgent  

`BaseAgent` defines a base class that implements common lifecycle hooks (`initialize`, `execute`, `finalize`) and a uniform response envelope (`{ status, payload, error }`). *CodingConventions* extends this class, inheriting error handling and logging, which reduces boilerplate across sibling agents.  

### `coding-conventions/rules.ts`  

Rules are expressed as plain objects with a `check(node: ASTNode): Diagnostic | null` signature. The module exports a dictionary keyed by rule identifiers, enabling the strategy layer to pull only the relevant subset. Each rule is pure‑functional, making them trivially testable and composable.  

### `coding-conventions/visitor.ts`  

The visitor implements the classic double‑dispatch pattern: for each AST node type, it calls the corresponding `visitX` method. Inside each visitor method, it iterates over the active rule set (provided by the strategy) and invokes `rule.check(node)`. Detected diagnostics are accumulated in a local collection and later handed off to *EntityStorage* for persistence.  

### `coding-conventions/strategy.ts`  

A `StrategyContext` object holds metadata such as language, framework, and project size. Concrete strategy classes (`JavaScriptStrategy`, `PythonStrategy`, etc.) implement a `selectRules(context): RuleSet` method that returns the appropriate rule dictionary. The context is supplied by the agent at runtime, allowing dynamic adaptation without code changes.  

### `coding-conventions/dry.ts`  

Utility functions like `uniqueId()`, `mergeDiagnostics()`, and `assertNever()` live here. By centralising these helpers, the rule definitions and visitor code avoid repetitive boilerplate, adhering to the DRY principle highlighted in the observations.  

---

## Integration Points  

1. **Graph Database Layer** – The sub‑component relies on the `createEntity()` function from **`storage/graph-database-adapter.ts`**. Any change to the adapter’s contract (e.g., schema evolution) will ripple to *CodingConventions* as well as its siblings.  

2. **BaseAgent Interface** – By extending **BaseAgent**, *CodingConventions* automatically integrates with the system‑wide agent orchestration pipeline (e.g., scheduling, health monitoring).  

3. **Strategy Context Provider** – The component expects a context object supplied by the caller (often the parent *CodingPatterns* orchestrator). This contract defines which fields must be present (language, framework) for the strategy selector to work.  

4. **EntityStorage Child** – All diagnostics are persisted through *EntityStorage*, which abstracts the graph‑database CRUD operations. The storage module can be swapped out (e.g., for an in‑memory store) without affecting the visitor or rule logic, thanks to the clean separation.  

5. **Sibling Reuse** – Because *DesignPatterns* and *BaseAgent* also invoke `createEntity()`, any cross‑cutting concerns such as transaction handling or audit logging are naturally shared, promoting consistency across the *CodingPatterns* ecosystem.  

---

## Usage Guidelines  

*When adding a new coding rule*: Define the rule in `coding-conventions/rules.ts` as a pure `check` function, then register it in the appropriate strategy class within `coding-conventions/strategy.ts`. Avoid duplicating validation logic; reuse existing helpers from `coding-conventions/dry.ts` to stay DRY.  

*When extending language support*: Implement a new strategy subclass (e.g., `GoStrategy`) that returns a rule set tailored to the language. The visitor does not need modification because it already iterates over the supplied rule collection.  

*Persisting diagnostics*: Always funnel violation objects through the `EntityStorage` child component. Do not call the graph adapter directly from rule or visitor code; this preserves the separation of concerns and keeps the persistence contract centralised.  

*Agent execution*: Invoke *CodingConventions* through the standard BaseAgent entry point (`execute(context)`). Ensure the context contains the required fields (language, project root) so that the strategy selector can operate correctly.  

*Testing*: Because rules are pure functions and the visitor only orchestrates them, unit tests should target each rule independently and then validate the visitor’s aggregation logic with a mock AST. Mock the graph‑database adapter to verify that `createEntity()` is called with the expected diagnostic payloads.  

---

### Architectural patterns identified  

* BaseAgent pattern (standardised agent behaviour)  
* Visitor pattern (AST traversal)  
* Strategy pattern (context‑driven rule selection)  
* Rules‑based engine (declarative enforcement)  
* DRY utilities (code reuse)  

### Design decisions and trade‑offs  

* **Separation of traversal vs. rule logic** – By using a visitor, the system gains extensibility (new node types) at the cost of a slightly more complex orchestration layer.  
* **Strategy‑driven rule selection** – Enables flexible, language‑specific configurations without proliferating conditionals, but introduces the need for a well‑defined context contract.  
* **Shared graph‑database adapter** – Promotes consistency across siblings, yet couples all sub‑components to the same persistence technology, potentially limiting alternative storage strategies.  

### System structure insights  

* *CodingConventions* is a leaf sub‑component of *CodingPatterns* with a dedicated child (*EntityStorage*) for persistence.  
* Sibling components share the same storage adapter and base‑agent foundation, forming a cohesive family of pattern‑related services.  
* The modular design (rules, visitor, strategy, DRY utilities) mirrors the classic “clean architecture” separation of concerns.  

### Scalability considerations  

* **Horizontal scaling** – Because rule evaluation is stateless and the visitor operates on per‑file ASTs, the workload can be parallelised across multiple agents or worker processes.  
* **Graph‑DB bottleneck** – High‑volume violation persistence could pressure the `createEntity()` path; batching diagnostics in *EntityStorage* before bulk insertion would mitigate this.  
* **Strategy cache** – Caching the result of `selectRules(context)` for repeated runs on the same project reduces repeated rule‑set construction.  

### Maintainability assessment  

* The strict DRY enforcement via `coding-conventions/dry.ts` and the pure‑function rule definitions make the codebase easy to reason about and test.  
* The clear division between traversal, rule logic, and persistence isolates changes; adding a new rule or language rarely requires touching the visitor or storage layers.  
* However, the reliance on a single graph‑database adapter means that any schema change propagates to all siblings, demanding careful versioning and migration planning.  

Overall, *CodingConventions* demonstrates a disciplined, pattern‑rich implementation that balances extensibility with maintainability, while leveraging shared infrastructure provided by its parent *CodingPatterns* and sibling components.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes a modular design, with multiple sub-components working together to provide a cohesive framework for coding standards. This is evident in the use of the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for graph database interactions and knowledge persistence. The createEntity() method in storage/graph-database-adapter.ts is specifically used for storing and managing entities, demonstrating a clear separation of concerns. Furthermore, the employment of the BaseAgent pattern from base-agent.ts standardizes agent behavior and response handling, ensuring consistency across the component.

### Children
- [EntityStorage](./EntityStorage.md) -- The createEntity() method in storage/graph-database-adapter.ts is used to store and manage coding convention entities, indicating a graph database is used for storage.

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- DesignPatterns leverages the createEntity() method in storage/graph-database-adapter.ts to store and manage design pattern entities.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the createEntity() method to store and manage entities in the graph database, as seen in storage/graph-database-adapter.ts.
- [BaseAgent](./BaseAgent.md) -- BaseAgent uses the GraphDatabaseAdapter to store and manage agent-related data, as seen in base-agent.ts.


---

*Generated from 6 observations*

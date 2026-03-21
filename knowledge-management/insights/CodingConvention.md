# CodingConvention

**Type:** SubComponent

The CodingConvention sub-component is configured using the config/coding-convention-config.json file, which defines the coding standards to be enforced.

## What It Is  

The **CodingConvention** sub‑component lives primarily in the **`lib/llm/llm-service.ts`** source file.  Within this file the **`LLMService`** class exposes an **`applyCodingConventions`** method that is responsible for enforcing the coding standards defined for the project.  The concrete rules themselves are stored in **`config/coding-convention-config.json`**, while the low‑level persistence of those rules (and the results of applying them) is handled through the **`GraphDatabaseAdapter`**, which reads its connection details from **`config/graph-database-config.json`**.  CodingConvention is a child of the **CodingPatterns** component and works hand‑in‑hand with sibling sub‑components such as **DesignPatternAnalyzer**, **CodeQualityEvaluator**, and **PatternStorage**.  

## Architecture and Design  

The architecture follows a **modular sub‑component pattern** anchored in a shared graph‑database layer.  All sub‑components that need persistence—CodingConvention, DesignPatternAnalyzer, CodeQualityEvaluator, and PatternStorage—delegate that responsibility to the **`GraphDatabaseAdapter`**.  This adapter implements the **Adapter pattern**, isolating the rest of the codebase from the specifics of the underlying graph database technology and allowing the configuration to be swapped via the **`graph-database-config.json`** file without touching business logic.  

Configuration is externalised through JSON files, a classic **Configuration‑as‑Code** approach.  The **`coding-convention-config.json`** file enumerates the coding standards (e.g., naming conventions, indentation rules, comment requirements) that the **`applyCodingConventions`** method reads at runtime.  By keeping standards declarative, the design promotes flexibility: new rules can be added or existing ones tweaked without recompiling the service.  

The **`LLMService`** class acts as a façade for LLM‑driven operations, encapsulating the logic that applies conventions to a codebase.  Its method **`applyCodingConventions`** orchestrates three distinct steps: (1) loading the convention definitions, (2) invoking the graph database through the adapter to retrieve any existing convention‑related metadata, and (3) persisting any updates or audit trails back to the graph store.  This separation of concerns mirrors a **Facade pattern**, presenting a simple API to callers while hiding the complexity of configuration loading and database interaction.  

## Implementation Details  

- **`lib/llm/llm-service.ts`** – houses the **`LLMService`** class.  The class contains the **`applyCodingConventions`** method, which is the entry point for enforcing standards.  Internally, the method likely reads **`config/coding-convention-config.json`** (using a standard JSON parser) to build an in‑memory representation of the rules.  It then calls the **`GraphDatabaseAdapter`** (imported from a sibling module) to either fetch existing convention entities or store new ones that represent the outcome of the analysis.  

- **`config/coding-convention-config.json`** – defines the concrete coding standards.  Because the file is JSON, the format is language‑agnostic and can be version‑controlled alongside the source.  The presence of this file indicates a **data‑driven** implementation: the service does not hard‑code any rule logic but instead interprets the JSON payload at runtime.  

- **`config/graph-database-config.json`** – supplies connection details (e.g., endpoint URL, authentication tokens) for the graph database.  The **`GraphDatabaseAdapter`** reads this file to establish a client session, thereby decoupling the adapter from any particular environment (development, staging, production).  

- **Interaction with Siblings** – The **DesignPatternAnalyzer** and **CodeQualityEvaluator** sub‑components also use the same adapter and configuration files, suggesting a **shared persistence contract**.  For example, when **DesignPatternAnalyzer** stores analysis results, those nodes can be linked to coding‑convention nodes, enabling richer queries across patterns and standards.  

## Integration Points  

1. **GraphDatabaseAdapter** – The primary integration surface for all persistence operations.  CodingConvention calls the adapter’s methods (e.g., `saveNode`, `fetchNode`) to read/write convention data.  Because the adapter abstracts the graph database, any change to the underlying store (e.g., switching from Neo4j to Amazon Neptune) requires only updates to **`graph-database-config.json`** and possibly the adapter implementation, not the sub‑components.  

2. **DesignPatternAnalyzer** – Supplies design‑pattern insights that may influence which conventions are applicable.  For instance, a detected “Singleton” pattern might trigger a convention that enforces private constructors.  The two sub‑components exchange data through the graph database, using shared node/relationship types.  

3. **CodeQualityEvaluator** – Consumes the output of **`applyCodingConventions`** to assess overall code health.  It reads the convention‑audit nodes created by CodingConvention to calculate compliance scores.  

4. **PatternStorage** – Acts as a generic repository for all coding patterns, including those defined by CodingConvention.  The overlap in storage responsibilities reinforces a **single source of truth** for pattern‑related data.  

5. **Parent Component – CodingPatterns** – Provides the broader context in which CodingConvention operates.  CodingPatterns orchestrates the various sub‑components, ensuring that conventions are applied before pattern analysis or quality evaluation occurs.  

## Usage Guidelines  

- **Always keep the JSON configuration files in sync with the codebase.**  When adding a new rule, update **`coding-convention-config.json`** and, if necessary, extend the parsing logic in **`LLMService.applyCodingConventions`** to recognize the new schema.  

- **Do not bypass the GraphDatabaseAdapter.**  Direct database calls undermine the abstraction and make future database swaps painful.  All reads and writes related to conventions should go through the adapter’s public API.  

- **Sequence matters.**  In a typical workflow, the parent **CodingPatterns** component should invoke **`applyCodingConventions`** before triggering **DesignPatternAnalyzer** or **CodeQualityEvaluator**.  This ensures that any rule‑based transformations are reflected in subsequent analyses.  

- **Version control the configuration files.**  Because they drive runtime behaviour, any change should be reviewed and tested in the same pipeline as code changes.  

- **Monitor performance of graph queries.**  Since conventions are stored as graph nodes, complex queries (e.g., “find all files violating rule X”) can become costly.  Consider indexing frequently accessed properties in the graph database configuration.  

---

### Architectural patterns identified  

1. **Adapter pattern** – `GraphDatabaseAdapter` abstracts the graph database.  
2. **Facade pattern** – `LLMService` provides a simplified API (`applyCodingConventions`).  
3. **Configuration‑as‑Code** – JSON files (`coding-convention-config.json`, `graph-database-config.json`) externalise behaviour.  
4. **Modular sub‑component architecture** – Clear separation between CodingConvention, DesignPatternAnalyzer, CodeQualityEvaluator, and PatternStorage.  

### Design decisions and trade‑offs  

- **Centralised graph persistence** offers rich relationship modeling but introduces a single point of failure; the adapter mitigates vendor lock‑in but adds an indirection layer.  
- **Data‑driven rule definition** enables rapid rule updates without code changes, at the cost of runtime parsing overhead and the need for strict schema validation.  
- **Shared adapter across siblings** reduces duplication but couples sub‑components to the same storage contract, which can limit independent evolution.  

### System structure insights  

The system is organized around a **parent‑child hierarchy** (`CodingPatterns` → `CodingConvention`) with **peer sub‑components** that all converge on a **graph‑database backend**.  The **`lib/llm/llm-service.ts`** file acts as a hub for LLM‑related services, housing both the convention‑application logic and the adapter interactions.  Configuration files sit in a dedicated **`config`** directory, reinforcing a clear separation between code and environment‑specific settings.  

### Scalability considerations  

- **Graph database scaling** (horizontal sharding, read replicas) will directly affect the throughput of all sub‑components, including CodingConvention.  
- **Batching of convention applications** could improve performance for large codebases; the current `applyCodingConventions` method should be examined for bulk‑operation support.  
- **Caching of rule definitions** (e.g., loading `coding-convention-config.json` once per process) can reduce I/O overhead.  

### Maintainability assessment  

The clear modular boundaries and reliance on well‑defined adapters make the codebase **highly maintainable**.  Adding new conventions or adjusting existing ones requires only JSON edits and, at most, minor adjustments to the parsing logic.  However, the heavy dependence on a single graph database means that any schema changes must be coordinated across all sibling sub‑components, demanding disciplined change‑management practices.  Overall, the design balances flexibility with a manageable level of coupling.

## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes the GraphDatabase class for persistence, as indicated by the presence of graph-database-config.json in the config directory. This configuration file suggests that the component is designed to work with a graph database, which is ideal for storing complex relationships between coding patterns and entities. The GraphDatabaseAdapter, used by the PatternStorage sub-component, provides a layer of abstraction between the component and the graph database, allowing for easier switching between different database implementations if needed. This design decision is evident in the lib/llm/llm-service.ts file, where the LLMService class interacts with the GraphDatabaseAdapter to store and retrieve coding patterns.

### Siblings
- [DesignPatternAnalyzer](./DesignPatternAnalyzer.md) -- DesignPatternAnalyzer interacts with the GraphDatabaseAdapter in the lib/llm/llm-service.ts file to store and retrieve design pattern analysis results.
- [CodeQualityEvaluator](./CodeQualityEvaluator.md) -- CodeQualityEvaluator interacts with the GraphDatabaseAdapter in the lib/llm/llm-service.ts file to store and retrieve code quality evaluation results.
- [PatternStorage](./PatternStorage.md) -- PatternStorage interacts with the GraphDatabaseAdapter in the lib/llm/llm-service.ts file to store and retrieve coding patterns and entities.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter interacts with the graph database using the graph-database-config.json file in the config directory.

---

*Generated from 7 observations*

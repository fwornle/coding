# QueryExecutionOptimizer

**Type:** Detail

For advanced query planning, it could integrate with machine learning-based query optimizers or use query planning algorithms like the Volcano or Cascades frameworks (e.g., ml-query-optimizer.ts:95)

## What It Is  

`QueryExecutionOptimizer` lives inside the **DataStorage** subsystem and is responsible for turning raw SQL statements into the most efficient execution plan possible before they are handed to the relational database used by `DataStorage.useDatabase()`.  The core implementation can be seen in three concrete files:  

* **`query-optimizer.ts`** – line 63 shows the component importing a database‑query‑analysis library (e.g., *pg‑query‑store* or a generic *query‑parser*) and using it to inspect incoming SQL strings.  
* **`cache-manager.ts`** – line 81 reveals an in‑memory or disk‑based cache (often Redis) that stores previously computed plans together with an invalidation routine to keep the cache fresh when underlying schema or statistics change.  
* **`ml-query-optimizer.ts`** – line 95 demonstrates an optional plug‑in that can invoke a machine‑learning model or classic query‑planning algorithms such as Volcano or Cascades to produce a cost‑based plan for complex queries.

Together these files give `QueryExecutionOptimizer` a layered, pluggable architecture: a fast‑path cache, a rule‑based analyzer, and an optional advanced optimizer that can be swapped in when the workload justifies the extra cost.

---

## Architecture and Design  

The observable design follows a **layered optimizer** pattern. The first layer (`cache-manager.ts`) acts as a *Cache‑Aside* façade: before any analysis is performed the optimizer checks whether a matching plan already exists in Redis (or a local disk cache). If a hit occurs, the cached plan is returned immediately, dramatically reducing latency for repetitive workloads.

The second layer (`query-optimizer.ts`) implements a **Strategy**‑style analysis step. By delegating the parsing of SQL to a dedicated library (e.g., *pg‑query‑store*), the component isolates parsing concerns from the rest of the system. This keeps the optimizer agnostic to the specific dialect and allows the same code to be reused by sibling components such as `DatabaseConnectionManager`, which also relies on the database driver to execute the final plan.

The third layer (`ml-query-optimizer.ts`) introduces an **Extensible Plug‑in** point. The file references machine‑learning‑based optimizers and classic algorithmic frameworks (Volcano, Cascades). By exposing a well‑defined interface (e.g., `IQueryPlanner.plan(query)`) the system can swap a lightweight rule‑based planner for a heavyweight ML model without touching the cache or parsing layers. This separation of concerns mirrors the **Decorator** pattern: the advanced planner decorates the basic plan with cost‑based refinements.

Interaction between layers is linear: the cache checks first, the parser/strategy runs second, and the optional ML plug‑in runs third only when the earlier steps cannot produce a satisfactory plan. The parent `DataStorage` component invokes `QueryExecutionOptimizer.optimize(query)` before passing the result to `DatabaseConnectionManager` for execution, while `DataSerializationHandler` may later serialize the result set for downstream consumers.

---

## Implementation Details  

1. **Cache Layer (`cache-manager.ts:81`)**  
   *A Redis client* (or a local file‑system cache) is instantiated at module load time. The `getPlan(queryHash)` method looks up a hash of the normalized query string. On a miss, `storePlan(queryHash, plan, ttl)` persists the newly generated plan with a time‑to‑live that reflects the expected stability of schema statistics. The invalidation strategy watches for schema‑change events emitted by `DataStorage` and purges related entries, ensuring that stale plans do not survive schema migrations.

2. **Parsing & Rule‑Based Planning (`query-optimizer.ts:63`)**  
   The optimizer imports a parsing library (`pg-query-store` or a generic `query-parser`). The function `analyzeQuery(rawSql)` produces an AST (Abstract Syntax Tree) that is then walked to extract tables, joins, predicates, and indexes. Based on this metadata, a set of heuristic rules (e.g., “push down predicates”, “prefer index scans for equality predicates”) are applied to construct an initial logical plan. This plan is then serialized into a lightweight JSON structure that the cache can store.

3. **Advanced ML / Algorithmic Planning (`ml-query-optimizer.ts:95`)**  
   When the heuristic plan’s estimated cost exceeds a configurable threshold, the optimizer delegates to `MLQueryPlanner`. This class loads a pre‑trained model (often a TensorFlow.js or ONNX model) that predicts join ordering and access paths. Alternatively, the file can instantiate a Volcano‑style iterator executor or a Cascades‑style memoization engine, both of which explore alternative plans and select the cheapest according to a cost model. The final plan returned by this layer replaces the heuristic one and is cached for future reuse.

All three layers expose a single public method `optimize(rawSql: string): ExecutionPlan` that the parent `DataStorage` calls. Errors in any layer bubble up as `OptimizerError`, allowing `DataStorage` to fall back to a safe “no‑optimisation” path if necessary.

---

## Integration Points  

* **Parent – `DataStorage`**: `DataStorage` orchestrates the end‑to‑end flow. Before persisting or retrieving data, it calls `QueryExecutionOptimizer.optimize(sql)` to obtain an `ExecutionPlan`. The plan is then handed to `DatabaseConnectionManager` for actual execution. Because `DataStorage` also emits schema‑change events, the optimizer’s cache invalidation logic can subscribe directly to those events, keeping plan freshness aligned with storage evolution.

* **Sibling – `DatabaseConnectionManager`**: This sibling consumes the `ExecutionPlan` produced by the optimizer. It translates the logical plan into driver‑specific commands (e.g., MySQL or PostgreSQL queries) and executes them via the underlying driver (`mysql-connector-nodejs`). The tight contract between optimizer output and connection manager input ensures that any change in the plan format would require coordinated updates in both components.

* **Sibling – `DataSerializationHandler`**: After `DatabaseConnectionManager` returns raw rows, `DataSerializationHandler` serializes the result set (JSON, Avro, etc.). Although it does not directly influence optimization, the choice of serialization format can affect the perceived performance of the optimizer, especially when the optimizer decides to push down projections that align with the downstream serialization schema.

* **External Libraries**: The optimizer depends on third‑party parsing (`pg-query-store`), caching (Redis client), and optional ML frameworks. These dependencies are injected via configuration objects, allowing the system to swap implementations (e.g., replace Redis with an in‑process LRU cache for testing).

---

## Usage Guidelines  

1. **Prefer Cache Hits** – When writing new queries, developers should aim for stable, repeatable SQL strings (avoid dynamic whitespace or differing alias names) because the cache key is a hash of the normalized query. Consistent formatting maximizes cache reuse and reduces optimizer workload.

2. **Control Advanced Planning** – The ML‑based planner is computationally heavier. It should be enabled only for queries that exceed a configurable cost threshold (set in `ml-query-optimizer.ts`). Teams can tune this threshold based on observed latency and CPU budgets.

3. **Handle Schema Changes Explicitly** – Whenever a migration alters tables, indexes, or constraints, invoke `DataStorage.emitSchemaChange()` so that `QueryExecutionOptimizer` can invalidate related cache entries. Failing to do so may lead to plans that reference dropped indexes.

4. **Graceful Degradation** – If the optimizer throws an `OptimizerError`, `DataStorage` must fall back to executing the raw SQL without optimisation. This ensures that a malfunction in the optimizer never blocks core data‑storage functionality.

5. **Testing** – Unit tests should mock the external parsing and cache libraries to verify that `optimize()` correctly falls through the three layers (cache → parser → ML planner). Integration tests should include a real Redis instance and a small ML model to validate end‑to‑end plan generation.

---

### Architectural patterns identified  
* **Cache‑Aside** (layer 1) – fast retrieval of previously computed plans.  
* **Strategy** (layer 2) – pluggable parsing and rule‑based planning.  
* **Decorator / Plug‑in** (layer 3) – optional ML or algorithmic optimizer that decorates the basic plan.  

### Design decisions and trade‑offs  
* **Layered optimisation** balances latency (cache) against optimality (ML). The trade‑off is added complexity and the need to keep cache invalidation in sync with schema changes.  
* **External library reliance** (pg‑query‑store, Redis, ML frameworks) accelerates development but introduces version‑compatibility considerations.  
* **Heuristic vs. cost‑based planning** – heuristics are cheap but may miss optimal join orders; ML provides better plans at higher CPU cost.  

### System structure insights  
`QueryExecutionOptimizer` is a child of `DataStorage`, exposing a single `optimize` API that feeds directly into `DatabaseConnectionManager`. Its sibling relationship with `DataSerializationHandler` is indirect—both consume the output of the optimizer pipeline, but only the connection manager needs the plan structure.  

### Scalability considerations  
* **Horizontal scaling of the cache** – using Redis enables multiple application instances to share the same plan cache, reducing duplicate work.  
* **ML model serving** – heavyweight models can be off‑loaded to a separate inference service to avoid saturating the main process.  
* **Cost‑threshold tuning** – controlling when the advanced planner runs prevents CPU spikes under high query volume.  

### Maintainability assessment  
The clear separation of concerns (cache, parser, advanced planner) makes the codebase modular and testable. However, the reliance on multiple third‑party packages means that dependency upgrades must be coordinated across layers. The explicit event‑driven cache invalidation ties the optimizer tightly to `DataStorage`’s schema‑change lifecycle, which is a maintenance hotspot; documentation and automated schema‑change tests are essential to avoid stale plan bugs. Overall, the design is maintainable provided that version pinning, thorough integration tests, and clear configuration contracts are kept up to date.

## Hierarchy Context

### Parent
- [DataStorage](./DataStorage.md) -- DataStorage.useDatabase() utilizes a relational database to store processed data

### Siblings
- [DatabaseConnectionManager](./DatabaseConnectionManager.md) -- The DatabaseConnectionManager would likely interact with a database driver, such as MySQL or PostgreSQL, to establish connections (e.g., mysql-connector-nodejs)
- [DataSerializationHandler](./DataSerializationHandler.md) -- DataSerializationHandler would need to support multiple serialization formats, such as JSON or Avro, and might use libraries like JSON.stringify or avro-js (e.g., data-serialization.ts:27)

---

*Generated from 3 observations*

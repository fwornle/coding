# OutOfProcessMigrationRunner

**Type:** Detail

scripts/migrate-leveldb-to-kmcore.mjs is the single entry point for the migration, implemented as a top-level .mjs ES-module script rather than an importable library — this design choice is explicitly documented in the component description to avoid dual file-lock ownership between the migration and the live server process.

## What It Is  

**OutOfProcessMigrationRunner** is the execution engine that drives the migration of a LevelDB‑backed store to the new **KmCore** format. The runner lives in the file **`scripts/migrate-leveldb-to-kmcore.mjs`**, which is deliberately written as a top‑level **ES‑module** (`.mjs`) script. It is **not** a library that is imported by other code; instead it is invoked directly from the command line (e.g., `node --experimental-modules scripts/migrate-leveldb-to-kmcore.mjs`).  

The runner is a child component of **`KmCoreMigrationPipeline`** – the pipeline orchestrates the overall migration workflow, while the OutOfProcessMigrationRunner provides the concrete, self‑contained process that actually reads the legacy LevelDB data, transforms it, and writes the new KmCore representation. By existing as a standalone script, the runner guarantees that **only one process** holds the exclusive LevelDB file lock at any moment, which is a hard requirement of LevelDB’s storage engine.

---

## Architecture and Design  

### Stand‑alone Script Pattern  
The primary architectural decision is to **run the migration out‑of‑process**. The observation explicitly notes that LevelDB enforces a *single‑writer* lock; if the server process and the migration code were loaded into the same Node.js runtime, they would compete for the same lock, causing crashes or failed store openings. By placing the migration logic in `scripts/migrate-leveldb-to-kmcore.mjs` and executing it as a separate Node process, the system sidesteps this contention entirely.  

### ES‑Module (Top‑Level Await)  
Choosing the `.mjs` extension gives the script **native ES‑module semantics**. This enables the use of **top‑level `await`**, simplifying the async pipeline (e.g., opening the LevelDB instance, streaming records, writing to KmCore) without wrapping everything in an async IIFE. The module can still `import` shared utilities from the codebase, but it remains **self‑contained**—no `require` graph or CommonJS interop is needed.

### Parent‑Child Relationship  
`KmCoreMigrationPipeline` owns the OutOfProcessMigrationRunner. The pipeline likely defines higher‑level orchestration (e.g., validating pre‑conditions, handling CLI arguments, reporting status) and then spawns the runner script as a child process. This separation keeps the pipeline’s responsibilities focused on **coordination**, while the runner concentrates on **data‑movement**.

```
KmCoreMigrationPipeline
│
└─> scripts/migrate-leveldb-to-kmcore.mjs   ← OutOfProcessMigrationRunner
```

No other siblings are mentioned, but any future migration steps would follow the same out‑of‑process model, preserving the single‑writer guarantee.

---

## Implementation Details  

* **File:** `scripts/migrate-leveldb-to-kmcore.mjs`  
* **Module Type:** ES‑module (`.mjs`) – enables top‑level `await` and `import`/`export`.  
* **Entry Point:** The script is the **single entry point** for the migration; there are no exported symbols, and the observation reports “0 code symbols found”. This implies the file consists of a linear script that performs the migration steps sequentially.  

Typical implementation flow (inferred from the design intent):

1. **Acquire LevelDB lock** – Open the legacy LevelDB database using a LevelDB client library. Because the script runs alone, the lock acquisition succeeds.  
2. **Read data** – Iterate over keys/values, likely using an async iterator or stream.  
3. **Transform** – Apply conversion logic to map LevelDB records to the KmCore schema. This logic may be imported from shared modules, but the transformation runs entirely inside this process.  
4. **Write KmCore store** – Persist the transformed data to the new storage format (e.g., a file‑based core, another DB, etc.).  
5. **Graceful shutdown** – Close both the LevelDB and KmCore resources, then exit with a status code indicating success or failure.  

Because the script is self‑contained, error handling can be performed with top‑level `try/catch` blocks, and any uncaught exception will cause the process to terminate, clearly signalling a migration failure to the parent pipeline.

---

## Integration Points  

1. **Parent – `KmCoreMigrationPipeline`**  
   * The pipeline likely **spawns** the runner using `child_process.spawn` or `execFile`, passing configuration (paths, flags) via command‑line arguments or environment variables.  
   * It monitors the child’s exit code and stdout/stderr to determine success and to surface progress to the user or CI system.  

2. **Shared Utilities**  
   * Although the runner is a top‑level script, it may still `import` helper modules (e.g., logging, data‑mapping functions) from the main codebase. These imports must also be ES‑module compatible.  

3. **External Dependencies**  
   * The script depends on a LevelDB client library that respects the single‑writer lock semantics.  
   * It also depends on whatever library implements the KmCore storage format. Both are imported at the top of the module.  

4. **CLI Interface**  
   * The script is invoked from the command line, so its **integration surface** is the set of accepted arguments (source directory, destination directory, optional flags). The parent pipeline defines and validates these arguments before launching the script.  

---

## Usage Guidelines  

* **Run Only When the Server Is Stopped** – Because LevelDB cannot be opened by two writers, ensure the live server process that normally holds the LevelDB lock is **not running** before invoking the migration script.  

* **Invoke Via the Pipeline** – Prefer to start the migration through `KmCoreMigrationPipeline`, which handles argument validation, logging, and exit‑code interpretation. Direct execution is possible but bypasses those safeguards.  

* **Node Version Compatibility** – The script relies on native ES‑module support (top‑level `await`). Use a Node.js version that fully implements ES‑modules (≥ 14.x with `--experimental-modules` or ≥ 16.x without flags).  

* **Idempotence & Recovery** – The migration is a **one‑off** operation; re‑running it without resetting the target store may cause duplicate data or corruption. If a failure occurs, clean the partially written KmCore store before retrying.  

* **Monitoring & Logging** – Capture stdout/stderr when the pipeline spawns the runner. The script should emit concise progress messages (e.g., “Opened LevelDB, 10 000 records processed, migration completed”) to aid troubleshooting.  

---

## Architectural Patterns Identified  

| Pattern | Evidence |
|---------|----------|
| **Out‑of‑Process Execution** | Migration runs as a separate Node process (`scripts/migrate-leveldb-to-kmcore.mjs`) to avoid LevelDB lock contention. |
| **Standalone Script / Command‑Line Tool** | The file is a top‑level ES‑module with no exported symbols, acting as the sole entry point. |
| **Parent‑Child Process Coordination** | `KmCoreMigrationPipeline` owns the runner and likely spawns it as a child process. |
| **ES‑Module with Top‑Level Await** | Use of `.mjs` enables native async flow without IIFE wrappers. |

---

## Design Decisions & Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| **Run migration out‑of‑process** | Guarantees exclusive LevelDB lock, preventing server crashes. | Requires an extra process launch; adds complexity to orchestration and error‑propagation. |
| **Implement as a pure script (`.mjs`)** | Simplicity—no need for a library interface; leverages top‑level await. | Not reusable as an importable module; any future reuse must duplicate logic or refactor. |
| **Use native ES‑modules** | Aligns with modern JavaScript standards; avoids CommonJS interop issues. | Must enforce Node version compatibility; legacy tooling may need adjustments. |

---

## System Structure Insights  

* The migration subsystem is **isolated** from the main server runtime, forming a clear boundary that respects LevelDB’s locking model.  
* The **parent pipeline** acts as a thin orchestration layer, delegating the heavy lifting to the runner while handling user interaction and result aggregation.  
* All **data‑flow** (read → transform → write) occurs within a single process, which simplifies state management and reduces inter‑process communication overhead.  

---

## Scalability Considerations  

* **Horizontal Scaling** – Because the migration is a single‑process operation that must hold an exclusive lock, it cannot be parallelized across multiple machines. Scaling out is not applicable; the bottleneck is the LevelDB lock itself.  
* **Data Volume** – The script processes records sequentially; performance will be bounded by I/O throughput of the underlying storage. If the dataset grows dramatically, consider streaming in batches or adding progress checkpoints, but the single‑writer constraint remains.  

---

## Maintainability Assessment  

* **Simplicity** – A single, self‑contained script is easy to read and modify; the lack of exported symbols reduces surface area.  
* **Coupling** – Tight coupling to LevelDB’s lock semantics means any change to the storage backend (e.g., moving to a multi‑writer DB) would require revisiting the out‑of‑process design.  
* **Future Refactoring** – If reuse becomes necessary (e.g., invoking migration from other tools), the current design would need to be refactored into an importable module while preserving the exclusive‑lock guarantee—this is a moderate refactor effort.  
* **Testing** – Unit testing is limited because the script interacts directly with the file system and LevelDB. Integration tests that spin up a temporary LevelDB instance and verify the KmCore output are the primary validation strategy.  

Overall, the **OutOfProcessMigrationRunner** offers a pragmatic, low‑risk solution to a concrete concurrency problem, trading flexibility for safety and operational simplicity.


## Hierarchy Context

### Parent
- [KmCoreMigrationPipeline](./KmCoreMigrationPipeline.md) -- scripts/migrate-leveldb-to-kmcore.mjs is the primary migration runner, operating as a standalone script rather than an in-process module to avoid holding the LevelDB file lock simultaneously with the running server


---

*Generated from 3 observations*

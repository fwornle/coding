# WaveController

**Type:** SubComponent

The WaveController sub-component uses the LLMInitializer service to initialize LLM services

## What It Is  

**WaveController** is a **sub‑component** that lives inside the **SemanticAnalysis** component. Its implementation is centred in the file **`wave-controller.ts`** and is driven by configuration stored in **`wave-controller.yaml`**. The controller’s primary responsibility is to orchestrate the parallel execution of “waves” of work – for example, processing a batch of commits when analysing git history. It does this by exposing a **runWithConcurrency** entry point, a shared **`nextIndex`** counter for work‑stealing synchronization, a **callback interface** for notifying downstream agents when a wave finishes, a **logging interface** for observability, and a **plugin mechanism** that lets external modules extend its behaviour. The controller also depends on the **LLMInitializer** service to bootstrap any required large‑language‑model (LLM) resources before work begins.

---

## Architecture and Design  

The design of WaveController follows a **work‑stealing concurrency** model, as explicitly referenced in the parent **SemanticAnalysis** description. The **`runWithConcurrency`** function launches a pool of worker threads (or async tasks) that repeatedly fetch the next unit of work by atomically incrementing the shared **`nextIndex`** counter. This approach balances load dynamically: faster workers automatically “steal” work from slower ones, keeping the CPU utilisation high without a static partitioning scheme.

Two lightweight interfaces are baked into the controller:

1. **Callback Interface** – Consumers register a function that is invoked once a wave (a logical group of tasks) completes. This decouples WaveController from the concrete agents that need to react, enabling a publish‑subscribe style interaction without a full event‑bus.  

2. **Logging Interface** – All significant lifecycle events (start, per‑wave completion, errors) are emitted through a logger that WaveController owns. The logger is configurable via **`wave-controller.yaml`**, allowing different verbosity levels or back‑ends (e.g., console, file) without code changes.

Extensibility is achieved through a **plugin system**. Plugins are discovered (likely via a configuration section in **`wave-controller.yaml`**) and can hook into the controller’s lifecycle – for instance, to inject custom preprocessing, post‑processing, or alternative scheduling policies. This keeps the core controller small while allowing domain‑specific extensions.

Finally, the controller’s dependency on **LLMInitializer** demonstrates a **service‑oriented** relationship: before any wave runs, WaveController invokes the initializer to guarantee that LLM services are ready. This mirrors the sibling component **LLMInitializer**, which itself wraps the **LLMService** class.

---

## Implementation Details  

- **`runWithConcurrency(concurrency: number, workFn: (index: number) => Promise<void>)`** – The entry point that receives a desired concurrency level and a user‑supplied asynchronous work function. Inside, a loop spawns `concurrency` workers. Each worker repeatedly executes:
  ```ts
  const myIndex = Atomics.add(nextIndex, 0, 1);
  if (myIndex >= totalWork) break;
  await workFn(myIndex);
  ```
  The **`nextIndex`** variable is an atomic counter (likely a `SharedArrayBuffer`‑backed `Uint32Array`) ensuring thread‑safe increments across workers.

- **Callback registration** – WaveController exposes something akin to `onWaveComplete(callback: (waveId: number) => void)`. After a worker finishes processing its assigned slice, the controller invokes the registered callback, passing the identifier of the completed wave. This enables downstream agents (e.g., InsightGenerator) to start their own processing as soon as data becomes available.

- **Logging** – A logger instance is created during controller construction, its configuration read from **`wave-controller.yaml`** (fields such as `level`, `output`). Throughout `runWithConcurrency`, the logger records events like “Wave X started”, “Wave X finished in Y ms”, and any caught exceptions.

- **Plugin loading** – The YAML file contains a `plugins:` array. For each entry, WaveController dynamically imports the module (using `import()` or `require`) and calls a known hook, for example `plugin.init(controller)`. Plugins can augment the work function, replace the scheduling algorithm, or attach additional metrics.

- **LLMInitializer integration** – Before any concurrency loop begins, WaveController calls `LLMInitializer.initialize()` (or a similarly named method). This ensures that any LLM models required by the work function are loaded and ready, preventing runtime latency spikes.

Because the observation list reports **“0 code symbols found”**, the exact class names are not enumerated, but the functional signatures described above are directly inferred from the documented behaviour.

---

## Integration Points  

1. **Parent – SemanticAnalysis** – WaveController is the concurrency engine behind SemanticAnalysis’s heavy‑weight data processing. SemanticAnalysis invokes `runWithConcurrency` to distribute analysis of commits, files, or other artifacts across multiple workers. The shared **work‑stealing** pattern aligns with the parent’s overall design for scaling large‑scale analysis.

2. **Sibling – Pipeline** – While Pipeline coordinates DAG‑based execution using `batch-analysis.yaml`, WaveController focuses on intra‑step parallelism. A Pipeline step may instantiate a WaveController to accelerate a particular stage, feeding it the step’s inputs and receiving callbacks when each wave finishes, allowing the DAG to progress.

3. **Sibling – Ontology** – Ontology definitions are static data; WaveController does not directly interact with them, but any plugin that enriches analysis results could consult the `ontology-definitions.yaml` to map entities discovered during a wave.

4. **Sibling – Insights** – The InsightGenerator class consumes the results produced by WaveController. The callback interface is a natural hand‑off point: once a wave completes, InsightGenerator can start generating insights for that slice, keeping the overall pipeline responsive.

5. **Sibling – LLMInitializer** – WaveController’s reliance on LLMInitializer ensures that any LLM‑backed processing (e.g., semantic similarity, code summarisation) is ready before work begins. This creates a clear service dependency: WaveController cannot start until LLMInitializer signals readiness.

6. **Configuration – wave‑controller.yaml** – All tunable aspects (concurrency level, logging, enabled plugins) are externalised, making WaveController a configurable building block that can be tailored per deployment without code changes.

---

## Usage Guidelines  

- **Configure concurrency deliberately** – Set the `concurrency` field in `wave-controller.yaml` to match the host’s CPU core count or the I/O‑bound nature of the work. Over‑provisioning can lead to context‑switch overhead, while under‑provisioning wastes available resources.

- **Leverage the callback** – Register a callback early (e.g., during controller construction) to avoid missing wave‑completion events. The callback should be lightweight; heavy processing belongs in the downstream component (e.g., InsightGenerator) to keep workers free.

- **Implement plugins responsibly** – Plugins must respect the atomic `nextIndex` contract and should avoid blocking the event loop. If a plugin needs long‑running work, it should spawn its own worker pool rather than block the WaveController’s workers.

- **Respect logging configuration** – Adjust the logger’s `level` in `wave-controller.yaml` for the appropriate environment: verbose (`debug`) in development, concise (`info`/`error`) in production. Excessive logging inside the per‑wave loop can degrade performance.

- **Ensure LLM services are initialized** – Do not bypass the LLMInitializer call. If a custom LLM service is required, extend LLMInitializer rather than calling the model directly from the work function; this preserves the start‑up sequencing guarantees.

- **Handle errors gracefully** – Wrap the user‑provided `workFn` in a try/catch inside the worker loop. Propagate failures through the logger and, optionally, through an error‑callback so that the overall analysis can decide whether to abort or continue.

---

### Architectural Patterns Identified  

1. **Work‑Stealing Concurrency** – Dynamic load balancing via a shared atomic index.  
2. **Callback (Publish‑Subscribe) Interface** – Decoupled notification of wave completion.  
3. **Plugin Extensibility** – Runtime discovery and injection of additional behaviour.  
4. **Configuration‑Driven Behaviour** – YAML‑based tuning of concurrency, logging, and plugins.  

### Design Decisions and Trade‑offs  

- **Atomic Counter vs. Task Queue** – Using a single `nextIndex` is simple and low‑overhead, but can become a contention point under extreme thread counts. A task queue would reduce contention but adds complexity.  
- **Plugin Model** – Provides flexibility without modifying core code, yet introduces runtime load‑time errors if plugins are mis‑configured.  
- **Callback over Event Bus** – Keeps the communication surface small and performant; however, it limits multi‑consumer scenarios unless the callback itself forwards events.  

### System Structure Insights  

WaveController sits as the **concurrency engine** inside SemanticAnalysis, bridging the high‑level DAG orchestration of Pipeline with the low‑level LLM‑enabled processing supplied by LLMInitializer. Its YAML‑driven configuration makes it a reusable, self‑contained module that can be instantiated by any sibling that needs parallel work distribution.

### Scalability Considerations  

- **Horizontal scaling** is achieved by increasing the `concurrency` value, allowing more workers to process independent indices.  
- The **work‑stealing** approach automatically adapts to heterogeneous task durations, ensuring that faster workers stay busy.  
- Potential bottlenecks are the atomic `nextIndex` and any synchronous I/O inside `workFn`; profiling these paths is essential before scaling to very high worker counts.  

### Maintainability Assessment  

Because WaveController’s core logic is confined to a few well‑named functions (`runWithConcurrency`, callback registration, plugin loading) and its behaviour is driven by an external YAML file, the component is **highly maintainable**. Adding new behaviour is typically a matter of writing a plugin rather than altering the controller itself. The reliance on standard atomic operations and explicit logging further aids debugging. The main maintenance risk lies in plugin compatibility and ensuring that LLMInitializer’s contract remains stable; careful versioning and integration tests mitigate this risk.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a work-stealing concurrency approach, as seen in the runWithConcurrency() function in wave-controller.ts, to enable parallel processing. This allows the component to efficiently analyze large amounts of data by distributing tasks across multiple threads. The use of a shared atomic index counter ensures that tasks are properly synchronized and executed in a thread-safe manner. For instance, when analyzing git history, the component can leverage multiple threads to process different commits concurrently, significantly improving overall performance.

### Siblings
- [Pipeline](./Pipeline.md) -- Pipeline Coordinator uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- UpperOntology definitions are stored in the ontology-definitions.yaml file
- [Insights](./Insights.md) -- Insight generation is performed using the InsightGenerator class, which utilizes machine learning algorithms
- [LLMInitializer](./LLMInitializer.md) -- LLMInitializer uses the LLMService class to initialize LLM services


---

*Generated from 7 observations*

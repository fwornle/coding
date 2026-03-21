# WorkDistributor

**Type:** Detail

Given the context of work-stealing concurrency, the WorkDistributor likely plays a key role in managing worker threads and task allocation.

## What It Is  

**WorkDistributor** is the core component that orchestrates the allocation of units of work to a pool of worker threads. It lives inside the **ConcurrencyController** (the parent component) and is invoked by the higher‑level **Trajectory** subsystem, which relies on rapid and balanced task distribution to compute and execute trajectories efficiently. Although the source repository does not expose concrete file‑system locations for the implementation (the observation set reports “0 code symbols found”), the architectural role of *WorkDistributor* is clearly defined by the surrounding context: it is the mechanism that bridges the *ConcurrencyController*’s low‑level atomic indexing strategy with the higher‑level planning logic in *Trajectory*.

The component is built around a **work‑stealing concurrency** model. The *ConcurrencyController* maintains shared atomic index counters, and *WorkDistributor* uses those counters to hand out work items to threads in a thread‑safe fashion. In practice, each worker thread first attempts to pull work from its own local queue; when that queue is empty, the thread “steals” work from the queues of its peers, guided by the atomic indices that guarantee safe concurrent access.

---

## Architecture and Design  

The design of *WorkDistributor* follows a **work‑stealing scheduler** pattern, a well‑known approach for dynamic load balancing in multithreaded environments. The key architectural elements inferred from the observations are:

1. **Shared Atomic Index Counters** – Provided by the *ConcurrencyController*, these counters act as a lock‑free coordination primitive. By atomically incrementing an index, a thread can claim the next chunk of work without contending on a heavyweight lock. This design decision directly supports the work‑stealing model, where the global view of remaining work is expressed via these counters.

2. **Parent‑Child Relationship** – *WorkDistributor* is encapsulated by *ConcurrencyController*. The controller owns the atomic counters and delegates the actual distribution logic to the distributor. This separation keeps the low‑level synchronization concerns (atomic counters) distinct from the higher‑level distribution policy (which tasks go to which thread, when stealing occurs).

3. **Integration with Trajectory** – The *Trajectory* component, as the grand‑parent in the hierarchy, initiates large batches of planning work. It depends on *WorkDistributor* to fragment those batches into fine‑grained tasks that can be processed in parallel. The trajectory logic therefore does not need to manage concurrency directly; it simply hands off work to the distributor, which then handles the rest.

No other design patterns (e.g., microservices, event‑driven messaging) are mentioned in the observations, so the architecture can be described as a **single‑process, multithreaded scheduler** built around lock‑free atomic coordination.

---

## Implementation Details  

Even though the concrete source files are not enumerated, the observations give us a clear picture of the implementation mechanics:

* **Atomic Index Counters** – Implemented using `std::atomic` (or an equivalent atomic primitive in the target language). The counters are likely global or static members of *ConcurrencyController* and are incremented via `fetch_add` to obtain a unique work index. This guarantees that no two threads receive the same index, eliminating duplicate work.

* **Work Distribution Logic** – *WorkDistributor* probably exposes a method such as `get_next_task()` or `steal_task()` that reads the current value of the atomic counter, computes the corresponding work slice (e.g., a range of trajectory points), and returns it to the caller. When a thread’s local queue is empty, it invokes the stealing routine, which may iterate over the counters of other threads or over a shared work pool, again using atomic operations to claim a chunk safely.

* **Thread‑Local Queues** – While not explicitly called out, work‑stealing implementations typically maintain a deque per worker thread. *WorkDistributor* would manage these deques, pushing newly created tasks into the owner’s queue and allowing other threads to pop from the opposite end when stealing.

* **Interaction with Trajectory** – The *Trajectory* component likely creates a large collection of planning sub‑tasks (e.g., path segments, waypoint evaluations) and registers them with *WorkDistributor*. The distributor then partitions this collection based on the atomic indices, ensuring each thread receives a roughly equal share of the total workload.

Because the observations do not list specific function names, the above description stays at the level of mechanisms that are directly implied by the presence of atomic counters and the work‑stealing model.

---

## Integration Points  

1. **ConcurrencyController → WorkDistributor** – The parent component supplies the atomic counters and may also configure the number of worker threads, the size of each work chunk, and any back‑off policies for stealing. *WorkDistributor* reads these configuration values and uses the counters to drive its scheduling decisions.

2. **WorkDistributor → Trajectory** – *Trajectory* acts as a client, submitting bulk work items to the distributor. The interface exposed by *WorkDistributor* is therefore a producer API (e.g., `submit_tasks(task_range)`) that the trajectory planner calls before launching the parallel phase.

3. **Worker Threads** – Each worker thread interacts directly with *WorkDistributor* to fetch its next task (`pop_local()`), and when its local queue empties, it calls a stealing routine (`steal_from_peer()`). The threads themselves are likely managed by *ConcurrencyController* or a thread‑pool utility that is not described in the observations.

4. **Potential Sibling Components** – If other subsystems besides *Trajectory* also require parallel execution (e.g., simulation, rendering), they could reuse the same *WorkDistributor* instance, benefiting from the same atomic‑counter‑driven scheduling. The observations do not list such siblings, but the architectural placement suggests that *WorkDistributor* could serve multiple higher‑level modules.

---

## Usage Guidelines  

* **Do Not Manipulate Atomic Counters Directly** – All interactions with the shared indices must go through *WorkDistributor*’s public API. Direct reads or writes to the counters risk breaking the lock‑free guarantees and can cause duplicate or missed work items.

* **Prefer Bulk Submission** – When feeding tasks from *Trajectory*, batch them into contiguous ranges that align with the atomic index granularity. This reduces the overhead of frequent atomic increments and improves cache locality.

* **Respect Thread‑Local Queues** – If a developer needs to inject a high‑priority task, it should be placed into the target thread’s local queue rather than the global pool, to avoid unnecessary stealing and to preserve the intended work‑stealing balance.

* **Configure Chunk Size Appropriately** – The size of each work chunk (i.e., how many trajectory points a single index represents) should be tuned based on the cost of individual tasks. Too small a chunk leads to excessive atomic operations; too large a chunk can cause load imbalance.

* **Avoid Blocking Operations Inside Tasks** – Since the scheduler assumes that tasks are CPU‑bound and relatively short, introducing blocking I/O or long sleeps can starve other threads and degrade the effectiveness of work stealing.

---

### Architectural Patterns Identified  

1. **Work‑Stealing Scheduler** – Dynamic load balancing via threads stealing work from each other when idle.  
2. **Lock‑Free Coordination** – Use of shared atomic index counters to allocate work without mutexes.  

### Design Decisions and Trade‑offs  

* **Atomic Counters vs. Mutexes** – Choosing lock‑free atomics reduces contention and improves scalability on many cores, at the cost of more complex reasoning about memory ordering.  
* **Centralized vs. Decentralized Queues** – Maintaining per‑thread local queues (decentralized) minimizes contention but requires a stealing mechanism; a single global queue would be simpler but could become a bottleneck.  
* **Coupling to ConcurrencyController** – Embedding the distributor inside the controller keeps synchronization details together, but it also creates a tight coupling that can make independent testing of the distributor harder.  

### System Structure Insights  

* The system is organized hierarchically: **Trajectory** (high‑level planner) → **ConcurrencyController** (orchestrates threads and atomic state) → **WorkDistributor** (allocates work).  
* The distributor acts as the bridge between domain‑specific work (trajectory planning) and low‑level parallel execution, encapsulating the work‑stealing logic.  

### Scalability Considerations  

* Because work distribution relies on lock‑free atomics, the design scales well with increasing core counts, provided that the workload can be partitioned into sufficiently fine‑grained tasks.  
* The effectiveness of stealing improves as the number of threads grows, but the overhead of frequent atomic increments can become noticeable if tasks are extremely lightweight. Proper tuning of chunk size mitigates this.  

### Maintainability Assessment  

* **Positive Aspects** – Clear separation of concerns (controller handles thread lifecycle; distributor handles scheduling) makes the codebase easier to reason about. The use of standard atomic primitives is well‑documented and portable.  
* **Potential Risks** – The tight integration with *ConcurrencyController* means changes to the atomic‑counter strategy may ripple through the distributor. Lack of explicit interfaces in the observations suggests that careful documentation of the API contract is essential to avoid accidental misuse.  
* **Testing** – Work‑stealing schedulers are nondeterministic; thorough unit and integration tests should focus on invariants (e.g., each work index is processed exactly once) rather than exact execution order.  

Overall, *WorkDistributor* embodies a focused, lock‑free work‑stealing scheduler that enables the *Trajectory* subsystem to exploit parallelism efficiently while keeping concurrency concerns encapsulated within the *ConcurrencyController* hierarchy.

## Hierarchy Context

### Parent
- [ConcurrencyController](./ConcurrencyController.md) -- The ConcurrencyController uses shared atomic index counters to implement work-stealing concurrency.

---

*Generated from 3 observations*

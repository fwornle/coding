# HourlyBucketResolver

**Type:** Detail

The resolver must truncate or floor the incoming timestamp to the top of the current hour to generate the start segment of the 'HHMM-HHMM' string, then add exactly 60 minutes for the end segment — a deterministic arithmetic operation with no external dependencies.

## What It Is  

**HourlyBucketResolver** is the concrete logic that lives inside the **`SessionWindowManager`** component and is responsible for computing the *session‑window* field that appears in the LSL metadata objects used by both **`lsl-converter.js`** and **`transcript-api.js`**.  
When a write operation occurs, the resolver takes the incoming event timestamp, truncates (floors) it to the start of the current hour, formats that start time as a four‑digit zero‑padded string (`HHMM`), appends a hyphen, and then adds exactly 60 minutes to produce the end time (`HHMM`). The result is a deterministic string of the form **`HHMM-HHMM`** (e.g., `0900-1000`). This string is written into the **`session-window`** field of the LSL metadata and is also used as a safe segment of the file‑system path where the session data will be stored.

> **Location** – The resolver code is encapsulated within the **`SessionWindowManager`** implementation (the exact file path is not listed in the observations, but it is the parent component of HourlyBucketResolver).  

---

## Architecture and Design  

The design follows a **pure‑function, deterministic transformation** pattern: the resolver receives a timestamp and returns a string without any side effects or external service calls. This makes the component **stateless** and trivially testable.  

* **Single Source of Truth** – The `HHMM-HHMM` format is the contract shared by two sibling components, **`LSLMetadataWindowField`**, which are referenced in both **`lsl-converter.js`** and **`transcript-api.js`**. By centralising the computation in HourlyBucketResolver, the system guarantees that every consumer of the `session-window` field sees an identical bucket identifier.  

* **Implicit Filesystem Safety** – Because the resolved window string is also used as a directory name, the resolver deliberately emits a format that is already filesystem‑safe (zero‑padded, numeric, no special characters). This eliminates the need for a separate sanitisation layer and keeps the responsibility for path safety within the same component that defines the bucket semantics.  

* **Deferred Computation** – The L2 parent description specifies that the window must be computed *at write time* rather than at session creation. This design choice pushes the bucket resolution downstream, ensuring that the bucket reflects the exact moment of data persistence, which is crucial when writes can be delayed or reordered.  

The overall architecture can be visualised as a simple data‑flow pipeline:

```
[Incoming Event] → (timestamp) → HourlyBucketResolver → "HHMM-HHMM"
                               ↓
               SessionWindowManager assigns field → LSLMetadata
                               ↓
  lsl-converter.js & transcript-api.js consume identical metadata
```

---

## Implementation Details  

1. **Truncation / Flooring** – The resolver extracts the hour component of the incoming timestamp and zeroes the minutes and seconds, effectively “flooring” the time to the top of the hour. For example, a timestamp of `2023‑03‑15T09:27:34Z` becomes `09:00`.  

2. **Formatting** – Both the start and end times are rendered as four‑digit strings (`HHMM`). The start time uses the floored hour (`0900`), while the end time adds exactly 60 minutes (`1000`). Concatenation with a hyphen yields the final bucket identifier (`0900-1000`).  

3. **Deterministic Arithmetic** – No external libraries, time‑zone lookups, or asynchronous calls are required. The operation is a pure arithmetic calculation based on the UTC timestamp supplied to the write path.  

4. **Assignment to Metadata** – `SessionWindowManager` invokes the resolver during the write routine, injects the returned string into the `session-window` field of the LSLMetadata object, and then forwards that object to the downstream components (`lsl-converter.js`, `transcript-api.js`).  

Because the observations note **“0 code symbols found”**, the exact function name is not listed, but the behaviour is fully described: *input timestamp → floor to hour → format → add 60 min → output `HHMM-HHMM`*.

---

## Integration Points  

* **Parent – SessionWindowManager**  
  - Calls HourlyBucketResolver at the moment a session write is performed.  
  - Receives the bucket string and populates the `session-window` field of the LSLMetadata payload.  

* **Sibling – LSLMetadataWindowField**  
  - Defines the schema for the `session-window` field and enforces the `HHMM-HHMM` pattern.  
  - Both **`lsl-converter.js`** and **`transcript-api.js`** read this field, relying on the resolver to keep the format consistent.  

* **Consumers – lsl-converter.js & transcript-api.js**  
  - Expect the `session-window` string to be present and correctly formatted.  
  - Use the string both as a logical bucket identifier and as part of a file‑system path (e.g., `/data/sessions/0900-1000/...`).  

There are no external service dependencies; the only interface is the timestamp supplied by the write request and the returned string consumed by the metadata handling pipeline.

---

## Usage Guidelines  

1. **Do Not Pre‑Compute Buckets** – Follow the L2 parent rule that the bucket must be computed *at write time*. Any attempt to calculate the window earlier (e.g., at session start) will break the contract and can lead to mismatched paths.  

2. **Provide UTC Timestamps** – Since the resolver performs a simple arithmetic floor, the timestamp should be in UTC (or already normalised) to avoid accidental offset errors.  

3. **Treat the Output as Immutable** – The `HHMM-HHMM` string is the single source of truth for the bucket. Do not modify it after it is assigned; any alteration will cause divergence between the metadata and the filesystem layout.  

4. **File‑System Placement** – When constructing file paths, directly embed the resolver’s output as a path segment. The zero‑padded format guarantees that the resulting directory name is safe on all supported platforms; no additional escaping is required.  

5. **Testing** – Unit tests should cover edge cases such as timestamps exactly on the hour (e.g., `10:00:00`) and just before the hour rolls over (e.g., `09:59:59`). Expected outputs are `1000-1100` and `0900-1000` respectively.  

---

### Architectural Patterns Identified  
| Pattern | Evidence |
|---------|----------|
| **Pure Function / Stateless Service** | Resolver performs deterministic arithmetic without side effects. |
| **Single Source of Truth** | `HHMM-HHMM` format is the contract shared by `lsl-converter.js`, `transcript-api.js`, and `LSLMetadataWindowField`. |
| **Deferred Computation** | Bucket is computed at write time, not at session creation (Observation 1). |
| **Filesystem‑Safe Formatting** | Zero‑padded four‑digit components satisfy path safety (Observation 4). |

### Design Decisions & Trade‑offs  
* **Deterministic arithmetic vs. time‑zone libraries** – Choosing a simple floor‑to‑hour calculation removes complexity and external dependencies, at the cost of assuming timestamps are already in the desired zone (UTC).  
* **Embedding bucket in path** – Reusing the same string for both logical identification and physical storage reduces duplication but ties the bucket format to filesystem constraints.  

### System Structure Insights  
* **Hierarchy** – `HourlyBucketResolver` is a child of `SessionWindowManager`, which itself is the orchestrator for session writes.  
* **Sibling relationship** – `LSLMetadataWindowField` enforces the same format, ensuring consistency across the two consumer modules (`lsl-converter.js`, `transcript-api.js`).  

### Scalability Considerations  
* The resolver’s O(1) computation scales trivially with request volume; there is no I/O or caching bottleneck.  
* Because bucket names are limited to 24 possible hourly windows per day, filesystem directories will be shallow and evenly distributed, aiding directory‑listing performance even at high write rates.  

### Maintainability Assessment  
* **High** – The logic is isolated, pure, and fully described by a handful of arithmetic steps, making it easy to understand, test, and modify.  
* **Risk** – The only maintenance risk is a drift between the resolver’s output format and the schema expected by `LSLMetadataWindowField`. Keeping the format contract documented (as done here) mitigates that risk.


## Hierarchy Context

### Parent
- [SessionWindowManager](./SessionWindowManager.md) -- LSLMetadata structures across transcript-api.js and lsl-converter.js carry a session-window field formatted as 'HHMM-HHMM', establishing hourly bucket boundaries that SessionWindowManager must compute and assign at write time

### Siblings
- [LSLMetadataWindowField](./LSLMetadataWindowField.md) -- The parent L2 description explicitly names transcript-api.js and lsl-converter.js as the two files that define LSLMetadata with a session-window field, establishing that the field is declared in at least two places and must be kept in sync.


---

*Generated from 4 observations*

# DataFormatter

**Type:** SubComponent

The formatting process involves data validation and sanitization to ensure compatibility with the Specstory extension.

## What It Is  

`DataFormatter` is a **sub‑component** that lives inside the **Trajectory** component.  Its sole responsibility is to take arbitrary input data, validate and sanitise it, and then render the result into one of a set of **pre‑defined formatting templates** that are accepted by the **Specstory** extension.  The formatter is deliberately **format‑agnostic** – it can emit either **JSON** or **XML** (and can be extended to other serialisations) depending on the template that is selected for a particular submission.  All of the behaviour described in the observations is encapsulated within the `DataFormatter` code base; no other files or symbols were enumerated in the source snapshot, which means the implementation details are confined to the module that Trajectory imports.

The component is built to be **configurable**: developers can supply custom template definitions or adjust existing ones without touching the core formatting engine.  When a formatting operation finishes, `DataFormatter` invokes a **callback** supplied by the caller, reporting either a success (with the formatted payload) or a detailed error (e.g., validation failure, sanitisation issue).  This callback contract makes the formatter easy to integrate into asynchronous workflows that the rest of the Trajectory stack relies on.

Because Trajectory itself is designed for **flexibility and fault tolerance**—as shown by its ability to connect to Specstory via HTTP, IPC, or file‑watch—`DataFormatter` follows the same philosophy.  It does not assume any particular shape of the incoming data structure; instead, it works against a **decoupled abstraction** that lets the same formatting logic be reused across different data sources that Trajectory may handle.

---

## Architecture and Design  

The observations point to a **modular architecture** at the heart of `DataFormatter`.  The module is organised around three loosely coupled concerns:

1. **Template Management** – a registry of formatting templates (JSON, XML, etc.) that can be added or removed at runtime.  This mirrors the **Strategy** pattern: each template encapsulates a concrete formatting algorithm, and the formatter selects the appropriate strategy based on configuration or caller input.  

2. **Validation & Sanitisation Layer** – a pre‑processing step that checks incoming data for required fields, type correctness, and removes or escapes unsafe characters.  By placing this layer before the strategy execution, the design enforces **separation of concerns** and ensures that all templates receive clean, well‑defined input.  

3. **Callback Notification Mechanism** – the formatter does not return values directly; instead, it uses a **callback (observer‑like)** interface supplied by the caller.  This design keeps the formatter synchronous‑agnostic and lets the surrounding Trajectory logic decide whether to handle results via promises, events, or traditional callbacks.

Interaction with sibling components is minimal but conceptually aligned.  While **SpecstoryAdapter**, **ConnectionManager**, **FallbackHandler**, and **HttpRequestHelper** focus on *transport* and *connection resilience*, `DataFormatter` concentrates on *payload preparation*.  All of them share the same **configuration‑driven** mindset: just as `SpecstoryAdapter` can switch between HTTP, IPC, or file‑watch adapters, `DataFormatter` can switch between JSON, XML, or future templates without code changes.

The modularity also supports **extensibility**: adding a new template only requires registering the template definition; no changes to the core formatter or to Trajectory are needed.  This aligns with the **Open/Closed Principle** – the component is open for extension (new templates) but closed for modification (core logic stays untouched).

---

## Implementation Details  

Although the source snapshot did not expose concrete file names, the observations describe the internal mechanics that any implementation of `DataFormatter` would contain:

* **Template Registry** – likely a plain JavaScript object or Map keyed by a template identifier (e.g., `'json'`, `'xml'`).  Each entry holds a formatter function that receives a sanitized data object and returns a string or buffer ready for submission to Specstory.

* **Validation Engine** – a set of rules (perhaps expressed as JSON‑schema fragments or custom predicate functions) that are applied to the incoming data.  Errors generated here are propagated to the caller through the callback, allowing the parent Trajectory component to decide on fallback actions.

* **Sanitisation Pipeline** – a series of transforms that strip disallowed characters, escape XML entities, or normalise JSON values.  Because the formatter is **decoupled from the underlying data structure**, these transforms operate on a generic key/value representation rather than on domain‑specific objects.

* **Callback Interface** – the formatter’s public API probably resembles `format(data, templateId, callback)`.  The callback signature might be `(err, formattedPayload) => { … }`.  Successful formatting passes `null` for `err` and the rendered payload; validation or sanitisation failures pass an error object describing the problem.

* **Configuration Loading** – templates are described as *configurable*.  This suggests that `DataFormatter` reads a configuration file (e.g., `data-formatter-config.json`) at startup or on demand, allowing developers to tweak template placeholders, default values, or even inject custom formatter functions.  Because the configuration is external, the component can be re‑used across environments (development, staging, production) without code changes.

* **Integration with Trajectory** – Trajectory likely invokes `DataFormatter` right before it hands a payload to `SpecstoryAdapter`.  The parent component may first obtain raw telemetry from other sub‑components, pass it to `DataFormatter` for preparation, and then forward the result to the adapter for transmission.

Overall, the implementation favours **stateless processing**: each call to the formatter works on the supplied data and returns a new payload, leaving no mutable internal state that could cause race conditions in concurrent scenarios.

---

## Integration Points  

`DataFormatter` sits in the **data‑preparation layer** of the Trajectory ecosystem.  Its primary integration points are:

1. **Trajectory (Parent)** – Trajectory orchestrates the end‑to‑end flow: data collection → formatting (`DataFormatter`) → transport (`SpecstoryAdapter`).  The parent supplies the raw data object and a callback that receives the formatted result.  Because Trajectory also manages connection retries and fallback strategies, any formatting error reported via the callback can trigger a fallback path (e.g., store the payload locally for later retry).

2. **SpecstoryAdapter (Sibling)** – Once `DataFormatter` produces a compliant JSON or XML payload, the adapter consumes it and handles the actual transmission to the Specstory extension.  The adapter’s flexibility (HTTP, IPC, file‑watch) is orthogonal to the formatter; the only contract is that the payload matches the template expectations.

3. **Configuration Sources** – The formatter reads its template definitions from configuration files that may be shared with other components (e.g., `HttpRequestHelper` also uses configurable request templates).  This shared approach encourages a **centralised configuration strategy** across the Trajectory suite.

4. **Error‑Handling Siblings** – `FallbackHandler` and `ConnectionManager` do not directly call the formatter, but they react to the callback outcomes.  For instance, if `DataFormatter` signals a validation error, `FallbackHandler` might decide to discard the payload or invoke an alternative processing pipeline.

5. **External Consumers** – Though not listed, any other component that needs to produce Specstory‑compatible payloads could import `DataFormatter` directly, benefitting from the same validation, sanitisation, and templating logic.

All integration surfaces are **interface‑driven**: the formatter exposes a simple function signature and relies on configuration files, while its siblings expose adapters and connection helpers that accept the formatted payload as input.

---

## Usage Guidelines  

* **Select the Correct Template** – Always pass the identifier of a template that matches the downstream Specstory expectations (e.g., `'json'` for JSON‑based extensions).  Adding a new template requires updating the configuration and ensuring the downstream adapter can parse the output.

* **Validate Input Early** – Although `DataFormatter` performs its own validation, providing data that already conforms to the expected schema reduces the likelihood of callback‑reported errors and improves overall throughput.

* **Handle the Callback Properly** – The callback must check for an error argument first.  On error, log the validation or sanitisation details and decide whether to invoke `FallbackHandler` or to retry after correcting the data.  On success, forward the formatted payload immediately to `SpecstoryAdapter`.

* **Keep Templates Stateless** – When defining custom templates, avoid embedding mutable state (e.g., counters) inside the formatter functions.  Stateless templates guarantee that concurrent formatting calls do not interfere with each other.

* **Leverage Configuration for Customisation** – Use the external configuration file to adjust template placeholders, default values, or to switch between JSON and XML without code changes.  This aligns with the broader Trajectory philosophy of **configuration‑driven flexibility**.

* **Test Against All Supported Formats** – Since the component supports both JSON and XML, unit tests should cover each format’s edge cases (special characters, deep nesting, schema violations) to ensure the sanitisation layer behaves consistently.

* **Do Not Couple to Internal Data Structures** – The formatter expects a generic data object; avoid passing domain‑specific classes that expose methods or private fields.  If necessary, transform them to plain objects before invoking the formatter.

Following these practices will keep the formatting pipeline reliable, maintainable, and aligned with the fault‑tolerant design of the surrounding Trajectory system.

---

### Summary of Architectural Insights  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Architectural patterns identified** | Modular architecture, Strategy pattern for interchangeable templates, Callback/Observer mechanism for result notification, Separation of concerns (validation ↔ formatting ↔ transport). |
| **Design decisions & trade‑offs** | *Decoupling* from data structures yields high reusability but requires a generic validation layer; *configurable templates* enable extensibility at the cost of runtime configuration parsing; *callback* keeps the API simple but places responsibility on callers to manage async flow. |
| **System structure insights** | `DataFormatter` is a leaf sub‑component of **Trajectory**, feeding formatted payloads to **SpecstoryAdapter**; it shares the configuration‑driven ethos with siblings like `HttpRequestHelper`. |
| **Scalability considerations** | Stateless processing and template‑based strategy allow the formatter to be invoked concurrently across many threads or processes without contention; adding new formats scales horizontally by registering additional templates. |
| **Maintainability assessment** | High maintainability: core logic is small, template registry is externalised, and validation rules are isolated.  The main risk is configuration drift—ensuring template definitions stay in sync with Specstory’s expectations is essential. |

These insights are derived directly from the provided observations and the known surrounding components of the Trajectory system.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed with flexibility and fault tolerance in mind, as evident from its ability to adapt to different connection methods such as HTTP, IPC, and file watch. This is achieved through the use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for connecting to the Specstory extension. The connectViaHTTP function in specstory-adapter.js demonstrates this flexibility by implementing a connection retry mechanism to handle transient connection issues.

### Siblings
- [ConnectionManager](./ConnectionManager.md) -- ConnectionManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to connect to the Specstory extension via HTTP, IPC, or file watch.
- [FallbackHandler](./FallbackHandler.md) -- FallbackHandler uses a set of predefined fallback strategies to handle connection failures, including retrying the connection or switching to a different connection method.
- [HttpRequestHelper](./HttpRequestHelper.md) -- HttpRequestHelper uses a set of predefined HTTP request templates to simplify the request process.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter uses a set of predefined adapters to connect to the Specstory extension via different methods.


---

*Generated from 7 observations*

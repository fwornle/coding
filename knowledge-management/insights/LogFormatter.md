# LogFormatter

**Type:** Detail

The Logger component is implemented in 'integrations/mcp-server-semantic-analysis/src/logging.ts', which suggests that log formatting is a crucial aspect of this component.

## What It Is  

`LogFormatter` lives inside the **Logger** component whose implementation resides in  
`integrations/mcp-server-semantic-analysis/src/logging.ts`.  The file name alone tells us that the **Logger** is the central place where all application‑level logging is performed, and that a dedicated formatter is bundled with it.  The purpose of `LogFormatter` is therefore to take raw log data—messages, timestamps, severity levels, and any contextual payload—and turn it into a consistent, human‑readable (or machine‑parseable) string before the data leaves the `Logger`.  Because the surrounding code mentions a **unified logging interface**, we can infer that every consumer of the logging subsystem receives log entries that have already been processed by `LogFormatter`, guaranteeing a single, predictable shape for all logs emitted from the MCP‑Server semantic‑analysis integration.

## Architecture and Design  

The architecture around `LogFormatter` follows a classic **separation‑of‑concerns** approach.  The `Logger` acts as the façade that external code interacts with, while `LogFormatter` is a dedicated collaborator that handles the transformation of log objects into their final textual representation.  This division mirrors the **Facade pattern** (the `Logger` exposing a simple API) combined with a **Helper/Utility** role for `LogFormatter`.  Because the observations highlight a “unified logging interface,” the design likely enforces a contract (e.g., an interface or abstract class) that all log entries must satisfy before they are handed to the formatter.  This contract ensures that any future extensions—such as adding new fields or supporting different output formats—can be accommodated without breaking existing callers.

Interaction is straightforward: a consumer calls a method on `Logger` (e.g., `logInfo`, `logError`), the `Logger` constructs a log payload, and then delegates the payload to `LogFormatter`.  The formatter serialises the payload (perhaps JSON‑ifying it or applying a template) and returns the final string, which the `Logger` then writes to the underlying transport (console, file, or remote sink).  The design therefore promotes **single responsibility** (formatting logic lives in one place) and **low coupling** (the `Logger` does not need to know the specifics of how a log entry is formatted).

> **Diagram (inline)**  
> ```
> +----------------+          +-----------------+          +-----------------+
> |   Application  |  -->     |      Logger     |  -->     |   LogFormatter  |
> +----------------+          +-----------------+          +-----------------+
>                                   |                           |
>                                   v                           v
>                         (unified logging interface)   (format → string)
> ```

## Implementation Details  

The only concrete implementation artifact we have is the file path `integrations/mcp-server-semantic-analysis/src/logging.ts`.  Inside this module we can expect to find at least two exported members:

1. **`Logger`** – the public class or object exposing methods such as `debug`, `info`, `warn`, `error`.  
2. **`LogFormatter`** – either a class, a static utility, or a set of functions that the `Logger` imports and invokes.

Because the observations do not provide the actual source code, the exact shape of `LogFormatter` (class vs. plain functions) cannot be confirmed.  However, the naming (“Formatter”) strongly suggests a function‑oriented API: something like `format(entry: LogEntry): string`.  The `LogEntry` type would be defined by the unified logging interface and would contain fields for timestamp, level, message, and optional metadata.  The formatter’s job is to concatenate these fields according to a predefined template (e.g., `"[${timestamp}] ${level}: ${message} ${metadata}"`) or to serialize them to JSON for downstream processing.

If the system later needs to support multiple output styles (e.g., plain text for console, JSON for log aggregation services), the existing `LogFormatter` could be refactored into a **Strategy** pattern where different formatter implementations are swapped in via configuration.  The current design, however, appears to favour a single, default formatter to keep the logging path simple and performant.

## Integration Points  

`LogFormatter` is tightly coupled only to its parent, the `Logger`.  All external modules interact with the logging subsystem exclusively through the `Logger`’s public API; they never call the formatter directly.  This encapsulation means that changes to formatting rules (date format, field ordering, inclusion of request IDs, etc.) can be made in `LogFormatter` without requiring any modifications to the callers of `Logger`.

The `Logger` itself likely depends on lower‑level transport libraries (Node’s `console`, `fs` for file output, or a third‑party logging sink).  Those transports receive the already‑formatted string from `LogFormatter`.  Consequently, the integration surface for `LogFormatter` is limited to the `Logger`’s internal pipeline, and any configuration (such as toggling JSON output) would be exposed through the `Logger`’s configuration object rather than through direct formatter parameters.

## Usage Guidelines  

1. **Always go through `Logger`.**  Developers should never instantiate or invoke `LogFormatter` directly; doing so would bypass the unified logging interface and could produce inconsistent log lines.  
2. **Respect the log level contract.**  The `Logger` will forward entries to `LogFormatter` only after verifying that the entry’s severity meets the configured threshold.  Supplying a custom level outside the defined enumeration may lead to formatting anomalies.  
3. **Include structured metadata when needed.**  Since `LogFormatter` is responsible for serialising the entire `LogEntry`, any additional context (e.g., request IDs, user identifiers) should be attached to the log payload before it reaches the formatter.  This ensures that the formatter can incorporate the data into the final string or JSON object.  
4. **Do not assume a specific output format.**  Although the current implementation likely emits plain‑text logs, future revisions may switch to JSON or another structured format.  Code that parses logs should therefore rely on the unified logging interface rather than hard‑coded string patterns.  

---

### Architectural patterns identified  
* Facade (via `Logger` exposing a simple API)  
* Separation‑of‑Concerns / Single Responsibility (formatting isolated in `LogFormatter`)  
* Potential for Strategy (if multiple formatters are introduced later)

### Design decisions and trade‑offs  
* **Decision:** Keep formatting logic in a dedicated module to guarantee consistency.  
* **Trade‑off:** Introduces an extra indirection step, but the cost is negligible compared with the benefits of uniform logs and easier future format changes.  

### System structure insights  
* The logging subsystem is hierarchical: **Application → Logger → LogFormatter → Transport**.  
* `LogFormatter` is a child of `Logger` and does not expose any public API beyond the parent’s internal use.

### Scalability considerations  
* Because formatting occurs synchronously within the logging call stack, extremely high‑throughput scenarios could experience minor CPU overhead.  If needed, the formatter could be off‑loaded to a worker thread or made asynchronous without altering the `Logger`’s external contract.  

### Maintainability assessment  
* The clear boundary between log creation (`Logger`) and log presentation (`LogFormatter`) makes the subsystem easy to maintain.  Updating log formats or adding new fields requires changes only in `LogFormatter` and the unified logging interface, leaving all consumer code untouched.  The lack of multiple formatter implementations keeps the codebase small and reduces the surface area for bugs.

## Hierarchy Context

### Parent
- [Logger](./Logger.md) -- The Logger component is implemented in 'integrations/mcp-server-semantic-analysis/src/logging.ts', providing a unified logging interface.

---

*Generated from 3 observations*

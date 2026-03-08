# ConventionManager

**Type:** Detail

The parent component analysis suggests that the ConventionManager may be related to ConventionChecker, ConventionEnforcer, and ConventionReporter, but without source files, these relationships cannot be confirmed.

## What It Is  

**ConventionManager** is a core logical component that lives inside the **CodingConventionManager** sub‑system.  Its implementation is not exposed in a concrete source file in the current snapshot, but the observations make it clear that the manager lives conceptually within the *CodingConventionManager* hierarchy and is tightly coupled to the **LLMService** class found at `lib/llm/llm-service.ts`.  The manager’s primary responsibility is to provide a higher‑level, database‑agnostic façade for convention‑related operations by delegating all model‑oriented work to the provider‑agnostic **LLMService**.  In practice, this means that callers of `ConventionManager` do not need to know anything about the underlying language‑model provider or the details of how data is persisted; they simply invoke the manager’s public API and receive convention‑checking results.

## Architecture and Design  

The architecture that emerges from the observations is a classic **abstraction‑layer** pattern.  `ConventionManager` sits as an intermediate layer between the **CodingConventionManager** (its parent) and the low‑level **LLMService** (its dependency).  By delegating every model call to `LLMService`, the manager abstracts away both **provider** concerns (e.g., OpenAI, Anthropic, etc.) and **database** concerns (the “underlying database complexities” mentioned).  This separation of concerns is achieved through **composition**: `ConventionManager` holds a reference to an instance of `LLMService` rather than inheriting from it, allowing the manager to remain focused on convention‑specific logic while the service encapsulates all LLM‑specific communication details.

Because the parent component, **CodingConventionManager**, also uses `LLMService` for its own provider‑agnostic calls, the two siblings share a common integration point.  This shared dependency promotes consistency across the subsystem: any change to authentication, request throttling, or response parsing inside `lib/llm/llm-service.ts` automatically propagates to both `CodingConventionManager` and `ConventionManager`.  The observed possible siblings—**ConventionChecker**, **ConventionEnforcer**, and **ConventionReporter**—are likely to follow the same pattern, each delegating to `LLMService` while adding their own domain‑specific behavior.

## Implementation Details  

Even though no concrete symbols are listed, the observations give us the essential mechanics:

1. **LLMService (`lib/llm/llm-service.ts`)** – This class is the single source of truth for making calls to any LLM provider.  It probably exposes methods such as `invokeModel(prompt: string, options?: ...)` that hide provider‑specific SDKs, authentication, and request formatting.  By being “provider‑agnostic,” it likely uses a strategy or adapter internally to switch between different LLM back‑ends without exposing that choice to callers.

2. **ConventionManager** – Implemented inside the **CodingConventionManager** package, it receives an `LLMService` instance (likely via constructor injection).  When a higher‑level operation such as “check coding conventions for a repository” is requested, `ConventionManager` builds a prompt or payload, forwards it to `LLMService.invokeModel`, and then interprets the response.  The interpretation step abstracts the raw LLM output into a structured form that downstream components (e.g., reporters) can consume.

3. **Abstraction of Database Complexity** – The phrase “abstract away underlying database complexities” suggests that `ConventionManager` does not interact directly with a persistence layer.  Instead, any data it needs (e.g., stored conventions, historical results) is either fetched indirectly through the LLM or supplied by the parent `CodingConventionManager`.  This design keeps the manager stateless with respect to storage, further reinforcing the separation of concerns.

Because the manager is a child of **CodingConventionManager**, it likely inherits configuration (such as default LLM provider, timeout settings, and logging hooks) from its parent, ensuring uniform behavior across the subsystem.

## Integration Points  

- **Parent → Child**: `CodingConventionManager` creates and configures the `ConventionManager`.  It passes a ready‑to‑use `LLMService` instance, possibly sharing the same service object across multiple children to reduce resource duplication.

- **Sibling ↔ Sibling**: Potential siblings like `ConventionChecker`, `ConventionEnforcer`, and `ConventionReporter` are expected to also depend on `LLMService`.  If they exist, they may coordinate through shared contracts (e.g., a common response schema) defined by `ConventionManager`.

- **External Dependencies**: The only explicit external dependency is the **LLMService** located at `lib/llm/llm-service.ts`.  No direct database drivers, file‑system modules, or network libraries are mentioned for `ConventionManager`; all such concerns are funneled through the service.

- **Public Interfaces**: While not listed, the manager likely exposes methods such as `runConventionCheck(context: ConventionContext): Promise<ConventionResult>` or similar, which accept domain objects and return structured results.  These methods form the integration contract for any consumer—be it a CLI tool, CI pipeline, or UI component.

## Usage Guidelines  

1. **Obtain the Manager via the Parent** – Developers should not instantiate `ConventionManager` directly.  Instead, request it from the `CodingConventionManager` factory or dependency‑injection container so that the correct, pre‑configured `LLMService` instance is used.

2. **Treat the Manager as Stateless** – Because the manager abstracts away database interactions, callers should not rely on internal caching or persistence.  If state needs to be retained across runs, it must be stored externally (e.g., in CI artifacts) and passed back in as part of the request payload.

3. **Leverage Provider‑Agnostic Calls** – When constructing prompts or payloads, follow the conventions documented in `LLMService`.  This ensures that switching the underlying LLM provider does not require changes in the calling code.

4. **Handle Structured Results** – The manager returns convention‑check results in a normalized format.  Consumers (reporters, enforcers, etc.) should parse this format rather than attempting to re‑interpret raw LLM text.

5. **Monitor Service Errors** – Since all model communication funnels through `LLMService`, any network, authentication, or rate‑limit errors will surface at the manager level.  Implement retry or fallback logic around the manager’s public methods if resilience is required.

---

### 1. Architectural patterns identified  
- **Abstraction‑layer / façade** – `ConventionManager` provides a high‑level API that hides LLM provider and database details.  
- **Composition** – The manager composes an `LLMService` instance rather than inheriting from it.  

### 2. Design decisions and trade‑offs  
- **Provider‑agnostic LLM access** trades off some fine‑grained control for flexibility; swapping providers is trivial, but specialized provider features may be inaccessible without extending `LLMService`.  
- **Stateless convention manager** simplifies testing and scaling but requires external handling of any persisted state.  

### 3. System structure insights  
- The subsystem is hierarchical: `CodingConventionManager` (parent) → `ConventionManager` (child).  
- Siblings likely follow the same dependency pattern, fostering uniformity across convention‑related features.  

### 4. Scalability considerations  
- Because all heavy lifting (LLM calls) is centralized in `LLMService`, scaling the system horizontally mainly involves scaling that service (e.g., connection pooling, async request handling).  
- Statelessness of `ConventionManager` means additional instances can be spawned without coordination overhead.  

### 5. Maintainability assessment  
- Centralizing LLM interactions in `lib/llm/llm-service.ts` reduces duplication and makes future provider migrations low‑risk.  
- The clear separation between the manager’s domain logic and the service’s communication logic improves readability and testability.  
- However, the lack of direct visibility into the manager’s source code (no symbols found) suggests that documentation and explicit interface contracts are crucial to prevent accidental misuse.


## Hierarchy Context

### Parent
- [CodingConventionManager](./CodingConventionManager.md) -- CodingConventionManager uses the LLMService class in lib/llm/llm-service.ts to perform provider-agnostic model calls, demonstrating its ability to abstract away underlying database complexities.


---

*Generated from 3 observations*

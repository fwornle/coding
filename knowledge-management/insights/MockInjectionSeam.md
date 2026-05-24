# MockInjectionSeam

**Type:** Detail

The `CRITICAL-ARCHITECTURE-ISSUES.md` document in `integrations/mcp-server-semantic-analysis/` records that prior eager-initialisation approaches required credentials at construction time, making unit tests environment-dependent; the lazy pattern resolved this by moving credential acquisition behind the `ensureLLMInitialized()` boundary.

## What It Is  

**MockInjectionSeam** is the testing‑only injection point that lives inside the **lazy‑initialisation gate** defined in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`.  The file contains a private (or protected) field that holds the LLM client instance and a single public method, `ensureLLMInitialized()`, which is the *only* sanctioned way for any concrete agent subclass to obtain a live LLM client.  By allowing a test to pre‑populate that internal field **before** invoking `ensureLLMInitialized()`, the gate’s guard (`if (this.llmClient) return;`) short‑circuits the real credential‑driven construction path.  This creates a **seam** that can be mocked without touching the production code‑path, giving tests full control over the LLM client while keeping production code free of test‑specific branches.

The seam is documented in `integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md`, which records the motivation: earlier eager‑initialisation required credentials at object construction time, making unit tests brittle and environment‑dependent.  The lazy pattern moved credential acquisition behind the `ensureLLMInitialized()` boundary, and the seam sits entirely inside `base-agent.ts`, not scattered across each concrete agent.

---

## Architecture and Design  

The design of **MockInjectionSeam** follows a **Lazy Initialization** pattern combined with a **Seam for Testing**.  The *lazy* aspect is embodied by `ensureLLMInitialized()`, which lazily creates the LLM client the first time it is needed.  The *seam* is the mutable internal field that can be overwritten by test code; because the field is checked before any real initialisation, the seam is effectively an *implicit dependency injection* point that does not require a formal DI container.

`MockInjectionSeam` is a **sibling** to the `EnsureLLMInitializedGate` concept – both live in the same `base-agent.ts` file.  The gate enforces that **all** concrete agents (the *children* of `LazyLLMInitializationPattern`) must obtain the LLM client through the single entry point, guaranteeing a consistent acquisition strategy across the hierarchy.  By centralising the seam, the architecture avoids duplicated mock‑setup code in each subclass, thereby reducing boilerplate and the risk of divergent test behaviours.

The overall architectural style is **layered**: the *base agent* layer provides the LLM acquisition contract, the *concrete agents* layer implements domain‑specific behaviour, and the *test harness* layer interacts with the seam to substitute a mock client.  No other patterns (e.g., micro‑services, event‑driven) are introduced, keeping the design focused on a single, well‑scoped responsibility.

---

## Implementation Details  

`base-agent.ts` defines (implicitly, from the observations) a private member such as:

```ts
private llmClient?: LLMClient;
```

and the public method:

```ts
protected async ensureLLMInitialized(): Promise<LLMClient> {
  if (this.llmClient) {
    // Mock or previously‑injected client is present – skip real init.
    return this.llmClient;
  }
  // Real initialisation path: acquire credentials, construct client.
  const creds = await CredentialProvider.getCredentials(); // may hit env
  this.llmClient = new LLMClient(creds);
  return this.llmClient;
}
```

The **gate** (`if (this.llmClient)`) is the **EnsureLLMInitializedGate** sibling.  In production, the field is `undefined`, so the method proceeds to fetch credentials (as described in the `CRITICAL-ARCHITECTURE-ISSUES.md` file) and instantiate the real LLM client.  In a test, the test harness does:

```ts
const agent = new SomeConcreteAgent();
(agent as any).llmClient = mockLlmClient; // inject mock before gate
await agent.ensureLLMInitialized(); // gate sees mock, returns it
```

Because the injection occurs **before** the gate is evaluated, the real credential acquisition is never triggered, eliminating the need for environment‑specific secrets during unit testing.  All concrete agents inherit this behaviour automatically; they do not need to implement their own injection logic.

No additional symbols were discovered, confirming that the seam is deliberately minimal – a single mutable field plus the guard check.  The `LazyLLMInitializationPattern` parent component documents the overall pattern, while `EnsureLLMInitializedGate` is the sibling that enforces the lazy‑initialisation contract.

---

## Integration Points  

* **Concrete Agents** – Every subclass under `integrations/mcp-server-semantic-analysis/src/agents/` calls `ensureLLMInitialized()` whenever it needs to talk to the LLM.  The seam is invisible to them; they simply receive whichever client the gate returns (real or mock).  

* **Credential Provider** – The real initialisation path depends on `CredentialProvider.getCredentials()` (or an equivalent module) which pulls secrets from the environment.  This dependency is *only* exercised when the seam is not pre‑populated.

* **Test Harness** – Test code imports the concrete agent, casts it (or uses a friend accessor) to set the internal `llmClient` field.  Because the seam is internal, the test harness must have visibility (e.g., via TypeScript’s `as any` or a dedicated test‑only accessor) but does not need to modify production code.

* **Documentation** – The `CRITICAL-ARCHITECTURE-ISSUES.md` file provides the rationale and should be consulted when altering the gate or the seam, ensuring that any change preserves the test‑ability guarantee.

The seam therefore acts as a **boundary** between the production credential‑driven world and the isolated test world, with a single, well‑defined integration point (`ensureLLMInitialized()`) that all callers respect.

---

## Usage Guidelines  

1. **Never bypass `ensureLLMInitialized()`** – All LLM interactions in concrete agents must be gated through this method.  Direct construction of `LLMClient` inside a subclass defeats the lazy pattern and re‑introduces environment coupling.

2. **Inject mocks only in test code** – Production code should never assign to the internal `llmClient` field.  Tests may set the field *before* the first call to `ensureLLMInitialized()`.  After the gate has run, the field becomes immutable for the remainder of the test execution.

3. **Keep the mock compatible** – The injected mock must implement the same public interface as `LLMClient`.  Because the seam is type‑agnostic (the field is declared as `LLMClient | undefined`), TypeScript will enforce compatibility at compile time if the test harness uses a proper type cast.

4. **Do not add additional initialization logic** – Any new credential‑related steps should be placed inside the existing guard’s *else* branch.  Adding a second guard or a separate init method would fragment the seam and break the “single entry point” guarantee.

5. **Document any changes** – If the lazy‑initialisation contract is altered (e.g., adding a secondary client), update `CRITICAL-ARCHITECTURE-ISSUES.md` and ensure the seam still allows a single mock to cover the whole hierarchy.

---

### Architectural Patterns Identified  

1. **Lazy Initialization** – Defers LLM client creation until first use.  
2. **Seam for Testing (Implicit Dependency Injection)** – Provides a mutable injection point hidden behind a guard.  
3. **Gate/Guard Pattern** – `EnsureLLMInitializedGate` enforces a single entry point.

### Design Decisions & Trade‑offs  

* **Centralised Mocking vs. Per‑Agent Shims** – By locating the seam in `base-agent.ts`, the design eliminates duplicated test code but introduces a single point of failure; a bug in the gate affects all agents.  
* **Implicit vs. Explicit DI** – The mutable field is an implicit injection mechanism, keeping the codebase free of a heavyweight DI framework, yet it sacrifices compile‑time visibility of the dependency.  
* **Credential Lazy‑Loading** – Moving credential acquisition behind the gate removes environment coupling from construction, improving testability at the cost of a slightly more complex control flow.

### System Structure Insights  

* **Parent** – `LazyLLMInitializationPattern` defines the overall lazy‑initialisation strategy.  
* **Sibling** – `EnsureLLMInitializedGate` is the guard logic that implements the pattern.  
* **Children** – All concrete agents inherit the seam automatically; they need not implement any injection logic.  

### Scalability Considerations  

* **Horizontal Scalability** – Adding new agents does not increase mocking effort; the single seam scales linearly with the number of agents.  
* **Performance** – The gate adds a negligible O(1) check per LLM request; however, if the LLM client holds state (e.g., session tokens), sharing a single instance across many agents could become a contention point.  In such cases, the design may be extended to allow per‑agent client factories while preserving the seam.

### Maintainability Assessment  

* **High Maintainability** – Centralising client acquisition and the mock seam reduces code duplication and simplifies future refactors (e.g., swapping the LLM provider).  
* **Risk Concentration** – Because the seam is the only injection point, any change to `base-agent.ts` must be carefully reviewed; a regression could break all agents and their tests simultaneously.  
* **Documentation Alignment** – The explicit reference to `CRITICAL-ARCHITECTURE-ISSUES.md` ensures that architectural intent is recorded alongside code, aiding onboarding and reducing accidental design drift.

---

*Diagram – LazyLLMInitializationPattern with MockInjectionSeam*  

```
+---------------------------+
| LazyLLMInitializationPattern |
+---------------------------+
          |
          v
+---------------------------+
| base-agent.ts (parent)    |
|  - llmClient? : LLMClient |
|  - ensureLLMInitialized() |
+---------------------------+
          |
   +------+------+
   |             |
   v             v
Real Init      Mock Injection (test)
   |             |
   v             v
LLMClient      MockLLMClient
   |             |
   +------> Agents (children) use the returned client
```

The diagram illustrates how the **MockInjectionSeam** sits behind the `ensureLLMInitialized()` gate, providing a single, test‑controlled entry point for all concrete agents.


## Hierarchy Context

### Parent
- [LazyLLMInitializationPattern](./LazyLLMInitializationPattern.md) -- base-agent.ts in integrations/mcp-server-semantic-analysis/src/agents/ is the authoritative source of the pattern, defining ensureLLMInitialized() as the single entry point for LLM client acquisition across all concrete agent subclasses

### Siblings
- [EnsureLLMInitializedGate](./EnsureLLMInitializedGate.md) -- `base-agent.ts` in `integrations/mcp-server-semantic-analysis/src/agents/` centralises LLM client acquisition in `ensureLLMInitialized()`, meaning no concrete subclass may bypass or duplicate this logic — the method is the sole sanctioned path to a live LLM client.


---

*Generated from 3 observations*

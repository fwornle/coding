# LegacyMockFlag

**Type:** Detail

`getLLMMode()` in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` consults `mockLLM` only after both the per-agent store and `llmState.globalMode` are found unset, placing it third in a four-level chain that bottoms out at the hardcoded `'public'` string fallback.

## What It Is  

**LegacyMockFlag** is the historic boolean flag that toggles a mock LLM backend for the **LLMModeController** subsystem. It lives in the file  

```
integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts
```  

and is consulted by the `getLLMMode()` function. The flag is evaluated only after two higher‑priority configuration sources are examined: a per‑agent override stored in `llmState` (keyed by agent ID) and the global mode stored in `llmState.globalMode`. If neither of those sources yields a value, `getLLMMode()` falls back to the legacy `mockLLM` boolean, and finally to the hard‑coded string `'public'`.  

Because the boolean can represent only “mock” vs. “real”, it cannot express the richer taxonomy introduced later (multiple mock variants, provider tiers, etc.). Consequently, **LegacyMockFlag** now functions as a backward‑compatibility shim rather than a primary configuration mechanism.

---

## Architecture and Design  

The design around **LegacyMockFlag** follows a **priority‑chain configuration pattern**. The `getLLMMode()` implementation builds a four‑level decision tree:

1. **Per‑agent override** – `llmState[agentId]` (handled by the sibling **AgentModeOverrideStore**).  
2. **Global mode** – `llmState.globalMode`.  
3. **Legacy boolean** – `mockLLM`.  
4. **Hard‑coded fallback** – `'public'`.  

```
┌───────────────────────┐
│ getLLMMode()           │
│ (llm-mock-service.ts) │
└─────────┬─────────────┘
          ▼
 ┌─────────────────────┐
 │ AgentModeOverride   │   ← Highest priority (sibling store)
 └─────────────────────┘
          ▼
 ┌─────────────────────┐
 │ llmState.globalMode │   ← Global configuration
 └─────────────────────┘
          ▼
 ┌─────────────────────┐
 │ mockLLM (Legacy)    │   ← Boolean shim
 └─────────────────────┘
          ▼
 ┌─────────────────────┐
 │ 'public' (fallback) │   ← Default mode
 └─────────────────────┘
```

The **parent component**—`LLMModeController`—exposes `setGlobalLLMMode` and `setAgentLLMMode` APIs that write to the higher‑priority stores. By placing the legacy flag at level 3, the original design (a single boolean) was preserved for existing callers while allowing newer code to adopt the richer mode taxonomy without breaking older integrations.

No explicit micro‑service, event‑driven, or plugin frameworks are evident; the architecture is a **monolithic, in‑process configuration hierarchy** driven by simple JavaScript/TypeScript objects (`llmState`). The pattern emphasizes **backward compatibility** and **deterministic precedence**, ensuring a single source of truth for the effective LLM mode at runtime.

---

## Implementation Details  

### `getLLMMode()` (llm-mock-service.ts)  

* **Signature** – Returns a string representing the active LLM mode (`'mock'`, `'public'`, or any custom mode set via the newer fields).  
* **Logic flow** –  
  1. Looks up `llmState[agentId]` via the **AgentModeOverrideStore**. If present, returns it immediately.  
  2. Checks `llmState.globalMode`. If defined, returns that value.  
  3. Reads the boolean `mockLLM`. When `true`, the function returns the legacy mock identifier (typically `'mock'`). When `false`, it proceeds.  
  4. Returns the literal `'public'` as the final fallback.  

The boolean `mockLLM` is defined somewhere in the same module (or imported) and defaults to `false` unless explicitly set by legacy configuration files or environment variables. Because it is a simple flag, its presence does not convey which mock implementation is used; the system assumes a single mock implementation behind the flag.

### Interaction with **LLMModeController**  

`LLMModeController` aggregates the mode‑resolution logic and provides mutators:  

* `setGlobalLLMMode(mode: string)` – writes to `llmState.globalMode`.  
* `setAgentLLMMode(agentId: string, mode: string)` – writes to the per‑agent entry in `llmState`.  

Both setters effectively **shadow** the legacy `mockLLM` flag because they occupy higher precedence levels. The controller does not expose any direct setter for `mockLLM`; the flag is only read, preserving its read‑only, shim status.

### Relationship to **AgentModeOverrideStore**  

The sibling component **AgentModeOverrideStore** implements its own `getLLMMode()` that accesses the same `llmState` map but is scoped to a specific agent ID. Its presence at the top of the priority chain guarantees that any per‑agent configuration always wins over global or legacy settings.

---

## Integration Points  

1. **Consumers of LLM mode** – Any part of the system that needs to know which LLM backend to invoke calls `LLMModeController.getLLMMode(agentId?)`. The returned string drives downstream service selection (e.g., real provider vs. mock implementation).  
2. **Configuration loaders** – Startup scripts or environment‑variable parsers may still set `mockLLM` for compatibility with older deployment pipelines. Modern loaders should prefer populating `llmState.globalMode` or per‑agent entries.  
3. **Testing harnesses** – Test suites that require a deterministic mock backend often flip `mockLLM` to `true`. However, best practice is to use the newer setters so that the test configuration mirrors production‑like precedence.  
4. **Legacy integration code** – Existing modules that directly read `mockLLM` (outside `getLLMMode`) will continue to work, but they will be overridden by any higher‑priority setting, potentially causing surprising behavior if not understood.  

All interactions are **in‑process**; there are no external service calls or messaging layers involved in the mode resolution path.

---

## Usage Guidelines  

* **Prefer the new APIs** – Use `LLMModeController.setGlobalLLMMode()` for system‑wide mock or real mode selection, and `setAgentLLMMode()` when a specific agent requires a different backend. This ensures the configuration is respected throughout the priority chain.  
* **Treat `mockLLM` as read‑only** – Do not write to `mockLLM` in new code. It exists solely for backward compatibility and will be ignored whenever a global or per‑agent mode is defined.  
* **Avoid direct boolean checks** – Never base logic on `if (mockLLM) …` because that bypasses the precedence logic and can lead to mode mismatches. Always call `getLLMMode()` (or the higher‑level controller method) to obtain the effective mode.  
* **Document overrides** – When setting per‑agent overrides, record the reason (e.g., feature flag, test scenario) because they supersede global configuration and can be a source of hidden complexity.  
* **Migration path** – Legacy deployments that still rely on the boolean flag should plan to migrate to the `globalMode` field. The migration is straightforward: set `llmState.globalMode = mockLLM ? 'mock' : 'public'` and then remove the flag from configuration files.  

---

### Architectural Patterns Identified  

| Pattern | Evidence |
|---------|----------|
| **Priority‑Chain Configuration** | Four‑level lookup in `getLLMMode()` (per‑agent → global → legacy → fallback). |
| **Backward‑Compatibility Shim** | `mockLLM` positioned at level 3, retained only to support older callers. |
| **Singleton‑Style State Store** | `llmState` is a shared in‑memory object accessed by multiple components. |

### Design Decisions & Trade‑offs  

* **Decision to keep `mockLLM`** – Provides a non‑breaking path for legacy deployments but introduces an extra conditional branch that developers must be aware of.  
* **Single source of truth (`llmState`)** – Simplifies look‑<COMPANY_NAME_REDACTED> but couples all mode decisions to a mutable global object, which can be a source of race conditions in highly concurrent contexts.  
* **Hard‑coded fallback `'public'`** – Guarantees a deterministic default but makes the system less flexible if additional default modes are needed later.  

### System Structure Insights  

* **Parent‑child relationship** – `LegacyMockFlag` is encapsulated within `LLMModeController`; the controller owns the state and exposes mutation APIs.  
* **Sibling interaction** – `AgentModeOverrideStore` shares the same `llmState` map but scopes its read/write to agent IDs, ensuring per‑agent granularity without duplicating storage.  

### Scalability Considerations  

* The current in‑memory `llmState` works well for a single‑process deployment. Scaling to a distributed environment would require externalizing this state (e.g., Redis, database) to preserve the priority semantics across nodes.  
* Adding new mode types (beyond `'mock'` and `'public'`) does not affect the lookup algorithm; they simply populate `globalMode` or per‑agent entries.  

### Maintainability Assessment  

* **Strengths** – Clear precedence rules, isolated shim (`mockLLM`) that can be deprecated in a future major version, and straightforward mutation APIs.  
* **Weaknesses** – The presence of an obsolete boolean can cause confusion; developers must remember the precedence order, which is not obvious without reading the `getLLMMode()` implementation. Documentation and lint rules that flag direct `mockLLM` usage can mitigate this risk.  

---  

*All references (file paths, class and function names) are taken directly from the supplied observations; no assumptions beyond the documented code have been introduced.*


## Hierarchy Context

### Parent
- [LLMModeController](./LLMModeController.md) -- `getLLMMode()` in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` implements a four-level priority chain: per-agent override in `llmState` keyed by agent ID, then `llmState.globalMode`, then legacy `mockLLM` boolean, then hardcoded `'public'` fallback

### Siblings
- [AgentModeOverrideStore](./AgentModeOverrideStore.md) -- `getLLMMode()` in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` checks this agent-keyed section of `llmState` at priority level 1 (the highest), meaning a per-agent assignment always wins over global or legacy settings.


---

*Generated from 4 observations*

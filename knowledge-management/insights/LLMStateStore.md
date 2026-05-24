# LLMStateStore

**Type:** Detail

LLMState is declared in src/mock/llm-mock-service.ts, a file whose name implies test-only scope — the SubComponent description explicitly warns new developers to treat this as a core types file, signaling a naming/location discrepancy that has caused onboarding confusion.

# LLMStateStore: Technical Insight Document

## What It Is

`LLMStateStore` is the in-memory and persisted state container that backs the `MockLLMService`, declared alongside the `LLMState` type in `src/mock/llm-mock-service.ts`. Despite the file path suggesting test-only utility code, this module is the single source of truth for both the `LLMMode` union (`'mock' | 'local' | 'public'`) and the `LLMState` shape that holds runtime mode configuration. The naming/location discrepancy has historically caused onboarding confusion, so the store must be understood as a core types and state module — not a mock fixture.

At its core, `LLMStateStore` holds two pieces of information that together describe how every agent in the process should resolve its LLM backend: a `globalMode` value and a `perAgentOverrides` map. These two fields form a two-tier configuration hierarchy that the sibling `LLMModeResolver` (via `getLLMMode()`) consults whenever an agent needs to decide which LLM mode to invoke.

## Architecture and Design

The architectural pattern evident in `LLMStateStore` is a **centralized state store with hierarchical fallback resolution**. The store does not itself perform mode decisions; instead, it exposes the data structure (`LLMState`) consumed by `LLMModeResolver.getLLMMode()`, which is identified as the single authoritative resolver in the parent `MockLLMService` analysis. This separation of state ownership (`LLMStateStore`) from resolution logic (`LLMModeResolver`) is a classic store-vs-selector split: the store knows the *what*, the resolver knows the *how to choose*.

The two-tier hierarchy is the key design decision. `perAgentOverrides` is a map keyed by agent identity that lets specific agents opt into a different `LLMMode` than the process default. When no entry exists for a given agent, `globalMode` is used as the fallback. This produces a deterministic priority chain — per-agent override first, global second — which `getLLMMode()` walks in order. The design explicitly enables **heterogeneous mode configurations across agents in a single process**, meaning one process can mix `'mock'`, `'local'`, and `'public'` agents simultaneously, supporting test scenarios and gradual rollouts without spinning up separate processes.

Another architectural decision worth noting is the dual nature of the store: it is both in-memory (for hot-path reads during `getLLMMode()` resolution) and persisted (so configuration survives restarts). This implies a hydration step at process startup that reconstitutes `LLMState` from durable storage before any agent begins resolving its mode.

## Implementation Details

`LLMState` is the central type, structurally containing at minimum:
- `globalMode: LLMMode` — the process-wide default LLM backend
- `perAgentOverrides: Map<AgentId, LLMMode>` (or equivalent map structure) — keyed overrides allowing individual agents to deviate

The `LLMMode` union itself — `'mock' | 'local' | 'public'` — is co-located in `src/mock/llm-mock-service.ts`, making this file the canonical definition site. Any code that needs to type-check or branch on the mode must import from this path; introducing parallel definitions elsewhere would fragment the source of truth and break the contract established with `LLMModeResolver`.

The store is contained within `MockLLMService` (per the related-entities mapping), which means `MockLLMService` owns the lifecycle of `LLMStateStore` — instantiation, hydration from persistence, mutations, and exposure to consumers. Because the store is persisted, developers must treat any write as a durable change. Mutations to `globalMode` or `perAgentOverrides` will be observed by `getLLMMode()` on subsequent calls and will survive process restarts, making accidental writes a potential source of cross-session drift.

## Integration Points

The primary integration point is the sibling `LLMModeResolver`, whose `getLLMMode()` function consumes `LLMState` to produce the final mode decision. This is the only path through which `LLMStateStore` data influences runtime behavior: all downstream agent branching depends on `getLLMMode()`'s output, and `getLLMMode()` in turn depends on the store's `globalMode` and `perAgentOverrides`. No other component should make this decision independently — doing so would bypass the authoritative resolver and produce inconsistencies.

The store is also implicitly integrated with whatever persistence layer hydrates it on startup. Although the specific persistence mechanism is not named in the observations, the documented dual nature (in-memory and persisted) means a mismatch between persisted state and the current environment configuration can cause `getLLMMode()` to resolve to an unintended mode after a restart. For example, if persisted state pins an agent to `'public'` mode but the environment is now configured for offline development, the resolver will still return `'public'` until the override is cleared.

`LLMStateStore`'s parent, `MockLLMService`, is the entry point for any external consumer needing to read or modify mode configuration. Direct manipulation of the store from outside `MockLLMService` should be avoided in favor of going through the parent's exposed interface.

## Usage Guidelines

**Treat `src/mock/llm-mock-service.ts` as a core types file, not a test utility.** This is the most important onboarding rule. The filename is misleading; `LLMMode` and `LLMState` definitions live here and are consumed throughout the system. Do not move these types to a "tests" directory and do not duplicate them — the file is the single source of truth.

**Always resolve modes through `LLMModeResolver.getLLMMode()`.** Never read `globalMode` or `perAgentOverrides` directly to make an LLM-mode decision in agent code. The resolver encapsulates the priority chain (per-agent override → global fallback), and bypassing it risks divergent behavior between agents.

**Account for state hydration on startup.** Because `LLMState` is persisted, the first read after a restart reflects the last persisted values, not environment defaults. When debugging an "unexpected mode" issue post-restart, inspect the hydrated `LLMState` before assuming environment configuration is at fault. Consider providing an explicit reset or reconciliation step if your environment requires deterministic startup modes.

**Use `perAgentOverrides` deliberately.** The override map is powerful — it enables heterogeneous agent configurations in a single process — but it also creates non-uniform behavior that can surprise developers expecting all agents to share a mode. Document any override at the point of mutation, and prefer clearing overrides over leaving stale entries that persist across sessions.

**Mutations are durable.** Any write to `LLMStateStore` propagates to the persistence layer and survives restarts. Treat writes with the same care as writes to a configuration database; ad-hoc test code that mutates the store should clean up after itself or operate on an isolated instance.

---

### Summary of Architectural Insights

1. **Patterns identified:** Centralized state store with hierarchical fallback resolution; store/selector separation between `LLMStateStore` and `LLMModeResolver`; single-source-of-truth type co-location.
2. **Design decisions and trade-offs:** Two-tier configuration (global + per-agent) trades simplicity for flexibility, enabling heterogeneous agent modes at the cost of more complex resolution semantics. Persistence trades fresh-start determinism for cross-session continuity.
3. **System structure insights:** `MockLLMService` owns `LLMStateStore`; `LLMModeResolver` is the sole consumer for mode decisions; the misleading file path is a known structural debt.
4. **Scalability considerations:** The store is per-process and in-memory, with a map-based override structure that scales linearly with agent count. For very large agent populations the map size and persistence payload should be monitored, but the design imposes no inherent cross-process coordination.
5. **Maintainability assessment:** The file-naming discrepancy is the largest maintainability risk and a documented source of onboarding confusion; renaming or relocating `src/mock/llm-mock-service.ts` (or extracting the core types into a clearly named module) would materially improve clarity. Otherwise the clear separation between state (`LLMStateStore`) and resolution (`LLMModeResolver`) makes the system easy to reason about.


## Hierarchy Context

### Parent
- [MockLLMService](./MockLLMService.md) -- src/mock/llm-mock-service.ts is the single source of truth for LLMMode ('mock' | 'local' | 'public') and LLMState, despite its filename implying it is only a test utility — new developers should treat it as a core types file

### Siblings
- [LLMModeResolver](./LLMModeResolver.md) -- getLLMMode() is identified in parent analysis as the single authoritative resolver for agent LLM mode, meaning all downstream agent behavior branches on its output — no other location should make this decision independently.


---

*Generated from 4 observations*

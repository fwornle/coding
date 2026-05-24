# LLMModeResolver

**Type:** Detail

Because src/mock/llm-mock-service.ts is the source of truth for the LLMMode union type ('mock' | 'local' | 'public'), getLLMMode()'s return type is tightly coupled to that definition — adding a new mode requires changing both the type and the resolver's branching logic in this single file.

# LLMModeResolver — Technical Insight Document

## What It Is

`LLMModeResolver` is a logical sub-component implemented within `src/mock/llm-mock-service.ts`, materialized as the `getLLMMode()` function. It serves as the **single authoritative resolver** for determining which LLM mode the agent should operate in at runtime, returning a value of the `LLMMode` union type (`'mock' | 'local' | 'public'`). It is contained by its parent `MockLLMService` and sits alongside its sibling `LLMStateStore` within the same file.

The resolver's purpose is narrow but pivotal: every downstream agent behavior that varies by LLM backend (mock, local model, or public API) must branch on the value produced by `getLLMMode()`. No other location in the codebase is expected to make this decision independently — this centralization is a deliberate architectural invariant.

## Architecture and Design

The architecture follows a **centralized resolver pattern** combined with a **layered override (priority chain) pattern**. `getLLMMode()` consolidates what could otherwise be scattered conditional checks throughout the agent runtime into a single decision point. This eliminates drift between callers and ensures that mode-dependent behavior is consistent across the system.

The resolver employs a **four-level priority chain** to determine which mode wins. The implication of this layering is a familiar override model — typically structured as per-agent override → global override → environment default → compiled fallback. The order of evaluation is significant: developers debugging unexpected mode behavior must trace the chain in priority order, because an earlier (higher-priority) layer will short-circuit later ones. This makes the resolver behave as a deterministic function of its layered inputs rather than as an ad-hoc check.

A notable design decision is the **co-location of the resolver with the `LLMMode` type definition itself**. Because `src/mock/llm-mock-service.ts` is the source of truth for the `LLMMode` union, `getLLMMode()`'s return type is tightly coupled to the type declaration in the same file. This intentional coupling reduces the surface area where mode semantics can diverge — adding a new mode is a single-file change touching both the type and the resolver's branching logic.

The architectural relationship with the parent `MockLLMService` is significant. Despite the filename `llm-mock-service.ts` implying a test-only utility, it is in practice a **core types and resolution module**. `LLMModeResolver` is one of two key sub-components defined there; its sibling `LLMStateStore` shares the same hosting file and the same naming/location discrepancy that has caused onboarding confusion. Both sub-components must be treated as production-critical despite the "mock" prefix in the host file.

## Implementation Details

The core implementation is the `getLLMMode()` function. Its return type is the `LLMMode` union (`'mock' | 'local' | 'public'`), declared in the same file. Internally, the function walks its four-level priority chain, returning at the first layer that yields a resolved mode. The fallback layer guarantees the function is total — it always returns a valid `LLMMode` value.

The `'mock'` branch of the resolver is operationally important: when `getLLMMode()` returns `'mock'`, it gates the behavior of `MockResponseProvider`. This means the resolver acts as the upstream gate for whether mocked responses are used at all. If the priority chain is misconfigured during a test setup — for example, if no test-level override is applied — the resolver may silently fall through to a lower-priority layer and yield `'local'` or `'public'`, causing the test to hit a live provider unintentionally. This is a critical implementation nuance: the resolver fails open to live providers, not closed to mocks.

The `'local'` and `'public'` branches similarly determine which real LLM backend is engaged. Because `getLLMMode()` is the only authoritative source, any change to which backend is reachable in a given environment must be expressed as a change to the inputs of the priority chain (configuration, environment, or override), not as a parallel branch elsewhere in the codebase.

Because no other code symbols were extracted for this entity, the resolver should be understood as a small, focused function whose value derives from its position in the system rather than from internal complexity. Its correctness rests on the discipline of all callers funneling through it.

## Integration Points

`LLMModeResolver` integrates with the rest of the system through three principal interfaces:

1. **Type coupling with `MockLLMService`**: The resolver returns the `LLMMode` type defined in its parent file `src/mock/llm-mock-service.ts`. Any consumer importing `LLMMode` is implicitly bound to the same authoritative definition that the resolver uses.
2. **Behavioral gating of `MockResponseProvider`**: When `getLLMMode()` resolves to `'mock'`, `MockResponseProvider` is engaged. This is the resolver's primary downstream contract — `MockResponseProvider` does not decide for itself whether to be active; it is selected by the resolver's output.
3. **Sibling coordination with `LLMStateStore`**: Both components live in the same file and represent the two pillars of mock LLM management — `LLMModeResolver` decides *which mode* is active, while `LLMStateStore` holds the associated `LLMState`. Consumers typically read mode from `getLLMMode()` and then consult `LLMStateStore` for mode-relevant state.

The four-level priority chain itself constitutes an integration surface with configuration layers (per-agent overrides, global overrides, environment defaults, and the compiled fallback). Each layer is an integration point where external configuration influences the resolver's output.

## Usage Guidelines

**Always call `getLLMMode()` rather than re-implementing mode detection.** Because the resolver is the single authoritative source, any parallel logic that infers mode from environment variables, flags, or configuration objects risks diverging from the canonical resolution and producing inconsistent agent behavior. If you find yourself reading the same inputs the resolver reads, you should be calling the resolver instead.

**Be deliberate about test-time mode configuration.** Tests that rely on mocked LLM behavior must explicitly configure the priority chain so that `getLLMMode()` returns `'mock'`. Because the chain falls through to lower-priority layers (and ultimately to a compiled fallback that may be `'local'` or `'public'`), a test that forgets to set the override may silently invoke a live provider, leading to flaky tests, unexpected network calls, or budget consumption. Treat explicit mock configuration as a test precondition, not a default.

**Understand the priority order before debugging.** When mode-dependent behavior is unexpected, walk the four layers in priority order: per-agent override first, then global override, environment default, and finally compiled fallback. The first non-empty layer wins, so a misplaced global override can mask an environment default that the developer assumed was active.

**Treat `src/mock/llm-mock-service.ts` as a core types and resolution file, not a test utility.** Despite the `mock` prefix in the filename, this file owns both the `LLMMode` type and the authoritative resolver, as well as the sibling `LLMStateStore`. New contributors should not be misled by the filename — modifying this file affects production behavior.

**Adding a new mode is a single-file change.** Because the `LLMMode` union and `getLLMMode()`'s branching logic both live in `src/mock/llm-mock-service.ts`, introducing a new mode (e.g., extending the union) requires editing the type, the resolver's branching, and any downstream consumers (notably `MockResponseProvider` and `LLMStateStore`). Keep the type and the resolver in sync — they are designed to be co-modified.

---

### Summary of Analyses Requested

1. **Architectural patterns identified**: Centralized resolver pattern; layered override (priority chain) pattern; co-location of type definition with its primary consumer/producer.
2. **Design decisions and trade-offs**: Single-point-of-truth resolution (gains consistency, concentrates risk in one function); fail-open-to-live-providers semantics (favors production correctness but creates test-time hazards); hosting core types in a `mock`-prefixed file (compact module boundary but causes onboarding confusion).
3. **System structure insights**: `LLMModeResolver` and `LLMStateStore` are paired sub-components of `MockLLMService`, jointly providing mode resolution and state storage; `MockResponseProvider` is a downstream consumer gated by the resolver's `'mock'` output.
4. **Scalability considerations**: The resolver's logic is O(1) over a fixed priority chain and a small enumerated union — performance is not a concern. The scalability question is *semantic*: each additional mode added to the `LLMMode` union expands the branching surface in both the type and the resolver, and ripples into every consumer that switches on mode.
5. **Maintainability assessment**: Maintainability is **good in the small** (single function, single file, single source of truth) but **fragile at the boundaries** — the filename mismatch (`mock` prefix for production-critical code) and the silent fallthrough to live providers are two recurring sources of confusion. Documenting the priority order at the call site and enforcing explicit mock configuration in test scaffolding would materially improve long-term maintainability.


## Hierarchy Context

### Parent
- [MockLLMService](./MockLLMService.md) -- src/mock/llm-mock-service.ts is the single source of truth for LLMMode ('mock' | 'local' | 'public') and LLMState, despite its filename implying it is only a test utility — new developers should treat it as a core types file

### Siblings
- [LLMStateStore](./LLMStateStore.md) -- LLMState is declared in src/mock/llm-mock-service.ts, a file whose name implies test-only scope — the SubComponent description explicitly warns new developers to treat this as a core types file, signaling a naming/location discrepancy that has caused onboarding confusion.


---

*Generated from 4 observations*

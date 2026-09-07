# GetLLMMode

**Type:** Detail

GetLLMMode() in llm_mock_service.py implements tier-based resolution by first checking an explicit LLM_MODE environment variable override, then falling back to checking connectivity/config flags to decide between 'mock', 'local', and 'public' modes.

# GetLLMMode — Technical Insight Document

## What It Is

GetLLMMode is a mode-resolution function implemented in two parallel forms within the LLM mock/routing subsystem: a Python implementation (`GetLLMMode()` in `llm_mock_service.py`) and a TypeScript sibling/counterpart (`getLLMMode()` in `llm-mock-service.ts`), both owned by the parent component `LLMMockService`. Its core responsibility is to determine which LLM backend a given call should be routed to — `mock`, `local`, or `public` — acting as the single authoritative decision point for LLM call routing across the codebase. This function is directly referenced by the architectural documentation at `docs/architecture/llm-routing.md`, confirming its role as a documented, intentional architectural boundary rather than an incidental utility.

## Architecture and Design

The design follows a **tiered precedence/override chain pattern**, a common approach for configuration resolution where multiple sources of truth exist with varying specificity and priority. The TypeScript parent implementation (`getLLMMode()` in `llm-mock-service.ts`) makes this precedence explicit: it checks, in strict order, (1) a per-agent override, (2) a global mode setting, (3) a legacy `mockLLM` boolean for backward compatibility, and (4) finally defaults to `'public'` if nothing else applies. This is a deliberate design decision to preserve backward compatibility (via the legacy boolean) while layering in newer, more granular controls (per-agent overrides) without breaking existing consumers.

The Python implementation mirrors this tiered philosophy but with different concrete tiers: it first checks an explicit `LLM_MODE` environment variable as a hard override, then falls back to inspecting connectivity/config flags to decide between mock, local, and public. This suggests the two implementations, while conceptually aligned (same function name, same three-way mode taxonomy), are independently tailored to their runtime environments — the TypeScript version is oriented around application-level/agent-level configuration state, while the Python version is oriented around environment/process-level configuration (env vars, connectivity checks). This is a reasonable and common pattern for polyglot codebases where the same architectural concept (mode routing) must be re-implemented per language runtime rather than shared directly.

## Implementation Details

At the mechanical level, GetLLMMode/getLLMMode is a pure decision function — given the current configuration state, it returns one of three string/enum values: `mock`, `local`, or `public`. The Python version's logic flow is: check `LLM_MODE` env var → if unset, check connectivity/config flags → resolve to one of the three modes. The TypeScript version's logic flow is: check per-agent override → check global mode → check legacy `mockLLM` boolean → default to `'public'`. Both are housed within `LLMMockService`, indicating this class is the central owner/namespace for all LLM mode-related logic, bundling the decision function alongside (presumably) the actual mock/local/public call dispatch logic it feeds into.

## Integration Points

The function's output directly gates downstream LLM call routing — any code path invoking an LLM must first consult this resolver to know which backend to hit. Its behavior is formally documented in `docs/architecture/llm-routing.md`, meaning it's a contract that other engineers and components rely on as documented behavior, not just an implementation detail. The legacy `mockLLM` boolean fallback indicates integration with older configuration schemas that predate the current mode/override system, implying this function serves as a compatibility shim between old and new configuration paradigms.

## Usage Guidelines

Developers should treat `LLM_MODE` (Python) and per-agent/global mode settings (TypeScript) as the primary, intentional levers for controlling routing — the legacy `mockLLM` boolean should be considered deprecated and only relied upon for backward compatibility, not for new code. Because precedence order is strict and load-bearing (overrides beat globals beat legacy flags beat defaults), any changes to this function must preserve or deliberately renegotiate that ordering, and should be reflected in `docs/architecture/llm-routing.md` to keep documentation and implementation in sync. Given there are two independent implementations (Python and TypeScript), maintainers should be cautious about mode-taxonomy drift between them and consider whether behavioral parity is expected/required across languages.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- getLLMMode() in llm-mock-service.ts implements a strict precedence chain: per-agent override, then global mode, then legacy mockLLM boolean, then 'public' default


---

*Generated from 3 observations*

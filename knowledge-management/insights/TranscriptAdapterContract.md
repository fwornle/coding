# TranscriptAdapterContract

**Type:** Detail

The convertToLSL() method is architecturally significant as it normalizes agent-specific transcript formats into a unified LSL structure (LSLSession/LSLEntry), decoupling downstream consumers from any single agent's native format

# TranscriptAdapterContract

## What It Is

`TranscriptAdapterContract` is the abstract interface specification implemented in `lib/agent-api/transcript-api.js` that defines the mandatory behavioral contract all agent transcript adapters must satisfy. It is not a runtime enforcement mechanism in the traditional sense, but rather a structural agreement — a canonical interface — that governs how any agent adapter integrates with the broader transcript processing system. It lives within the `TranscriptAdapterRegistry` as the foundational contract that makes uniform adapter treatment possible.

The contract specifies exactly five mandatory methods: `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. Every adapter — whether for Claude, Copilot, or any future agent — must implement all five to be a valid participant in the registry system.

## Architecture and Design

The design follows a **contract-based polymorphism** pattern. By codifying the interface in `lib/agent-api/transcript-api.js`, the system establishes a single source of truth for what constitutes a valid adapter. This allows `TranscriptAdapterRegistry` to dispatch operations across heterogeneous agent adapters without any agent-specific branching logic inside the registry itself — the registry simply trusts that whatever adapter it holds satisfies the contract.

This is a classic application of the **Liskov Substitution Principle**: Claude's adapter and Copilot's adapter are interchangeable from the registry's perspective precisely because both honor the same five-method surface. Adding a new agent means implementing the contract, not modifying the registry.

The most architecturally significant design decision is the placement of format normalization responsibility inside `convertToLSL()`. Rather than allowing each adapter to expose its native transcript format upstream, the contract mandates that normalization happens at the adapter boundary. Downstream consumers only ever see `LSLSession` and `LSLEntry` structures, making the entire rest of the system agent-agnostic by construction.

## Implementation Details

The five methods divide cleanly into two concerns:

**Identity and configuration** — `getAgentType()` and `getTranscriptDirectory()` provide adapter self-description. `getAgentType()` identifies which agent the adapter represents, while `getTranscriptDirectory()` exposes where that agent's raw transcripts reside on disk. These methods ground the adapter in its specific runtime environment.

**Data access and transformation** — `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()` form the operational core. `readTranscripts()` handles raw file I/O from the agent-specific directory. `convertToLSL()` is the normalization pipeline: it accepts whatever native format a given agent produces and outputs the unified `LSLSession`/`LSLEntry` structure. `getCurrentSession()` provides a focused accessor for the active session, likely used by consumers that need only present state rather than full history.

The `LSLSession`/`LSLEntry` output types defined or referenced in `lib/agent-api/transcript-api.js` represent the system's canonical transcript data model — the shape all downstream logic is written against.

## Integration Points

`TranscriptAdapterContract` sits at the center of a hub-and-spoke relationship. The `TranscriptAdapterRegistry` is its direct parent and primary consumer — the registry holds adapter instances and relies entirely on this contract to interact with them uniformly. Without the contract, the registry would require explicit knowledge of each agent type.

On the other side, each concrete adapter (Claude, Copilot, and future agents) is a spoke that implements this contract. The contract is the only coupling point between the registry and any individual adapter implementation — a clean, narrow interface that minimizes blast radius when any single adapter changes.

Downstream consumers of `convertToLSL()` output depend on `LSLSession` and `LSLEntry` as their data contract, making those two types a secondary but equally important integration surface.

## Usage Guidelines

**When implementing a new adapter**, all five methods in `lib/agent-api/transcript-api.js` must be implemented — omitting any one breaks the contract and will cause failures at the registry level. The implementation of `convertToLSL()` deserves the most careful attention: it is the sole translation layer between an agent's native format and the rest of the system, so correctness here is critical for all downstream consumers.

**`convertToLSL()` must always produce valid `LSLSession`/`LSLEntry` structures.** Downstream code is written against these types exclusively; any deviation introduced here will propagate invisibly until consumption time.

**Agent-specific logic must stay inside the adapter.** The entire value of this contract is that the registry and downstream consumers remain free of agent-specific branching. Any conditional logic that would otherwise live in the registry belongs instead in the relevant adapter's method implementations.

**Scalability** is well-served by this design: adding a tenth agent adapter carries no cost to the registry or any consumer — only a new file implementing the five-method contract. **Maintainability** is similarly strong for the same reason, though it does place discipline requirements on adapter authors to keep agent-specific complexity self-contained rather than leaking it upward.


## Hierarchy Context

### Parent
- [TranscriptAdapterRegistry](./TranscriptAdapterRegistry.md) -- The TranscriptAdapter abstract class in `lib/agent-api/transcript-api.js` enforces five mandatory methods — `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, `getCurrentSession()` — forming a strict interface contract all agent adapters must satisfy


---

*Generated from 3 observations*

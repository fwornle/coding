# CoordinatorHealthFetch

**Type:** Detail

## What It Is

CoordinatorHealthFetch is the concrete `checkHealthStatus()` function implemented in `scripts/health-prompt-hook.js`. It performs the single HTTP round-trip that underlies the entire health-reporting behavior of its parent, HealthPromptHook: a `fetch(`${coordinator}/health/state`)` against `process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034'`. The function's own docstring explicitly labels it "the only data source for this hook (Phase 33)," meaning every status line an operator eventually sees—success, failure, or unknown—traces back to this one call.

## Architecture and Design

The design centers on a fail-safe wrapper pattern around an external HTTP dependency: rather than letting fetch failures propagate, `checkHealthStatus()` normalizes every outcome into one of three disjoint shapes—HTTP-error (`overallStatus: 'unknown'`, `upstream: 'http_${r.status}'`), fetch-exception (`upstream: 'unreachable'`, `error: err.message`), or success (`status: deriveSummary(state)`). This reflects a broader architectural pattern (observation 8) of treating "unknown" as an explicit non-happy-path default rather than allowing silent success or an unhandled throw.

A notable structural trait is that this single fetch feeds two independent consumers: `main()` branches on `servicesAvailable` to choose between the Q3 empty-context exit and the normal path, while `outputHealthContext()` separately branches on `healthStatus.status.overallStatus` to select the emoji-prefixed operator-facing string. This dual-consumer arrangement means any change to the returned shape requires synchronized updates at both call sites—a coupling risk worth remembering when modifying `checkHealthStatus()`.

## Implementation Details

Internally, the normalized result is consumed by `deriveSummary()`, which interprets the coordinator's JSON body and treats a missing `knowledge_pipeline` key identically to `stalled: false`—both pass through without raising an issue. This is deliberate backward-compatibility behavior (asserted directly by the sibling KnowledgePipelineStallDetection's test suite, `tests/integration/health-prompt-hook-stall.test.mjs`), accommodating older coordinators or probes mid-first-tick.

Error-detail handling is asymmetric by design: an HTTP-error branch discards the response body, retaining only the status code (`http_${r.status}`), while a thrown exception preserves the full `err.message`. Practically, a 500 with a descriptive JSON error body loses that detail, whereas a network-level failure (DNS, ECONNREFUSED) surfaces its raw message via `outputHealthContext()`'s `⚪ System Health: unknown (${reason})` line.

Critically, the fetch has no timeout or AbortController. Since `main()` carries a hard invariant to always exit 0 promptly, a coordinator that accepts a TCP connection but never responds would leave the `await fetch()` call hanging indefinitely—a gap not covered by the existing try/catch, which only handles thrown exceptions or resolved-but-non-OK responses, not hangs.

## Integration Points

CoordinatorHealthFetch is the sole gateway between HealthPromptHook and the external coordinator service, and by extension the mechanism that surfaces obs-api's health state (including a known, unresolved coverage-metric bug where a ratio's denominator wrongly includes 'observations' and 'digests' entity types—filed as an outstanding defect against obs-api, not fixable from this file alone). Downstream, it interacts with sibling SpecR8OutputEnvelope's `outputEnvelope()`, which ultimately wraps whatever context string is derived into the SPEC R8-compliant stdout payload for Claude.

Testing integration is notable: rather than mocking `fetch`, `tests/integration/health-prompt-hook-stall.test.mjs`'s `hookSays()` spins up a real ephemeral `http.createServer`, injects its URL via `HEALTH_COORDINATOR_URL`, and drives the whole hook via `execFile`, asserting only on stdout—since `deriveSummary` is module-private and unreachable directly.

## Usage Guidelines

Developers modifying `checkHealthStatus()` must update both `main()`'s `servicesAvailable` branch and `outputHealthContext()`'s `overallStatus` branch in tandem—new top-level keys added to the return shape are inert until both readers are adjusted. Any fix for the missing-timeout gap should preserve the existing three-shape contract and the "never block" invariant. Preserving the `knowledge_pipeline`-missing-equals-not-stalled behavior is required for backward compatibility, and any error-detail improvements should consider harmonizing how much information from HTTP-error responses versus exceptions is surfaced.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The obs-api Service Lifecycle and Dev Workflow Resumption record establishes an open, unresolved coverage-metric bug where a ratio's denominator wrongly includes 'observations' and 'digests' entity types, skewing a reported statistic on the obs-api side that the coordinator fetch ultimately surfaces to this hook — filed as a known outstanding defect against this area rather than something recoverable purely from reading health-prompt-hook.js's current fetch/parse logic.

## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] The HealthDashboard record establishes that health-prompt-hook.js is the 'status aggregator' feeding the tmux statusline click-report integration alongside the constraint-monitor dashboard.

### Siblings
- [KnowledgePipelineStallDetection](./KnowledgePipelineStallDetection.md) -- [SESSION] HealthDashboard record establishes health-prompt-hook.js is the 'status aggregator' feeding the tmux statusline click-report integration alongside the constraint-monitor dashboard.
- [SpecR8OutputEnvelope](./SpecR8OutputEnvelope.md) -- [LLM] `outputEnvelope()` in scripts/health-prompt-hook.js is the single implementation of the SPEC R8 contract: it always writes `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }` to stdout, and defends the shape itself with `typeof additionalContext === 'string' ? additionalContext : ''` so a caller passing `undefined` or an object still yields a well-formed envelope rather than `"undefined"` leaking into Claude's context.


---

*Generated from 10 observations*

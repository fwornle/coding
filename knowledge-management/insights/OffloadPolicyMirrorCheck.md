# OffloadPolicyMirrorCheck

**Type:** Detail

[Architectural Patterns] Reconciliation/diff pattern between client-predicted and server-resolved state (offload-decision.tsx's configRungs.disagreements); Bounded-concurrency pool pattern for rate-limiting fan-out HTTP calls (pooled() in offload-decision.tsx); Optimistic-concurrency partial-PATCH pattern to avoid poll-vs-edit races (use-classifier-judge.ts's save()); Config-per-concern / failure-domain isolation pattern (separate YAML files and separate React hooks for offload policy vs classifier judge); Derived-rule-over-lookup-table pattern to prevent silent staleness (cost-model.ts's fast-mode pricing multiplier); Boiled-down derived cache invalidated by mtime+size, sourced from an external system-of-record (model-limits.cjs); Tri-state runtime-vs-config field separation for health signaling (JudgeBackend.reachable vs .enabled)

# OffloadPolicyMirrorCheck — Technical Insight Document

## What It Is

OffloadPolicyMirrorCheck is the reconciliation mechanism implemented in `offload-decision.tsx`, centered on the `configRungs` memoized computation and its `disagreements` array. It exists to answer a single question with certainty rather than assumption: does the dashboard's local prediction of routing behavior match what the proxy will actually do? The component maintains a client-side `evaluateOffload()` ladder (imported from `offload-gates.ts`) that can predict routing decisions instantly, but for any policy that is SAVED, it refuses to trust that prediction — instead it independently resolves every route via `GET /api/llm/routing/resolve` and diffs the two verdicts explicitly.

As a child concern of the parent `LLMProxyClient` entity, this component lives entirely in the control-plane layer. The parent's `llm-with-process.ts` transport is the data-plane client that actually dispatches completions to the proxy; OffloadPolicyMirrorCheck and its sibling `use-classifier-judge.ts` never make LLM calls themselves — they inspect and edit the routing policy that governs how the data-plane's requests get dispatched.

## Architecture and Design

The core pattern here is **reconciliation-by-diff between independently-implemented decision logic**: a client prediction path (`evaluateOffload()` ladder) and a server ground-truth path (`/api/llm/routing/resolve`), unified only by an explicit comparison step rather than a shared code path. This is a deliberate architectural redundancy. The trade-off is stated plainly in the observations — extra network calls and duplicated logic that must be kept conceptually in sync — accepted in exchange for a hard guarantee that "what the operator sees" matches "what the proxy will do" for any saved policy.

This mirrors a broader principle visible across the LLMProxyClient hierarchy: control-plane and data-plane components independently agree on wire semantics rather than sharing code, and that agreement is verified rather than assumed. The parent context notes this same tension for `llm-with-process.ts` itself, and it recurs structurally here at the policy layer.

Because the proxy's `/api/llm/routing/resolve` endpoint is a per-route synchronous RPC with no batch variant, the component must fan out up to ~39 individual HTTP calls when checking a full policy. Rather than pushing for a batch API change, the architecture compensates entirely client-side via the `pooled()` helper, which caps concurrency at width=8 — a bounded-concurrency pool pattern substituting for proper API design.

## Implementation Details

`pooled()` implements bounded fan-out: given up to 39 routes to resolve, it throttles concurrent in-flight requests to 8, trading latency for backend protection against unthrottled burst load. Paired with this is a narrowly-scoped `resolveKey` `useMemo`, which builds its cache key via `JSON.stringify` over routes, defaults, and network — explicitly excluding the `hours` traffic-volume parameter. This fine-grained invalidation scoping prevents re-firing the entire 39-request pool on re-renders that only change traffic volume, a targeted cache-invalidation strategy compensating for the missing batch endpoint.

The `configRungs` `useMemo` is the actual mirror-check: it compares `evaluateOffload()` output against `resolved[key]` (the proxy's answer) for every route, producing a `disagreements[]` array whenever the two diverge. This is the concrete implementation of the "restatement must be checked, not trusted" philosophy — the client's own ladder logic is treated as an unverified restatement of policy that the proxy authoritatively owns.

Reinforcing this isolation at the variable-scoping level, the component deliberately separates `cls = policy.classifier` from `p = policy.draft`, ensuring a classifier-config edit cannot silently redraw the gate-ladder counts it doesn't govern — the same separation principle enforced twice, once at the config-file level (`config/prompt-classifier.yaml` vs the proxy's `llm-routing.yaml`) and once in-component.

## Integration Points

OffloadPolicyMirrorCheck integrates directly with the proxy's HTTP surface via `GET /api/llm/routing/resolve`, its sole external dependency for ground-truth verification. It shares the file `offload-decision.tsx` with `useOffloadPolicyDraft`, and imports gate logic from `offload-gates.ts`. It is architecturally paired — but functionally separated — from `use-classifier-judge.ts`'s `useClassifierJudge` hook, which owns its own save path and config file (`config/prompt-classifier.yaml`) and its own tri-state `JudgeBackend.reachable` health signal, distinct from the offload policy's concerns entirely.

Within the LLMProxyClient hierarchy, this component sits above the transport layer described for `llm-with-process.ts`, consuming the proxy's resolved routing decisions but never issuing completions itself. It also shares design lineage with `cost-model.ts` (derived-rule pricing) and `model-limits.cjs` (derived cache from an external system-of-record) in valuing single-owner truth over duplicated tables — though it diverges from both by choosing verification-by-diff rather than eliminating the duplicate computation outright.

## Usage Guidelines

Developers modifying `evaluateOffload()` or the gate ladder in `offload-gates.ts` must remember that any drift from the proxy's actual resolution logic will surface as entries in `disagreements[]` for SAVED policies — this is a feature, not a bug, and should not be silenced without understanding why it fired. Do not attempt to "simplify" this into a single code path; the redundancy is intentional given the two systems' independent evolution.

When touching `resolveKey`, preserve the exclusion of `hours` unless a genuine dependency is introduced — reintroducing it will cause unnecessary refiring of the full pooled resolution across all routes. Similarly, `pooled()`'s width=8 concurrency cap should be treated as a load-bearing rate limit against the proxy, not an arbitrary constant to tune casually. Finally, respect the `cls`/`p` variable separation when extending the component — cross-wiring classifier and draft-policy state defeats the isolation this design specifically enforces against silent cross-contamination.


## Hierarchy Context

### Parent
- [LLMProxyClient](./LLMProxyClient.md) -- [LLM] The parent context establishes that llm-with-process.ts is a deliberate fetch-based bypass around the SDK's LLMService.complete(), built specifically to inject the 'process' telemetry tag the rapid-llm-proxy's /api/complete endpoint requires, with resolveProxyCompleteUrl() implementing a layered precedence (RAPID_LLM_PROXY_URL → LLM_CLI_PROXY_URL → LLM_PROXY_URL → localhost default). This is the LLMProxyClient's actual transport layer, and the dashboard code surveyed here (offload-decision.tsx, use-classifier-judge.ts) is the operator-facing control plane that sits ABOVE that transport: neither file makes an LLM completion call itself, they instead call GET/PATCH against the proxy's HTTP surface (/api/llm/routing/resolve, /api/llm/classifier) to inspect and edit the routing policy that governs how llm-with-process.ts's requests get dispatched. This is a clean separation between the data-plane client (proxy-bridge, llm-with-process.ts) and the control-plane client (this dashboard code), but it also means the two must agree on wire semantics independently — evidenced by the extensive commentary in offload-decision.tsx about the proxy's resolved answers being compared against the dashboard's own ladder logic rather than trusted.


---

*Generated from 10 observations*

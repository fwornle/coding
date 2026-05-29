# ProcessTagInjector

**Type:** Detail

The module wraps proxy requests rather than modifying LLMService.complete() directly, indicating a decorator or thin-wrapper architectural pattern that avoids coupling telemetry concerns into the core service

## What It Is

`ProcessTagInjector` is a focused telemetry-enrichment component implemented within `llm-with-process.ts`, housed inside the `ProxyMediatedLLMClient` module. Its singular purpose is to attach a `process` tag to outbound proxy requests made to the LLM layer — a piece of metadata that `LLMService.complete()` does not supply on its own. Without this tag, calls originating from wave-analysis routines arrive at the token-usage telemetry pipeline without a meaningful process identifier, causing them to be bucketed under `process='unknown'` in dashboards documented in `docs/architecture/token-usage.md`.

## Architecture and Design

The core architectural decision here is **non-invasive enrichment via wrapping**. Rather than patching `LLMService.complete()` to accept or propagate a process tag, `ProcessTagInjector` operates as a decorator or thin-wrapper layer around proxy requests. This is a deliberate separation-of-concerns: the core LLM service remains agnostic to telemetry requirements, while `llm-with-process.ts` intercepts the request path at the proxy boundary to inject the needed metadata.

This pattern reflects a trade-off favoring **loose coupling over convenience**. Modifying `LLMService.complete()` directly would have been the shorter path, but it would have entangled telemetry logic into a foundational service used broadly across the system. By confining the injection to `ProxyMediatedLLMClient`, the concern is scoped: only proxy-mediated calls receive this treatment, and the core service contract is left intact.

The wrapper pattern also implies that `ProcessTagInjector` is transparent to callers — code invoking the proxy client does not need to know about tag injection; it happens automatically as part of the proxy mediation layer.

## Implementation Details

The implementation lives in `llm-with-process.ts` as part of `ProxyMediatedLLMClient`. The mechanical approach is to intercept outbound proxy requests and augment them with a `process` field before they are forwarded. This tag identifies the originating workflow context — most critically, wave-analysis calls — so that the telemetry pipeline can attribute token consumption correctly.

The "gap-filling" framing from the parent component description is significant: this is not a general-purpose tagging framework but a targeted fix for a known blind spot. The `process` tag value is presumably determined from the call context available at the proxy layer, injected at the point where the request is constructed or dispatched.

Because no additional code symbols were resolved, the precise injection mechanism (middleware hook, request builder override, explicit wrapper function) cannot be confirmed from observations alone — but the decorator/thin-wrapper characterization from the observations is the reliable structural description.

## Integration Points

`ProcessTagInjector` sits within `ProxyMediatedLLMClient` and operates on the downstream path toward the LLM proxy. Its upstream dependency is whatever invokes proxy-mediated LLM calls (wave-analysis being the documented primary consumer). Its downstream effect surfaces in the token-usage telemetry pipeline, specifically the dashboards described in `docs/architecture/token-usage.md` that break down costs by process.

The relationship with `LLMService.complete()` is notable precisely because it is **intentionally absent**: `ProcessTagInjector` does not call into or modify that method, which is what keeps the design clean. The integration boundary is the proxy request itself.

## Usage Guidelines

Developers working in this area should treat `ProcessTagInjector` as the **canonical point** for process-tag attachment in proxy-mediated flows. Any new call path that routes through `ProxyMediatedLLMClient` will inherit tag injection automatically — this is the expected behavior. Conversely, LLM calls that bypass the proxy layer and invoke `LLMService.complete()` directly will not receive a process tag, and if those calls need attribution in token-usage dashboards, they must be either routed through the proxy client or have tagging handled separately.

When extending or modifying `llm-with-process.ts`, care should be taken not to broaden its scope beyond tag injection — the narrow responsibility is what keeps it maintainable. Telemetry concerns added here should remain limited to metadata that belongs at the proxy boundary. Anything requiring deeper request semantics should be evaluated for placement in `LLMService` itself or a separate concern layer.

The `docs/architecture/token-usage.md` document should be treated as the authoritative reference for what the `process` tag values mean and how they are consumed downstream — changes to tag values or injection logic should be validated against that documentation to ensure dashboard attribution remains accurate.


## Hierarchy Context

### Parent
- [ProxyMediatedLLMClient](./ProxyMediatedLLMClient.md) -- The llm-with-process.ts module exists specifically to inject a process tag into proxy requests, filling a gap in LLMService.complete() that caused wave-analysis calls to appear as process='unknown' in token-usage telemetry


---

*Generated from 3 observations*

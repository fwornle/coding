# HTTPPortScanConnection

**Type:** Detail

It validates the response by checking data.extensionId === this.extensionId or data.name === 'specstory' before accepting the connection

# HTTPPortScanConnection — Technical Insight Document

## What It Is

HTTPPortScanConnection is the HTTP-based connection strategy implemented as `connectViaHTTP()`, a method belonging to `SpecstoryAdapter`. It works by scanning a fixed set of candidate ports — `[7357, 7358, 7359]` — issuing a `GET /api/status` request to each via `this.httpRequest()` in order to discover a locally running Specstory service. It is one of three connection mechanisms available to `SpecstoryAdapter`, the others being IPC and file-watch based fallbacks.

## Architecture and Design

The core architectural pattern is a **port-scanning discovery mechanism** combined with a **response validation gate**. Rather than assuming a fixed, known port, the connection logic probes a small, bounded range of well-known ports and treats the first port that returns a validated response as authoritative. Validation is a defensive step: the response's `data.extensionId` must match `this.extensionId`, or `data.name` must equal `'specstory'` — ensuring the adapter doesn't mistakenly bind to an unrelated service that happens to be listening on one of these ports.

This method sits within a larger **fallback chain pattern**, embodied by its sibling `SpecstoryInitializeFallbackChain`. That component's `initialize()` calls `connectViaHTTP() || connectViaIPC() || connectViaFileWatch()`, relying on JavaScript's OR short-circuit evaluation to establish connection-method precedence. HTTPPortScanConnection is deliberately tried first, implying it's considered the most efficient or most commonly available transport, with IPC and file-watch as progressively more resilient (but likely more expensive or indirect) fallbacks.

## Implementation Details

Internally, `connectViaHTTP()` performs an iteration loop over the three candidate ports, issuing `this.httpRequest()` calls against `/api/status`. Each attempt is wrapped in a try/catch where **failures are silently swallowed by a bare catch block** — this is a key implementation detail enabling the multi-port scan to proceed to the next candidate without surfacing per-port errors up the stack. Only after all ports are exhausted (or a valid one is found) does control return to the caller.

On a successful, validated match, the method doesn't just return a boolean or raw response — it constructs and returns a connection object exposing a `log()` method. This `log()` method POSTs JSON payloads to `/api/log` on the *same port* that was successfully discovered, meaning the discovered port is captured via closure and reused for the lifetime of the connection object, avoiding redundant re-scanning for subsequent operations.

## Integration Points

HTTPPortScanConnection integrates directly with its parent, `SpecstoryAdapter`, as one of its three initialization strategies (`connectViaHTTP()`, `connectViaIPC()`, `connectViaFileWatch()`), invoked in that fallback order. It is functionally coupled to `SpecstoryInitializeFallbackChain`, which orchestrates the actual selection logic via short-circuit OR evaluation and assigns the winning result to `this.extensionApi`. The returned connection object's `log()` method is the primary interface surface exposed to the rest of the system once a connection is established, making downstream consumers dependent on this object's shape (specifically, the presence of a callable `log()` method) rather than on HTTP internals directly.

## Usage Guidelines

Developers extending or debugging this logic should be aware that failures are intentionally invisible at the per-port level — the bare catch means diagnosing why HTTP discovery failed requires instrumentation added deliberately, since no error is logged or rethrown by default. The validation check (`extensionId` or `name === 'specstory'`) should be preserved in any modification to avoid false-positive connections to unrelated services on the same ports. Because the fallback chain depends on truthy/falsy return values for its OR-based short-circuiting, `connectViaHTTP()` must return a falsy value (not throw) on total failure, and a truthy connection object on success — any deviation from this contract would break `SpecstoryInitializeFallbackChain`'s ordering logic. Finally, since the port list `[7357, 7358, 7359]` is hardcoded, adding new listening ports for the underlying service requires updating this array directly.


## Hierarchy Context

### Parent
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter.initialize() tries three connection methods in fallback order: connectViaHTTP(), then connectViaIPC(), then connectViaFileWatch()

### Siblings
- [SpecstoryInitializeFallbackChain](./SpecstoryInitializeFallbackChain.md) -- initialize() sets this.extensionApi = await connectViaHTTP() || await connectViaIPC() || await connectViaFileWatch(), relying on JS OR short-circuit for fallback ordering


---

*Generated from 4 observations*

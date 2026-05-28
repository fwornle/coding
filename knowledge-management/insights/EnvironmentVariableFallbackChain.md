# EnvironmentVariableFallbackChain

**Type:** Detail

Based on the ProxyURLResolver sub-component description, the resolver checks three distinct environment variables in priority order before falling back to a hardcoded default, enabling deployment-specific overrides without code changes.

# EnvironmentVariableFallbackChain

## What It Is

The `EnvironmentVariableFallbackChain` is a configuration resolution mechanism embedded within `ProxyURLResolver`. It implements a strict priority-ordered lookup across three environment variables — `RAPID_LLM_PROXY_URL`, `LLM_CLI_PROXY_URL`, and `LLM_PROXY_URL` — before settling on a hardcoded default of `localhost:12435`. This chain exists entirely within `ProxyURLResolver`'s resolution logic and represents the core decision path that `ProxyURLResolver` executes whenever a proxy URL is needed.

## Architecture and Design

The design follows a **chain-of-responsibility** pattern applied to configuration: each candidate source is checked in decreasing order of specificity, and the first non-empty value wins. This is a deliberate layering strategy — narrow, context-specific overrides sit at the top, and progressively broader defaults sit below. The three variables encode a clear semantic gradient: `RAPID_LLM_PROXY_URL` is scoped to rapid/local development tooling, `LLM_CLI_PROXY_URL` is scoped to CLI-level usage, and `LLM_PROXY_URL` is the most general deployment-level setting.

The terminal fallback to `localhost:12435` is an architectural coupling to the `rapid-llm-proxy` daemon's default port. This is a deliberate ergonomic decision: a developer running the daemon locally with no environment configuration gets a working setup without any bootstrapping overhead. The chain is designed to be **zero-configuration by default** while remaining fully overridable at every layer.

A notable design trade-off here is the tight coupling between the hardcoded default and the `rapid-llm-proxy` daemon's port convention. This makes the out-of-box experience seamless but means that any change to the daemon's default port would require a code change in `ProxyURLResolver` as well, rather than just a configuration update.

## Implementation Details

The chain evaluates variables in the following strict order:

1. `RAPID_LLM_PROXY_URL` — highest precedence; intended for rapid/local dev tooling contexts where a developer may need to point at a non-standard or experimental proxy endpoint.
2. `LLM_CLI_PROXY_URL` — mid-level precedence; targets CLI-driven invocations, allowing CLI tooling to operate against a distinct proxy without interfering with broader environment settings.
3. `LLM_PROXY_URL` — lowest explicit precedence; the general-purpose deployment variable suitable for production or shared environment configuration.
4. `localhost:12435` — the hardcoded terminal default, binding to the `rapid-llm-proxy` daemon's conventional port.

Each step in the chain is a simple presence check on the environment variable. The mechanics are straightforward: the resolver reads each variable in order and returns the first populated value, short-circuiting the remaining checks. The hardcoded default is only reached when all three variables are absent or empty.

## Integration Points

`EnvironmentVariableFallbackChain` is entirely internal to `ProxyURLResolver` — it is the resolution strategy that `ProxyURLResolver` encapsulates. External components interact only with `ProxyURLResolver`, receiving a resolved URL without needing awareness of which variable or default produced it. This encapsulation means the fallback logic can evolve (e.g., adding a fourth variable or changing the default port) without affecting callers.

The dependency on the `rapid-llm-proxy` daemon's port `12435` as the terminal default represents an implicit runtime dependency: the chain assumes that if no environment variable is set, a `rapid-llm-proxy` instance is reachable at that address.

## Usage Guidelines

Developers configuring deployments should set `LLM_PROXY_URL` as the standard deployment-level variable, reserving `LLM_CLI_PROXY_URL` for CLI tooling contexts where a separate proxy endpoint is needed. `RAPID_LLM_PROXY_URL` should be treated as a developer-local override and should not be committed to shared environment configurations, as it will silently shadow both other variables.

When running locally without any environment configuration, the chain assumes the `rapid-llm-proxy` daemon is running on its default port `12435`. Developers who run the daemon on a non-default port must set at least one of the environment variables explicitly — the hardcoded fallback will not adapt automatically.

When extending or modifying `ProxyURLResolver`, care should be taken to preserve the semantic ordering of the chain. Inserting a new variable at the wrong priority level could silently override intended deployment configuration, since the chain short-circuits on first match. Any change to the terminal default port should be treated as a breaking change in environments that rely on zero-configuration local operation.

---

**Architectural Patterns:** Chain of Responsibility (configuration variant), layered specificity, zero-configuration default with full override capability.

**Key Trade-off:** Ergonomic zero-config local experience in exchange for an implicit coupling to `rapid-llm-proxy`'s port convention at the terminal fallback position.


## Hierarchy Context

### Parent
- [ProxyURLResolver](./ProxyURLResolver.md) -- ProxyURLResolver implements a prioritized fallback chain checking RAPID_LLM_PROXY_URL, then LLM_CLI_PROXY_URL, then LLM_PROXY_URL, and finally defaulting to a port-based localhost address (port 12435) when no environment variable is set


---

*Generated from 3 observations*

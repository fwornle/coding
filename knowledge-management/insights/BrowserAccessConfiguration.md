# BrowserAccessConfiguration

**Type:** Detail

The integrations/browser-access/README.md file provides information on setting up the Browser Access MCP Server for Claude Code, which is relevant to the BrowserAccess sub-component

## What It Is  

**BrowserAccessConfiguration** is the concrete configuration object that drives the *BrowserAccess* sub‑component of the system. The definition lives wherever the **BrowserAccess** component is instantiated – the documentation that describes its setup is found in `integrations/browser-access/README.md`. This README explains how to stand up the *Browser Access MCP Server* that powers the Claude Code integration, and it lists the three required configuration keys:  

* `BROWSER_ACCESS_PORT` – the TCP port on which the MCP server listens.  
* `BROWSER_ACCESS_SSE_URL` – the HTTP URL that clients use to open a Server‑Sent Events (SSE) stream for real‑time browser‑side results.  
* `ANTHROPIC_API_KEY` – the secret credential required to call Anthropic’s language‑model services from within the Browser Access flow.  

Both **BrowserAccessComponent** and the higher‑level **BrowserAccess** entity contain an instance of **BrowserAccessConfiguration**, indicating that the configuration is shared across the component hierarchy and is the single source of truth for all runtime parameters needed by the Browser Access feature.

---

## Architecture and Design  

The architecture follows a *configuration‑driven service* pattern. The **BrowserAccessConfiguration** object aggregates environment‑level settings that are read by the *Browser Access MCP Server* at startup. The server itself is a thin wrapper around a network listener (bound to `BROWSER_ACCESS_PORT`) that exposes an SSE endpoint (`BROWSER_ACCESS_SSE_URL`). By externalising the port, URL, and API key into configuration, the design decouples deployment concerns (e.g., container orchestration, port mapping) from the business logic that drives browser‑based interactions.

The README notes that the Browser Access sub‑component “may utilize a similar approach to the Claude Code Setup for Graph‑Code MCP Server.” That reference implies the same *MCP (Model‑Control‑Plane) server* pattern used elsewhere in the codebase: a lightweight HTTP service that mediates between the client (the browser) and the back‑end LLM provider (Anthropic). The pattern is essentially a *proxy* that:

1. Accepts incoming SSE connections from the browser.  
2. Relays prompts or actions to the Anthropic API using the supplied `ANTHROPIC_API_KEY`.  
3. Streams back responses over the same SSE channel.

Because **BrowserAccessConfiguration** is the only artefact mentioned, the design decision is to keep the configuration surface minimal—only the three keys are required. This reduces the cognitive load on developers and operators and makes the component easy to spin up in varied environments (local dev, CI, production).

---

## Implementation Details  

Although no concrete code symbols were discovered, the implementation can be inferred from the README and the listed keys:

* **Port Binding** – At process start, the MCP server reads `BROWSER_ACCESS_PORT` (likely from the environment or a `.env` file) and binds an HTTP listener to that port. This is the entry point for all Browser Access traffic.  

* **SSE Endpoint** – The server registers a route matching `BROWSER_ACCESS_SSE_URL`. When a client issues a GET request to this URL, the server upgrades the connection to an SSE stream, keeping the HTTP connection open and pushing JSON‑encoded events as they become available.  

* **Anthropic Integration** – When the server receives a request that requires LLM processing (e.g., “fetch page content”, “execute JavaScript”), it uses the `ANTHROPIC_API_KEY` to authenticate calls to Anthropic’s API. The response payload is then transformed into SSE events and sent back to the browser client.  

* **Configuration Propagation** – Both **BrowserAccessComponent** and the top‑level **BrowserAccess** embed a **BrowserAccessConfiguration** instance. This suggests that the configuration object is constructed once (perhaps via a factory or a DI container) and then passed down the component tree, ensuring that all internal modules share identical runtime settings.

Because the README is the only source of truth, the implementation likely follows the same code path as the “Claude Code Setup for Graph‑Code MCP Server,” reusing existing server scaffolding, request handling, and SSE utilities.

---

## Integration Points  

**BrowserAccessConfiguration** sits at the intersection of three major subsystems:

1. **Network Layer** – The `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL` values are consumed by the HTTP server that hosts the MCP service. Any reverse‑proxy, load‑balancer, or container orchestrator must be aware of the port to route traffic correctly.  

2. **Anthropic LLM Provider** – The `ANTHROPIC_API_KEY` is the credential that enables the MCP server to call Anthropic’s models. The key is passed directly to the HTTP client used for LLM requests, making the configuration a critical security boundary.  

3. **Parent Components** – Since **BrowserAccessComponent** and **BrowserAccess** both contain a **BrowserAccessConfiguration**, changes to the configuration (e.g., switching ports for a staging environment) automatically propagate to every consumer of the Browser Access feature. This tight coupling ensures consistent behaviour across the component hierarchy.

The README also hints that the Browser Access MCP Server may be launched as a separate process or container, meaning that **BrowserAccessConfiguration** could be supplied via environment variables at container start‑up, aligning with typical DevOps practices.

---

## Usage Guidelines  

1. **Define All Three Keys** – Before launching the Browser Access MCP Server, ensure that `BROWSER_ACCESS_PORT`, `BROWSER_ACCESS_SSE_URL`, and `ANTHROPIC_API_KEY` are defined in the environment or a configuration file. Missing any of these will prevent the server from starting or from authenticating to Anthropic.  

2. **Port Coordination** – Choose a `BROWSER_ACCESS_PORT` that does not conflict with other services in the same host. When deploying to Kubernetes or Docker, map the container port to a host port explicitly to avoid accidental collisions.  

3. **SSE URL Consistency** – The `BROWSER_ACCESS_SSE_URL` must match the path the client code expects. If the client library is hard‑coded to `/sse`, configure the URL accordingly (e.g., `http://localhost:1234/sse`).  

4. **Secure the API Key** – Treat `ANTHROPIC_API_KEY` as a secret. Store it in a secret manager or a protected environment variable, and never commit it to source control. Rotate the key regularly according to Anthropic’s security recommendations.  

5. **Leverage Parent Configuration** – When modifying configuration values, do so at the level of **BrowserAccessConfiguration** within the parent **BrowserAccess** or **BrowserAccessComponent**. This guarantees that all downstream modules receive the updated settings without needing individual patches.

---

### Summary of Architectural Insights  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Architectural patterns identified** | Configuration‑driven service; MCP (Model‑Control‑Plane) server pattern; SSE‑based streaming. |
| **Design decisions and trade‑offs** | Minimal configuration surface (only three keys) → simplicity vs. limited flexibility; shared configuration object across parent and child components → consistency vs. tight coupling. |
| **System structure insights** | `BrowserAccessConfiguration` is instantiated once and injected into both `BrowserAccessComponent` and `BrowserAccess`; the MCP server reads this configuration to bind a port, expose an SSE endpoint, and authenticate to Anthropic. |
| **Scalability considerations** | Because the server is a single HTTP process bound to a specific port, scaling horizontally requires running multiple instances behind a load balancer, each with its own `BROWSER_ACCESS_PORT`. The SSE model works well for many concurrent browsers as long as the server can maintain open connections. |
| **Maintainability assessment** | High maintainability due to the tiny, well‑documented configuration contract. Changes are localized to the configuration object and the README. However, the tight coupling of configuration to both parent and child components means that any structural change to the component hierarchy will require careful propagation of the configuration object. |

These insights are directly grounded in the observations from `integrations/browser-access/README.md` and the listed configuration keys. No speculative patterns have been introduced beyond what the source material explicitly suggests.


## Hierarchy Context

### Parent
- [BrowserAccess](./BrowserAccess.md) -- BrowserAccess may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md


---

*Generated from 3 observations*

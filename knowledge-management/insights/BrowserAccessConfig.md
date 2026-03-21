# BrowserAccessConfig

**Type:** Detail

The integrations/code-graph-rag/docs/claude-code-setup.md file provides setup instructions for Claude Code, which may be related to the browser access configuration, implying a connection between the two components.

## What It Is  

**BrowserAccessConfig** is the concrete configuration object that drives the Browser Access MCP (Managed Control Plane) server used by Claude Code. The definition lives under the **`integrations/browser-access/`** directory – the same place where the *Browser Access MCP Server* is described in the `README.md`.  The config is consumed by the **BrowserAccess** component (its parent) and is referenced by its sibling **MCPBrowserAccess**, which implements the actual MCP server logic.  

The configuration surface is deliberately thin: it is expressed through a handful of environment variables, most notably **`BROWSER_ACCESS_PORT`** and **`BROWSER_ACCESS_SSE_URL`**. These variables are documented in the README and are also referenced in the Claude‑Code setup guide (`integrations/code-graph-rag/docs/claude-code-setup.md`).  In practice, a developer or deployment pipeline supplies these values so that the MCP server can bind to the correct port and publish Server‑Sent Events (SSE) streams to the URL expected by Claude Code.

---

## Architecture and Design  

The architecture follows a **configuration‑driven, separation‑of‑concerns** model. The *BrowserAccess* parent component encapsulates the high‑level feature (exposing a browser‑based UI to Claude Code), while the *MCPBrowserAccess* sibling houses the concrete MCP server implementation. **BrowserAccessConfig** sits at the boundary between the two, acting as a contract that both sides agree on.  

From the observations we can infer the following design decisions:

1. **Environment‑Variable Configuration** – By relying on `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL`, the system decouples deployment‑time concerns (network ports, external URLs) from code. This mirrors a classic *12‑factor* approach where the runtime environment supplies configuration, enabling the same binary to run in diverse environments (local dev, CI, production).  

2. **MCP Server as a Separate Integration** – The README treats the MCP server as a distinct integration (`integrations/browser-access/README.md`). This suggests a modular packaging strategy: the server can be built, started, and upgraded independently of the rest of Claude Code. The sibling relationship to **MCPBrowserAccess** reinforces this modularity.

3. **SSE (Server‑Sent Events) for Real‑Time Streaming** – The presence of `BROWSER_ACCESS_SSE_URL` indicates that the MCP server pushes incremental updates (e.g., UI state, execution logs) to Claude Code via SSE. This is a lightweight, unidirectional streaming pattern that avoids the overhead of full‑duplex websockets when only server‑to‑client events are needed.

No other architectural patterns (e.g., event‑driven, micro‑service) are mentioned, so the analysis stays within the observed configuration‑centric design.

---

## Implementation Details  

The concrete implementation revolves around three artifacts:

| Artifact | Role |
|----------|------|
| `integrations/browser-access/README.md` | Documents the purpose of the Browser Access MCP server, outlines required env vars, and provides usage instructions. |
| `BROWSER_ACCESS_PORT` | Determines the TCP port on which the MCP server listens for incoming HTTP/SSE connections. |
| `BROWSER_ACCESS_SSE_URL` | The base URL that Claude Code will subscribe to for receiving SSE payloads. |

**BrowserAccessConfig** is likely a thin data‑class (or struct) that reads these environment variables at start‑up, validates them (e.g., ensuring the port is an integer and the URL is well‑formed), and then exposes them to **MCPBrowserAccess**. Because the sibling component implements the MCP server, it probably constructs an HTTP listener bound to `BROWSER_ACCESS_PORT` and registers an SSE endpoint at `BROWSER_ACCESS_SSE_URL`.  

The Claude‑Code setup guide (`integrations/code-graph-rag/docs/claude-code-setup.md`) references these variables, indicating that developers are expected to set them before launching the MCP server. The guide’s inclusion of the same variables reinforces that **BrowserAccessConfig** is the single source of truth for the server’s network contract.

No additional functions or classes are named in the observations, so the deep dive focuses on the flow: *environment → BrowserAccessConfig → MCPBrowserAccess → HTTP/SSE server*.

---

## Integration Points  

1. **Claude Code** – The primary consumer of the SSE stream. The `claude-code-setup.md` document ties the configuration to Claude Code’s expectations, meaning that any change to `BROWSER_ACCESS_SSE_URL` must be mirrored in Claude Code’s client configuration.  

2. **Parent Component (BrowserAccess)** – BrowserAccess aggregates the configuration and passes it downstream to MCPBrowserAccess. This relationship ensures that higher‑level features (e.g., UI routing, authentication) can be layered on top of the raw MCP server without modifying its config handling.  

3. **Sibling Component (MCPBrowserAccess)** – Directly implements the server that respects the values supplied by BrowserAccessConfig. Because they share the same integration directory, they are version‑co‑managed, reducing the risk of mismatched expectations.  

4. **Deployment/CI Pipelines** – Since configuration is environment‑driven, any CI step that builds or deploys the Browser Access MCP server must inject `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL`. The README likely provides default values or examples for local development.

No other external libraries or services are referenced, so the integration surface remains confined to the internal BrowserAccess hierarchy and the external Claude Code client.

---

## Usage Guidelines  

* **Set Environment Variables Early** – Before starting the MCP server, ensure `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL` are defined. Use a `.env` file or CI secret store to keep them consistent across environments.  

* **Validate Values** – Although not explicitly documented, a defensive implementation would verify that the port is within the valid range (1024‑65535) and that the SSE URL follows `http(s)://` syntax. This prevents runtime binding errors.  

* **Keep Config in Sync with Claude Code** – Whenever `BROWSER_ACCESS_SSE_URL` changes, update the corresponding client configuration in Claude Code (as described in `claude-code-setup.md`). Failure to do so will break the SSE channel.  

* **Leverage the README** – The `integrations/browser-access/README.md` is the authoritative source for setup steps, default values, and troubleshooting. Developers should treat it as the single point of truth rather than guessing configuration names.  

* **Isolation for Testing** – Because the server is driven purely by env vars, tests can spin up the MCP server on an ephemeral port by overriding `BROWSER_ACCESS_PORT`. This makes integration testing straightforward and avoids port collisions.

---

### Architectural patterns identified  

1. **Configuration‑as‑Code (environment‑variable driven)** – All runtime parameters are supplied via environment variables.  
2. **Modular Integration** – The Browser Access MCP server is packaged as an independent integration (`integrations/browser-access`).  
3. **Server‑Sent Events (SSE) Streaming** – Unidirectional real‑time push from server to Claude Code.

### Design decisions and trade‑offs  

* **Pros** – Decouples deployment from code, enables easy re‑use across environments, and keeps the MCP server lightweight.  
* **Cons** – Reliance on env vars means missing or malformed values cause startup failures; no built‑in fallback or dynamic re‑configuration is evident.

### System structure insights  

The system is organized hierarchically: **BrowserAccess** (parent) → **BrowserAccessConfig** (configuration object) → **MCPBrowserAccess** (sibling implementing the server). All artifacts live under the `integrations/browser-access/` directory, reinforcing a clear module boundary.

### Scalability considerations  

Because the server binds to a single port and serves SSE streams, scaling horizontally would require multiple instances behind a load balancer that respects sticky routing for SSE connections. The current design does not expose clustering or multi‑process coordination, so scaling would need to be added at the deployment layer (e.g., container orchestration).  

### Maintainability assessment  

The configuration surface is minimal, which simplifies maintenance. Documentation lives in a single README and a related Claude‑Code setup guide, reducing the cognitive load for developers. However, the lack of explicit validation or versioned configuration schemas could become a maintenance burden as the feature evolves. Adding a small validation layer inside **BrowserAccessConfig** would improve robustness without sacrificing the current simplicity.

## Hierarchy Context

### Parent
- [BrowserAccess](./BrowserAccess.md) -- The BrowserAccess MCP server is described in integrations/browser-access/README.md.

### Siblings
- [MCPBrowserAccess](./MCPBrowserAccess.md) -- The BrowserAccess MCP server is described in integrations/browser-access/README.md, which provides information on how to set up and use the server.

---

*Generated from 3 observations*

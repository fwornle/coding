# MCPBrowserAccess

**Type:** Detail

The BROWSER_ACCESS_PORT and BROWSER_ACCESS_SSE_URL environment variables are mentioned in the project documentation, indicating their importance in configuring the BrowserAccess sub-component.

## What It Is  

**MCPBrowserAccess** is the concrete implementation of the Browser Access capability inside the **BrowserAccess** integration. The source of truth for its purpose and setup lives in the markdown file **`integrations/browser-access/README.md`**. This README describes the *Browser Access MCP server* – the service that powers the “browser‑access” sub‑component for Claude Code – and lists the two environment variables that drive its runtime behaviour: **`BROWSER_ACCESS_PORT`** and **`BROWSER_ACCESS_SSE_URL`**.  

In the component hierarchy, **MCPBrowserAccess** is a child of the top‑level **BrowserAccess** component. Its sibling, **BrowserAccessConfig**, is referenced in the same README as the primary configuration surface for the Browser Access MCP server. Thus, MCPBrowserAccess represents the executable server logic while BrowserAccessConfig encapsulates the configuration values that the server consumes.

---

## Architecture and Design  

The architecture that can be inferred from the observations is a **configuration‑driven server** model. The design isolates the runtime concerns of the Browser Access MCP server (the **MCPBrowserAccess** process) from the rest of the system by exposing only two environment variables:

1. **`BROWSER_ACCESS_PORT`** – determines the network port on which the MCP server listens for incoming HTTP/SSE connections.  
2. **`BROWSER_ACCESS_SSE_URL`** – specifies the URL endpoint used for Server‑Sent Events (SSE) communication, which is the transport mechanism for pushing browser‑side updates back to Claude Code.

Because the README is the sole source of information, the architecture leans heavily on **environment‑variable configuration** rather than hard‑coded values or complex service‑discovery mechanisms. The parent **BrowserAccess** component likely orchestrates the launch of the MCP server, while the sibling **BrowserAccessConfig** aggregates the required environment variables into a coherent configuration object that MCPBrowserAccess consumes at start‑up.

No explicit design patterns such as micro‑services, event‑driven pipelines, or dependency injection are mentioned; the observed pattern is simply **“configuration‑as‑code”** where the server’s behaviour is dictated by external configuration supplied at deployment time.

---

## Implementation Details  

The implementation details are sparse, but the following points are concrete:

* **Location of documentation** – All operational guidance is stored in **`integrations/browser-access/README.md`**. This file explains how to start the Browser Access MCP server, which environment variables must be set, and what role the server plays within the larger Claude Code ecosystem.  

* **Environment‑variable interface** – The server reads **`BROWSER_ACCESS_PORT`** to bind its listening socket. This allows the same binary to be deployed in different network contexts (e.g., local development vs. containerised production) without code changes.  

* **SSE endpoint configuration** – By exposing **`BROWSER_ACCESS_SSE_URL`**, the server can be pointed at any SSE consumer that conforms to the expected protocol. The URL is likely parsed at start‑up and used to open a persistent HTTP connection that streams events to the client.  

* **Parent‑child relationship** – The parent component **BrowserAccess** probably includes a launch script or orchestration layer that sets the environment variables, then invokes the MCP server binary (the concrete implementation of **MCPBrowserAccess**). The sibling **BrowserAccessConfig** is the place where these variables are defined, possibly in a `.env` file or a CI/CD pipeline configuration.

Because no code symbols were discovered, we cannot cite concrete class or function names. The observable implementation surface is limited to the README and the two environment variables that act as the public API of the component.

---

## Integration Points  

The primary integration surface for **MCPBrowserAccess** is the **environment‑variable contract** described in the README. Any system that needs to interact with the Browser Access MCP server must:

1. **Set `BROWSER_ACCESS_PORT`** – ensuring that the server is reachable on a known port for HTTP/SSE traffic.  
2. **Set `BROWSER_ACCESS_SSE_URL`** – providing the endpoint that the server will use to emit SSE messages.  

These variables are likely consumed by the server at process start‑up, meaning that the integration is performed **outside of the codebase** (e.g., in Docker compose files, Kubernetes manifests, or local development scripts). The sibling **BrowserAccessConfig** component probably centralises these values, making it the single source of truth for any downstream component that needs to know the port or SSE endpoint.

Because the README mentions “Browser Access MCP Server for Claude Code,” we can infer that the server’s output is consumed by the Claude Code front‑end or a related service that interprets the SSE stream. The integration is therefore **unidirectional**: the MCP server pushes events, while the consumer subscribes to them.

---

## Usage Guidelines  

* **Always define both environment variables** before starting the MCP server. Missing either variable will likely cause the server to abort or listen on a default port that may clash with other services.  

* **Prefer externalised configuration** (e.g., `.env` files, CI/CD variable stores) rather than hard‑coding values. This aligns with the design decision observed in the README and keeps the server portable across environments.  

* **Keep the README (`integrations/browser-access/README.md`) up‑to‑date**. Since it is the sole documentation source, any change to the configuration contract (e.g., adding new variables) must be reflected there to avoid breaking downstream consumers.  

* **Validate the SSE URL** before deployment. Because the server will open a persistent connection to this URL, an incorrect or unreachable endpoint will result in runtime errors that are difficult to diagnose without proper logging.  

* **Monitor the port** specified by `BROWSER_ACCESS_PORT` for conflicts. In containerised deployments, expose the port explicitly in the container definition to avoid accidental binding to an unexpected host port.

---

### Architectural patterns identified
* Configuration‑as‑code via environment variables  
* Parent‑child component composition (BrowserAccess → MCPBrowserAccess)  

### Design decisions and trade‑offs
* **Decision**: Use environment variables for all runtime configuration, avoiding hard‑coded values.  
* **Trade‑off**: Simplicity and portability are gained, but discoverability relies entirely on external documentation (the README).  

### System structure insights
* **Parent** – BrowserAccess orchestrates the MCP server.  
* **Sibling** – BrowserAccessConfig aggregates configuration values.  
* **Child** – MCPBrowserAccess is the concrete server implementation that consumes the configuration.  

### Scalability considerations
* The server’s scalability hinges on the ability to run multiple instances on different ports (controlled by `BROWSER_ACCESS_PORT`).  
* SSE scaling depends on the underlying HTTP server and the load on the `BROWSER_ACCESS_SSE_URL` endpoint; no built‑in load‑balancing is described.  

### Maintainability assessment
* **Strengths**: Single source of truth (README) and simple env‑var configuration make onboarding straightforward.  
* **Weaknesses**: Lack of visible code symbols or internal documentation limits static analysis; any change to the contract must be manually propagated to the README and any deployment scripts.  

Overall, **MCPBrowserAccess** follows a minimalistic, configuration‑driven design that is easy to deploy but places a heavy reliance on accurate external documentation and disciplined environment management.


## Hierarchy Context

### Parent
- [BrowserAccess](./BrowserAccess.md) -- The BrowserAccess MCP server is described in integrations/browser-access/README.md.

### Siblings
- [BrowserAccessConfig](./BrowserAccessConfig.md) -- The integrations/browser-access/README.md file mentions the Browser Access MCP Server for Claude Code, indicating a key configuration point for browser access.


---

*Generated from 3 observations*

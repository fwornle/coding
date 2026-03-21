# BrowserAccessMcpServer

**Type:** Detail

The integrations/browser-access/README.md file serves as a central location for information about the Browser Access MCP Server, implying that it is a notable aspect of the Integrations sub-component.

## What It Is  

The **BrowserAccessMcpServer** is implemented under the **Integrations** umbrella, with its primary documentation located at `integrations/browser-access/README.md`.  The README identifies the component as the *Browser Access MCP Server for Claude Code*, describing its purpose as a dedicated server that enables browser‑based access to the Claude Code MCP (Message‑Control‑Protocol) services.  Two explicit configuration points are highlighted in the documentation: `BROWSER_ACCESS_PORT` – the TCP port on which the server listens – and `BROWSER_ACCESS_SSE_URL` – the URL used for Server‑Sent Events (SSE) communication.  Because the README is the sole source of truth in the provided observations, it serves both as the technical description and the entry point for developers seeking to understand or modify the server.

## Architecture and Design  

From the observations we can infer a **configuration‑driven server architecture**.  The presence of `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL` indicates that the server’s runtime behavior is controlled via environment variables (or a similar configuration mechanism).  This design isolates deployment‑specific details (network port, SSE endpoint) from the code itself, allowing the same binary to be reused across development, testing, and production environments without code changes.

The server appears to adopt a **single‑purpose integration pattern** within the broader *Integrations* component.  Rather than being a monolithic service that handles many unrelated responsibilities, BrowserAccessMcpServer is scoped to the browser‑access use‑case, keeping its responsibilities narrow and well‑defined.  The naming of `SSE_URL` suggests that the server leverages **Server‑Sent Events** to push real‑time updates to connected browsers, a pattern that fits the “push‑notification” style of interaction typical for browser‑based tooling.

Interaction between components is likely **request‑response over HTTP** for the initial handshake (listening on `BROWSER_ACCESS_PORT`) followed by an **asynchronous SSE stream** to deliver ongoing messages.  Because the README is the only documented artifact, the exact wiring (e.g., whether an HTTP framework like Express, FastAPI, or a custom socket handler is used) cannot be confirmed, but the architectural intent—exposing a port and an SSE endpoint—is clear.

## Implementation Details  

The concrete implementation details are limited to the two configuration keys mentioned in the README:

* **`BROWSER_ACCESS_PORT`** – defines the network port on which the MCP server binds.  This is the entry point for client browsers to establish an HTTP connection.
* **`BROWSER_ACCESS_SSE_URL`** – specifies the URL that browsers should subscribe to for Server‑Sent Events.  This URL is probably constructed from the host/port combination and a fixed path (e.g., `/events`), though the exact path is not disclosed.

Given the naming convention, the server most likely follows these steps internally:

1. **Startup** – reads `BROWSER_ACCESS_PORT` from the environment (or a config file) and starts an HTTP listener.
2. **Endpoint Registration** – registers an SSE endpoint at the path derived from `BROWSER_ACCESS_SSE_URL`.  When a browser connects, the server establishes an SSE stream and keeps the connection open.
3. **Message Dispatch** – as MCP messages are generated elsewhere in the system, the server pushes them into the open SSE stream, enabling real‑time updates in the browser UI.

Because no class or function names are present in the observations, we cannot cite specific source files beyond the README location.  The design choice to keep configuration external to code suggests that the server’s core logic is encapsulated in a small, self‑contained module that can be started with a single command (e.g., `node server.js` or `python -m browser_access`), but the exact runtime language or framework is not disclosed.

## Integration Points  

BrowserAccessMcpServer lives under the **Integrations** parent component, implying that it is one of several integration adapters provided by the repository.  Its primary integration points are:

* **External Clients (Browsers)** – browsers connect to the server using the port defined by `BROWSER_ACCESS_PORT` and subscribe to the SSE stream at `BROWSER_ACCESS_SSE_URL`.  This is the public API surface of the component.
* **MCP Message Producer** – although not explicitly documented, the server must receive MCP messages from elsewhere in the system (e.g., from Claude Code’s core engine).  This internal dependency is likely satisfied via an in‑process queue, a message broker, or direct function calls, but the exact mechanism is not observable in the current data.
* **Configuration System** – the server relies on the environment or a configuration loader to obtain `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL`.  Any deployment tooling that sets these variables (Docker compose, Kubernetes ConfigMaps, CI pipelines) constitutes an integration point.

Because the README is the central source of truth, developers looking to integrate new functionality should first extend or reference this documentation rather than altering the server’s core code without a clear contract.

## Usage Guidelines  

1. **Set Configuration Before Launch** – always define `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL` in the environment (or via a supported config file) prior to starting the server.  Missing values will prevent the server from binding correctly or exposing the SSE endpoint.
2. **Consistent Naming** – retain the exact variable names (`BROWSER_ACCESS_PORT`, `BROWSER_ACCESS_SSE_URL`) when adding new deployment scripts or CI pipelines.  Changing these identifiers would break the contract established by the README.
3. **Deploy Within the Integrations Namespace** – treat BrowserAccessMcpServer as a sibling to other integration servers.  Shared conventions (logging format, health‑check endpoints) should be mirrored across the Integrations component to maintain uniformity.
4. **Monitor SSE Connections** – because SSE holds long‑lived HTTP connections, ensure that the hosting environment (load balancer, reverse proxy) is configured to allow sufficient timeout and keep‑alive settings.
5. **Reference the README** – any change to the server’s runtime behavior (e.g., adding a new endpoint, altering the SSE payload format) must be documented in `integrations/browser-access/README.md` to keep the central source of truth up to date.

---

### 1. Architectural patterns identified  
* **Configuration‑driven server** – behavior is controlled via `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL`.  
* **Single‑purpose integration** – a focused server dedicated to browser‑based MCP access.  
* **Server‑Sent Events (SSE) push model** – real‑time, uni‑directional streaming from server to browser.

### 2. Design decisions and trade‑offs  
* **Explicit environment variables** simplify deployment and allow the same binary to run in varied contexts, at the cost of requiring external configuration management.  
* **SSE over WebSockets** reduces protocol complexity and works well for fire‑and‑forget updates, but may be less suitable for bidirectional communication.  
* **Isolation in the Integrations component** keeps the codebase modular, but introduces a dependency on the broader MCP message source that is not documented here.

### 3. System structure insights  
* The **Integrations** parent groups together multiple adapters; BrowserAccessMcpServer is one such adapter, documented centrally in `integrations/browser-access/README.md`.  
* No child modules are listed, suggesting the server is a leaf node in the hierarchy with no further sub‑components exposed in the current observations.

### 4. Scalability considerations  
* Because the server binds to a single port, horizontal scaling would require multiple instances behind a load balancer, each with its own `BROWSER_ACCESS_PORT`.  
* SSE streams are long‑lived; scaling out must account for the number of concurrent connections each instance can sustain.  The configuration‑driven design makes it straightforward to spin up additional instances with distinct ports.

### 5. Maintainability assessment  
* **High maintainability** in the sense that configuration is externalized and the README serves as a single source of truth.  
* **Potential risk** stems from the lack of visible source code or test artifacts in the observations; future contributors must locate the actual implementation files (outside the provided README) to make code changes.  Keeping the README up‑to‑date is therefore critical to preserving maintainability.

## Hierarchy Context

### Parent
- [Integrations](./Integrations.md) -- The integrations/browser-access/README.md file describes the browser access MCP server, which is an example of an integration

---

*Generated from 3 observations*

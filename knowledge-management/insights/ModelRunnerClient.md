# ModelRunnerClient

**Type:** Detail

In a typical implementation, the ModelRunnerClient would likely be defined in a separate module or class, such as lib/llm/model-runner-client.ts, to maintain a clean separation of concerns.

## What It Is  

The **ModelRunnerClient** is the concrete abstraction that mediates all interactions with the Model Runner container ecosystem.  According to the observations it lives in its own source file – `lib/llm/model-runner-client.ts` – so that the higher‑level **DMRProviderModule** (found in `lib/llm/dmr-provider-module.ts`) can delegate Docker‑related work to a dedicated client rather than embedding Docker calls directly.  In practice the client is expected to expose operations such as *createContainer*, *startContainer* and *stopContainer* that wrap the underlying Docker API used by the DMRProviderModule.  By centralising these responsibilities the codebase keeps a clean separation between “what the DMR provider needs” (model‑runner lifecycle management) and “how it is achieved” (Docker API calls).

## Architecture and Design  

The architecture follows a **thin‑module / client‑wrapper** style.  The `DMRProviderModule` is the consumer of model‑runner services, while the `ModelRunnerClient` acts as a **facade** over the Docker SDK.  This façade pattern is evident from the description that the client “handles tasks such as creating, starting, and stopping model runner containers.”  The client therefore shields the rest of the system from the low‑level Docker details (socket handling, image pulling, container options, error mapping, etc.) and presents a small, purpose‑built API surface.

Because the client is placed in its own module (`lib/llm/model-runner-client.ts`), the design also reflects **separation of concerns**: Docker‑specific logic is isolated from the business logic of the DMR provider.  This makes the DMRProviderModule easier to test – a mock implementation of `ModelRunnerClient` can be injected – and it also prepares the codebase for future substitution (e.g., swapping Docker for another container runtime) without touching the provider’s core.

The only explicit dependency mentioned is the Docker API client, which the `ModelRunnerClient` wraps.  No additional architectural patterns (such as micro‑services or event‑driven messaging) are introduced in the observations, so the design stays within a single‑process, library‑level interaction model.

## Implementation Details  

Although the source code is not provided, the observations give a clear picture of the expected implementation shape:

* **File location** – `lib/llm/model-runner-client.ts`.  The file is likely to export a class named `ModelRunnerClient` (or a similarly named object) that encapsulates Docker SDK calls.
* **Core responsibilities** – The client will expose methods that correspond to the lifecycle of a model‑runner container:
  * `createContainer(image: string, options: DockerContainerOptions): Promise<ContainerId>`
  * `startContainer(id: ContainerId): Promise<void>`
  * `stopContainer(id: ContainerId): Promise<void>`
  * Possibly auxiliary helpers such as `removeContainer`, `inspectContainer`, or `listRunningContainers`.
* **Docker API integration** – Internally the client will instantiate the Docker SDK (e.g., `dockerode` or the official Docker client library) and translate the high‑level method calls into SDK calls like `docker.createContainer`, `container.start`, and `container.stop`.  Error handling will be normalised so that callers (the DMRProviderModule) receive consistent exceptions rather than raw Docker errors.
* **Configuration** – The client may read Docker connection settings (socket path, host/port, TLS options) from environment variables or a configuration object supplied by the DMRProviderModule.  This keeps the client flexible across development, CI, and production environments.
* **Export contract** – The module likely exports the client class as the default export or as a named export, enabling the DMRProviderModule to import it with a simple statement such as `import { ModelRunnerClient } from './model-runner-client'`.

Because the DMRProviderModule already “uses a Docker API client to interact with the Model Runner,” the `ModelRunnerClient` is the logical place where that usage is encapsulated, providing a clean, typed interface for the rest of the codebase.

## Integration Points  

The **primary integration point** is the **DMRProviderModule** (`lib/llm/dmr-provider-module.ts`).  The provider imports `ModelRunnerClient` and invokes its methods whenever a model‑runner container must be provisioned, started for inference, or torn down after use.  This creates a one‑to‑one dependency direction: the provider depends on the client, but the client does not depend on the provider, preserving a clean dependency graph.

Other potential integration points, inferred from the client’s responsibilities, include:

* **Configuration layer** – A central configuration service or environment file that supplies Docker connection details to the client.
* **Logging / monitoring** – The client may emit structured logs (container IDs, lifecycle events) that downstream observability tools consume.
* **Testing harnesses** – Unit tests for the DMRProviderModule can replace `ModelRunnerClient` with a mock that simulates container lifecycle without invoking Docker, reinforcing test isolation.

No sibling modules are explicitly mentioned, so the client’s interaction surface is limited to the provider and the Docker runtime.

## Usage Guidelines  

1. **Instantiate Once, Reuse** – Create a single `ModelRunnerClient` instance per application lifetime (or per DMRProviderModule instance) and reuse it for all container operations.  This avoids repeated Docker SDK initialization and preserves connection pooling.
2. **Handle Errors Gracefully** – The client should translate Docker errors into domain‑specific exceptions (e.g., `ModelRunnerCreationError`).  Callers must catch these and implement retry or fallback logic where appropriate.
3. **Respect Container Idempotency** – Before creating a new container, the provider may query the client to see if a suitable container already exists (e.g., via a `listRunningContainers` helper).  This reduces unnecessary container churn.
4. **Clean Up Resources** – Always invoke the client’s stop/remove methods when a model runner is no longer needed.  Leaking containers can quickly exhaust host resources.
5. **Configuration Consistency** – Ensure the Docker connection settings used by the client match those expected by the host environment (socket path on Linux, TCP endpoint on Windows, TLS certificates if required).  Misconfiguration will surface as connection failures at runtime.

---

### Architectural patterns identified  

* **Facade / Wrapper** – `ModelRunnerClient` abstracts the Docker SDK behind a purpose‑built API.  
* **Separation of Concerns** – Docker‑specific logic lives in its own module, distinct from the DMR provider’s business logic.  

### Design decisions and trade‑offs  

* **Explicit client module** – Improves testability and future replaceability but adds an extra abstraction layer that developers must understand.  
* **Container‑lifecycle focus** – Limiting the client to creation, start, and stop keeps the API small, but any additional Docker features (networking, volume management) would require extending the client or adding a new helper.  

### System structure insights  

* The system is organized around a **provider → client → Docker** stack.  
* All model‑runner interactions funnel through `ModelRunnerClient`, centralising Docker error handling and configuration.  

### Scalability considerations  

* Because the client is a thin wrapper, scaling the number of concurrent model‑runner containers is primarily a Docker host concern.  
* The client can be extended to support connection pooling or parallel API calls if the provider begins to launch many containers simultaneously.  

### Maintainability assessment  

* **High maintainability** – The clear module boundary and façade pattern make the codebase easy to reason about.  
* **Low coupling** – The DMRProviderModule depends only on the client’s stable interface, allowing independent evolution.  
* **Testability** – Mockable client interface enables unit tests for the provider without requiring Docker, further improving maintainability.  

Overall, the `ModelRunnerClient` provides a focused, well‑encapsulated bridge between the DMRProviderModule and the Docker runtime, aligning with clean‑code principles while keeping the system ready for future extensions.


## Hierarchy Context

### Parent
- [DMRProviderModule](./DMRProviderModule.md) -- The DMRProviderModule uses a Docker API client to interact with the Model Runner, as seen in lib/llm/dmr-provider-module.ts.


---

*Generated from 3 observations*

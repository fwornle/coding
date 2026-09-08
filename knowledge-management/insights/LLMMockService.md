# LLMMockService

**Type:** SubComponent

integrations/semantic-analysis/src/mock/llm-mock-service.ts implements mode management supporting 'mock', 'local', and 'public' LLM call routing

# LLMMockService — Technical Insight Document

## What It Is

LLMMockService is implemented in `integrations/semantic-analysis/src/mock/llm-mock-service.ts`, where it provides mode management for routing LLM calls between three distinct modes: 'mock', 'local', and 'public'. It exists specifically to decouple services—most notably the semantic analysis MCP—from real LLM providers during testing, enabling deterministic, cost-free, network-independent test execution in CI and Docker environments. As a SubComponent, it lives within the broader LLMAbstraction grouping while also being wrapped by the DockerizedServices layer, reflecting its dual role as both an LLM interface concern and a containerization/testing concern.

## Architecture and Design

The core architectural pattern here is a mode-switching facade over LLM invocation. Rather than services calling LLM providers directly, calls are routed through LLMMockService, which resolves the active mode and either intercepts the call with a mock response or passes it through to a local or public backend. This resolution responsibility is delegated to its child component, GetLLMMode, a dedicated function governing which routing path is taken—keeping mode-detection logic isolated from response-generation logic.

A key design decision is driving mock responses from a shared `workflow-progress.json` state file rather than hardcoded stubs or random generation. This allows mock behavior to remain deterministic and reproducible across test runs, which is essential for CI pipelines where flaky LLM-dependent tests would be unacceptable.

![LLMMockService — Architecture](images/llmmock-service-architecture.png)

Another notable trade-off is the explicit decoupling of mock behavior from `CODING_ROOT`. Since this environment variable can differ between host and container execution contexts, the service avoids hard dependencies on absolute path resolution tied to `CODING_ROOT`, instead relying on the shared state file mechanism—mirroring the CODING_REPO-relative path resolution pattern used by sibling ServiceWrapperScripts (api-service.js, dashboard-service.js).

## Implementation Details

The mode-switching logic likely inspects environment variables (in a style similar to `LLM_PROXY_URL`-based configuration) to determine at runtime whether to intercept calls with mocks or forward them to real backends. This environment-driven configuration approach is consistent with the broader DockerizedServices philosophy of supporting both containerized and standalone host execution without code changes.

GetLLMMode, as a child component, encapsulates the actual mode-resolution function referenced by the parent's mode-management responsibility. This separation suggests a clean internal structure: LLMMockService acts as the orchestrating module, while GetLLMMode handles the narrower decision logic of which of the three modes ('mock', 'local', 'public') is currently active.

## Integration Points

LLMMockService sits at the intersection of two containment hierarchies: it is contained by LLMAbstraction (its logical domain) and by DockerizedServices (its operational context). Within DockerizedServices, it complements sibling components like ServiceStarter, ServiceProbe, ProcessStateManager, HealthCoordinator, and ServiceWrapperScripts, all of which address reliability and lifecycle concerns for services running in Docker or as standalone processes. While those siblings focus on process startup, health verification, and lifecycle registration, LLMMockService addresses a different reliability concern: making LLM-dependent services testable without external dependencies.

![LLMMockService — Relationship](images/llmmock-service-relationship.png)

Its primary integration consumer is the semantic analysis MCP, which relies on mock mode to avoid cost and network dependency during testing. The shared `workflow-progress.json` file acts as an implicit integration contract—any test harness or CI process must ensure this state file is present and correctly formatted for deterministic mocking to function.

## Usage Guidelines

Developers should be aware that switching between 'mock', 'local', and 'public' modes is likely controlled through environment configuration rather than code changes, so test and CI environments should explicitly set the relevant variables to guarantee mock routing is engaged. When writing tests against services that depend on LLM calls, rely on the `workflow-progress.json` state file conventions rather than assuming arbitrary or random mock output—this ensures reproducibility. Additionally, because path resolution differences between host and container (`CODING_ROOT`) were an explicit motivation for this design, developers should avoid reintroducing hard-coded root-path assumptions into mock logic, preserving the portability this service was designed to achieve.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and process-management layer that wraps Coding's various services (semantic analysis MCP, constraint monitor API/dashboard, graphify, LLM services) so they can run reliably both inside Docker containers and as standalone Node processes managed by a Global Service Coordinator. The layer combines Docker artifacts (docker-compose.yml, Dockerfile.coding-services, supervisord.conf, entrypoint.sh) with a set of Node.js wrapper scripts (api-service.js, dashboard-service.js) that spawn actual backend processes, forward signals, and register/unregister with a ProcessStateManager (PSM) for lifecycle tracking.

A core architectural pattern is robust startup with retry/backoff and health verification, implemented in lib/service-starter.js's startServiceWithRetry(), which wraps a start function and a health-check function with timeouts (via withDeadline) and exponential backoff, distinguishing required vs optional services for graceful degradation. Complementing this, lib/utils/service-probe.js implements liveness probes (probeHttpHealth, probeTcpPort) used by scripts/health-coordinator.js to poll services every 5 seconds per config/health-verification-rules.json, strictly avoiding false-positive 'healthy' states per its SPEC R6 invariant.

Service wrappers such as api-service.js and dashboard-service.js follow a consistent pattern: resolve CODING_REPO-relative paths, verify target files/directories exist, spawn the real process with stdio inherited, forward SIGTERM/SIGINT, and asynchronously register/unregister with ProcessStateManager for centralized process tracking across the dockerized/global service fleet. Mock-mode support (llm-mock-service.ts) allows service behavior (LLM calls) to be swapped for deterministic mocks driven by a shared workflow-progress.json state file, aiding testing inside containers where CODING_ROOT may differ from host paths.

### Children
- [GetLLMMode](./GetLLMMode.md) -- The L2 description states llm-mock-service.ts 'implements mode management supporting mock, local, and public LLM call routing', indicating a dedicated resolution function governs this behavior.

### Siblings
- [ServiceStarter](./ServiceStarter.md) -- startServiceWithRetry() in lib/service-starter.js wraps a caller-supplied start function and health-check function, retrying with exponential backoff on failure
- [ServiceProbe](./ServiceProbe.md) -- probeHttpHealth() in lib/utils/service-probe.js issues HTTP requests to a service's health endpoint and interprets response codes/timeouts
- [ProcessStateManager](./ProcessStateManager.md) -- scripts/process-state-manager.js exposes register/unregister operations called asynchronously by wrapper scripts like api-service.js and dashboard-service.js
- [HealthCoordinator](./HealthCoordinator.md) -- scripts/health-coordinator.js polls services every 5 seconds, using probeHttpHealth() and probeTcpPort() from lib/utils/service-probe.js
- [ServiceWrapperScripts](./ServiceWrapperScripts.md) -- api-service.js and dashboard-service.js resolve CODING_REPO-relative paths before spawning target processes, supporting both container and host execution


---

*Generated from 5 observations*

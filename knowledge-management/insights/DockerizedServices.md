# DockerizedServices

**Type:** Component

[LLM] docker/docker-compose.yml defines Memgraph and Redis as dependency services with the full coding services container depending on their health checks before starting. The bind mount architecture — mounting the host repository into containers at /coding — means the Docker deployment is not a self-contained artifact: it requires the host filesystem to be the live Coding repository checkout. This makes the Docker Compose stack suitable for development and CI use cases where the repository is always present, but unsuitable for standalone production deployment where images should be self-contained. The environment variable bridging (CODING_REPO, OPENAI_API_KEY, ANTHROPIC_API_KEY, DOCKER_TIMEOUT, and others documented in CLAUDE.md) flows from host shell environment into containers via the `environment:` stanza in docker-compose.yml, meaning secrets are never baked into images but must be present in the host environment before `docker compose up` is invoked. The DOCKER_TIMEOUT variable specifically controls service startup timeout behavior, allowing CI environments with slower disk I/O to extend probe patience without code changes.

# DockerizedServices

## What It Is

DockerizedServices is the container orchestration and service lifecycle management layer of the Coding project, implemented across `docker/Dockerfile.coding-services`, `docker/supervisord.conf`, `docker/docker-compose.yml`, `lib/service-starter.js`, and `lib/utils/service-probe.js`. It provides the runtime environment for co-located services — the semantic analysis MCP server (part of SemanticAnalysis), the constraint monitor API (`scripts/api-service.js`), and the dashboard (`scripts/dashboard-service.js`) — along with the infrastructure to start, probe, and supervise them reliably. Two child components formalize the reusable pieces: ServiceStarterFramework (`lib/service-starter.js`) and ServiceProbeLibrary (`lib/utils/service-probe.js`).

## Architecture and Design

![DockerizedServices — Architecture](images/dockerized-services-architecture.png)

The defining architectural choice is **co-location under supervisord** rather than one-process-per-container. `docker/supervisord.conf` configures supervisord as the container's init process (after an entrypoint script handles sequencing), and all long-running services run as supervised children within the single container defined by `docker/Dockerfile.coding-services`. This trades container isolation purity for operational simplicity: there is one container to manage, one log stream to follow, and one place to configure process supervision policy. The cost is a blast radius that spans all co-located services — if the container itself fails, everything goes down together. Within the container, supervisord's per-process restart policy means a crash in one service does not kill the others; supervisord will attempt restarts independently.

The second major architectural decision is the **bind mount deployment model**. `docker/docker-compose.yml` mounts the host repository into containers at `/coding` (expressed as `CODING_ROOT=/coding` inside the container) rather than copying code into the image at build time. This makes the Docker Compose stack explicitly a development and CI artifact: it requires a live Coding repository checkout on the host and is not suitable for standalone production deployment where images should be self-contained. The upside is that code changes on the host are immediately reflected inside the container without rebuilding the image, which suits rapid iteration workflows.

Dependency ordering is handled at two layers: Docker Compose `depends_on` with health checks gates the coding services container on Memgraph and Redis becoming healthy, while application-level retry logic in ServiceStarterFramework handles the residual race conditions that Compose health checks cannot fully eliminate (e.g., a service passing its health check before it is truly ready to accept connections).

![DockerizedServices — Relationship](images/dockerized-services-relationship.png)

## Implementation Details

**ServiceStarterFramework** (`lib/service-starter.js`) implements retry-with-exponential-backoff with `maxRetries=3` and a 30-second timeout per attempt. When a service fails to start within the timeout, the framework sends SIGTERM first, waits for a clean exit, then escalates to SIGKILL if the process hasn't exited. This SIGTERM→SIGKILL escalation is intentional: it gives processes a grace period to flush buffers and close connections (particularly relevant for Memgraph and Redis clients), reducing the likelihood of corrupted state on the next startup attempt.

**ServiceProbeLibrary** (`lib/utils/service-probe.js`) enforces an architectural invariant labeled SPEC R6 in the source: probe functions may only return the string literals `'running'`, `'stopped'`, or `'unknown'` — never `'healthy'`. This is a deliberate semantic boundary. Probes report process/port reachability, not application-level correctness. Two implementations exist: `probeHttpHealth()` performs an HTTP GET against a service's health endpoint and interprets HTTP 200 as `'running'`; `probeTcpPort()` attempts a raw TCP connection, used for Memgraph's Bolt protocol (port 7687) and Redis (port 6379), which do not speak HTTP. The three-value enum is treated as exhaustive by downstream consumers including ProcessStateManager (`process-state-manager.js`) and dashboard display logic — introducing a fourth value would break those consumers silently.

**Dashboard-to-API coupling** in `scripts/dashboard-service.js` hardcodes `NEXT_PUBLIC_API_BASE_URL=http://<CONNECTION_STRING_REDACTED> `OntologyRegistry` (accessed via a `LegacyOntologyAdapter` shim) to classify extracted observations into upper/lower ontology classes with configurable heuristic and LLM-assisted classification modes. The `OntologyClassificationAgent` manages lifecycle (initialize → classify → suggest extensions) and attaches `OntologyMetadata` (class, confidence, method, version) to every entity before persistence. Storage was migrated from a legacy `GraphDatabaseAdapter`+`PersistenceAgent` trio to a `KmCoreAdapter` surface in Phase 42.x, with field names preserved for minimal call-site disruption.

Key cross-cutting concerns include: LLM calls routed through `@rapid/llm-proxy`'s `LLMService` with token usage telemetry via `attachTokenLogger`; optional code-graph-rag integration via `CodeGraphAgent` (Tree-sitter AST + Memgraph) that gracefully degrades when the `uv` CLI or Memgraph TCP connection is unavailable; content staleness detection combining reference-pattern regex scanning and git-commit correlation via `GitStalenessDetector`; and trace files written to `logs/` for debugging non-fatally.


---

*Generated from 6 observations*

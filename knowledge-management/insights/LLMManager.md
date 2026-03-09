# LLMManager

**Type:** SubComponent

The LLMManager's configuration files, such as 'docker-compose.yml', provide a clear and concise way to define the dependencies and configuration for each language model, making it easier to manage and deploy language models.

## What It Is  

The **LLMManager** is the sub‑component responsible for orchestrating the lifecycle of the individual language‑model services that live under the `DockerizedServices` parent.  Each model is materialised in its own directory – for example `language-model-service/` – and is paired with a dedicated `docker‑compose.yml` that declares the container image, network links, environment variables and any auxiliary services it depends on.  A complementary `cache‑config.yml` sits alongside the compose file and captures the caching policy that each model must honour (e.g., time‑to‑live, cache keys, storage backend).  By treating every language model as an isolated Docker Compose stack, the LLMManager provides a clear, file‑system‑driven boundary that developers can version, build, and deploy independently of the rest of the system.

## Architecture and Design  

The observations reveal a **modular, configuration‑driven architecture**.  Rather than hard‑coding service wiring in code, the LLMManager relies on declarative artefacts (`docker‑compose.yml`, `cache‑config.yml`) that live next to the model’s source.  This pattern aligns with a *configuration‑as‑code* approach: the service topology, resource limits and caching strategy are all expressed in YAML, enabling the same tooling (Docker Compose, CI pipelines) to spin up any model in isolation.  

Interaction between the LLMManager and the rest of the platform is mediated through Docker networking defined in the compose files.  The `docker‑compose.yml` for each language model lists its dependencies – for instance a shared Redis instance for caching or a message broker used by the sibling **ServiceOrchestrator** – allowing Docker Compose to resolve service names at runtime.  The caching layer is decoupled from the model containers; the `cache‑config.yml` is read by a lightweight caching utility (or by the model’s own entry‑point) to decide whether a request can be answered from cache or must trigger a fresh inference, thereby preventing redundant re‑classification.  

Because the LLMManager lives under the **DockerizedServices** parent, it inherits the same high‑level modular philosophy that also governs its siblings **ServiceOrchestrator**, **CodingService**, and **LanguageModelService**.  All three expose their own Dockerfiles or compose files, which means the overall system can be assembled from a collection of independently versioned units, each with a well‑defined contract expressed in its configuration files.

## Implementation Details  

At the file‑system level the LLMManager’s implementation is centred on two artefacts:

1. **`language-model-service/docker-compose.yml`** – This file defines a service block (e.g., `llm‑model‑x`) that pulls a pre‑built Docker image, mounts any required model artefacts, and declares environment variables such as `MODEL_NAME` or `CACHE_STRATEGY`.  It also lists `depends_on` entries that pull in shared infrastructure (e.g., `redis`, `postgres`) which are themselves defined either in the same compose file or in a higher‑level compose that aggregates all services under DockerizedServices.

2. **`language-model-service/cache-config.yml`** – The cache configuration is a concise YAML document that specifies the caching backend (often Redis), the key‑generation scheme (typically a hash of the input payload), and eviction policies.  The model container reads this file at start‑up (or on each request) to initialise a caching client.  When a request arrives, the model checks the cache first; a hit short‑circuits the inference pipeline, satisfying the “prevent redundant language model re‑classification” goal described in the observations.

The modularity is reinforced by the directory layout: each language model gets its own folder (`language-model-service/model‑A/`, `language-model-service/model‑B/`, …) containing the model binaries, the two YAML files above, and optionally a `Dockerfile` if the model requires a custom build step.  The LLMManager’s orchestration scripts (not explicitly named in the observations) iterate over these directories, invoking `docker compose -f <path>/docker-compose.yml up -d` to bring each model online.  Because the caching strategy is externalised, swapping or tweaking the cache policy does not require rebuilding the model image—only an update to `cache-config.yml` and a container restart.

## Integration Points  

The LLMManager plugs into the broader **DockerizedServices** ecosystem through several explicit interfaces:

* **Service discovery** – The Docker Compose network makes each model reachable by its service name (e.g., `http://model‑x:8080`).  The sibling **ServiceOrchestrator** consumes these endpoints when routing user requests to the appropriate model based on language or task.

* **Shared infrastructure** – The compose files frequently reference common services such as a Redis cache, a PostgreSQL metadata store, or a message queue (e.g., RabbitMQ).  These dependencies are declared in `depends_on` and are satisfied by the sibling **LanguageModelService** or by global services defined at the DockerizedServices level.

* **Caching layer** – The `cache-config.yml` points to the same Redis instance used by other components, ensuring a unified cache namespace.  This enables cross‑component cache hits (e.g., a request classified by the **CodingService** may reuse a model’s cached response).

* **CI/CD pipelines** – Because each model’s definition lives in a self‑contained directory, the CI system can trigger builds and deployments on a per‑model basis.  The pipeline reads the `docker-compose.yml` to spin up a test harness, runs integration tests, and pushes the resulting image to the registry.

## Usage Guidelines  

Developers extending or maintaining the LLMManager should adhere to the following conventions:

1. **Isolate changes to a single model directory** – When adding a new language model, create a fresh sub‑folder under `language-model-service/`, copy the template `docker-compose.yml` and `cache-config.yml`, and adjust the image tag, environment variables, and cache keys.  Avoid editing the compose files of other models to keep deployments independent.

2. **Treat caching as a first‑class concern** – The `cache-config.yml` must be kept in sync with the model’s inference semantics.  If the model’s output becomes non‑deterministic, either disable caching for that model or adjust the key generation logic to include additional context (e.g., a version stamp).

3. **Leverage Docker Compose for local testing** – Use `docker compose -f language-model-service/<model>/docker-compose.yml up` to spin up a single model alongside its dependencies.  This mirrors production behaviour because the same compose file is used in CI/CD and in the deployed environment.

4. **Document dependencies explicitly** – Any external service required by a model (e.g., a GPU driver, a custom library) should be listed under `depends_on` and reflected in the model’s Dockerfile.  This makes the contract visible to the **ServiceOrchestrator** and prevents runtime surprises.

5. **Version control the configuration files** – Both `docker-compose.yml` and `cache-config.yml` should be committed alongside the model code.  When a caching policy changes, increment the configuration file’s version comment to aid traceability.

---

### 1. Architectural patterns identified  
* **Modular, configuration‑driven architecture** – each language model lives in its own directory with dedicated `docker‑compose.yml` and `cache‑config.yml`.  
* **Configuration‑as‑Code** – service topology, dependencies, and caching strategy are expressed declaratively in YAML.  
* **Separation of concerns** – model inference, service orchestration, and caching are isolated into distinct artefacts.

### 2. Design decisions and trade‑offs  
* **Per‑model directories** enable independent development and deployment but increase the number of compose files to manage.  
* **Docker Compose** provides simple orchestration and network isolation; however, scaling to large numbers of models may require more sophisticated orchestration (e.g., Kubernetes) which is not present in the current design.  
* **External cache configuration** allows cache policy changes without rebuilding images, at the cost of an extra runtime read and the need to keep the config in sync with model semantics.

### 3. System structure insights  
The LLMManager sits under the **DockerizedServices** parent, sharing the same modular folder layout as its siblings (**ServiceOrchestrator**, **CodingService**, **LanguageModelService**).  Each child (individual language model) is a self‑contained Docker Compose stack, exposing a network‑addressable service and a cache policy file.  This hierarchy yields a clear, layered structure: parent provides shared infrastructure, siblings provide complementary services, and LLMManager’s children encapsulate the actual model workloads.

### 4. Scalability considerations  
Because each model runs in its own container, they can be scaled horizontally by increasing replica counts in the respective `docker‑compose.yml` (or by migrating to a higher‑level orchestrator).  The caching layer mitigates load spikes by serving repeated requests from Redis, reducing the number of expensive inference calls.  Nevertheless, the flat Docker Compose approach may become a bottleneck when the number of models grows into the dozens, at which point a service mesh or orchestrator with dynamic service discovery would be advisable.

### 5. Maintainability assessment  
The file‑system‑driven modularity makes the LLMManager highly maintainable: changes to one model’s code or configuration do not ripple across the system.  Clear, version‑controlled YAML files serve as living documentation of dependencies and caching rules.  The main maintenance overhead lies in managing multiple compose files and ensuring consistency of shared resources (e.g., Redis connection strings).  Overall, the design promotes low coupling and high cohesion, which are favorable for long‑term upkeep.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component exhibits a modular architecture, with each service having its own directory and configuration files. This is evident in the way services are organized, with separate folders for each service, such as the 'coding-service' and 'language-model-service'. Each service directory contains its own set of configuration files, including Dockerfiles and docker-compose files, allowing for independent management and deployment of each service. For example, the 'coding-service' directory contains a 'Dockerfile' that defines the build process for the service, while the 'language-model-service' directory contains a 'docker-compose.yml' file that defines the service's dependencies and configuration. This modular approach enables developers to work on individual services without affecting the entire system, promoting a more efficient and scalable development process.

### Siblings
- [ServiceOrchestrator](./ServiceOrchestrator.md) -- The ServiceOrchestrator utilizes a separate directory for each coding service, such as the 'coding-service' directory, containing a 'Dockerfile' that defines the build process for the service.
- [CodingService](./CodingService.md) -- The CodingService utilizes a separate directory, such as the 'coding-service' directory, containing a 'Dockerfile' that defines the build process for the service.
- [LanguageModelService](./LanguageModelService.md) -- The LanguageModelService utilizes a separate directory, such as the 'language-model-service' directory, containing a 'docker-compose.yml' file that defines the dependencies and configuration for the service.


---

*Generated from 7 observations*

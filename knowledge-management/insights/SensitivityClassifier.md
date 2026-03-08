# SensitivityClassifier

**Type:** SubComponent

The SensitivityClassifier sub-component is designed to support multiple modes, including the mock provider in integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts, which allows for testing and development without incurring actual costs.

## What It Is  

The **SensitivityClassifier** is a sub‑component that lives inside the *LLMAbstraction* hierarchy and is responsible for determining how sensitive a given LLM request is.  Its core implementation resides in the provider‑specific files **`lib/llm/providers/anthropic-provider.ts`** and **`lib/llm/providers/dmr-provider.ts`**, while the orchestration logic that makes the classifier provider‑agnostic lives in **`lib/llm/llm-service.ts`**.  A mock implementation for development and testing is provided in **`integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`**.  The classifier is driven by a machine‑learning model and persists its results in an internal data‑storage mechanism so that downstream components can retrieve classification outcomes for analysis or policy enforcement.

## Architecture and Design  

The design of **SensitivityClassifier** is anchored in the **facade pattern** as explicitly noted in observation 3.  The file **`lib/llm/llm-service.ts`** acts as the façade, exposing a single, unified API for “classify sensitivity” regardless of which underlying LLM provider is in use.  This façade decouples the rest of the system (e.g., *BudgetTracker*, *ProviderManager*, *MODEngine*) from provider‑specific details, allowing new providers to be added or removed without ripple effects.  

Provider‑specific logic lives in the **provider modules** under `lib/llm/providers/`.  Both **`anthropic-provider.ts`** and **`dmr-provider.ts`** contain concrete implementations of a `SensitivityClassifier` class that adhere to the interface expected by the façade.  Because each provider module implements the same contract, the system achieves **provider‑agnostic** behavior while still allowing each vendor to leverage its own API quirks or model endpoints.  

A **mock mode** is introduced via **`integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`** (observation 4).  This mock provider implements the same façade contract but returns deterministic or stubbed classification results, enabling safe testing and development without incurring real LLM costs.  The presence of a mock mode demonstrates an explicit **mode‑support strategy**, where the façade can be swapped at runtime based on configuration.  

Finally, the classifier incorporates a **data‑storage mechanism** (observation 7) to persist classification outcomes.  While the exact storage technology is not detailed, the existence of this layer indicates a separation between the classification engine and the persistence layer, supporting later analytics or audit requirements.

## Implementation Details  

At the heart of the classifier is the **`SensitivityClassifier` class** defined in each provider file.  In **`anthropic-provider.ts`**, the class likely implements a method such as `classify(request: LLMRequest): SensitivityResult` that forwards the request to Anthropic’s endpoint, receives a response, and translates it into a structured sensitivity rating.  Observation 5 confirms that the classification uses a **machine‑learning‑based approach**, meaning the provider call probably invokes a model fine‑tuned for sensitivity detection rather than a simple rule‑based check.  

The **`dmr-provider.ts`** file mirrors this structure, showing that the same `SensitivityClassifier` contract can be satisfied by a completely different vendor (DMR).  Both implementations rely on the **facade** in `llm-service.ts` to expose a common method like `getSensitivity(request)`.  The façade internally resolves the appropriate provider based on configuration (e.g., environment variables, runtime flags) and delegates the call.  

The **mock provider** in `llm-mock-service.ts` implements the same interface but bypasses any external ML call.  Instead, it may return a pre‑configured sensitivity level (e.g., “low”) or a deterministic mapping based on request content, which is useful for unit tests and CI pipelines.  

After classification, the result is written to a **data storage component**.  While the observation does not name the storage class, the pattern suggests a repository‑style abstraction (e.g., `SensitivityResultRepository.save(result)`) that decouples persistence from classification logic.  This design enables later retrieval for audit logs, compliance checks, or feeding back into model retraining pipelines.

## Integration Points  

**SensitivityClassifier** is tightly integrated with its parent **LLMAbstraction**.  LLMAbstraction invokes the façade in `llm-service.ts` whenever a request needs a sensitivity check, ensuring that every LLM operation (including those managed by *BudgetTracker*, *ProviderManager*, and *MODEngine*) benefits from consistent classification.  Because the siblings all share the same façade, any change to the classification contract propagates uniformly across budgeting, provider management, and model execution logic.  

The classifier depends on two primary external contracts:  

1. **LLM Provider SDKs** – each concrete provider (Anthropic, DMR) supplies its own client library, which the provider‑specific `SensitivityClassifier` wraps.  
2. **Persistence Layer** – the storage mechanism (likely an abstraction over a database or log store) is injected or accessed by the classifier to record results.  

Configuration files or environment settings determine which provider implementation the façade resolves at runtime, allowing seamless switching between real providers and the mock implementation used in integration tests (`integrations/mcp-server-semantic-analysis`).  

## Usage Guidelines  

1. **Always invoke classification through the façade** (`llm-service.ts`).  Directly calling a provider‑specific `SensitivityClassifier` circumvents the abstraction and makes the code brittle to provider changes.  
2. **Select the appropriate mode via configuration**.  For local development or CI, set the system to use the mock provider (`llm-mock-service.ts`) to avoid external API calls and cost.  In production, configure the façade to point at the desired real provider (Anthropic or DMR).  
3. **Persist and retrieve classification results** using the provided storage API.  Do not attempt to write directly to the database; rely on the repository abstraction to maintain consistency and enable future analytics.  
4. **Handle classification failures gracefully**.  Because the classifier depends on external ML services, network or model errors may occur; callers should fallback to a safe default (e.g., “unknown” or “high”) and log the incident.  
5. **Do not modify provider‑specific files** unless adding a new vendor.  Extending the system should be done by creating a new provider module that implements the same `SensitivityClassifier` contract, then registering it in the façade’s provider map.

---

### 1. Architectural patterns identified  
* **Facade pattern** – `lib/llm/llm-service.ts` provides a unified interface for sensitivity classification.  
* **Provider (Strategy) pattern** – each concrete provider (`anthropic-provider.ts`, `dmr-provider.ts`) implements the same classifier contract, allowing runtime selection.  
* **Mock/Stub mode** – a dedicated mock implementation (`llm-mock-service.ts`) enables testing without external calls.  
* **Repository/Storage abstraction** – classification results are persisted via a data‑storage mechanism separate from the classification logic.

### 2. Design decisions and trade‑offs  
* **Provider‑agnostic façade** simplifies consumer code and eases addition/removal of providers, at the cost of an extra indirection layer.  
* **Separate mock provider** avoids cost and flakiness in tests, but requires maintaining parity of the mock contract with real providers.  
* **Machine‑learning‑based classification** yields higher accuracy but introduces dependency on external ML services and potential latency.  
* **Persisting results** supports auditability and analytics but adds storage overhead and necessitates cleanup/retention policies.

### 3. System structure insights  
* SensitivityClassifier is a child of **LLMAbstraction** and shares the same façade (`llm-service.ts`) with sibling components (*BudgetTracker*, *ProviderManager*, *MODEngine*).  
* Provider‑specific implementations reside under `lib/llm/providers/`, while the mock lives in the integration test tree, reflecting a clear separation between production and testing code.  
* The data‑storage layer is likely a shared service used by other sub‑components that need to log LLM‑related metadata.

### 4. Scalability considerations  
* Adding new providers scales horizontally; the façade’s provider map can be extended without affecting existing consumers.  
* The mock mode scales trivially for parallel test execution because it does not depend on external services.  
* Persisted classification results must be stored in a scalable datastore (e.g., a time‑series DB or document store) to handle high request volumes without becoming a bottleneck.  
* Machine‑learning inference latency can be mitigated by batching requests or caching recent classifications.

### 5. Maintainability assessment  
* The clear separation of concerns (facade, provider modules, mock, storage) promotes high maintainability; changes in one provider do not ripple to others.  
* Centralizing the API in `llm-service.ts` ensures a single source of truth for consumers, reducing duplication.  
* However, the reliance on a consistent contract across providers means that any contract change requires coordinated updates in every provider implementation and the mock.  
* Documentation of the storage schema and retention policy is essential to avoid drift as the system evolves.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM operations. This design decision allows for provider-agnostic model calls, enabling the addition or removal of providers without affecting the rest of the system. For instance, the Anthropic provider (lib/llm/providers/anthropic-provider.ts) and the DMR provider (lib/llm/providers/dmr-provider.ts) can be easily integrated or removed without modifying the core component. The facade pattern also enables the component to support multiple modes, including the mock provider (integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts) for testing purposes.

### Siblings
- [BudgetTracker](./BudgetTracker.md) -- BudgetTracker utilizes the lib/llm/llm-service.ts file to fetch the current budget for LLM operations, enabling provider-agnostic budget management.
- [ProviderManager](./ProviderManager.md) -- ProviderManager utilizes the lib/llm/llm-service.ts file to manage and integrate different LLM providers, enabling provider-agnostic operations.
- [MODEngine](./MODEngine.md) -- MODEngine utilizes the lib/llm/llm-service.ts file to manage and execute LLM operations in different modes, enabling mode-agnostic operations.


---

*Generated from 7 observations*

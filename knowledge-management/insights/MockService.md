# MockService

**Type:** SubComponent

MockService configuration is defined in a separate configuration file (mock-service-config.json) which specifies mock settings and behaviors

## What It Is

- The mock implementation includes error simulation in mock-error-simulator.py, allowing for testing of error handling paths

- MockService implements mock implementations of LLM providers in mock-providers.py, simulating their behavior for testing

- The service uses a mock data store in mock-data-store.py to store and retrieve mock results, mimicking the real data flow

- MockService configuration is defined in a separate configuration file (mock-service-config.json) which specifies mock settings and behaviors


## Related Entities

### Used By

- LLMAbstraction (contains)



## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component serves as an abstraction layer over various LLM (Large Language Model) providers, enabling provider-agnostic model calls, tier-based routing, and mock mode for testing. This component's architecture involves a high-level facade, the LLMService, which handles mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback. The component also includes specific providers such as AnthropicProvider, DMRProvider, and a mock service for testing purposes.

### Siblings
- [DMRController](./DMRController.md) -- DMRController utilizes the Docker Python SDK in docker-controller.py to manage Docker containers for model inference
- [AnthropicController](./AnthropicController.md) -- AnthropicController initializes the Anthropic SDK in anthropic-init.py, setting up API keys and model configurations
- [LLMService](./LLMService.md) -- LLMService implements mode routing in mode-router.py, directing requests to appropriate providers based on the current mode


---

*Generated from 6 observations*

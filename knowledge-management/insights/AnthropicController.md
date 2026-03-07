# AnthropicController

**Type:** SubComponent

AnthropicController's run_inference function in anthropic-runner.py asynchronously calls the Anthropic API for model inference, handling timeouts and retries

## What It Is

- AnthropicController initializes the Anthropic SDK in anthropic-init.py, setting up API keys and model configurations

- AnthropicController configuration, such as API keys and model IDs, is stored securely in an encrypted file (anthropic-config.json)

- The controller's prepare_input method in input-preparer.py converts user input into a format compatible with the Anthropic API

- AnthropicController's run_inference function in anthropic-runner.py asynchronously calls the Anthropic API for model inference, handling timeouts and retries


## Related Entities

### Used By

- LLMAbstraction (contains)



## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component serves as an abstraction layer over various LLM (Large Language Model) providers, enabling provider-agnostic model calls, tier-based routing, and mock mode for testing. This component's architecture involves a high-level facade, the LLMService, which handles mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback. The component also includes specific providers such as AnthropicProvider, DMRProvider, and a mock service for testing purposes.

### Siblings
- [DMRController](./DMRController.md) -- DMRController utilizes the Docker Python SDK in docker-controller.py to manage Docker containers for model inference
- [LLMService](./LLMService.md) -- LLMService implements mode routing in mode-router.py, directing requests to appropriate providers based on the current mode
- [MockService](./MockService.md) -- MockService implements mock implementations of LLM providers in mock-providers.py, simulating their behavior for testing


---

*Generated from 6 observations*

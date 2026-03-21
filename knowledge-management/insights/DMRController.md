# DMRController

**Type:** SubComponent

The controller's result processing pipeline in result-processor.py applies post-processing techniques such as tokenization and normalization to the inference outputs

## What It Is

- DMRController utilizes the Docker Python SDK in docker-controller.py to manage Docker containers for model inference

- DMRController's configuration is loaded from a YAML file (config.yaml) which defines settings such as model paths, Docker image names, and inference parameters

- The run_inference method in inference-runner.py implements a retry mechanism with exponential backoff for handling transient Docker errors

- DMRController's load_model function in model-loader.py checks the model's compatibility with the local Docker environment before proceeding with loading

## How It Works

- The controller's result processing pipeline in result-processor.py applies post-processing techniques such as tokenization and normalization to the inference outputs

## Related Entities

### Dependencies

- ModelLoader (contains)

- InferenceRunner (contains)

- ResultProcessor (contains)

### Used By

- LLMAbstraction (contains)

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component serves as an abstraction layer over various LLM (Large Language Model) providers, enabling provider-agnostic model calls, tier-based routing, and mock mode for testing. This component's architecture involves a high-level facade, the LLMService, which handles mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback. The component also includes specific providers such as AnthropicProvider, DMRProvider, and a mock service for testing purposes.

### Children
- [ModelLoader](./ModelLoader.md) -- The ModelLoader utilizes the docker-controller.py script to interact with the Docker environment, specifically leveraging the Docker Python SDK to load models.
- [InferenceRunner](./InferenceRunner.md) -- The InferenceRunner is expected to be implemented in conjunction with the ModelLoader, as it relies on the loaded models to execute inference tasks.
- [ResultProcessor](./ResultProcessor.md) -- The ResultProcessor would likely be implemented as a separate module or class, allowing for easy modification and extension of the post-processing functionality.

### Siblings
- [AnthropicController](./AnthropicController.md) -- AnthropicController initializes the Anthropic SDK in anthropic-init.py, setting up API keys and model configurations
- [LLMService](./LLMService.md) -- LLMService implements mode routing in mode-router.py, directing requests to appropriate providers based on the current mode
- [MockService](./MockService.md) -- MockService implements mock implementations of LLM providers in mock-providers.py, simulating their behavior for testing

---

*Generated from 6 observations*

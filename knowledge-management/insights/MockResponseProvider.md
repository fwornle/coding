# MockResponseProvider

**Type:** Detail

MockResponseProvider class defines a `get_response()` method that matches incoming prompts against a registry of canned replies stored in `mock_responses.json`, enabling deterministic output for container-based agent tests without live API calls.

## What It Is

MockResponseProvider is a class within LLMMockService, implemented in the `mock/` subdirectory of the semantic analysis server (specifically in `llm-mock-service.ts`). It provides deterministic LLM responses for containerized test runs by matching prompts against canned replies stored in `mock_responses.json`.

## Architecture and Design

The intentional isolation in the `mock/` subdirectory ensures clean separation from production LLM routing logic. This follows a substitution pattern—MockResponseProvider can replace live LLM providers during testing without modifying production code paths. The registry-based approach (prompt → canned response) prioritizes determinism over flexibility.

## Implementation Details

MockResponseProvider exposes a `get_response()` method that performs prompt matching against entries in `mock_responses.json`. This enables repeatable test assertions without network calls or API key dependencies.

## Integration Points

Contained within LLMMockService, it serves as a drop-in substitute for the production LLM provider interface during containerized agent tests. The `mock_responses.json` file acts as the external configuration surface for test scenarios.

## Usage Guidelines

Developers should maintain `mock_responses.json` entries that mirror expected prompt patterns in tests. Since matching is registry-based, new test scenarios require corresponding entries in the response file. This component should never be referenced from production code paths.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts resides in the mock/ subdirectory of the semantic analysis server, indicating it is intentionally isolated from production LLM routing logic to allow safe substitution during containerized test runs.


---

*Generated from 3 observations*

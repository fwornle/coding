# Semantic Analysis Agent System

A modular, distributed agent system for semantic analysis of code, conversations, and technical documentation. Built with a hybrid communication architecture using MQTT for events and JSON-RPC for commands, with MCP server integration for tool exposure.

## Architecture Overview

The system consists of multiple specialized agents that communicate through a hybrid protocol:

- **Semantic Analysis Agent**: Analyzes code commits, conversations, and extracts patterns
- **Web Search Agent**: Performs context-aware web searches and validates references  
- **Knowledge Graph Agent**: Manages entities, relations, and syncs with MCP memory
- **Coordinator Agent**: Orchestrates complex workflows across agents
- **MCP Server**: Exposes agent capabilities as MCP tools

## Features

- **LLM Agnostic**: Supports Claude (primary) and OpenAI-compatible APIs
- **Event-Driven**: MQTT-based event bus for asynchronous communication
- **Standards-Based**: JSON-RPC for synchronous commands, MCP for tool exposure
- **Scalable**: Can run on single machine or distributed across multiple nodes
- **Resilient**: Agent supervision with automatic restart capabilities
- **Extensible**: Easy to add new agents or LLM providers

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and configuration
   ```

3. **Start the system**:
   ```bash
   # Start all agents
   npm run start:agents

   # Start MCP server (in another terminal)
   npm run start:mcp
   ```

## Usage

### As MCP Tools

Once the MCP server is running, you can use the tools in any MCP-compatible client:

```javascript
// In Claude Desktop or other MCP client
const result = await mcp.call('semantic_analyze_code', {
  repository: '/path/to/repo',
  depth: 10
});
```

### Direct Agent Communication

```javascript
import { CoordinatorClient } from './clients/coordinator-client.js';

const coordinator = new CoordinatorClient({
  rpcEndpoint: 'http://localhost:8080'
});

const analysis = await coordinator.analyzeConversation({
  conversationPath: '/path/to/conversation.md',
  extractInsights: true
});
```

### CLI Usage

```bash
# Analyze recent commits
semantic-cli analyze code --repo . --depth 10

# Analyze conversation
semantic-cli analyze conversation --file conversation.md

# Search for technical documentation
semantic-cli search "React hooks patterns"
```

## Agent Communication

### Event-Driven (MQTT)

Agents publish and subscribe to events for asynchronous communication:

```javascript
// Publishing an event
agent.publish('analysis/completed', {
  requestId: 'req-123',
  results: analysisResults
});

// Subscribing to events
agent.on('pattern/detected', async (data) => {
  await processPattern(data);
});
```

### Request-Response (JSON-RPC)

For synchronous operations between agents:

```javascript
// Making RPC calls
const result = await agent.call('knowledge-graph', 'createEntity', {
  name: 'ReactHooksPattern',
  type: 'TechnicalPattern',
  significance: 8
});
```

## Configuration

### Agent Configuration

Edit `config/agents.yaml` to configure individual agents:

```yaml
agents:
  semantic-analysis:
    llm:
      primary: claude
      fallback: openai
    analysis:
      significanceThreshold: 7
      maxCommits: 50
```

### Communication Configuration

MQTT and JSON-RPC settings in `.env`:

```env
MQTT_BROKER_HOST=localhost
MQTT_BROKER_PORT=1883
JSON_RPC_PORT=8080
```

## Development

### Adding a New Agent

1. Create agent directory: `agents/your-agent/`
2. Extend `BaseAgent` class
3. Implement required methods
4. Register in agent registry

Example:
```javascript
import { BaseAgent } from '../../framework/base-agent.js';

export class YourAgent extends BaseAgent {
  constructor(config) {
    super({ ...config, id: 'your-agent' });
  }
  
  async initialize() {
    // Setup agent-specific initialization
    this.subscribe('your-agent/requests/#');
  }
  
  async handleRequest(data) {
    // Process requests
  }
}
```

### Adding LLM Providers

1. Create provider in `agents/semantic-analysis/providers/`
2. Implement `LLMProviderInterface`
3. Register in provider factory

## Integration with UKB

The system integrates seamlessly with the existing UKB knowledge management:

```bash
# Use semantic agents with ukb
ukb --agent --auto

# Or programmatically
const ukb = new UKBClient({ useAgents: true });
await ukb.analyzeRepository();
```

## Deployment

### Single Machine

```bash
docker-compose up
```

### Distributed

Deploy agents to different machines, pointing to shared MQTT broker:

```env
MQTT_BROKER_HOST=mqtt.your-domain.com
```

### Kubernetes

```bash
kubectl apply -f k8s/
```

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test agents/semantic-analysis

# Integration tests
npm run test:integration
```

## Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Submit pull request

## License

MIT
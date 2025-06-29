# Semantic Analysis System Architecture

This document provides a detailed technical overview of the semantic analysis system architecture, communication patterns, and integration with the existing knowledge management infrastructure.

## System Overview

![System Architecture](../images/semantic-analysis-system-overview.png)

The semantic analysis system implements a **multi-agent architecture** with **hybrid communication** patterns to provide scalable, intelligent knowledge management capabilities.

## Architectural Principles

### 1. Agent-Oriented Design

- **Autonomous agents** with specialized capabilities
- **Loose coupling** through event-driven communication
- **Resilient operation** with automatic failure recovery
- **Horizontal scalability** across multiple machines

### 2. Hybrid Communication

- **MQTT** for asynchronous, event-driven coordination
- **JSON-RPC** for synchronous, request-response operations
- **MCP** for external tool integration with Claude Code
- **Direct API** for programmatic access

### 3. Knowledge Integration

- **Backward compatibility** with existing ukb/vkb tools
- **Seamless data migration** from shared-memory.json
- **Enhanced entity management** with AI-powered extraction
- **Cross-system synchronization** for data consistency

## Agent Architecture

![Agent Architecture](../images/semantic-analysis-agents.png)

### Core Agent Framework

All agents extend the `BaseAgent` class which provides:

```javascript
class BaseAgent extends EventEmitter {
  // Common functionality:
  - MQTT communication
  - RPC handling
  - Health monitoring
  - Event routing
  - Error handling
  - Lifecycle management
}
```

### Agent Responsibilities

#### Semantic Analysis Agent

```text
├── LLM Provider Abstraction
│   ├── Claude Provider (Primary)
│   ├── OpenAI Provider (Fallback)
│   └── Provider Interface
├── Code Analysis
│   ├── Git Repository Analysis
│   ├── Commit Pattern Detection
│   └── Significance Scoring
└── Conversation Analysis
    ├── Insight Extraction
    ├── Topic Identification
    └── Knowledge Synthesis
```

#### Web Search Agent

```text
├── Search Providers
│   ├── DuckDuckGo (Default)
│   ├── Bing API (Optional)
│   └── Google Custom Search (Optional)
├── Result Processing
│   ├── Quality Filtering
│   ├── Relevance Scoring
│   └── Duplicate Detection
└── Specialized Search
    ├── Technical Documentation
    ├── Best Practices
    └── API References
```

#### Knowledge Graph Agent

```text
├── Entity Management
│   ├── Creation & Updates
│   ├── Relationship Mapping
│   └── Search & Discovery
├── UKB Integration
│   ├── Bidirectional Sync
│   ├── Format Conversion
│   └── Legacy Compatibility
└── Knowledge Processing
    ├── Automatic Extraction
    ├── Insight Generation
    └── Pattern Recognition
```

#### Coordinator Agent

```text
├── Workflow Engine
│   ├── Step Execution
│   ├── Error Recovery
│   └── Progress Tracking
├── Task Scheduling
│   ├── Recurring Tasks
│   ├── Priority Management
│   └── Resource Allocation
└── Agent Management
    ├── Capability Discovery
    ├── Load Balancing
    └── Health Monitoring
```

## Communication Architecture

![Communication Architecture](../images/semantic-analysis-communication-vertical.png)

### MQTT Event Bus

The system uses MQTT for **asynchronous, event-driven communication**:

```text
Topic Structure:
├── analysis/
│   ├── code/requested
│   ├── code/completed
│   ├── conversation/requested
│   └── conversation/completed
├── search/
│   ├── web/requested
│   ├── web/completed
│   └── technical-docs/requested
├── knowledge/
│   ├── entity/create/requested
│   ├── entity/created
│   └── relation/created
└── workflow/
    ├── started
    ├── step/completed
    └── completed
```

### JSON-RPC API

For **synchronous operations** requiring immediate responses:

```text
RPC Methods:
├── semantic-analysis.*
│   ├── analyzeCode(params)
│   ├── analyzeConversation(params)
│   └── extractPatterns(params)
├── web-search.*
│   ├── search(query, options)
│   ├── searchTechnicalDocs(params)
│   └── validateReferences(params)
├── knowledge-graph.*
│   ├── createEntity(entity)
│   ├── searchEntities(query)
│   └── syncWithUkb(direction)
└── coordinator.*
    ├── startWorkflow(type, params)
    ├── getWorkflowStatus(id)
    └── scheduleTask(task)
```

### MCP Integration

The **MCP server** exposes agent capabilities as tools for Claude Code:

```text
MCP Tools:
├── analyze_repository
├── analyze_conversation
├── search_web
├── search_technical_docs
├── create_knowledge_entity
├── search_knowledge
├── start_workflow
├── get_workflow_status
├── schedule_task
├── sync_with_ukb
└── get_system_status
```

## Workflow Architecture

![Workflow Architecture](../images/semantic-analysis-workflows.png)

### Workflow Engine Components

#### Workflow Builder

- **Template Management**: Predefined workflow patterns
- **Custom Workflows**: User-defined analysis sequences
- **Parameter Binding**: Dynamic value substitution
- **Validation**: Workflow structure verification

#### Workflow Engine

- **Step Execution**: Sequential and parallel step processing
- **State Management**: Context and result storage
- **Error Recovery**: Automatic retry with exponential backoff
- **Progress Tracking**: Real-time status updates

#### Task Scheduler

- **Recurring Tasks**: Cron-like scheduling for automated analysis
- **Priority Management**: Resource allocation and task ordering
- **Dependency Resolution**: Task prerequisite handling
- **Health Monitoring**: Task failure detection and recovery

### Example Workflow: Repository Analysis

```text
1. analyze-repository
   ├── Input: repository path, analysis depth
   ├── Agent: semantic-analysis
   └── Output: commit analysis, patterns

2. extract-technologies
   ├── Input: analysis results
   ├── Type: transform
   └── Output: technology list, patterns

3. search-best-practices
   ├── Input: technologies
   ├── Agent: web-search
   └── Output: best practice references

4. create-knowledge-entities
   ├── Input: analysis + search results
   ├── Agent: knowledge-graph
   └── Output: entities created

5. sync-with-ukb
   ├── Input: new entities
   ├── Agent: knowledge-graph
   └── Output: sync status
```

## Data Architecture

![Data Architecture](../images/semantic-analysis-data.png)

### Knowledge Graph Schema

```json
{
  "entities": [
    {
      "id": "entity_uuid",
      "name": "Entity Name",
      "entityType": "Pattern|Insight|Technology|Reference",
      "significance": 1-10,
      "observations": ["observation1", "observation2"],
      "metadata": {
        "created": "ISO_DATE",
        "source": "analysis_type",
        "technologies": ["tech1", "tech2"],
        "references": ["url1", "url2"]
      }
    }
  ],
  "relations": [
    {
      "id": "relation_uuid",
      "from": "entity_id",
      "to": "entity_id",
      "relationType": "uses|implements|extends|references",
      "metadata": {
        "created": "ISO_DATE",
        "strength": 1-10
      }
    }
  ]
}
```

### Analysis Results Schema

```json
{
  "analysisType": "code|conversation|web-search",
  "timestamp": "ISO_DATE",
  "source": "repository_path|conversation_path|search_query",
  "significance": 1-10,
  "insights": [
    {
      "type": "pattern|architectural|performance|security",
      "title": "Insight Title",
      "description": "Detailed description",
      "significance": 1-10,
      "applicability": "Context where applicable",
      "technologies": ["tech1", "tech2"],
      "references": ["url1", "url2"]
    }
  ],
  "entities": [...],
  "relations": [...]
}
```

## Integration Architecture

![Integration Architecture](../images/semantic-analysis-integration.png)

### Claude Code Integration

The system integrates with Claude Code through multiple layers:

1. **MCP Server**: Direct tool access in conversations
2. **Knowledge Sync**: Automatic loading of knowledge base
3. **Conversation Logging**: Post-session analysis and capture
4. **Context Awareness**: Project-specific knowledge loading

### UKB Integration

**Backward Compatibility** is maintained through:

1. **Data Format**: Compatible with shared-memory.json
2. **Command Interface**: ukb commands continue to work
3. **Sync Mechanisms**: Bidirectional data synchronization
4. **Migration Path**: Gradual adoption without disruption

### VKB Integration

**Enhanced Visualization** through:

1. **Entity Enrichment**: AI-generated entities appear in visualizations
2. **Relationship Discovery**: Automatic relationship detection
3. **Interactive Analysis**: Click-through to detailed analysis
4. **Real-time Updates**: Live updates from agent analysis

## Deployment Architecture

![Deployment Architecture](../images/semantic-analysis-deployment.png)

### Single Machine Deployment

![Single Machine Deployment](../images/semantic-analysis-deployment-single.png)

Key characteristics:

- All components run on a single host
- Shared memory and localhost communication
- Ideal for development and small teams
- Minimal infrastructure requirements

### Distributed Deployment

![Distributed Deployment](../images/semantic-analysis-deployment-distributed.png)

Key characteristics:

- Agents distributed across multiple nodes
- Central MQTT broker for coordination
- Scalable and fault-tolerant
- Network-based communication

## Security Architecture

### Authentication & Authorization

- **API Key Management**: Secure storage and rotation
- **Agent Authentication**: Certificate-based agent identity
- **Request Validation**: Input sanitization and rate limiting
- **Audit Logging**: Comprehensive operation tracking

### Data Protection

- **Encryption in Transit**: TLS for all external communications
- **Encryption at Rest**: Sensitive data encryption
- **Access Control**: Role-based permission system
- **Data Isolation**: Project-specific knowledge boundaries

### Network Security

- **Firewall Rules**: Restricted port access
- **VPN Support**: Secure remote agent deployment
- **Certificate Management**: Automated cert rotation
- **Intrusion Detection**: Anomaly monitoring

## Performance Architecture

### Scalability Patterns

- **Horizontal Scaling**: Add agents across machines
- **Load Balancing**: Intelligent request distribution
- **Caching Strategies**: Multi-level result caching
- **Resource Pooling**: Shared LLM provider connections

### Optimization Techniques

- **Batch Processing**: Group similar requests
- **Parallel Execution**: Concurrent agent operations
- **Result Streaming**: Progressive result delivery
- **Connection Pooling**: Reuse network connections

### Monitoring & Metrics

- **Health Checks**: Automated agent health monitoring
- **Performance Metrics**: Response time and throughput tracking
- **Resource Monitoring**: Memory and CPU utilization
- **Alert Management**: Proactive issue notification

## Related Documentation

- [System Overview](./README.md) - Getting started and overview
- [API Reference](./api-reference.md) - Complete API documentation
- [Workflow Guide](./workflows.md) - Workflow configuration and usage
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

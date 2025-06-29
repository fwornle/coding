# Semantic Analysis System - API Reference

This document provides comprehensive API documentation for the semantic analysis system, including MCP tools, JSON-RPC methods, and MQTT topics.

## MCP Tools (Claude Code Integration)

These tools are available when using `claude-mcp` and can be called directly in conversations with Claude Code.

### analyze_repository

Analyzes a code repository for patterns, insights, and architectural elements.

**Parameters:**
```json
{
  "repository": "string",           // Path to repository (required)
  "depth": "number",               // Number of commits to analyze (default: 10)
  "significanceThreshold": "number", // Minimum significance score (default: 5)
  "includeFiles": "string[]",      // File patterns to include (optional)
  "excludeFiles": "string[]",      // File patterns to exclude (optional)
  "analysisTypes": "string[]"      // Types of analysis: ["patterns", "architecture", "performance"] (optional)
}
```

**Response:**
```json
{
  "analysisId": "string",
  "timestamp": "ISO_DATE",
  "repository": "string",
  "commitsAnalyzed": "number",
  "insights": [
    {
      "type": "string",
      "title": "string",
      "description": "string",
      "significance": "number",
      "technologies": "string[]",
      "codeFiles": "string[]",
      "references": "string[]"
    }
  ],
  "patterns": [
    {
      "name": "string",
      "type": "string",
      "occurrences": "number",
      "examples": "string[]"
    }
  ],
  "entities": "Entity[]",
  "relations": "Relation[]"
}
```

**Example:**
```json
{
  "repository": "/path/to/project",
  "depth": 15,
  "significanceThreshold": 7,
  "analysisTypes": ["patterns", "architecture"]
}
```

### analyze_conversation

Extracts insights and knowledge from conversation logs or text content.

**Parameters:**
```json
{
  "content": "string",             // Text content to analyze (required)
  "source": "string",             // Source identifier (optional)
  "participantRoles": "string[]", // Roles of participants (optional)
  "extractEntities": "boolean",   // Whether to extract knowledge entities (default: true)
  "significanceThreshold": "number" // Minimum significance score (default: 5)
}
```

**Response:**
```json
{
  "analysisId": "string",
  "timestamp": "ISO_DATE",
  "insights": [
    {
      "type": "string",
      "title": "string",
      "description": "string",
      "significance": "number",
      "applicability": "string",
      "participants": "string[]"
    }
  ],
  "topics": "string[]",
  "keyDecisions": "string[]",
  "actionItems": "string[]",
  "entities": "Entity[]",
  "relations": "Relation[]"
}
```

### search_web

Performs intelligent web search for technical information and documentation.

**Parameters:**
```json
{
  "query": "string",              // Search query (required)
  "maxResults": "number",         // Maximum results to return (default: 10)
  "searchTypes": "string[]",      // Types: ["documentation", "tutorials", "best-practices"] (optional)
  "filters": {
    "domains": "string[]",        // Specific domains to search (optional)
    "excludeDomains": "string[]", // Domains to exclude (optional)
    "language": "string",         // Content language (optional)
    "timeframe": "string"         // Time constraint: "week", "month", "year" (optional)
  }
}
```

**Response:**
```json
{
  "searchId": "string",
  "query": "string",
  "timestamp": "ISO_DATE",
  "totalResults": "number",
  "results": [
    {
      "url": "string",
      "title": "string",
      "snippet": "string",
      "relevanceScore": "number",
      "source": "string",
      "type": "string"
    }
  ],
  "relatedQueries": "string[]",
  "summary": "string"
}
```

### search_technical_docs

Specialized search for technical documentation and API references.

**Parameters:**
```json
{
  "technology": "string",         // Technology name (required)
  "topic": "string",             // Specific topic or feature (optional)
  "docTypes": "string[]",        // Types: ["api", "tutorial", "guide", "reference"] (optional)
  "officialOnly": "boolean"      // Only official documentation (default: false)
}
```

### create_knowledge_entity

Creates a new entity in the knowledge graph.

**Parameters:**
```json
{
  "name": "string",              // Entity name (required)
  "entityType": "string",        // Type: Pattern, Insight, Technology, etc. (required)
  "significance": "number",      // Significance score 1-10 (required)
  "observations": "string[]",    // Descriptive observations (required)
  "metadata": {
    "technologies": "string[]",  // Related technologies (optional)
    "references": "string[]",    // Reference URLs (optional)
    "codeFiles": "string[]",     // Related code files (optional)
    "source": "string"          // Source of the entity (optional)
  }
}
```

### search_knowledge

Searches the existing knowledge base for entities and insights.

**Parameters:**
```json
{
  "query": "string",             // Search query (required)
  "entityTypes": "string[]",     // Filter by entity types (optional)
  "significanceThreshold": "number", // Minimum significance (optional)
  "limit": "number"              // Maximum results (default: 20)
}
```

### start_workflow

Initiates a complex multi-agent workflow for comprehensive analysis.

**Parameters:**
```json
{
  "workflowType": "string",      // Type: "repository-analysis", "technology-research", etc. (required)
  "parameters": "object",        // Workflow-specific parameters (required)
  "priority": "string",          // Priority: "low", "medium", "high" (default: "medium")
  "notifications": "boolean"     // Enable progress notifications (default: true)
}
```

**Workflow Types:**

#### repository-analysis
```json
{
  "workflowType": "repository-analysis",
  "parameters": {
    "repository": "string",
    "depth": "number",
    "includeSearch": "boolean",
    "searchTopics": "string[]"
  }
}
```

#### technology-research
```json
{
  "workflowType": "technology-research", 
  "parameters": {
    "technology": "string",
    "aspects": "string[]",        // ["documentation", "best-practices", "comparison"]
    "depth": "string"            // "basic", "comprehensive", "expert"
  }
}
```

#### conversation-analysis
```json
{
  "workflowType": "conversation-analysis",
  "parameters": {
    "conversationPath": "string",
    "extractPatterns": "boolean",
    "createEntities": "boolean"
  }
}
```

### sync_with_ukb

Synchronizes knowledge entities with the traditional UKB system.

**Parameters:**
```json
{
  "direction": "string",         // "to_ukb", "from_ukb", "bidirectional" (required)
  "entityFilter": {
    "types": "string[]",         // Filter by entity types (optional)
    "significance": "number",    // Minimum significance (optional)
    "recent": "boolean"          // Only recent entities (optional)
  }
}
```

### get_system_status

Retrieves the health and status of all agents and system components.

**Parameters:** None

**Response:**
```json
{
  "timestamp": "ISO_DATE",
  "overallStatus": "string",     // "healthy", "degraded", "error"
  "agents": [
    {
      "agentId": "string",
      "status": "string",
      "lastHeartbeat": "ISO_DATE",
      "activeRequests": "number",
      "errorCount": "number"
    }
  ],
  "infrastructure": {
    "mqttBroker": "string",
    "rpcServer": "string",
    "knowledgeBase": "string"
  },
  "metrics": {
    "totalEntities": "number",
    "totalRelations": "number",
    "requestsLastHour": "number",
    "averageResponseTime": "number"
  }
}
```

## JSON-RPC API

Direct programmatic access to agent capabilities via JSON-RPC.

### Base URL
```
http://localhost:3001/rpc
```

### Authentication
API key authentication via header:
```
Authorization: Bearer <API_KEY>
```

### Request Format
```json
{
  "jsonrpc": "2.0",
  "method": "string",
  "params": "object",
  "id": "string|number"
}
```

### Response Format
```json
{
  "jsonrpc": "2.0",
  "result": "object",
  "id": "string|number"
}
```

### Error Format
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": "number",
    "message": "string",
    "data": "object"
  },
  "id": "string|number"
}
```

### Methods

#### semantic-analysis.analyzeCode
```json
{
  "method": "semantic-analysis.analyzeCode",
  "params": {
    "repository": "string",
    "depth": "number",
    "options": "object"
  }
}
```

#### semantic-analysis.analyzeConversation
```json
{
  "method": "semantic-analysis.analyzeConversation", 
  "params": {
    "content": "string",
    "metadata": "object"
  }
}
```

#### web-search.search
```json
{
  "method": "web-search.search",
  "params": {
    "query": "string",
    "options": "object"
  }
}
```

#### knowledge-graph.createEntity
```json
{
  "method": "knowledge-graph.createEntity",
  "params": {
    "entity": "Entity"
  }
}
```

#### knowledge-graph.searchEntities
```json
{
  "method": "knowledge-graph.searchEntities",
  "params": {
    "query": "string",
    "filters": "object"
  }
}
```

#### coordinator.startWorkflow
```json
{
  "method": "coordinator.startWorkflow",
  "params": {
    "workflowType": "string",
    "parameters": "object"
  }
}
```

## MQTT Topics

Event-driven communication between agents using MQTT publish/subscribe.

### Broker Configuration
- **Host:** localhost
- **Port:** 1883
- **Authentication:** Optional API key
- **QoS:** 1 (at least once delivery)

### Topic Structure

#### Analysis Events
```
analysis/
├── code/
│   ├── requested           # Code analysis request
│   ├── completed           # Code analysis completed
│   └── failed              # Code analysis failed
├── conversation/
│   ├── requested           # Conversation analysis request
│   ├── completed           # Conversation analysis completed
│   └── failed              # Conversation analysis failed
└── pattern/
    ├── detected            # New pattern detected
    └── validated           # Pattern validation result
```

#### Search Events
```
search/
├── web/
│   ├── requested           # Web search request
│   ├── completed           # Web search completed
│   └── failed              # Web search failed
├── technical-docs/
│   ├── requested           # Technical docs search request
│   └── completed           # Technical docs search completed
└── validation/
    ├── requested           # Reference validation request
    └── completed           # Reference validation completed
```

#### Knowledge Events
```
knowledge/
├── entity/
│   ├── create/requested    # Entity creation request
│   ├── created             # Entity created successfully
│   ├── updated             # Entity updated
│   └── deleted             # Entity deleted
├── relation/
│   ├── create/requested    # Relation creation request
│   ├── created             # Relation created successfully
│   └── updated             # Relation updated
└── sync/
    ├── requested           # Sync with UKB requested
    ├── completed           # Sync completed
    └── failed              # Sync failed
```

#### Workflow Events
```
workflow/
├── started                 # Workflow execution started
├── step/
│   ├── started             # Workflow step started
│   ├── completed           # Workflow step completed
│   └── failed              # Workflow step failed
├── completed               # Workflow completed
├── failed                  # Workflow failed
└── cancelled               # Workflow cancelled
```

#### System Events
```
system/
├── agent/
│   ├── started             # Agent started
│   ├── stopped             # Agent stopped
│   ├── heartbeat           # Agent heartbeat
│   └── error               # Agent error
├── health/
│   ├── check               # Health check request
│   └── status              # Health status update
└── metrics/
    ├── updated             # Metrics updated
    └── alert               # Alert triggered
```

### Message Formats

#### Analysis Request
```json
{
  "requestId": "string",
  "timestamp": "ISO_DATE",
  "type": "code|conversation",
  "parameters": "object",
  "priority": "low|medium|high",
  "requester": "string"
}
```

#### Analysis Completed
```json
{
  "requestId": "string",
  "timestamp": "ISO_DATE",
  "duration": "number",
  "result": "AnalysisResult",
  "agentId": "string"
}
```

#### Search Request
```json
{
  "requestId": "string",
  "timestamp": "ISO_DATE",
  "query": "string",
  "searchType": "web|technical-docs",
  "options": "object",
  "requester": "string"
}
```

#### Entity Created
```json
{
  "entityId": "string",
  "timestamp": "ISO_DATE",
  "entity": "Entity",
  "source": "string",
  "agentId": "string"
}
```

#### Workflow Status
```json
{
  "workflowId": "string",
  "executionId": "string",
  "timestamp": "ISO_DATE",
  "status": "started|completed|failed|cancelled",
  "currentStep": "number",
  "totalSteps": "number",
  "progress": "number",
  "message": "string"
}
```

## Error Codes

### HTTP Status Codes
- **200**: Success
- **400**: Bad Request (invalid parameters)
- **401**: Unauthorized (missing/invalid API key)
- **404**: Not Found (agent/resource not found)
- **429**: Too Many Requests (rate limit exceeded)
- **500**: Internal Server Error
- **503**: Service Unavailable (agent offline)

### JSON-RPC Error Codes
- **-32700**: Parse error
- **-32600**: Invalid Request
- **-32601**: Method not found
- **-32602**: Invalid params
- **-32603**: Internal error
- **-32000**: Agent error
- **-32001**: Analysis failed
- **-32002**: Search failed
- **-32003**: Knowledge operation failed
- **-32004**: Workflow error

### Agent-Specific Error Codes
- **1001**: Repository not found
- **1002**: Invalid commit range
- **1003**: Analysis timeout
- **2001**: Search provider unavailable
- **2002**: Query too broad
- **2003**: No results found
- **3001**: Entity validation failed
- **3002**: Duplicate entity
- **3003**: UKB sync failed
- **4001**: Workflow definition invalid
- **4002**: Workflow execution failed
- **4003**: Step dependency not met

## Rate Limits

### Default Limits
- **MCP Tools**: 100 requests/minute per user
- **JSON-RPC**: 1000 requests/minute per API key
- **MQTT Publishing**: 10 messages/second per client

### LLM Provider Limits
- **Claude API**: Respects Anthropic's rate limits
- **OpenAI API**: Respects OpenAI's rate limits
- **Search APIs**: Respects individual service limits

### Custom Limits
Rate limits can be configured per agent and client in the configuration files.

## Configuration

### Environment Variables
```bash
# API Keys
ANTHROPIC_API_KEY=your_claude_api_key
OPENAI_API_KEY=your_openai_api_key

# System Paths
CODING_TOOLS_PATH=/path/to/coding/tools
CODING_KB_PATH=/path/to/shared-memory.json

# Network Configuration
MQTT_BROKER_URL=mqtt://localhost:1883
RPC_SERVER_PORT=3001
MCP_SERVER_PORT=3000

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Performance
MAX_CONCURRENT_REQUESTS=10
REQUEST_TIMEOUT=30000
CACHE_TTL=3600
```

### Agent Configuration
Configuration files located in `semantic-analysis-system/config/`:
- `agents.yaml` - Agent-specific settings
- `llm-providers.yaml` - LLM provider configuration
- `search-providers.yaml` - Search provider settings
- `knowledge-graph.yaml` - Knowledge graph configuration

## Examples

### Complete Repository Analysis
```javascript
// 1. Start repository analysis workflow
const workflow = await claude.startWorkflow({
  workflowType: "repository-analysis",
  parameters: {
    repository: "/path/to/project",
    depth: 20,
    includeSearch: true,
    searchTopics: ["architecture patterns", "best practices"]
  }
});

// 2. Monitor progress (optional)
const status = await claude.getWorkflowStatus({
  workflowId: workflow.workflowId
});

// 3. Search resulting knowledge
const insights = await claude.searchKnowledge({
  query: "architecture patterns",
  entityTypes: ["Pattern", "Insight"]
});

// 4. Sync with traditional UKB
await claude.syncWithUkb({
  direction: "to_ukb",
  entityFilter: {
    recent: true,
    significance: 7
  }
});
```

### Technology Research
```javascript
// Research Next.js best practices
const research = await claude.startWorkflow({
  workflowType: "technology-research",
  parameters: {
    technology: "Next.js",
    aspects: ["documentation", "best-practices", "performance"],
    depth: "comprehensive"
  }
});
```

### Manual Knowledge Creation
```javascript
// Create a custom pattern entity
const entity = await claude.createKnowledgeEntity({
  name: "React Context Optimization Pattern",
  entityType: "ArchitecturalPattern",
  significance: 8,
  observations: [
    "Optimizes React Context to prevent unnecessary re-renders",
    "Uses multiple context providers for different data domains",
    "Implements context selectors for fine-grained subscriptions"
  ],
  metadata: {
    technologies: ["React", "TypeScript"],
    references: ["https://react.dev/reference/react/useContext"],
    codeFiles: ["src/contexts/OptimizedContext.tsx"]
  }
});
```

## Related Documentation

- [Architecture Overview](./architecture.md)
- [User Guide](./README.md)
- [Deployment Guide](./deployment.md)
- [Troubleshooting](./troubleshooting.md)
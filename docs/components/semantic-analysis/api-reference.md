# Semantic Analysis API Reference

Complete API reference for the semantic analysis components.

For detailed MCP tool documentation, see [MCP Server Documentation](../../integrations/mcp-server-semantic-analysis/README.md).

## Overview

The semantic analysis system provides both MCP (Model Context Protocol) tools and HTTP REST API endpoints for code analysis and knowledge management.

## MCP Tools

Available when connected via Claude Code MCP server.

### analyze_repository

Analyze entire repository for patterns and insights.

**Input Schema**:
```json
{
  "repository": "string (path)",
  "depth": "number (1-50, default: 25)",
  "significanceThreshold": "number (1-10, default: 6)"
}
```

**Example**:
```json
{
  "repository": ".",
  "depth": 25,
  "significanceThreshold": 6
}
```

**Response**:
```json
{
  "insights": [...],
  "patterns": [...],
  "observations": [...],
  "metadata": {
    "filesAnalyzed": 150,
    "duration": 45.3
  }
}
```

### analyze_code

Analyze specific code for patterns, security, or performance issues.

**Input Schema**:
```json
{
  "code": "string",
  "language": "string (optional)",
  "file_path": "string (optional)",
  "analysis_focus": "string (optional: patterns|quality|security|performance|architecture)"
}
```

**Example**:
```json
{
  "code": "function authenticate(user) { return user.password === input; }",
  "language": "javascript",
  "analysis_focus": "security"
}
```

**Response**:
```json
{
  "issues": [
    {
      "type": "security",
      "severity": "high",
      "message": "Direct password comparison without hashing",
      "line": 1,
      "recommendation": "Use bcrypt.compare() or similar"
    }
  ],
  "patterns": [...],
  "metrics": {...}
}
```

### determine_insights

Extract insights from content using LLM analysis.

**Input Schema**:
```json
{
  "content": "string",
  "analysis_type": "string (general|code|patterns|architecture)",
  "context": "string (optional)",
  "provider": "string (optional: anthropic|openai|auto)"
}
```

### extract_patterns

Extract reusable patterns from code.

**Input Schema**:
```json
{
  "source": "string",
  "pattern_types": "array of strings (optional)",
  "context": "string (optional)"
}
```

### create_ukb_entity_with_insight

Create UKB knowledge base entity.

**Input Schema**:
```json
{
  "entity_name": "string",
  "entity_type": "string",
  "insights": "string",
  "significance": "number (1-10, optional)",
  "tags": "array of strings (optional)"
}
```

### execute_workflow

Execute predefined analysis workflow.

**Input Schema**:
```json
{
  "workflow_name": "string (complete-analysis|incremental-analysis|...)",
  "parameters": "object (optional)"
}
```

**Available Workflows**:
- `complete-analysis` - Full repository analysis
- `incremental-analysis` - Analyze only changes
- `conversation-analysis` - Extract from conversations
- `repository-analysis` - Repository structure analysis
- `technology-research` - Research patterns and best practices

### generate_documentation

Generate documentation from analysis results.

**Input Schema**:
```json
{
  "analysis_result": "object",
  "metadata": "object (optional)"
}
```

### create_insight_report

Create detailed insight report with diagrams.

**Input Schema**:
```json
{
  "analysis_result": "object",
  "metadata": "object (optional)"
}
```

### generate_plantuml_diagrams

Generate PlantUML architecture diagrams.

**Input Schema**:
```json
{
  "diagram_type": "string (architecture|sequence|use-cases|class)",
  "content": "string",
  "name": "string",
  "analysis_result": "object (optional)"
}
```

## HTTP REST API

Available via the HTTP proxy server (port 8765).

### Base URL

```
http://localhost:8765/api
```

### Health Check

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "version": "1.0.0"
}
```

### Analyze Repository

**Endpoint**: `POST /semantic/analyze-repository`

**Request**:
```json
{
  "repository": ".",
  "depth": 25,
  "significanceThreshold": 6
}
```

**Response**: Same as MCP `analyze_repository`

### Analyze Code

**Endpoint**: `POST /semantic/analyze-code`

**Request**:
```json
{
  "code": "...",
  "language": "typescript",
  "analysis_focus": "security"
}
```

**Response**: Same as MCP `analyze_code`

### Execute Workflow

**Endpoint**: `POST /semantic/execute-workflow`

**Request**:
```json
{
  "workflow_name": "repository-analysis",
  "parameters": {}
}
```

**Response**: Workflow execution results

### Get Status

**Endpoint**: `GET /status`

**Response**:
```json
{
  "server": {
    "status": "running",
    "startTime": "2025-01-15T10:00:00Z",
    "uptime": 3600
  },
  "agents": [...],
  "resources": {...}
}
```

### Get Metrics

**Endpoint**: `GET /metrics`

**Response**:
```json
{
  "requests": {
    "total": 150,
    "successful": 145,
    "failed": 5
  },
  "performance": {
    "averageDuration": 2.5,
    "p95Duration": 5.2,
    "p99Duration": 8.1
  },
  "cache": {
    "hits": 80,
    "misses": 70,
    "hitRate": 0.533
  }
}
```

## Error Responses

All APIs return errors in this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {...}
  }
}
```

**Common Error Codes**:
- `INVALID_INPUT` - Invalid request parameters
- `API_ERROR` - External API failure
- `TIMEOUT` - Operation timed out
- `NOT_FOUND` - Resource not found
- `RATE_LIMIT` - Rate limit exceeded
- `INTERNAL_ERROR` - Internal server error

## Rate Limits

- **MCP**: No explicit limits (controlled by Claude Code)
- **HTTP API**: 50 requests/minute, 80,000 tokens/minute

## Authentication

- **MCP**: Authenticated via Claude Code
- **HTTP API**: Local access only (no authentication required)

## See Also

- [MCP Server Documentation](../../integrations/mcp-server-semantic-analysis/README.md)
- [Tool Extensions](../../integrations/mcp-server-semantic-analysis/docs/architecture/tools.md)
- [Integration Patterns](../../integrations/mcp-server-semantic-analysis/docs/architecture/integration.md)
- [Use Cases](../../integrations/mcp-server-semantic-analysis/docs/use-cases/README.md)

# API Reference

MCP tools and REST API endpoints.

## MCP Tools

### Semantic Analysis

| Tool | Description |
|------|-------------|
| `heartbeat` | Connection health monitoring |
| `test_connection` | Server connectivity verification |
| `determine_insights` | AI-powered content analysis |
| `analyze_code` | Code pattern and quality analysis |
| `analyze_repository` | Repository-wide architecture analysis |
| `extract_patterns` | Design pattern identification |
| `create_ukb_entity_with_insight` | Knowledge base entity creation |
| `execute_workflow` | Multi-agent workflows |
| `generate_documentation` | Automated documentation |
| `create_insight_report` | Detailed analysis reports |
| `generate_plantuml_diagrams` | Architecture diagrams |
| `reset_analysis_checkpoint` | Reset checkpoints |
| `refresh_entity` | Refresh knowledge entity |
| `analyze_code_graph` | AST-based code analysis |

### Constraint Monitor

| Tool | Description |
|------|-------------|
| `check_constraints` | Validate against constraints |
| `get_constraint_status` | Current compliance metrics |
| `get_violation_history` | Past violations |
| `update_constraints` | Modify constraint rules |

### Browser Access

| Tool | Description |
|------|-------------|
| `stagehand_navigate` | Navigate to URL |
| `stagehand_act` | Perform page actions |
| `stagehand_extract` | Extract page text |
| `stagehand_observe` | Find actionable elements |
| `screenshot` | Capture page screenshot |

### Code Graph RAG

| Tool | Description |
|------|-------------|
| `index_repository` | Build code graph |
| `query_code_graph` | Natural language queries |
| `get_code_snippet` | Retrieve source code |
| `surgical_replace_code` | Targeted code replacement |
| `comprehensive_analysis` | LLM-powered analysis |

## REST APIs

### Constraint Monitor API (Port 3031)

#### List Violations

```bash
GET /api/violations?project=coding
```

Response:

```json
{
  "violations": [
    {
      "id": "uuid",
      "constraintId": "no-logging-statements",
      "severity": "warning",
      "message": "Avoid logging statements",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ],
  "total": 1
}
```

#### Log Violation

```bash
POST /api/violations
Content-Type: application/json

{
  "constraintId": "no-logging-statements",
  "severity": "warning",
  "message": "Logging statement found in file.js",
  "project": "coding"
}
```

#### Get Compliance

```bash
GET /api/compliance/coding
```

Response:

```json
{
  "score": 9.5,
  "violations": 1,
  "trend": "improving"
}
```

#### List Constraints

```bash
GET /api/constraints
```

#### Health Check

```bash
GET /api/health
```

### Health Dashboard API (Port 3033)

#### Overall Health

```bash
GET /api/health
```

Response:

```json
{
  "status": "healthy",
  "services": {
    "lsl": "healthy",
    "ukb": "healthy",
    "constraints": "healthy"
  },
  "uptime": 3600
}
```

#### Service Status

```bash
GET /api/services
```

#### Metrics History

```bash
GET /api/metrics?range=24h
```

#### Alerts

```bash
GET /api/alerts?limit=10
```

### VKB Server API (Port 8080)

#### List Entities

```bash
GET /api/entities?team=coding
```

#### Get Entity

```bash
GET /api/entities/:id
```

#### Search

```bash
GET /api/search?q=authentication&type=ImplementationPattern
```

#### Graph Data

```bash
GET /api/graph?team=coding
```

## Agent Integration

### AgentAdapter Interface

```typescript
interface AgentAdapter {
  // Identification
  getName(): string;
  getVersion(): string;

  // Capabilities
  supportsMemory(): boolean;
  supportsBrowser(): boolean;
  supportsHooks(): boolean;

  // Operations
  initialize(config: AgentConfig): Promise<void>;
  createMemory(key: string, value: any): Promise<void>;
  searchMemory(query: string): Promise<Memory[]>;
  readMemory(key: string): Promise<any>;
}
```

### Required APIs for New Agents

| API | Purpose |
|-----|---------|
| Transcript generation | JSONL format session logs |
| Memory operations | create/search/read |
| Browser automation | navigate/act/extract |
| Hook support | PreToolUse/PostToolUse |

### Integration Steps

1. Implement `AgentAdapter` interface
2. Register in `agent-registry.js`
3. Add detection in `agent-detector.js`
4. Create launcher script `launch-{agent}.sh`
5. Update `bin/coding` routing
6. Test with validation commands

## Webhook Events

### Constraint Violations

```json
{
  "event": "constraint.violation",
  "data": {
    "constraintId": "no-hardcoded-secrets",
    "severity": "critical",
    "project": "coding",
    "blocked": true
  }
}
```

### Health Alerts

```json
{
  "event": "health.alert",
  "data": {
    "service": "lsl",
    "status": "degraded",
    "message": "High memory usage"
  }
}
```

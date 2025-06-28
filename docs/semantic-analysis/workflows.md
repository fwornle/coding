# Semantic Analysis System - Workflow Guide

This guide provides detailed information about using workflows in the semantic analysis system for complex, multi-step analysis tasks.

## Overview

Workflows allow you to orchestrate multiple agents to perform comprehensive analysis tasks that would be difficult or time-consuming to do manually. Each workflow is a sequence of steps executed across different agents, with automatic error handling, progress tracking, and result aggregation.

## Available Workflows

### 1. Repository Analysis Workflow

Comprehensive analysis of a code repository including pattern detection, technology identification, and best practice research.

**Use Cases:**
- Initial project analysis for new team members
- Architecture review and documentation
- Technology stack assessment
- Code quality evaluation

**Workflow Steps:**
1. **analyze-repository** → Semantic Analysis Agent
2. **extract-technologies** → Transform step
3. **search-best-practices** → Web Search Agent
4. **create-knowledge-entities** → Knowledge Graph Agent
5. **sync-with-ukb** → Knowledge Graph Agent

**Example Usage:**
```json
{
  "workflowType": "repository-analysis",
  "parameters": {
    "repository": "/path/to/project",
    "depth": 25,
    "significanceThreshold": 6,
    "includeSearch": true,
    "searchTopics": [
      "React best practices",
      "Node.js architecture patterns",
      "TypeScript patterns"
    ],
    "analysisTypes": ["patterns", "architecture", "performance"],
    "excludeFiles": ["node_modules/**", "dist/**", "*.test.js"]
  }
}
```

**Expected Duration:** 3-8 minutes depending on repository size

**Output:**
- Extracted patterns and architectural insights
- Technology stack analysis
- Best practice recommendations
- Knowledge entities created in the graph
- UKB integration completed

### 2. Technology Research Workflow

In-depth research on a specific technology, including documentation, best practices, comparisons, and implementation examples.

**Use Cases:**
- Evaluating new technologies for adoption
- Creating technology documentation
- Training material preparation
- Architecture decision support

**Workflow Steps:**
1. **search-documentation** → Web Search Agent
2. **search-best-practices** → Web Search Agent
3. **search-comparisons** → Web Search Agent
4. **search-tutorials** → Web Search Agent
5. **analyze-results** → Semantic Analysis Agent
6. **create-summary-entity** → Knowledge Graph Agent

**Example Usage:**
```json
{
  "workflowType": "technology-research",
  "parameters": {
    "technology": "Svelte",
    "aspects": [
      "documentation",
      "best-practices",
      "comparison",
      "tutorials",
      "performance"
    ],
    "depth": "comprehensive",
    "includeComparisons": ["React", "Vue.js", "Angular"],
    "focusAreas": ["component architecture", "state management", "routing"]
  }
}
```

**Expected Duration:** 2-5 minutes

**Output:**
- Comprehensive technology overview
- Best practice compilation
- Comparison with similar technologies
- Tutorial and learning resource links
- Implementation recommendations

### 3. Conversation Analysis Workflow

Extracts insights, decisions, and knowledge from conversation logs or meeting transcripts.

**Use Cases:**
- Meeting minutes analysis
- Design decision documentation
- Knowledge extraction from discussions
- Action item identification

**Workflow Steps:**
1. **analyze-conversation** → Semantic Analysis Agent
2. **extract-insights** → Transform step
3. **identify-decisions** → Transform step
4. **search-related-topics** → Web Search Agent
5. **create-knowledge-entities** → Knowledge Graph Agent
6. **update-relationships** → Knowledge Graph Agent

**Example Usage:**
```json
{
  "workflowType": "conversation-analysis",
  "parameters": {
    "conversationPath": "/path/to/meeting-transcript.md",
    "participantRoles": ["architect", "developer", "product-manager"],
    "extractPatterns": true,
    "createEntities": true,
    "significanceThreshold": 5,
    "topicAreas": ["architecture", "implementation", "timeline"]
  }
}
```

**Expected Duration:** 1-3 minutes

**Output:**
- Key insights and decisions
- Action items with assignments
- Technical discussions summary
- Related knowledge entities
- Cross-references with existing knowledge

### 4. Pattern Detection Workflow

Identifies and validates patterns across multiple repositories or codebases.

**Use Cases:**
- Code pattern standardization
- Architecture consistency checking
- Best practice enforcement
- Code review automation

**Workflow Steps:**
1. **scan-repositories** → Semantic Analysis Agent
2. **detect-patterns** → Semantic Analysis Agent
3. **validate-patterns** → Transform step
4. **search-pattern-docs** → Web Search Agent
5. **create-pattern-entities** → Knowledge Graph Agent
6. **generate-recommendations** → Transform step

**Example Usage:**
```json
{
  "workflowType": "pattern-detection",
  "parameters": {
    "repositories": [
      "/path/to/repo1",
      "/path/to/repo2",
      "/path/to/repo3"
    ],
    "patternTypes": ["architectural", "design", "anti-patterns"],
    "technologies": ["React", "TypeScript", "Node.js"],
    "includeRecommendations": true,
    "validationLevel": "strict"
  }
}
```

### 5. Knowledge Migration Workflow

Migrates and enhances existing knowledge from various sources into the semantic analysis system.

**Use Cases:**
- Legacy documentation migration
- Knowledge base consolidation
- Data quality improvement
- Cross-system integration

**Workflow Steps:**
1. **analyze-source-data** → Semantic Analysis Agent
2. **extract-entities** → Transform step
3. **enhance-metadata** → Semantic Analysis Agent
4. **search-references** → Web Search Agent
5. **create-enhanced-entities** → Knowledge Graph Agent
6. **establish-relationships** → Knowledge Graph Agent

**Example Usage:**
```json
{
  "workflowType": "knowledge-migration",
  "parameters": {
    "sourceType": "markdown",
    "sourcePath": "/path/to/docs/",
    "enhanceMetadata": true,
    "searchReferences": true,
    "qualityThreshold": 6,
    "preserveStructure": true
  }
}
```

## Custom Workflows

You can create custom workflows by defining a sequence of steps with specific parameters.

### Creating a Custom Workflow

```json
{
  "workflowType": "custom",
  "name": "React Performance Analysis",
  "parameters": {
    "steps": [
      {
        "id": "analyze-components",
        "type": "agent",
        "agent": "semantic-analysis",
        "method": "analyzeCode",
        "parameters": {
          "repository": "{repository}",
          "focusPatterns": ["performance", "optimization"]
        }
      },
      {
        "id": "search-optimizations",
        "type": "agent",
        "agent": "web-search",
        "method": "search",
        "parameters": {
          "query": "React performance optimization {technologies}",
          "searchTypes": ["best-practices", "documentation"]
        },
        "dependencies": ["analyze-components"]
      },
      {
        "id": "create-report",
        "type": "transform",
        "transformer": "performance-report-generator",
        "parameters": {
          "includeRecommendations": true,
          "format": "markdown"
        },
        "dependencies": ["analyze-components", "search-optimizations"]
      }
    ]
  }
}
```

### Parallel Execution

Some steps can be executed in parallel to improve performance:

```json
{
  "id": "parallel-search",
  "type": "parallel",
  "steps": [
    {
      "id": "search-docs",
      "type": "agent",
      "agent": "web-search",
      "method": "searchTechnicalDocs",
      "parameters": {
        "technology": "{technology}",
        "docTypes": ["api", "guide"]
      }
    },
    {
      "id": "search-tutorials",
      "type": "agent", 
      "agent": "web-search",
      "method": "search",
      "parameters": {
        "query": "{technology} tutorials",
        "searchTypes": ["tutorials"]
      }
    }
  ]
}
```

### Conditional Steps

Steps can be executed conditionally based on previous results:

```json
{
  "id": "conditional-analysis",
  "type": "conditional",
  "condition": {
    "field": "previous.result.significance",
    "operator": ">=",
    "value": 8
  },
  "trueBranch": [
    {
      "id": "deep-analysis",
      "type": "agent",
      "agent": "semantic-analysis",
      "method": "analyzeConversation",
      "parameters": {
        "depth": "comprehensive"
      }
    }
  ],
  "falseBranch": [
    {
      "id": "basic-analysis",
      "type": "agent",
      "agent": "semantic-analysis", 
      "method": "analyzeConversation",
      "parameters": {
        "depth": "basic"
      }
    }
  ]
}
```

## Workflow Execution

### Starting a Workflow

**Via MCP Tools (Claude Code):**
```
start_workflow {
  "workflowType": "repository-analysis",
  "parameters": {
    "repository": "/path/to/project",
    "depth": 15
  }
}
```

**Via JSON-RPC API:**
```json
{
  "jsonrpc": "2.0",
  "method": "coordinator.startWorkflow",
  "params": {
    "workflowType": "repository-analysis",
    "parameters": {
      "repository": "/path/to/project", 
      "depth": 15
    }
  },
  "id": "1"
}
```

**Via Command Line:**
```bash
semantic-cli workflow start \
  --type repository-analysis \
  --repository /path/to/project \
  --depth 15
```

### Monitoring Progress

**Check Status:**
```
get_workflow_status {
  "workflowId": "workflow_uuid"
}
```

**Response:**
```json
{
  "workflowId": "workflow_uuid",
  "executionId": "execution_uuid", 
  "status": "running",
  "currentStep": 2,
  "totalSteps": 5,
  "progress": 40,
  "startTime": "2024-01-15T10:30:00Z",
  "estimatedCompletion": "2024-01-15T10:35:00Z",
  "steps": [
    {
      "stepId": "analyze-repository",
      "status": "completed",
      "duration": 45000,
      "result": "AnalysisResult"
    },
    {
      "stepId": "extract-technologies",
      "status": "running",
      "startTime": "2024-01-15T10:31:00Z"
    }
  ]
}
```

### Progress Notifications

Enable real-time progress updates via MQTT:

**Subscribe to workflow events:**
```
workflow/+/started
workflow/+/step/+/completed
workflow/+/completed
workflow/+/failed
```

**Example notification:**
```json
{
  "workflowId": "workflow_uuid",
  "executionId": "execution_uuid",
  "event": "step.completed",
  "stepId": "analyze-repository",
  "timestamp": "2024-01-15T10:31:00Z",
  "duration": 45000,
  "nextStep": "extract-technologies"
}
```

## Error Handling and Recovery

### Automatic Retry

Failed steps are automatically retried with exponential backoff:

```yaml
retryPolicy:
  maxAttempts: 3
  initialDelay: 1000      # 1 second
  maxDelay: 30000         # 30 seconds
  backoffMultiplier: 2.0
  retryableErrors:
    - NETWORK_ERROR
    - TIMEOUT_ERROR
    - RATE_LIMIT_ERROR
```

### Step Recovery

If a step fails permanently, the workflow can continue with alternative steps:

```json
{
  "id": "resilient-search",
  "type": "agent",
  "agent": "web-search",
  "method": "search",
  "parameters": {
    "query": "React patterns"
  },
  "fallback": {
    "type": "agent",
    "agent": "web-search", 
    "method": "searchTechnicalDocs",
    "parameters": {
      "technology": "React",
      "topic": "patterns"
    }
  }
}
```

### Workflow Recovery

Failed workflows can be resumed from the last successful step:

```
resume_workflow {
  "executionId": "execution_uuid",
  "fromStep": "extract-technologies"
}
```

## Performance Optimization

### Caching

Results are automatically cached to improve performance:

```yaml
caching:
  enabled: true
  ttl: 3600              # 1 hour
  strategy: "content-hash"
  excludeSteps:
    - "real-time-analysis"
    - "time-sensitive-search"
```

### Parallel Execution

Independent steps are automatically executed in parallel:

```json
{
  "parallelSteps": [
    "search-documentation",
    "search-best-practices", 
    "search-tutorials"
  ],
  "maxConcurrency": 3
}
```

### Resource Management

Workflows respect system resource limits:

```yaml
resourceLimits:
  maxConcurrentWorkflows: 5
  maxMemoryPerWorkflow: "1GB"
  maxDurationPerWorkflow: "10m"
  priorityLevels:
    high: 3
    medium: 2  
    low: 1
```

## Workflow Templates

### Repository Onboarding Template

```json
{
  "name": "Repository Onboarding",
  "description": "Complete analysis for new repository",
  "steps": [
    {
      "id": "initial-scan",
      "type": "agent",
      "agent": "semantic-analysis",
      "method": "analyzeCode",
      "parameters": {
        "repository": "{repository}",
        "depth": 10,
        "analysisTypes": ["overview", "architecture"]
      }
    },
    {
      "id": "technology-research",
      "type": "workflow",
      "workflowType": "technology-research",
      "parameters": {
        "technology": "{primaryTechnology}",
        "depth": "basic"
      },
      "dependencies": ["initial-scan"]
    },
    {
      "id": "create-documentation",
      "type": "transform",
      "transformer": "documentation-generator",
      "parameters": {
        "format": "markdown",
        "sections": ["overview", "architecture", "setup", "contributing"]
      },
      "dependencies": ["initial-scan", "technology-research"]
    }
  ]
}
```

### Weekly Analysis Template

```json
{
  "name": "Weekly Repository Analysis",
  "description": "Weekly analysis of repository changes",
  "schedule": "0 9 * * 1",  // Every Monday at 9 AM
  "steps": [
    {
      "id": "analyze-recent-commits",
      "type": "agent",
      "agent": "semantic-analysis", 
      "method": "analyzeCode",
      "parameters": {
        "repository": "{repository}",
        "timeRange": "1w",
        "significanceThreshold": 6
      }
    },
    {
      "id": "update-patterns",
      "type": "agent",
      "agent": "knowledge-graph",
      "method": "updateEntities",
      "parameters": {
        "source": "weekly-analysis",
        "autoMerge": true
      },
      "dependencies": ["analyze-recent-commits"]
    }
  ]
}
```

## Best Practices

### Workflow Design

1. **Keep Steps Focused:** Each step should have a single, clear responsibility
2. **Use Parallel Execution:** Identify independent steps that can run in parallel
3. **Plan for Failures:** Include fallback strategies and retry policies
4. **Optimize Performance:** Cache results and reuse computations where possible
5. **Monitor Progress:** Provide meaningful progress updates and logging

### Parameter Management

1. **Use Variables:** Parameterize workflows for reusability
2. **Validate Inputs:** Check parameters before starting execution
3. **Provide Defaults:** Set sensible default values for optional parameters
4. **Document Parameters:** Clearly document what each parameter does

### Error Handling

1. **Graceful Degradation:** Continue workflow execution when possible
2. **Meaningful Errors:** Provide clear error messages and troubleshooting steps
3. **Rollback Capability:** Allow workflows to undo changes if needed
4. **Notification Strategy:** Alert appropriate stakeholders of failures

### Testing Workflows

1. **Unit Test Steps:** Test individual workflow steps in isolation
2. **Integration Testing:** Test complete workflow execution
3. **Performance Testing:** Validate workflow performance under load
4. **Error Scenario Testing:** Test failure and recovery scenarios

## Related Documentation

- [API Reference](./api-reference.md) - Detailed API documentation
- [Architecture](./architecture.md) - System architecture overview
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
- [Configuration](./configuration.md) - System configuration guide
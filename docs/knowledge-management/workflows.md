# Knowledge Workflows

**Purpose**: Orchestrated analysis workflows for comprehensive knowledge gathering

---

## Overview

Knowledge workflows are predefined sequences of semantic analysis operations that coordinate multiple agents and systems to provide comprehensive analysis capabilities. They automate complex analysis tasks that would otherwise require multiple manual steps.

### What Are Workflows?

Workflows are **automated orchestrations** that can:

- Analyze multiple aspects of a project simultaneously
- Coordinate different types of analysis (code, documentation, web research)
- Provide comprehensive reports with actionable insights
- Run as scheduled tasks for continuous knowledge gathering
- Chain multiple workflows for complex analysis pipelines

---

## Available Workflow Types

### 1. Repository Analysis Workflow

**Purpose**: Comprehensive codebase analysis including patterns, architecture, and best practices

**What it does:**
1. Analyzes git history and commit patterns
2. Identifies architectural patterns and anti-patterns
3. Searches for relevant documentation and best practices
4. Creates knowledge entities automatically
5. Generates architectural insights report

**Claude Code Example:**
```
start_workflow {
  "workflowType": "repository-analysis",
  "parameters": {
    "repository": "/path/to/project",
    "depth": 25,
    "significanceThreshold": 6,
    "includeWebSearch": true,
    "technologies": ["React", "Express", "MongoDB"],
    "focusAreas": ["architecture", "patterns", "testing"]
  }
}
```

### 2. Conversation Analysis Workflow

**Purpose**: Extract structured insights from team discussions, code reviews, and documentation

**What it does:**
1. Processes conversation transcripts or logs
2. Identifies key decisions and rationale
3. Extracts technical patterns and solutions
4. Creates knowledge entities for future reference
5. Links insights to relevant code or documentation

**Example:**
```
analyze_conversation {
  "conversationPath": "./team-discussion.md",
  "extractInsights": true,
  "updateKnowledge": true,
  "focusAreas": ["decisions", "tradeoffs", "technical-requirements"]
}
```

### 3. Technology Research Workflow

**Purpose**: Comprehensive research on specific technologies, frameworks, or approaches

**What it does:**
1. Searches multiple documentation sources
2. Gathers best practices and common patterns
3. Identifies potential issues and solutions
4. Creates comparative analysis
5. Builds knowledge base of technology insights

**Example:**
```
start_workflow {
  "workflowType": "technology-research",
  "parameters": {
    "technology": "GraphQL vs REST",
    "aspects": ["performance", "scalability", "developer-experience"],
    "includeComparisons": true,
    "searchDomains": ["docs.", "blog.", "github.com"],
    "maxResults": 20
  }
}
```

### 4. Cross-Project Learning Workflow

**Purpose**: Analyze patterns, solutions, and insights across multiple projects

**What it does:**
1. Identifies similar patterns across projects
2. Extracts cross-project best practices
3. Finds reusable solutions and architectures
4. Tracks pattern effectiveness across teams
5. Generates recommendations based on multi-project experience

**Example:**
```
start_workflow {
  "workflowType": "cross-project-analysis",
  "parameters": {
    "projects": ["/proj-a", "/proj-b", "/proj-c"],
    "patternTypes": ["architectural", "performance", "security"],
    "minimumSimilarity": 0.7
  }
}
```

---

## Workflow Execution

### Monitoring Progress

```
# Check workflow status
get_workflow_status {
  "workflowId": "repo-analysis-20241129-001"
}
```

**Response:**
```json
{
  "id": "repo-analysis-20241129-001",
  "status": "running",
  "progress": 65,
  "currentStep": {
    "name": "Searching for React patterns documentation",
    "phase": "web-research"
  },
  "results": {
    "patternsFound": 12,
    "insightsExtracted": 8,
    "entitiesCreated": 15
  }
}
```

### Viewing Results

```
# Search for workflow results
search_knowledge {
  "query": "architecture patterns",
  "entityType": "ArchitecturalPattern",
  "maxResults": 10
}
```

---

## Workflow Benefits

### Automated Orchestration

- No need to manually run multiple analysis steps
- Coordinated execution across different agent types
- Automatic error recovery and retry logic
- Background execution doesn't block development work

### Comprehensive Coverage

- Multiple analysis dimensions in single operation
- Web research integrated with code analysis
- Knowledge graph automatically updated
- Cross-referencing between different analysis types

### Time Efficiency

- Parallel processing across multiple agents
- Results accumulated over time
- Scheduled execution for continuous learning
- Incremental updates avoid duplicate work

### Consistent Results

- Standardized analysis approaches
- Repeatable processes across projects
- Quality thresholds maintained automatically
- Best practices applied consistently

---

## Advanced Features

### Scheduled Workflows

Run workflows on a schedule for continuous knowledge gathering:

```
schedule_task {
  "taskName": "weekly-pattern-analysis",
  "taskType": "workflow",
  "schedule": {
    "type": "cron",
    "expression": "0 9 * * 1"  // Every Monday at 9 AM
  },
  "config": {
    "workflowType": "repository-analysis",
    "parameters": {
      "repository": ".",
      "depth": 10,
      "significanceThreshold": 7
    }
  }
}
```

### Custom Workflow Parameters

Fine-tune workflow behavior with detailed parameters:

```
start_workflow {
  "workflowType": "repository-analysis",
  "parameters": {
    "repository": ".",
    "depth": 30,
    "significanceThreshold": 5,
    "includeWebSearch": true,
    "excludePatterns": ["test/**", "node_modules/**"],
    "focusAreas": ["security", "performance", "maintainability"],
    "technologies": ["TypeScript", "React", "Express"],
    "outputFormat": "detailed"
  }
}
```

### Workflow Chaining

Chain workflows to create complex analysis pipelines:

```
start_workflow {
  "workflowType": "conversation-analysis",
  "parameters": {
    "conversationPath": "./team-discussion.md",
    "followUpWorkflows": [
      {
        "type": "technology-research",
        "triggerOn": "new-technology-mentioned",
        "parameters": {
          "technology": "${mentioned_technology}",
          "aspects": ["documentation", "best-practices"]
        }
      }
    ]
  }
}
```

---

## Use Cases

### Starting a New Project

Use repository analysis workflow to understand inherited codebase:

```
# Analyze inherited project
start_workflow {
  "workflowType": "repository-analysis",
  "parameters": {
    "repository": "/path/to/inherited-project",
    "depth": 25,
    "significanceThreshold": 6,
    "includeWebSearch": true,
    "technologies": ["React", "Express", "MongoDB"],
    "focusAreas": ["architecture", "patterns", "testing"]
  }
}

# Wait for completion and view results
search_knowledge {
  "query": "architecture patterns inherited-project",
  "entityType": "ArchitecturalPattern"
}
```

### Technology Evaluation

Research technologies before making architectural decisions:

```
start_workflow {
  "workflowType": "technology-research",
  "parameters": {
    "technology": "GraphQL vs REST",
    "aspects": ["performance", "scalability", "developer-experience", "tooling"],
    "includeComparisons": true,
    "searchDomains": ["docs.", "blog.", "github.com"]
  }
}
```

### Capturing Team Discussions

Extract insights from architectural discussions:

```
# Save conversation to file
echo "## Architecture Discussion - API Design
**Decision**: Use GraphQL with query complexity analysis
**Rationale**: Mobile team needs flexible querying, REST causes over-fetching
**Tradeoffs**: Added complexity in query analysis, but better mobile UX
" > conversation.md

# Analyze conversation
analyze_conversation {
  "conversationPath": "./conversation.md",
  "extractInsights": true,
  "updateKnowledge": true,
  "focusAreas": ["decisions", "tradeoffs", "technical-requirements"]
}
```

### Cross-Project Pattern Discovery

Find reusable patterns across multiple projects:

```
start_workflow {
  "workflowType": "cross-project-analysis",
  "parameters": {
    "projects": ["/project-a", "/project-b", "/project-c"],
    "patternTypes": ["architectural", "performance", "security"],
    "minimumSimilarity": 0.7,
    "generateReport": true
  }
}
```

---

## When to Use Workflows

### Use Workflows When:

- ✅ Analyzing large or complex codebases
- ✅ Need comprehensive analysis across multiple dimensions
- ✅ Want to research technologies or approaches thoroughly
- ✅ Have long conversations/documents to process
- ✅ Setting up recurring analysis for teams
- ✅ Coordinating multiple analysis types

### Use Direct Commands When:

- ✅ Quick single-purpose analysis
- ✅ Testing specific functionality
- ✅ Manual knowledge entry
- ✅ Immediate feedback needed
- ✅ Simple, focused operations

---

## Integration with Knowledge Management

### Automatic Knowledge Base Updates

Workflows automatically update the knowledge base with findings:

```bash
# Run workflow
start_workflow { "workflowType": "repository-analysis", ... }

# View updated knowledge
vkb

# Search for workflow results
ukb search "patterns"
```

### MCP Memory Integration

Workflows integrate with MCP memory service for real-time knowledge access:

```javascript
// Knowledge automatically available in MCP memory
const results = await mcp.call('mcp__memory__search_nodes', {
  query: "workflow results"
});
```

---

## Workflow Configuration

Configure workflows in semantic analysis system:

```yaml
# config/agents.yaml
agents:
  semantic-analysis:
    workflows:
      repository-analysis:
        enabled: true
        defaultDepth: 20
        significanceThreshold: 6
        includeWebSearch: true
      conversation-analysis:
        enabled: true
        extractDecisions: true
        extractPatterns: true
      technology-research:
        enabled: true
        searchDomains: ["docs.", "blog.", "github.com"]
      cross-project:
        enabled: true
        minimumSimilarity: 0.7
```

---

## Troubleshooting

### Check Workflow Status

```
# Get system status
get_system_status {}

# View active workflows
search_knowledge {
  "query": "workflow",
  "entityType": "WorkflowExecution"
}
```

### Cancel Running Workflow

```bash
# Via API
curl -X DELETE http://localhost:8765/api/workflows/repo-analysis-20241129-001
```

### Debug Workflow Issues

```bash
# Check semantic analysis server logs
vkb logs --follow

# View workflow execution history
ukb search "workflow execution"

# Check MCP memory service
curl http://localhost:8765/health
```

---

## See Also

- [UKB - Update Knowledge Base](./ukb-update.md)
- [VKB - Visualize Knowledge Base](./vkb-visualize.md)
- [Semantic Analysis](../integrations/semantic-analysis.md)
- [Knowledge Management Overview](./README.md)

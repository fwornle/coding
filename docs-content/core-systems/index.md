# Core Systems

The coding infrastructure consists of six interconnected systems that work together to create a self-improving development experience.

![Complete System Overview](../images/complete-system-overview.png)

---

## System Overview

<div class="grid cards" markdown>

-   :material-file-document-multiple:{ .lg .middle } **Live Session Logging (LSL)**

    ---

    Captures every Claude conversation automatically with intelligent 5-layer classification that routes content between projects.

    ![LSL Architecture](../images/lsl-architecture.png)

    - Real-time monitoring with zero data loss
    - Automatic secret redaction
    - Multi-project content routing

    [:octicons-arrow-right-24: Learn more](lsl.md)

-   :material-brain:{ .lg .middle } **Knowledge Management (UKB/VKB)**

    ---

    14-agent AI system extracts insights from git history and conversation logs, building a searchable knowledge graph.

    ![UKB Workflow](../images/ukb-workflow-multi-agent-topology.png)

    - Incremental and full analysis modes
    - Graph + vector database storage
    - Interactive web visualization

    [:octicons-arrow-right-24: Learn more](ukb-vkb.md)

-   :material-shield-check:{ .lg .middle } **Constraint System**

    ---

    20+ configurable constraints enforce code quality via PreToolUse hooks - preventing mistakes before they happen.

    ![Constraint Dashboard](../images/constraint-dashboard.png)

    - Real-time violation detection
    - Web dashboard monitoring
    - Auto-correction suggestions

    [:octicons-arrow-right-24: Learn more](constraints.md)

-   :material-compass:{ .lg .middle } **Trajectory Detection**

    ---

    Tracks development progress and detects when you're deviating from your goals.

    ![Trajectory Analysis](../images/real-time-trajectory-analysis-flow.png)

    - Real-time state tracking
    - Goal deviation alerts
    - Status line integration

    [:octicons-arrow-right-24: Learn more](trajectories.md)

-   :material-heart-pulse:{ .lg .middle } **Health Monitoring**

    ---

    4-layer watchdog architecture ensures system reliability with automatic recovery.

    ![Health Monitor](../images/health-monitoring-overview.png)

    - Process health monitoring
    - Automatic restart on failure
    - Multi-agent workflow visualization

    [:octicons-arrow-right-24: Learn more](../architecture/health-monitoring.md)

-   :material-information-outline:{ .lg .middle } **Status Line**

    ---

    Real-time feedback in your terminal showing system health, API costs, and development state.

    ![Status Line](../images/status-line-display.png)

    - Service health indicators
    - Cost tracking display
    - Trajectory and LSL status

    [:octicons-arrow-right-24: Learn more](../guides/status-line.md)

</div>

---

## How They Work Together

```mermaid
flowchart TB
    subgraph Input["Claude Session"]
        A[User Prompt]
        B[Tool Calls]
        C[Responses]
    end

    subgraph LSL["Live Session Logging"]
        D[Monitor] --> E[5-Layer Classifier]
        E --> F[Redactor]
        F --> G{Route}
        G -->|Local| H[Project History]
        G -->|Coding| I[Coding History]
    end

    subgraph KB["Knowledge Management"]
        J[UKB Workflow] --> K[14 Agents]
        K --> L[Graph DB]
        K --> M[Vector DB]
        L --> N[VKB Viewer]
    end

    subgraph Constraints["Constraint System"]
        O[PreToolUse Hook] --> P[Validator]
        P --> Q{Compliant?}
        Q -->|No| R[Block + Suggest Fix]
        Q -->|Yes| S[Allow]
    end

    subgraph Feedback["Feedback Systems"]
        T[Status Line]
        U[Health Monitor]
        V[Trajectory Analyzer]
    end

    A --> D
    B --> O
    H --> J
    I --> J
    U --> T
    V --> T
```

---

## Quick Command Reference

| System | Command | Description |
|--------|---------|-------------|
| **LSL** | Automatic | Runs in background, no commands needed |
| **UKB** | `ukb` | Incremental knowledge update |
| **UKB** | `ukb full` | Full analysis from first commit |
| **UKB** | `ukb debug` | Debug mode with mocked LLM |
| **VKB** | `vkb` | Open knowledge viewer at `localhost:8080` |
| **Constraints** | Dashboard | View at `localhost:3030` |
| **Health** | `coding --health` | Check all service health |
| **Health** | Dashboard | View at `localhost:3032` |

---

## Data Flow

The systems interact through shared data stores:

```mermaid
flowchart LR
    subgraph Storage["Data Storage"]
        A[(".specstory/history/\nLSL Files")]
        B[(".data/knowledge-graph/\nGraph DB")]
        C[(".data/vector-store/\nVector DB")]
        D[(".health/\nHealth Files")]
    end

    subgraph Systems
        E[LSL Monitor] --> A
        A --> F[UKB Workflow]
        F --> B
        F --> C
        G[Health Monitor] --> D
    end

    subgraph Viewers
        B --> H[VKB Web UI]
        D --> I[Health Dashboard]
    end
```

---

## System States

Each system reports its status through health files and the status line:

| State | Icon | Meaning |
|-------|------|---------|
| :material-check-circle:{ .green } Healthy | Green | Service running normally |
| :material-alert-circle:{ .yellow } Degraded | Yellow | Service running with issues |
| :material-close-circle:{ .red } Failed | Red | Service not responding |
| :material-progress-clock: Transitioning | Blue | Mode switch in progress |

---

## Architecture Diagrams

### LSL 5-Layer Classification

![5-Layer Classification](../images/lsl-5-layer-classification.png)

### UKB Multi-Agent Workflow

![UKB Workflow](../images/ukb-workflow.png)

### Constraint Monitoring Flow

![Constraint Flow](../images/constraint-hooks-flow.png)

### Health Monitoring Architecture

![Health Architecture](../images/4-layer-monitoring-architecture.png)

---

## Related Documentation

- [Architecture Overview](../architecture/index.md) - System design principles
- [Data Flow](../architecture/data-flow.md) - Detailed data flow diagrams
- [Integrations](../integrations/index.md) - MCP server details

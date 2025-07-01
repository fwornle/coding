# Agent-Agnostic Knowledge Flow Architecture

## Overview

This document describes the comprehensive flow of information from project insights through agent-specific memory systems to persistent git storage in the agent-agnostic coding tools system. The architecture supports both Claude Code (with MCP) and GitHub CoPilot (with fallback services) while maintaining a unified knowledge base.

## Architecture Components

### 1. **Unified Insight Capture**
- **Source**: Development sessions, git commits, conversation logs
- **Tools**: Agent-aware `ukb` (Update Knowledge Base) script
- **Modes**: Interactive and automatic capture
- **Location**: Any project directory
- **Agents**: Works with Claude Code, GitHub CoPilot, or any detected agent

### 2. **Agent-Specific Memory Layer**
- **Claude Code**: MCP memory server for runtime knowledge graph
- **CoPilot**: Graphology.js for in-memory graph operations
- **Purpose**: Session-persistent and cross-session knowledge
- **Operations**: Create entities, add observations, create relations
- **Compatibility**: Both systems use same data format

### 3. **Unified Storage Sync**
- **File**: `shared-memory.json` in the coding project
- **Purpose**: Git-trackable persistent storage shared across agents
- **Format**: Structured JSON with entities, relations, and metadata
- **Versioning**: Git history provides knowledge evolution tracking
- **Agent-Agnostic**: Same format regardless of source agent

## Detailed Information Flow

### Phase 1: Agent-Aware Insight Capture

```mermaid
graph TB
    subgraph "Development Context"
        A[Project Development]
        B[Git Commits]
        C[Conversation Logs]
        D[Manual Insights]
    end
    
    subgraph "Agent Detection"
        AD[Agent Detector]
        AR[Agent Registry]
    end
    
    subgraph "Capture Tools"
        UKB[ukb --auto]
        UKBI[ukb --interactive]
        UKBA[ukb --agent-aware]
    end
    
    subgraph "Temporary Processing"
        G[Insight Extraction]
        H[Pattern Recognition]
        I[Significance Scoring]
    end
    
    A --> B
    A --> C
    A --> D
    
    B --> UKB
    C --> UKB
    D --> UKBI
    
    UKB --> AD
    UKBI --> AD
    AD --> AR
    AR --> UKBA
    
    UKBA --> G
    G --> H
    H --> I
```

**Process**:
1. **Agent Detection**: System automatically detects available agents
2. **Automatic Mode** (`ukb --auto`):
   - Analyzes recent git commits for patterns
   - Extracts architectural insights from commit messages
   - Identifies performance optimizations and bug fixes
   - Generates insights based on file changes and patterns

3. **Interactive Mode** (`ukb --interactive`):
   - Guided insight capture with prompts
   - Significance ranking (1-10 scale)
   - Structured observation entry
   - Real-time validation and suggestions

### Phase 2: Agent-Specific Memory Operations

```mermaid
graph TB
    subgraph "Agent-Specific Processing"
        subgraph "Claude Code Path"
            CM[Claude MCP Adapter]
            MCP[MCP Memory Server]
            MM[MCP Memory Graph]
        end
        
        subgraph "CoPilot Path"
            CPA[CoPilot Adapter]
            GR[Graphology Service]
            GM[Graph Memory]
        end
    end
    
    subgraph "Unified Operations"
        CREATE[Create Entities]
        RELATE[Create Relations]
        SEARCH[Search Operations]
        TRAVERSE[Graph Traversal]
    end
    
    subgraph "Sync Triggers"
        CSYNC[Claude MCP Sync]
        GSYNC[Graphology Sync]
        TRIGGER[Sync Trigger Files]
    end
    
    CM --> MCP
    MCP --> MM
    CPA --> GR
    GR --> GM
    
    MM --> CREATE
    GM --> CREATE
    MM --> RELATE
    GM --> RELATE
    MM --> SEARCH
    GM --> SEARCH
    MM --> TRAVERSE
    GM --> TRAVERSE
    
    CREATE --> CSYNC
    RELATE --> CSYNC
    CREATE --> GSYNC
    RELATE --> GSYNC
    
    CSYNC --> TRIGGER
    GSYNC --> TRIGGER
```

**Claude Code Process**:
1. **MCP Integration**: Direct integration with MCP memory server
2. **Sync Triggers**: Creates `.mcp-sync/sync-required.json` for session startup
3. **Persistence**: Memory persists across Claude sessions via MCP
4. **Bidirectional Sync**: MCP memory ↔ shared-memory.json

**CoPilot Process**:
1. **Graphology Integration**: Pure JavaScript graph operations
2. **Immediate Persistence**: Direct save to `.coding-tools/memory.json`
3. **Import/Export**: Compatible with MCP memory format
4. **Real-time Sync**: Graphology memory ↔ shared-memory.json

### Phase 3: Cross-Agent Memory Synchronization

```mermaid
graph TB
    subgraph "Agent Memory Systems"
        MCP_MEM[MCP Memory Server]
        GRAPH_MEM[Graphology Memory]
    end
    
    subgraph "Shared Storage"
        SHARED[shared-memory.json]
        LOCAL_CLAUDE[.mcp-sync/]
        LOCAL_COPILOT[.coding-tools/memory.json]
    end
    
    subgraph "Sync Operations"
        EXPORT[Export to Shared]
        IMPORT[Import from Shared]
        MERGE[Merge Conflicts]
        VALIDATE[Validate Integrity]
    end
    
    subgraph "Version Control"
        GIT[Git Repository]
        COMMIT[Auto-commit Changes]
        HISTORY[Knowledge History]
    end
    
    MCP_MEM --> EXPORT
    GRAPH_MEM --> EXPORT
    EXPORT --> SHARED
    
    SHARED --> IMPORT
    IMPORT --> MCP_MEM
    IMPORT --> GRAPH_MEM
    
    SHARED --> MERGE
    MERGE --> VALIDATE
    VALIDATE --> SHARED
    
    SHARED --> GIT
    GIT --> COMMIT
    COMMIT --> HISTORY
    
    LOCAL_CLAUDE <--> MCP_MEM
    LOCAL_COPILOT <--> GRAPH_MEM
```

**Synchronization Process**:
1. **Export Phase**: Each agent exports its memory to shared format
2. **Merge Phase**: Intelligent merging of insights from different agents
3. **Validation Phase**: Consistency checks and duplicate resolution
4. **Import Phase**: All agents can import the unified knowledge base

### Phase 4: Conversation Logging Integration

```mermaid
graph TB
    subgraph "Agent-Specific Logging"
        subgraph "Claude Logging"
            CL[Claude Sessions]
            MCPL[MCP Logger]
            CLAUDE_LOG[Claude Log Files]
        end
        
        subgraph "CoPilot Logging"
            CPL[CoPilot Sessions]
            SPEC[Specstory Extension]
            FILE_LOG[File-based Logger]
            COPILOT_LOG[CoPilot Log Files]
        end
    end
    
    subgraph "Unified Logging"
        DETECT[Logger Detection]
        ROUTE[Smart Routing]
        UNIFIED[.specstory/history/]
    end
    
    subgraph "Log Processing"
        PARSE[Parse Conversations]
        EXTRACT_INSIGHTS[Extract Insights]
        AUTO_UKB[Auto-trigger UKB]
    end
    
    CL --> MCPL
    MCPL --> CLAUDE_LOG
    CPL --> DETECT
    DETECT --> SPEC
    DETECT --> FILE_LOG
    SPEC --> COPILOT_LOG
    FILE_LOG --> COPILOT_LOG
    
    CLAUDE_LOG --> ROUTE
    COPILOT_LOG --> ROUTE
    ROUTE --> UNIFIED
    
    UNIFIED --> PARSE
    PARSE --> EXTRACT_INSIGHTS
    EXTRACT_INSIGHTS --> AUTO_UKB
```

**Logging Integration**:
1. **Agent Detection**: Automatically detects available logging systems
2. **Smart Routing**: Routes logs to appropriate directories based on content
3. **Format Unification**: All logs stored in compatible format
4. **Insight Extraction**: Automated extraction of insights from conversations

### Phase 5: Knowledge Visualization and Access

```mermaid
graph TB
    subgraph "Data Sources"
        SM[shared-memory.json]
        LOGS[.specstory/history/]
        PATTERNS[Pattern Library]
    end
    
    subgraph "Visualization System"
        VKB[vkb Viewer]
        WEB[Web Interface]
        GRAPH_VIZ[Graph Visualization]
    end
    
    subgraph "Query Interface"
        SEARCH_API[Search API]
        FILTER[Filtering]
        EXPORT_VIZ[Export Options]
    end
    
    subgraph "Agent Integration"
        CLAUDE_ACCESS[Claude Memory Access]
        COPILOT_ACCESS[CoPilot Memory Access]
        UNIFIED_API[Unified Memory API]
    end
    
    SM --> VKB
    LOGS --> VKB
    PATTERNS --> VKB
    
    VKB --> WEB
    WEB --> GRAPH_VIZ
    WEB --> SEARCH_API
    SEARCH_API --> FILTER
    FILTER --> EXPORT_VIZ
    
    UNIFIED_API --> CLAUDE_ACCESS
    UNIFIED_API --> COPILOT_ACCESS
    SEARCH_API --> UNIFIED_API
```

## Data Flow Patterns

### Entity Creation Flow

```plantuml
@startuml
participant Developer
participant "ukb Tool" as UKB
participant "Agent Detector" as AD
participant "Claude Adapter" as CA
participant "CoPilot Adapter" as CPA
participant "MCP Memory" as MCP
participant "Graphology" as GR
participant "shared-memory.json" as SM

Developer -> UKB: Run ukb
UKB -> AD: Detect agent
alt Claude Available
    AD -> CA: Initialize adapter
    CA -> MCP: Create entities
    MCP -> MCP: Store in memory
    MCP -> SM: Sync to shared storage
else CoPilot Available
    AD -> CPA: Initialize adapter
    CPA -> GR: Create entities
    GR -> GR: Store in graph
    GR -> SM: Sync to shared storage
end
UKB -> Developer: Insights captured
@enduml
```

### Cross-Agent Knowledge Sharing

```plantuml
@startuml
participant "Claude User" as CU
participant "MCP Memory" as MCP
participant "shared-memory.json" as SM
participant "CoPilot User" as CPU
participant "Graphology" as GR

CU -> MCP: Add knowledge
MCP -> SM: Export knowledge
SM -> SM: Git commit
note right: Knowledge persisted in git

CPU -> SM: Load knowledge
SM -> GR: Import knowledge
GR -> CPU: Knowledge available
CPU -> GR: Add new insights
GR -> SM: Export combined knowledge
SM -> MCP: Import for Claude users
@enduml
```

## Performance Considerations

### Memory Optimization

```mermaid
graph TB
    subgraph "Optimization Strategies"
        LAZY[Lazy Loading]
        CACHE[Intelligent Caching]
        BATCH[Batch Operations]
        COMPRESS[Data Compression]
    end
    
    subgraph "Performance Metrics"
        LOAD_TIME[Load Time]
        MEMORY_USAGE[Memory Usage]
        SEARCH_SPEED[Search Speed]
        SYNC_SPEED[Sync Speed]
    end
    
    subgraph "Monitoring"
        PERF_LOG[Performance Logging]
        METRICS[Metrics Collection]
        ALERTS[Performance Alerts]
    end
    
    LAZY --> LOAD_TIME
    CACHE --> SEARCH_SPEED
    BATCH --> SYNC_SPEED
    COMPRESS --> MEMORY_USAGE
    
    LOAD_TIME --> PERF_LOG
    MEMORY_USAGE --> PERF_LOG
    SEARCH_SPEED --> METRICS
    SYNC_SPEED --> METRICS
    
    PERF_LOG --> ALERTS
    METRICS --> ALERTS
```

### Scalability Metrics

| Component | Small Project | Medium Project | Large Project |
|-----------|---------------|----------------|---------------|
| **Entities** | <100 | 100-1000 | 1000+ |
| **Relations** | <200 | 200-2000 | 2000+ |
| **Load Time** | <100ms | <500ms | <2s |
| **Search Time** | <50ms | <200ms | <1s |
| **Sync Time** | <200ms | <1s | <5s |

## Error Handling and Recovery

### Sync Conflict Resolution

```mermaid
flowchart TD
    CONFLICT[Sync Conflict Detected]
    AUTO_MERGE{Auto-merge possible?}
    MERGE[Automatic Merge]
    MANUAL[Manual Resolution]
    BACKUP[Create Backup]
    RESOLVE[Apply Resolution]
    VALIDATE[Validate Result]
    COMMIT[Commit Changes]
    
    CONFLICT --> BACKUP
    BACKUP --> AUTO_MERGE
    AUTO_MERGE -->|Yes| MERGE
    AUTO_MERGE -->|No| MANUAL
    MERGE --> VALIDATE
    MANUAL --> RESOLVE
    RESOLVE --> VALIDATE
    VALIDATE --> COMMIT
```

### Failure Recovery

```javascript
class KnowledgeFlowRecovery {
  async recoverFromFailure(error) {
    switch (error.type) {
      case 'SYNC_FAILURE':
        return await this.recoverSync();
      case 'MEMORY_CORRUPTION':
        return await this.recoverFromBackup();
      case 'AGENT_UNAVAILABLE':
        return await this.fallbackToAlternativeAgent();
      default:
        return await this.genericRecovery(error);
    }
  }
  
  async recoverSync() {
    // Restore from last known good state
    const backup = await this.getLastValidBackup();
    await this.restoreFromBackup(backup);
    return { recovered: true, method: 'backup_restore' };
  }
}
```

## Security and Privacy

### Data Protection

```mermaid
graph TB
    subgraph "Security Layers"
        ENC[Data Encryption]
        AUTH[Access Control]
        AUDIT[Audit Logging]
        BACKUP[Secure Backup]
    end
    
    subgraph "Privacy Controls"
        FILTER[Content Filtering]
        REDACT[Sensitive Data Redaction]
        ANON[Anonymization]
        RETENTION[Data Retention Policy]
    end
    
    subgraph "Compliance"
        GDPR[GDPR Compliance]
        SOC[SOC 2 Type II]
        ISO[ISO 27001]
        LOCAL[Local-only Processing]
    end
    
    ENC --> GDPR
    AUTH --> SOC
    AUDIT --> ISO
    FILTER --> LOCAL
    REDACT --> LOCAL
    ANON --> GDPR
```

This agent-agnostic knowledge flow architecture ensures that insights and knowledge are captured, processed, and shared efficiently across different AI coding agents while maintaining data integrity, performance, and security.
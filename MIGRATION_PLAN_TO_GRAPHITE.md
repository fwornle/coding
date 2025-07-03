# Migration Plan: Semantic Analysis System to Graphite Framework

## Executive Summary

This document outlines the complete migration plan from our current Node.js-based semantic analysis system to a Python-based Graphite framework implementation. The migration preserves ALL existing functionality while addressing current reliability issues.

## Current System Analysis

### 7 Agents Architecture
1. **Semantic Analysis Agent** - Core LLM analysis engine
2. **Web Search Agent** - Context-aware search and validation  
3. **Knowledge Graph Agent** - Entity/relationship management + MCP sync
4. **Coordinator Agent** - Workflow orchestration across agents
5. **Synchronization Agent** - State sync and conflict resolution
6. **Deduplication Agent** - Similarity detection and entity merging
7. **Documentation Agent** - Automated documentation generation

### Current Infrastructure
- **MQTT Broker**: Event-driven communication (ports 1883/8883)
- **JSON-RPC Server**: Synchronous commands (port 8081)
- **System Health Monitor**: Agent status (port 9090)
- **Memory Visualizer**: Knowledge graph UI (port 8080)
- **MCP Server**: Claude integration (stdio)

## Graphite System Architecture

### Project Structure
```
semantic-analysis-graphite/          # New isolated Python project
├── pyproject.toml                   # Dependencies: grafi, anthropic, openai, etc.
├── bin/
│   ├── semantic-analysis            # Global command (like ukb/vkb)
│   └── semantic-analysis-cli        # CLI interface with all current commands
├── agents/                          # 7 Graphite agents (as Nodes/Tools)
│   ├── semantic_analysis.py         # Core LLM analysis engine
│   ├── web_search.py               # Context-aware search
│   ├── knowledge_graph.py          # Entity/relationship management
│   ├── coordinator.py              # Workflow orchestration
│   ├── synchronization.py          # Data sync (MCP ↔ Graphology ↔ shared-memory)
│   ├── deduplication.py            # Similarity detection
│   └── documentation.py            # Document generation
├── workflows/                       # Graphite Assistants
│   ├── full_analysis.py            # Complete semantic analysis
│   ├── incremental_analysis.py     # Delta analysis
│   ├── conversation_analysis.py    # Conversation processing
│   └── pattern_extraction.py       # Pattern-focused workflows
├── api/
│   ├── mcp_server.py               # MCP server for Claude
│   ├── http_server.py              # HTTP API for CoPilot
│   └── graphology_bridge.py       # CoPilot data bridge
├── config/
│   ├── api_keys.py                 # Unified API key handling
│   ├── agent_config.py             # Agent configuration
│   └── logging_config.py           # Unified logging setup
└── event_store/                    # Graphite durable event storage
```

## Feature Preservation Requirements

### 1. Global Command Access ✅
- **`semantic-analysis`** command available globally (like `ukb`/`vkb`)
- **Install via `install.sh`**: Adds to PATH and shell activation
- **Cross-directory usage**: Works from any directory, passes context

### 2. API Key Handling ✅
- **Primary**: `ANTHROPIC_API_KEY` for Claude-based analysis
- **Fallback**: `OPENAI_API_KEY` for OpenAI-compatible models
- **Custom**: Support for custom OpenAI-compatible endpoints
- **Graceful degradation**: Fall back to non-AI `ukb`/`ukb-cli` when no keys

### 3. Agent-Agnostic Integration ✅
- **`coding` command**: Primary semantic analysis via Graphite system
- **CoPilot support**: HTTP API + Graphology database integration
- **Claude support**: MCP server integration
- **Fallback chain**: Graphite → UKB → UKB-CLI (no AI)

### 4. Data Handling & Synchronization ✅
- **Dual database support**:
  - **MCP Memory**: For Claude integration
  - **Graphology DB**: For CoPilot integration
- **Shared-memory sync**: Bidirectional sync with `shared-memory-*.json`
- **Synchronization agent**: Maintains consistency across all storage layers
- **Conflict resolution**: Smart merging and version management

### 5. Unified Logging ✅
- **Cross-agent logging**: Single log stream across all 7 agents
- **Real-time visibility**: User can follow analysis progress
- **Structured output**: Clear agent identification and progress tracking
- **Debug capabilities**: Detailed tracing for troubleshooting

### 6. Robustness & Job Completion ✅
- **Event sourcing**: Durable storage of all analysis steps
- **Job resumption**: Can complete interrupted analyses
- **State recovery**: Restart from last successful checkpoint
- **Error handling**: Graceful failure and retry mechanisms

### 7. Use Case Preservation ✅
- **All current MCP tools**: Exact same interface for Claude
- **All current HTTP endpoints**: Exact same REST API for CoPilot
- **All current CLI commands**: Same command structure and options
- **All current workflows**: Repository analysis, conversation analysis, etc.

## Implementation Phases

### Phase 1: Core Graphite Foundation (Week 1)
- Set up isolated Python project with Graphite
- Implement unified API key handling (ANTHROPIC_API_KEY, OPENAI_API_KEY, custom)
- Create global `semantic-analysis` command with cross-directory support
- Set up unified logging system across all agents
- Implement durable event store for job persistence

### Phase 2: Agent Recreation (Week 2)
- **Recreate all 7 agents as Graphite components**:
  - Map current agent capabilities to Graphite Nodes/Tools
  - Preserve all LLM provider abstractions
  - Maintain same analysis algorithms and thresholds
- **Implement workflow coordination**: Graphite Assistants for complex workflows
- **Add job resumption**: Event sourcing for interrupted analysis recovery

### Phase 3: Data Integration Layer (Week 3)
- **Dual database support**: MCP Memory + Graphology DB integration
- **Synchronization agent**: Bidirectional sync with shared-memory files
- **Data bridges**: Maintain data format compatibility
- **Conflict resolution**: Smart merging across storage systems

### Phase 4: API & Interface Preservation (Week 4)
- **MCP server**: Expose exact same tools for Claude integration
- **HTTP API**: Maintain identical REST endpoints for CoPilot
- **CLI interface**: Preserve all current command structures
- **Integration testing**: Verify all use cases work identically

### Phase 5: Lifecycle Integration (Week 5)
- **`install.sh` updates**: Add Graphite system installation and PATH setup
- **`coding` command integration**: 
  - Auto-start Graphite system (primary)
  - Fallback to UKB when no API keys
  - Graceful degradation chain
- **Post-session cleanup**: Proper Graphite shutdown
- **Health monitoring**: System status and agent coordination

## Agent-Agnostic Fallback Chain

```
User triggers analysis
        ↓
Is Graphite system available + API keys?
   ├─ YES → Use Graphite semantic analysis (AI-powered)
   └─ NO → API keys available?
       ├─ YES → Use UKB with AI analysis
       └─ NO → Use UKB-CLI (pattern-based, no AI)
```

## Migration Benefits

### Reliability Improvements
- ✅ **Event sourcing**: No more lost analysis progress
- ✅ **Durable storage**: Persistent state across restarts
- ✅ **Job resumption**: Complete interrupted analyses
- ✅ **Better error handling**: Graceful failure and recovery

### Operational Improvements
- ✅ **Unified logging**: Single stream for all agent activities
- ✅ **Better observability**: Built-in Graphite tracing
- ✅ **Clean lifecycle**: Proper startup/shutdown management
- ✅ **Resource management**: No port conflicts or stale processes

### User Experience Preservation
- ✅ **Zero interface changes**: All commands work identically
- ✅ **Same performance**: Equivalent or better analysis speed
- ✅ **Same capabilities**: All current features preserved
- ✅ **Better reliability**: More robust than current system

## Agent Mapping: Current → Graphite

| Current Agent | Graphite Component | Key Capabilities Preserved |
|---------------|-------------------|---------------------------|
| Semantic Analysis | Analysis Node + LLM Tools | Claude/OpenAI providers, AST parsing, pattern detection |
| Web Search | Search Node + Web Tools | Context-aware search, result processing |
| Knowledge Graph | Knowledge Node + MCP Tools | Entity management, UKB integration, MCP sync |
| Coordinator | Workflow Assistant | Multi-agent orchestration, task scheduling |
| Synchronization | Sync Node + File Tools | MCP/Graphology/shared-memory sync, conflict resolution |
| Deduplication | Dedup Node + Embedding Tools | Similarity detection, entity merging |
| Documentation | Doc Node + Template Tools | Auto-generation, template management |

## Risk Mitigation

1. **Parallel development**: Build alongside current system
2. **Interface preservation**: Identical APIs and commands
3. **Gradual rollout**: Switch components one by one
4. **Rollback capability**: Keep current system until proven
5. **Comprehensive testing**: All use cases verified before cutover

## Timeline & Milestones

- **Week 1**: Core Graphite foundation + global command
- **Week 2**: All 7 agents recreated in Graphite
- **Week 3**: Data integration layer complete
- **Week 4**: API/interface preservation verified
- **Week 5**: Full lifecycle integration + testing

**Total Duration**: 5 weeks  
**Risk Level**: Low (isolated project, preserved interfaces)  
**User Impact**: Zero (transparent replacement)  
**Primary Benefits**: Eliminates all current reliability issues while preserving complete functionality

## Success Criteria

1. **All 7 agents** functioning in Graphite framework
2. **All commands** work identically to current system
3. **All integrations** (MCP, HTTP, CLI) preserved
4. **Better reliability**: No startup failures, port conflicts, or crashes
5. **Job resumption**: Can recover from interruptions
6. **Unified logging**: Single stream for monitoring
7. **Performance parity**: Equal or better analysis speed

## Next Steps

1. Review and approve this migration plan
2. Set up new `semantic-analysis-graphite` project
3. Begin Phase 1 implementation
4. Weekly progress reviews and adjustments
5. Gradual rollout with extensive testing
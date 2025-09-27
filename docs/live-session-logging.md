# Live Session Logging (LSL) System - Current Architecture

A robust real-time conversation monitoring and classification system that ensures all Claude Code conversations are properly captured and routed to the correct `.specstory/history/` directories with zero data loss and automatic recovery capabilities.

## Overview

The LSL system provides **real-time transcript monitoring** with intelligent classification to determine whether content belongs to **coding infrastructure** work or **project-specific** work. The system features global coordination across multiple projects, health monitoring, and bulletproof reliability through automatic recovery.

![LSL Architecture](images/lsl-architecture.png)

### Core Principles

- **🔄 Real-time Monitoring**: Captures conversations as they happen during active Claude sessions
- **🛡️ Bulletproof Reliability**: Global Coordinator ensures LSL never fails across any session
- **📦 Zero Data Loss**: Every conversation exchange is preserved and routed appropriately
- **🎯 Smart Classification**: Four-layer analysis prevents false positives and ensures accurate routing
- **🏥 Health Monitoring**: Automatic detection and recovery from failed processes
- **🌍 Multi-Project Support**: Simultaneous monitoring across multiple concurrent projects
- **⚡ Session Continuation Detection**: Prevents inappropriate redirection of session continuation messages

## System Architecture

![LSL Components](images/lsl-components.png)

The LSL system consists of four main components working together:

### 1. Enhanced Transcript Monitor

**Location**: `scripts/enhanced-transcript-monitor.js`

The core monitoring system that runs as a background process for each project.

**Key Features**:
- **Real-time Processing**: Monitors Claude transcript files (`.jsonl`) for new exchanges
- **Periodic Transcript Refresh**: Automatically detects and switches to newer transcript files every 60 seconds
- **Health File Generation**: Creates `.transcript-monitor-health` with process metrics and activity tracking
- **Session Boundary Detection**: Organizes content into time-based windows (e.g., 1800-1900)
- **Suspicious Activity Detection**: Identifies stale monitors and processing issues
- **Exchange Classification**: Uses ReliableCodingClassifier for intelligent content routing

**Health Monitoring**:
```json
{
  "timestamp": 1758820202726,
  "projectPath": "/Users/<username>/Agentic/<project>",
  "transcriptPath": "/Users/<username>/.claude/projects/-Users-<username>-Agentic-<project>/ca137daf-b706-4d7b-9d49-16bd4ba84c1f.jsonl",
  "status": "running",
  "userHash": "<user-hash>",
  "metrics": {
    "memoryMB": 9,
    "cpuUser": 7481974,
    "uptimeSeconds": 925,
    "processId": 78406
  },
  "activity": {
    "lastExchange": "82da8b2a-6a30-45eb-b0c7-5e1e2b2d54ee",
    "exchangeCount": 10,
    "isSuspicious": false
  },
  "streamingActive": true
}
```

### 2. Global LSL Coordinator

**Location**: `scripts/global-lsl-coordinator.js`

Multi-project coordination system that ensures healthy monitoring across all projects started via `coding/bin/coding`.

**Key Responsibilities**:
- **Project Registry Management**: Tracks all active projects and their monitoring status
- **Monitor Lifecycle**: Starts, stops, and restarts Enhanced Transcript Monitor processes
- **Health Checking**: Regular health assessments with automatic recovery for failed monitors
- **Process Management**: Proper cleanup of stale processes and resource management
- **Environment Configuration**: Sets project-specific environment variables for monitors

**Registry Structure**:
```json
{
  "version": "1.0.0",
  "lastUpdated": 1758820202726,
  "projects": {
    "<project>": {
      "projectPath": "/Users/<username>/Agentic/<project>",
      "monitorPid": 78406,
      "status": "active",
      "lastHealthCheck": 1758820202726
    }
  }
}
```

### 3. ReliableCodingClassifier

**Location**: `src/live-logging/ReliableCodingClassifier.js`

Four-layer classification system that accurately determines content routing with advanced semantic understanding.

![Classification Flow](images/lsl-classification-flow.png)

**Classification Layers**:

1. **PathAnalyzer (Layer 1)**: File operation pattern matching
   - Analyzes file paths and operations for direct coding infrastructure detection
   - Fastest decision path with <1ms response time
   - High accuracy for known file patterns and operations

2. **KeywordMatcher (Layer 2)**: Fast keyword-based classification  
   - Uses intelligent keyword analysis for coding-related term detection
   - Immediate classification for clear coding infrastructure content
   - <10ms response time for obvious cases

3. **EmbeddingClassifier (Layer 3)**: Semantic vector similarity search
   - Uses sentence-transformers and Qdrant vector database
   - 384-dimensional embeddings with cosine similarity search
   - <3ms response time with HNSW indexing and int8 quantization
   - Searches against indexed coding infrastructure repository content

4. **SemanticAnalyzer (Layer 4)**: LLM-powered deep understanding
   - Used when embedding classification is inconclusive (isCoding: null)
   - Provides nuanced classification for complex edge cases
   - <10ms response time with performance monitoring and caching

**Additional Components**:
- **RepositoryIndexer**: Automatically indexes coding repository content into Qdrant vector database
- **EmbeddingGenerator**: Generates 384-dimensional embeddings using sentence-transformers
- **ChangeDetector**: Monitors repository changes and triggers reindexing when needed
- **PerformanceMonitor**: Enhanced monitoring with embedding-specific metrics

**Performance Features**:
- **Four-Layer Optimization**: Progressively more expensive layers, early exit when confident
- **Vector Database**: HNSW indexing with int8 quantization for <3ms similarity search
- **Embedding Cache**: LRU cache with TTL for <2ms cached embedding retrieval
- **Repository Indexing**: Automatic background indexing of coding infrastructure content
- **Performance Monitoring**: Tracks classification times across all four layers

### 4. LSL File Manager

**Location**: `scripts/lsl-file-manager.js`

Handles the creation and management of LSL session files with intelligent routing.

**File Organization**:
```
.specstory/history/
├── 2025-09-25_1800-1900_<user-hash>.md                    # Local project content
├── coding/.specstory/history/
│   └── 2025-09-25_1800-1900_<user-hash>_from-<project>.md  # Redirected coding content
```

**Key Features**:
- **Smart File Creation**: Time-based session boundaries with user hash collision prevention
- **Content Routing**: Automatic redirection of coding infrastructure content to coding project
- **Session Continuity**: Maintains conversation flow across time boundaries
- **File Watching**: Monitors active session files for proper closure

## Multi-Project Architecture

![Multi-Project Flow](images/lsl-multi-project-architecture.png)

### Project-Specific Monitoring

Each project started via `coding/bin/coding` gets its own Enhanced Transcript Monitor:

**Environment Variables**:
```javascript
env: {
  PROJECT_PATH: "/Users/<username>/Agentic/<project>",
  TRANSCRIPT_SOURCE_PROJECT: "/Users/<username>/Agentic/<project>",
  CODING_TOOLS_PATH: "/Users/<username>/Agentic/coding"
}
```

**Process Isolation**:
- Each monitor watches its project's specific Claude transcript directory
- Independent health monitoring and recovery
- Project-specific content routing and classification
- Isolated error handling prevents cascade failures

### Global Health Monitoring

The Global Coordinator performs regular health checks:

1. **Process Verification**: Confirms monitor processes are running
2. **Health File Analysis**: Checks activity levels and suspicious behavior detection
3. **Automatic Recovery**: Restarts failed monitors with proper cleanup
4. **Performance Tracking**: Monitors system resource usage across all projects

## Session Continuation Detection

A critical feature that prevents false positive classification of conversation summaries.

**Problem Solved**:
Session continuation messages like "This session is being continued from a previous conversation..." were incorrectly classified as coding content due to keywords like "session" and "conversation".

**Solution**:
```javascript
isSessionContinuation(content) {
  const sessionPatterns = [
    /^this session is being continued from a previous conversation/,
    /^this conversation is being continued from/,
    /session.*continued.*previous.*conversation/,
    /previous conversation.*ran out of context/,
    /conversation.*summarized below/
  ];
  
  // Pattern matching + summary structure detection
  const summaryIndicators = [
    'primary request and intent:',
    'key technical concepts:',
    'files and code sections:'
  ];
  
  return patterns.match || summaryIndicators.count >= 3;
}
```

**Benefits**:
- Prevents inappropriate redirection of conversation summaries
- Maintains session continuity in originating projects
- Reduces classification noise and false positives

## File Naming and Organization

### Session File Format
```
YYYY-MM-DD_HHMM-HHMM_<user-hash>.md
```

**Examples**:
- `2025-09-25_1800-1900_<user-hash>.md` - Regular project content
- `2025-09-25_1800-1900_<user-hash>_from-<project-2>.md` - Redirected coding content

### User Hash Generation

**Location**: `scripts/user-hash-generator.js`

Generates consistent 6-character hashes to prevent filename collisions:
```javascript
generateUserHash() {
  // Based on user environment and system characteristics
  return "<user-hash>"; // Example hash
}
```

## Startup and Integration

### Automatic Startup

When running `coding` or `coding --claude`:

1. **Launch Script Execution**: `scripts/launch-claude.sh` invokes global coordinator
2. **Global Coordinator Start**: Ensures LSL monitoring for target project
3. **Monitor Process Spawn**: Enhanced Transcript Monitor starts as detached process
4. **Health Monitoring**: Continuous health checks and recovery

### Integration with Coding Workflow

```bash
# Start Claude session with automatic LSL
coding --project <project>

# Global coordinator ensures monitoring
node scripts/global-lsl-coordinator.js ensure /path/to/<project>

# Monitor starts automatically and begins real-time capture
```

## Performance and Reliability

### Performance Metrics

**Classification Performance**:
- PathAnalyzer (Layer 1): <1ms (file pattern matching)
- KeywordMatcher (Layer 2): <10ms (keyword analysis)
- EmbeddingClassifier (Layer 3): <3ms (vector similarity search)
- SemanticAnalyzer (Layer 4): <10ms (LLM analysis when needed)
- **Total Pipeline**: <30ms (all layers combined)

**Memory Usage**:
- Enhanced Transcript Monitor: 9-69MB per project
- Global Coordinator: Minimal overhead
- Efficient streaming for large transcript files

### Reliability Features

1. **Automatic Recovery**: Failed monitors are automatically restarted
2. **Process Cleanup**: Stale processes are properly terminated and cleaned up
3. **Health Monitoring**: Continuous monitoring detects issues before they cause failures
4. **Graceful Degradation**: System continues operating even with partial failures
5. **Data Integrity**: Zero data loss through robust file handling and atomic operations

## Configuration Files

### Coding Keywords Dictionary

**Location**: `scripts/coding-keywords.json`

Contains coding-related terms for fast classification:
```json
{
  "general": ["code", "function", "class", "debug"],
  "tools": ["git", "npm", "build", "test"],
  "infrastructure": ["deploy", "server", "api", "database"]
}
```

### Global Registry

**Location**: `.global-lsl-registry.json`

Tracks all active projects and their monitoring status for coordination.

## Troubleshooting

### Common Issues

1. **Monitor Not Starting**:
   - Check project path is correct
   - Verify `.specstory/history/` directory exists
   - Confirm no port conflicts

2. **Content Not Being Classified**:
   - Verify ReliableCodingClassifier is properly initialized
   - Check keyword dictionary is accessible
   - Review performance monitoring logs

3. **Health File Stale**:
   - Monitor may be stuck or crashed
   - Global coordinator will automatically restart
   - Check process ID validity

### Debug Mode

Enable detailed logging across the system:
```bash
TRANSCRIPT_DEBUG=true node scripts/enhanced-transcript-monitor.js
```

## Integration Points

The LSL system integrates with:

- **Coding Startup Script**: Automatic initialization
- **Claude Transcript System**: Real-time monitoring of `.jsonl` files
- **MCP Session Management**: Coordination with Claude Code session lifecycle
- **Project Directory Structure**: Proper `.specstory/history/` organization

---

## See Also

- [Global LSL Coordinator Documentation](architecture/global-lsl-coordinator.md)
- [Enhanced Transcript Monitor API](reference/enhanced-transcript-monitor.md)
- [Four-Layer Classification System Guide](components/embedding-classification/README.md)
- [Troubleshooting LSL Issues](troubleshooting.md)

---

*The LSL system ensures comprehensive conversation capture with intelligent routing, providing a robust foundation for cross-session knowledge management and project documentation.*
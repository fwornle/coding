# Multi-Topic Session Splitting Implementation

## Overview

Implemented a sophisticated system to split mixed-topic Claude Code sessions into separate log files based on content, ensuring each topic is logged to the appropriate project directory.

## Architecture

### 1. **ConversationTopicSegmenter** (`conversation-topic-segmenter.js`)
- Parses conversations into individual exchanges
- Analyzes each exchange to determine its topic
- Groups consecutive exchanges with the same topic into segments
- Uses keyword detection and LLM classification for accurate topic identification
- Merges small segments to avoid over-fragmentation

### 2. **MultiTopicSessionLogger** (`multi-topic-session-logger.js`)
- Takes segmented conversations and logs each segment to appropriate project
- Creates separate markdown files for each topic segment
- Generates cross-reference index files to link related segments
- Maintains session coherence with parent session IDs

### 3. **Enhanced SimplePostSessionLogger** (`simple-post-session-logger.js`)
- Now supports both single-file and multi-topic modes
- Activated via `MULTI_TOPIC_LOGGING=true` environment variable
- Defaults to multi-topic mode in `claude-mcp-launcher.sh`

## How It Works

### Topic Detection
The system identifies topics through:
1. **Keyword Analysis**: Scans for project-specific keywords (ukb, vkb, timeline, etc.)
2. **LLM Classification**: Uses AI to classify content as "coding" or "project"
3. **Path Extraction**: Identifies project paths mentioned in conversation
4. **Context Awareness**: Considers surrounding content for accurate classification

### Supported Topics
- **knowledge-management**: ukb, vkb, shared-memory operations
- **mcp-infrastructure**: MCP servers, semantic analysis systems
- **logging-system**: Post-session logging, session management
- **timeline-development**: Timeline project, React/Kotlin migration
- **session-review**: Reading and analyzing session logs
- **[project]-development**: Any specific project work

### File Organization
```
/Users/q284340/Agentic/coding/.specstory/history/
  └── 2025-07-20_16-30-00_coding-knowledge-management-segment.md
  └── 2025-07-20_16-30-00_coding-logging-system-segment.md
  └── 2025-07-20_16-30-00_session-index.json

/Users/q284340/Agentic/timeline/.specstory/history/
  └── 2025-07-20_16-30-00_timeline-timeline-development-segment.md
  └── 2025-07-20_16-30-00_session-index.json
```

### Cross-Reference System
Each session creates an index file containing:
- Parent session ID
- List of all segments with their locations
- Summary of topics covered
- Total exchange count
- Links to all segment files

## Usage

### Enable Multi-Topic Splitting
```bash
# Via environment variable
MULTI_TOPIC_LOGGING=true node simple-post-session-logger.js

# Via command line flag
node simple-post-session-logger.js --multi-topic

# Automatically enabled in claude-mcp
claude-mcp  # Uses multi-topic by default
```

### Disable Multi-Topic Splitting
```bash
# Explicitly disable
MULTI_TOPIC_LOGGING=false claude-mcp
```

## Benefits

1. **Accurate Project History**: Each project maintains its own relevant session history
2. **Reduced Noise**: Projects only contain logs relevant to their development
3. **Better Organization**: Topics are clearly separated and labeled
4. **Maintained Context**: Cross-references preserve session continuity
5. **Semantic Understanding**: AI-powered classification ensures accurate routing

## Implementation Details

### Segment Structure
Each segment file contains:
- Parent session reference
- Topic and keyword metadata
- Exchange range information
- Full conversation content for that topic
- Cross-reference to session index

### Topic Transitions
The system creates new segments when:
- Topic changes between exchanges
- Project context switches
- Keywords indicate different domain

### Small Segment Handling
Segments with less than 2 exchanges are merged with adjacent related segments to avoid fragmentation.

## Future Enhancements

1. **Topic Prediction**: Predict likely topic transitions
2. **Custom Rules**: Allow project-specific classification rules
3. **Interactive Mode**: Let users confirm/adjust topic assignments
4. **Topic Analytics**: Generate reports on time spent per topic
5. **Smart Merging**: More sophisticated segment merging logic
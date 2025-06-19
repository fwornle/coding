# Cross-Project Logging Pattern

## Table of Contents

- [Problem](#problem)
- [Solution](#solution)
- [Implementation Details](#implementation-details)
  - [1. Post-Session Processing Architecture](#1-post-session-processing-architecture)
  - [2. Session Data Analysis](#2-session-data-analysis)
  - [3. Intelligent Content Detection](#3-intelligent-content-detection)
  - [4. Repository Routing Decision](#4-repository-routing-decision)
  - [3. Filename Convention](#3-filename-convention)
  - [4. Filename Normalization](#4-filename-normalization)
- [Benefits](#benefits)
- [Usage](#usage)
  - [Setup](#setup)
  - [Verification](#verification)
  - [Normalization](#normalization)
- [Key Files](#key-files)
- [Related Patterns](#related-patterns)
- [Technologies](#technologies)
- [Significance](#significance)

## Problem
When working on the coding project (knowledge management tools) from other project contexts, conversation logs were saved only in the current project's `.specstory/history/` folder. This required manual cleanup and made it difficult to track cross-project knowledge management work, undermining the coding project's role as a central knowledge hub.

## Solution
Post-session conversation logging system that automatically detects coding project work and routes conversations to the appropriate `.specstory/history/` folder through session analysis and intelligent content detection.

## Implementation Details

### 1. **Post-Session Processing Architecture**
The system processes completed Claude sessions through a Node.js script for conversation extraction:

```bash
# Post-session logging triggered after Claude session completion
node /path/to/post-session-logger.js "$PROJECT_PATH" "$CODING_REPO"
```

### 2. **Session Data Analysis**
The post-session script analyzes completed session data for conversation extraction:

```javascript
// From post-session-logger.js
function processSession(sessionData) {
  // Extract conversations from completed session
  const exchanges = extractExchanges(sessionData);
  
  // Detect conversation boundaries using pattern matching
  exchanges.forEach(exchange => {
    if (exchange.type === 'user') {
      // Process user input for content detection
      processUserMessage(exchange.content);
    } else if (exchange.type === 'assistant') {
      // Process assistant response
      processAssistantMessage(exchange.content);
    }
  });
  
  // Route to appropriate repository based on content analysis
  const targetRepo = detectCodingContent(exchanges) ? codingRepo : projectPath;
  generateLogFile(exchanges, targetRepo);
}
```

### 3. **Intelligent Content Detection**
Automatic routing based on conversation content:

```javascript
detectCodingContent(userMessage, assistantMessage = '') {
  const content = `${userMessage} ${assistantMessage}`.toLowerCase();
  
  const codingKeywords = [
    'ukb', 'vkb', 'shared-memory.json', 'knowledge-base',
    'mcp', 'claude-mcp', 'specstory', 'coding project',
    'knowledge management', 'transferable pattern', 'CLAUDE.md'
  ];
  
  return codingKeywords.some(keyword => content.includes(keyword));
}
```

### 4. **Repository Routing Decision**
Post-session analysis for log placement:

```javascript
function routeSession(exchanges) {
  const shouldGoToCoding = detectCodingContentInSession(exchanges);
  
  // Analyze entire session content for routing decision
  const targetRepo = shouldGoToCoding ? codingRepo : projectPath;
  
  // Generate log file in appropriate repository
  const logPath = path.join(targetRepo, '.specstory', 'history');
  writeLogFile(logPath, exchanges);
  
  console.log(`Session logged to: ${targetRepo}`);
}

### 3. **Filename Convention**
Consistent naming across all projects:
- Format: `YYYY-MM-DD_HH-MM-descriptive-title.md`
- No spaces (replaced with hyphens)
- No capitals (lowercase only)
- No special characters
- Maximum 50 characters for title

### 4. **Filename Normalization**
Script to fix existing files:

```bash
#!/bin/bash
# normalize-specstory-filenames.sh
normalize_filename() {
    local old_file="$1"
    # Extract date, generate time, sanitize title
    # Rename to YYYY-MM-DD_HH-MM-title.md format
}
```

## Benefits

1. **Automatic Organization**
   - No manual log cleanup required
   - Conversations automatically appear in relevant project contexts
   - Cross-project work properly attributed

2. **Knowledge Capture**
   - Coding project insights captured regardless of working context
   - Supports `ukb` analysis across projects
   - Central repository of knowledge management work

3. **Team Collaboration**
   - Consistent filenames across all projects
   - Easier automated processing
   - Clear project attribution in metadata

## Usage

### Setup
1. Use post-session logging system (automatically configured)
2. Start Claude Code with `claude-mcp` script
3. No additional setup required - system processes sessions automatically after completion

### Verification
```bash
# Start in non-coding project
cd ~/projects/timeline
claude-mcp

# Work on coding tools (mention ukb, mcp, etc.)
# Check both locations for logs:
ls .specstory/history/
ls $PROJECT_ROOT/.specstory/history/
```

### Normalization
```bash
# Fix all existing filenames
$PROJECT_ROOT/knowledge-management/normalize-specstory-filenames.sh

# Fix specific project
$PROJECT_ROOT/knowledge-management/normalize-specstory-filenames.sh /path/to/project
```

## Key Files
- `scripts/post-session-logger.js` - Main entry point for post-session logging processing
- `scripts/claude-mcp-launcher.sh` - MCP integration and knowledge sync
- `knowledge-management/normalize-specstory-filenames.sh` - Batch filename fixes
- `CLAUDE.md` - Main documentation with logging architecture
- `.specstory/history/` - Conversation storage directories (project-specific)

## Related Patterns
- **KnowledgePersistencePattern** - Cross-session knowledge persistence and memory integration
- **ConditionalLoggingPattern** - Runtime logging control
- **NetworkAwareInstallationPattern** - Cross-environment support

## Technologies
- TypeScript, Node.js, MCP SDK
- Bash scripting
- File system operations
- Regular expressions

## Significance: 8/10
Essential for maintaining the coding project as a central knowledge hub, enabling seamless cross-project knowledge capture without manual intervention.
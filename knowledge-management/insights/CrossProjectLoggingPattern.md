# Cross-Project Logging Pattern

## Problem
When working on the coding project (knowledge management tools) from other project contexts, conversation logs were saved only in the current project's `.specstory/history/` folder. This required manual cleanup and made it difficult to track cross-project knowledge management work, undermining the coding project's role as a central knowledge hub.

## Solution
Enhanced MCP logging server that automatically detects coding project work and implements dual logging - saving conversations to both the current project AND the coding project's `.specstory/history/` folder.

## Implementation Details

### 1. **Automatic Detection**
The system detects coding project work using keyword matching:

```typescript
// From claude-logger-mcp/src/index-auto.ts
function detectCodingProjectWork(userMessage: string, assistantMessage: string): boolean {
  const content = `${userMessage} ${assistantMessage}`.toLowerCase();
  
  const codingKeywords = [
    'ukb', 'vkb', 'shared-memory.json', 'knowledge-base',
    'mcp', 'claude-mcp', 'specstory', 'claude-logger',
    'coding project', 'claude tools', 'install.sh',
    'knowledge management', 'transferable pattern'
  ];
  
  return codingKeywords.some(keyword => content.includes(keyword));
}
```

### 2. **Dual Logging Logic**
When coding work is detected outside the coding project:

```typescript
// Primary log to current project
await logger.logConversation(currentSessionId, userMsg, assistantMsg, metadata);

// Secondary log to coding project
if (isCodingWork && !isInCodingProject) {
  const codingLogger = new SpecStoryLogger(codingProjectPath);
  const codingSessionId = `${generateSessionId()}-cross-project`;
  await codingLogger.logConversation(codingSessionId, userMsg, assistantMsg, {
    ...metadata,
    project_path: `${projectPath} (cross-project from coding tools)`
  });
}
```

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
3. No additional setup required - system is automatic

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
- `scripts/start-auto-logger.sh` - Main entry point for automatic logging
- `scripts/post-session-logger.js` - Post-session conversation capture and routing
- `scripts/conversation-capture.js` - Real-time backup capture system
- `knowledge-management/normalize-specstory-filenames.sh` - Batch filename fixes
- `docs/enhanced-cross-project-logging.md` - Detailed documentation
- `docs/automatic-conversation-logging.md` - Post-session logging architecture

## Related Patterns
- **MCPKnowledgePersistencePattern** - MCP memory integration
- **ConditionalLoggingPattern** - Runtime logging control
- **NetworkAwareInstallationPattern** - Cross-environment support

## Technologies
- TypeScript, Node.js, MCP SDK
- Bash scripting
- File system operations
- Regular expressions

## Significance: 8/10
Essential for maintaining the coding project as a central knowledge hub, enabling seamless cross-project knowledge capture without manual intervention.
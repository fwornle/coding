# Enhanced Cross-Project Logging System

## Overview

The MCP logging server has been enhanced to automatically detect when work on the coding project (knowledge management tools) happens from within other project contexts, eliminating the need for manual log reorganization.

## Key Features

### 1. **Cross-Project Detection**

The logging server automatically detects coding project work based on conversation content:

**Detection Keywords:**
- `ukb`, `vkb` - Knowledge management commands
- `shared-memory.json`, `knowledge-base` - Core knowledge files
- `mcp`, `claude-mcp` - MCP integration terms
- `specstory`, `claude-logger` - Logging system terms
- `coding project`, `claude tools` - Direct references
- `install.sh`, `knowledge management` - Setup and workflow terms
- `transferable pattern`, `shared knowledge`, `cross-project` - Knowledge concepts

### 2. **Dual Logging**

When coding project work is detected in another project:
- **Primary Log**: Conversation logged to current project's `.specstory/history/`
- **Secondary Log**: Same conversation also logged to coding project's `.specstory/history/`
- **Metadata**: Secondary log includes cross-project source information

### 3. **Improved Filename Convention**

**New Format**: `YYYY-MM-DD_HH-MM-descriptive-title.md`

**Rules**:
- No spaces (replaced with hyphens)
- No capital letters (converted to lowercase)
- No special characters (removed or replaced)
- Maximum 50 characters for title portion
- Time component includes hour and minute

**Examples**:
- Old: `2025-06-10-Auto-logged Claude Code Session.md`
- New: `2025-06-10_18-04-auto-logged-claude-code-session.md`

## Implementation Details

### Auto-Detection Logic

```typescript
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

### Dual Logging Process

```typescript
// Log to current project (always)
await logger.logConversation(currentSessionId, userMsg, assistantMsg, metadata);

// Also log to coding project if detected
if (isCodingWork && !isInCodingProject) {
  const codingLogger = new SpecStoryLogger(codingProjectPath);
  const codingSessionId = `${generateSessionId()}-cross-project`;
  await codingLogger.logConversation(codingSessionId, userMsg, assistantMsg, {
    ...metadata,
    project_path: `${projectPath} (cross-project from coding tools)`
  });
}
```

### Filename Sanitization

```typescript
function sanitizeForFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-')         // Spaces to hyphens
    .replace(/-+/g, '-')          // Collapse hyphens
    .replace(/^-|-$/g, '')        // Remove leading/trailing
    .substring(0, 50);            // Limit length
}
```

## Usage Examples

### Scenario 1: Working on Timeline, Fixing ukb
**Context**: In timeline project, discussing ukb fixes
**Result**: 
- Logged to: `timeline/.specstory/history/2025-06-10_14-30-timeline-work.md`
- Also logged to: `coding/.specstory/history/2025-06-10_14-30-cross-project-ukb-fixes.md`

### Scenario 2: Pure Timeline Work
**Context**: In timeline project, discussing 3D visualization
**Result**:
- Logged to: `timeline/.specstory/history/2025-06-10_15-45-3d-visualization-fixes.md`
- No cross-project logging (no coding keywords detected)

### Scenario 3: Direct Coding Work
**Context**: In coding project, working on knowledge management
**Result**:
- Logged to: `coding/.specstory/history/2025-06-10_16-20-knowledge-management-updates.md`
- No dual logging (already in correct project)

## Migration and Maintenance

### Filename Normalization

A script is provided to normalize existing files:

```bash
# Normalize all SpecStory files
~/Agentic/coding/knowledge-management/normalize-specstory-filenames.sh

# Normalize specific directory
~/Agentic/coding/knowledge-management/normalize-specstory-filenames.sh /path/to/project
```

### Verification

Check if cross-project logging is working:

1. **Start Claude Code** in a non-coding project with `claude-mcp`
2. **Mention coding keywords** (ukb, shared-memory.json, etc.)
3. **Verify dual logs** appear in both projects' `.specstory/history/` directories

## Benefits

### 1. **Automatic Organization**
- No manual log cleanup required
- Conversations automatically appear in relevant project contexts
- Cross-project work is properly attributed

### 2. **Improved Discoverability**
- Coding project work is always findable in the coding project logs
- Historical context preserved in both locations
- Better support for `ukb` analysis of cross-project insights

### 3. **Team Collaboration**
- Consistent filename convention across all projects
- Easier automated processing of conversation logs
- Clear separation of project-specific vs. cross-project work

### 4. **Knowledge Management Integration**
- `ukb` can more easily find coding-related insights across projects
- Cross-project patterns are properly captured in knowledge base
- Supports the coding project's role as central knowledge hub

## Configuration

The system uses environment variables for configuration:

- `CLAUDE_TOOLS_PATH`: Path to coding project (for cross-project logging)
- `PROJECT_PATH`: Current project path (set by `claude-mcp` script)

These are automatically configured when using the `claude-mcp` startup script.

## Troubleshooting

### Cross-Project Logging Not Working

1. **Check environment variables** are set correctly
2. **Verify coding project path** exists and is writable
3. **Check console output** for error messages during logging
4. **Restart Claude Code** with `claude-mcp` to reload configuration

### Filename Convention Issues

1. **Run normalization script** to fix existing files
2. **Check for write permissions** in `.specstory/history/` directories
3. **Verify no filesystem restrictions** on filenames (case sensitivity, length limits)

---

*This enhanced logging system ensures that the coding project's role as a central knowledge management hub is properly supported with automatic cross-project conversation capture.*
# Automatic Conversation Logging

## Overview

The Claude Code MCP integration now includes automatic conversation logging that captures all interactions to `.specstory/history/` without requiring manual intervention.

## How It Works

### Architecture

1. **I/O Stream Interception**: `start-auto-logger.sh` launches a Node.js process that intercepts stdin/stdout
2. **Conversation Parsing**: Real-time analysis of conversation flow to detect user/assistant boundaries
3. **Smart Content Routing**: Intelligent analysis determines whether content should go to coding or current project
4. **Session Management**: Each session creates a timestamped log file in the appropriate repository
5. **Pass-through Design**: All content is logged while maintaining normal Claude Code operation

### Implementation Details

The auto-logging system works independently of MCP and uses I/O stream interception:

#### Stream Interception (`start-auto-logger.sh`)
- Launches Node.js monitoring process that intercepts Claude's stdin/stdout
- Detects conversation boundaries using pattern matching
- Maintains conversation state and buffers for user/assistant exchanges
- Routes content to appropriate `.specstory/history/` directories based on content analysis

#### Smart Content Detection
- **Coding Keywords**: ukb, vkb, shared-memory.json, MCP, knowledge management, etc.
- **Path Detection**: Matches coding repository paths and tool references
- **Cross-project Routing**: Ensures coding-related discussions go to coding/.specstory/history/
- **Dynamic Switching**: Can switch target repositories mid-conversation based on content

#### Legacy MCP Tools (Still Useful)
- `claude-logger-mcp` **kept for manual logging scenarios**:
  - Manual conversation recording when I/O interception isn't available
  - Debugging and testing logging functionality  
  - Session management tools (`start_session`, `end_session`, `list_sessions`)
  - Direct control over log formatting and metadata
- **Not used for automatic logging** due to MCP architectural limitations
- Tools: `enable_auto_logging`, `log_message`, `start_session`, `end_session`, `list_sessions`

### Configuration

Automatic logging is configured through the `claude-mcp` launcher script:

```bash
# claude-mcp script automatically detects and launches start-auto-logger.sh
LOGGER_SCRIPT="$CODING_REPO_DIR/start-auto-logger.sh"
if [[ -x "$LOGGER_SCRIPT" ]]; then
    # Launch Claude with I/O interception
    exec "$LOGGER_SCRIPT" "$(pwd)" "$CODING_REPO_DIR" "$@"
else
    # Fallback to Claude without logging
    exec claude --mcp-config "$MCP_CONFIG" "$@"
fi
```

Environment variables:
- `CODING_REPO`: Path to the coding repository (defaults to `/Users/q284340/Agentic/coding`)
- Current working directory passed to determine project context

## File Structure

Conversation logs are stored in:
```
project-root/
└── .specstory/
    └── history/
        ├── 2025-06-10-Auto-logged Claude Code Session.md
        ├── 2025-06-11-Fixing ukb interactive mode.md
        └── ...
```

### Log File Format

Each log file contains:
- **Session metadata**: ID, start time, project path
- **Conversation exchanges**: Timestamped user prompts and assistant responses
- **Tool usage**: Tools invoked during the conversation
- **Model information**: Which Claude model was used

Example:
```markdown
# Auto-logged Claude Code Session

**Session ID:** 2025-06-11_08-15-30_claude-code  
**Started:** 2025-06-11T06:15:30.123Z  
**Project:** /Users/username/project

---

## User

*2025-06-11T06:15:35.456Z*

How do I implement a singleton pattern in TypeScript?

## Assistant

*2025-06-11T06:15:40.789Z*

Here's how to implement a singleton pattern in TypeScript...

<details>
<summary>Metadata</summary>

Model: claude-opus-4-20250514  
Tools Used: Read, Write
</details>
```

## Troubleshooting

### Logs Not Being Created

1. **Check MCP Configuration**: Ensure `claude-code-mcp-processed.json` uses `index-auto.js`
2. **Verify Server Running**: Check if claude-logger MCP server started successfully
3. **Permissions**: Ensure write permissions for `.specstory/history/` directory

### Switching Between Manual and Auto Mode

To switch modes, update the MCP configuration:

**For Auto Mode** (recommended):
```bash
# Edit claude-code-mcp.json to use index-auto.js
# Run install.sh to regenerate processed config
./install.sh --update-mcp-config
```

**For Manual Mode**:
```bash
# Edit claude-code-mcp.json to use index.js
# Run install.sh to regenerate processed config
./install.sh --update-mcp-config
```

## Privacy and Security

- Logs are stored locally in your project directory
- No external transmission of conversation data
- Logs are excluded from git by default (check `.gitignore`)
- Sensitive information in conversations will be logged - review before sharing

## Integration with Knowledge Management

Logged conversations can be processed by the knowledge management system:

1. **Automatic Insight Extraction**: Future versions will analyze logs for patterns
2. **Session Summaries**: Generate summaries of long coding sessions
3. **Learning Capture**: Extract reusable solutions from problem-solving sessions
4. **Team Knowledge**: Share sanitized logs for team learning

## Future Enhancements

- [ ] Automatic insight extraction from conversation logs
- [ ] Session summarization tools
- [ ] Privacy filters for sensitive data
- [ ] Integration with `ukb` for automatic knowledge capture
- [ ] Search functionality across all conversation logs

---

*Note: The automatic logging feature ensures no valuable insights from Claude Code sessions are lost, creating a comprehensive record of your development journey.*
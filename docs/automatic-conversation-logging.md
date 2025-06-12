# Automatic Conversation Logging

## Overview

The Claude Code MCP integration now includes automatic conversation logging that captures all interactions to `.specstory/history/` without requiring manual intervention.

## How It Works

### Architecture

1. **MCP Server**: `claude-logger-mcp` runs as an MCP server alongside Claude Code
2. **Auto Mode**: Uses `index-auto.js` instead of `index.js` for automatic capture
3. **Session Management**: Each Claude Code session creates a new timestamped log file
4. **Real-time Capture**: All prompts and responses are logged as they occur

### Implementation Details

The auto-logging system consists of two versions of the claude-logger MCP server:

#### Manual Mode (`index.js`)
- Requires explicit calls to `log_message` for each exchange
- Provides tools like `enable_auto_logging`, `disable_auto_logging`, `log_message`
- Used when fine-grained control over logging is needed

#### Auto Mode (`index-auto.js`)
- Automatically starts logging when Claude Code launches
- Creates a session file immediately on startup
- Intercepts all message exchanges without manual intervention
- Extracts meaningful titles from first user messages
- Provides `auto_log_exchange` tool for internal use

### Configuration

The MCP configuration template (`claude-code-mcp.json`) specifies which version to use:

```json
{
  "claude-logger": {
    "command": "node",
    "args": ["{{CLAUDE_PROJECT_PATH}}/claude-logger-mcp/dist/index-auto.js"],
    "env": {
      "PROJECT_PATH": "{{CLAUDE_PROJECT_PATH}}"
    }
  }
}
```

The `install.sh` script processes this template and replaces placeholders with actual paths.

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
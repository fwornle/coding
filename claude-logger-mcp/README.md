# Claude Logger MCP Server

An MCP (Model Context Protocol) server that provides specstory-style logging functionality for Claude Code conversations. This server automatically saves AI chat conversations to well-formatted Markdown files in the `.specstory/history` directory, following the SpecStory format specification. With automatic logging enabled, all your Claude Code conversations are saved without any manual intervention.

## Features

- **Automatic Conversation Logging**: Automatically save all Claude Code conversations when auto-logging is enabled
- **SpecStory Compatibility**: Stores logs in `.specstory/history` directory using SpecStory format  
- **Session Management**: Start, end, and manage conversation sessions both manually and automatically
- **Metadata Tracking**: Capture model information, tools used, project context, and timestamps
- **Project Integration**: Filter and organize conversations by project path
- **Search and Retrieval**: List and retrieve past conversation sessions

## Installation

1. Clone or download this MCP server to your local machine
2. Install dependencies:

```bash
cd claude-logger-mcp
npm install
```

3. Build the TypeScript code:

```bash
npm run build
```

## Configuration

Add the server to your Claude Code MCP configuration file (`claude-code-mcp.json`):

```json
{
  "mcpServers": {
    "claude-logger": {
      "command": "node",
      "args": ["/path/to/claude-logger-mcp/dist/index.js"],
      "env": {
        "PROJECT_PATH": "/path/to/your/project"
      }
    }
  }
}
```

## Available Tools

### Automatic Logging Tools

### `enable_auto_logging`
🔴 Start automatic logging of all Claude Code conversations.

**Parameters:** None

### `disable_auto_logging`
⏹️ Stop automatic logging.

**Parameters:** None

### `auto_log_status`
📊 Check if automatic logging is currently enabled.

**Parameters:** None

### `log_message`
Queue a message for automatic logging (used internally by Claude Code).

**Parameters:**
- `type` (required): Message type ("user" or "assistant")
- `content` (required): Message content

### Manual Logging Tools

### `start_session`
Start a new conversation session manually.

**Parameters:**
- `session_id` (required): Unique identifier for the session
- `project_path` (optional): Path to the project directory
- `title` (optional): Human-readable title for the session

### `log_conversation`
Log a conversation exchange between user and assistant manually.

**Parameters:**
- `session_id` (required): Session identifier
- `user_message` (required): User's message content
- `assistant_message` (required): Assistant's response content
- `metadata` (optional): Additional metadata including:
  - `timestamp`: ISO timestamp
  - `model`: Model name used
  - `tools_used`: Array of tool names used
  - `project_path`: Project directory path
  - `branch`: Git branch name

### `end_session`
End a conversation session with optional summary.

**Parameters:**
- `session_id` (required): Session identifier to end
- `summary` (optional): Summary of the session

### `list_sessions`
List all logged conversation sessions.

**Parameters:**
- `limit` (optional): Maximum number of sessions to return (default: 10)
- `project_path` (optional): Filter by project path

### `get_session`
Retrieve a specific conversation session.

**Parameters:**
- `session_id` (required): Session identifier to retrieve

## Output Format

The server creates markdown files in the `.specstory/history` directory with the following structure:

```markdown
# Conversation Session: session-id

**Session ID:** unique-session-id  
**Started:** 2025-06-05T10:30:00.000Z  
**Project:** /path/to/project  

---

## User

*2025-06-05T10:30:15.000Z*

User's message content here...

## Assistant

*2025-06-05T10:30:20.000Z*

Assistant's response here...

<details>
<summary>Metadata</summary>

Model: claude-3-5-sonnet-20241022  
Tools Used: read_file, write_file  
Branch: feature/new-functionality  
</details>

---

**Session Ended:** 2025-06-05T10:45:00.000Z  
**Total Messages:** 4

## Session Summary

Optional summary of what was accomplished in this session.
```

## Directory Structure

The server creates and manages the following directory structure:

```
your-project/
├── .specstory/
│   ├── .gitignore
│   └── history/
│       ├── 2025-06-05-session-name.md
│       ├── 2025-06-05-another-session.md
│       └── ...
```

## Quick Start: Automatic Logging

1. **Enable auto-logging in Claude Code:**
   ```
   User: Enable automatic logging
   ```

2. **Continue your normal conversation** - all messages will be automatically saved to `.specstory/history/`

3. **Check status anytime:**
   ```
   User: Is auto-logging active?
   ```

4. **Disable when done:**
   ```
   User: Stop logging
   ```

## Integration with SpecStory

This MCP server is designed to be compatible with the SpecStory VS Code extension. The logged conversations will be accessible through SpecStory's interface and can be used for:

- Context references in new chat sessions
- Searching previous prompts and code snippets
- Meta-analyzing patterns and learning from past experiences
- Deriving AI rules from past interactions

## Development

### Build
```bash
npm run build
```

### Development Mode (with watch)
```bash
npm run dev
```

### Testing
```bash
npm test
```

## License

MIT License - see LICENSE file for details.

## Compatibility

- **Node.js**: 18+ required
- **MCP SDK**: Compatible with @modelcontextprotocol/sdk v0.6.0+
- **SpecStory**: Compatible with SpecStory extension format
- **Claude Code**: Designed for Claude Code integration
# Claude MCP Configuration Setup Guide

This guide explains how to set up the MCP (Model Context Protocol) servers for the Claude Knowledge Management System.

## Overview

The `claude-code-mcp.json` file is now a template that uses placeholders for sensitive information and paths. During installation, these placeholders are replaced with actual values from your `.env` file.

## Setup Steps

### 1. Create your `.env` file

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` and set your values:

```env
# Your Anthropic API key (required for browser-access)
ANTHROPIC_API_KEY=your-actual-api-key-here

# Chrome debugging URL (default is usually fine)
LOCAL_CDP_URL=ws://localhost:9222

# Project path (will be set automatically by installer)
CLAUDE_PROJECT_PATH=/path/to/your/claude/repo
```

### 2. Run the installer

The installer will automatically:
- Replace placeholders in `claude-code-mcp.json` with your environment values
- Copy the configured file to your Claude application directory
- Create command wrappers with correct paths

```bash
./install.sh
```

### 3. Manual setup (if needed)

If the installer couldn't find your Claude configuration directory, manually copy the processed configuration:

**macOS:**
```bash
cp claude-code-mcp.json "$HOME/Library/Application Support/Claude/"
```

**Linux:**
```bash
cp claude-code-mcp.json "$HOME/.config/Claude/"
```

**Windows:**
```bash
cp claude-code-mcp.json "$APPDATA/Claude/"
```

## Template Placeholders

The `claude-code-mcp.json` template uses these placeholders:

- `{{CLAUDE_PROJECT_PATH}}` - The absolute path to your Claude repo
- `{{LOCAL_CDP_URL}}` - Chrome DevTools Protocol URL
- `{{ANTHROPIC_API_KEY}}` - Your Anthropic API key

## Security Notes

1. **Never commit `.env` to version control** - It contains sensitive API keys
2. The template file (`claude-code-mcp.json`) is safe to commit as it only contains placeholders
3. The `.gitignore` file is configured to exclude:
   - `.env` and all `.env.*` files
   - Processed MCP configuration files
   - Installation artifacts

## Troubleshooting

### API Key Issues

If you see errors about missing API keys:
1. Check that your `.env` file exists and contains the correct keys
2. Re-run the installer: `./install.sh`
3. Restart Claude after updating the configuration

### Path Issues

If MCP servers can't find files:
1. Ensure `CLAUDE_PROJECT_PATH` in `.env` points to the correct directory
2. Use absolute paths, not relative paths
3. On Windows, use forward slashes: `C:/Users/username/Claude`

### Chrome Debugging

For browser-access to work:
1. Start Chrome with debugging enabled: `./browser-access/start-chrome-debug.sh`
2. Verify the debugging port matches `LOCAL_CDP_URL` in your `.env`

## Updating Configuration

To update your MCP configuration after changes:

1. Edit your `.env` file with new values
2. Re-run the setup portion of the installer:
   ```bash
   source .env
   # The installer will handle the rest
   ./install.sh
   ```

## For Team Members

When setting up on a new machine:
1. Clone the repository
2. Copy `.env.example` to `.env`
3. Add your API keys to `.env`
4. Run `./install.sh`

The installer will handle all path adjustments automatically based on where you cloned the repository.
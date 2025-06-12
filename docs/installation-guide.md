# Coding Knowledge Management System - Installation Guide

## Quick Start

> **Note:** Throughout this guide, `~/coding` is used as an example installation directory. You can clone to any location you prefer (e.g., `~/claude-knowledge`, `~/workspace/knowledge-system`, etc.). Replace `~/coding` with your chosen path, and update `$PROJECT_ROOT` variables in configuration examples accordingly.

```bash
# Clone the repository to your preferred location
git clone <repository-url> ~/coding
cd ~/coding

# Run the installer
./install.sh

# Reload your shell
source ~/.bashrc  # or ~/.zshrc on macOS
```

## What Gets Installed

The installation script sets up:

1. **Knowledge Management Tools**
   - `ukb` - Update Knowledge Base command
   - `vkb` - View Knowledge Base command

2. **Memory Visualizer**
   - Web-based knowledge graph visualization
   - Automatically cloned and built

3. **MCP Servers** (optional)
   - Browser automation (Stagehand)
   - Conversation logger

4. **Shell Integration**
   - Global command access from any directory
   - Environment variables

## Platform-Specific Instructions

### macOS

```bash
# Install prerequisites (if needed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git node python3 jq

# Clone and install
git clone <repository-url> ~/coding
cd ~/coding
./install.sh
source ~/.zshrc
```

### Linux (Ubuntu/Debian)

```bash
# Install prerequisites
sudo apt-get update
sudo apt-get install -y git nodejs npm python3 python3-pip jq

# Clone and install
git clone <repository-url> ~/coding
cd ~/coding
./install.sh
source ~/.bashrc
```

### Windows (WSL2 Recommended)

```bash
# In WSL2 terminal
# Install prerequisites
sudo apt-get update
sudo apt-get install -y git nodejs npm python3 python3-pip jq

# Clone and install
git clone <repository-url> ~/coding
cd ~/coding
./install.sh
source ~/.bashrc
```

### Windows (Git Bash)

```bash
# Prerequisites:
# 1. Install Git Bash from https://git-scm.com/downloads
# 2. Install Node.js from https://nodejs.org/
# 3. Install Python from https://www.python.org/downloads/
# 4. Install jq from https://stedolan.github.io/jq/download/

# In Git Bash terminal
git clone <repository-url> ~/coding
cd ~/coding
./install.sh
source ~/.bashrc
```

## Usage

### Update Knowledge Base (ukb)

Capture insights after coding sessions:

```bash
# Automatic mode - analyzes git commits and .specstory files
ukb

# Interactive mode - capture deep insights manually
ukb --interactive
```

### View Knowledge Base (vkb)

Visualize your knowledge graph:

```bash
# Start the visualization server
vkb

# Stop the server
vkb stop

# Check server status
vkb status
```

## MCP Server Configuration (Optional)

### Browser Access (Stagehand)

1. Set environment variables:
   ```bash
   export ANTHROPIC_API_KEY='your-key'
   export BROWSERBASE_API_KEY='your-key'  # Optional
   ```

2. Add to Claude Code MCP settings:
   ```json
   {
     "mcpServers": {
       "browser-access": {
         "command": "node",
         "args": ["/full/path/to/your/project/browser-access/dist/index.js"]
       }
     }
   }
   ```
   
   > **Note:** Replace `/full/path/to/your/project` with your actual project installation path (e.g., `/Users/username/project` or wherever you cloned the repository).

### Claude Logger

Add to Claude Code MCP settings:
```json
{
  "mcpServers": {
    "claude-logger": {
      "command": "node",
      "args": ["/full/path/to/your/project/claude-logger-mcp/dist/index.js"]
    }
  }
}
```

## Knowledge Sharing Workflow

1. **Capture insights** during development:
   ```bash
   ukb  # Run after significant work
   ```

2. **Review captured knowledge**:
   ```bash
   vkb  # Visualize the knowledge graph
   ```

3. **Share with team**:
   ```bash
   cd ~/coding
   git add shared-memory.json
   git commit -m "feat: add insights from feature X development"
   git push
   ```

4. **Team members update**:
   ```bash
   cd ~/coding
   git pull
   vkb  # View updated knowledge
   ```

## Troubleshooting

### Commands not found

```bash
# Reload shell configuration
source ~/.bashrc  # or ~/.zshrc

# Check PATH
echo $PATH | grep -q "project/bin" && echo "PATH is set" || echo "PATH not set"
```

### Memory visualizer issues

```bash
# Rebuild visualizer
cd ~/coding/memory-visualizer
npm install
npm run build
```

### Permission errors

```bash
# Fix script permissions
chmod +x ~/coding/knowledge-management/ukb
chmod +x ~/coding/knowledge-management/vkb
chmod +x ~/coding/bin/*
```

### Port conflicts (vkb)

```bash
# Check what's using port 8080
lsof -i :8080

# Stop vkb server
vkb stop

# Use different port (edit vkb script)
```

## Uninstalling

To remove the installation while preserving your knowledge data:

```bash
cd ~/coding
./uninstall.sh
```

This removes:
- Installed components
- Shell configurations
- Dependencies

But preserves:
- `shared-memory.json` (your knowledge data)
- Source code
- Configuration files

## Support

- Check `install.log` for installation details
- Run commands with `--help` for usage information
- See `docs/` directory for detailed documentation
# Windows Installation Guide

This document describes Windows-specific differences and additional steps required for installing the Claude Knowledge Management System on Windows.

## Overview

The `install.bat` script provides automated installation for Windows users that matches the functionality of `install.sh` for Mac/Linux. However, there are some Windows-specific considerations and manual steps required.

## Prerequisites

Before running `install.bat`, ensure you have:

1. **Node.js** (v18 or higher) - https://nodejs.org/
2. **npm** (comes with Node.js)
3. **Git for Windows** - https://git-scm.com/downloads
   - **Important**: Install with "Git Bash" option selected
4. **Python** (3.8+) - https://www.python.org/downloads/
   - **Important**: Check "Add Python to PATH" during installation

## Installation Steps

### Step 1: Run install.bat

1. Open Command Prompt or PowerShell as Administrator
2. Navigate to the coding directory
3. Run the installer:
   ```cmd
   install.bat
   ```

The script will:
- Check all dependencies
- Install npm packages for main project and lib/ subdirectories
- Clone and build memory-visualizer
- Install all available MCP servers
- Create .env configuration file
- Create command wrappers (.bat files)
- Create bash wrapper scripts
- Configure Git Bash environment
- Initialize knowledge databases

### Step 2: Restart Your Terminal

The installer automatically adds the `bin` directory to your Windows PATH. To activate the changes:

1. **Close and reopen your terminal** (CMD, PowerShell, or Git Bash)
2. The `coding`, `ukb`, and `vkb` commands should now be available

**Note**: If the automatic PATH setup failed, you can add it manually:
1. Press `Win+X` and select "System"
2. Click "Advanced system settings" → "Environment Variables"
3. Under "User variables", edit "Path" → Click "New"
4. Add: `C:\Users\YourUsername\coding\bin` (replace with your actual path)
5. Click "OK" and restart your terminal

### Step 3: Verify Installation

#### For Git Bash Users:
```bash
# Restart Git Bash or reload configuration
source ~/.bash_profile

# Test commands
coding --help
vkb status
ukb --help
```

#### For CMD/PowerShell Users:
```cmd
# Restart your terminal, then test
coding --help
vkb status
ukb --help
```

## Windows-Specific Differences

### 1. Dual Command System

Windows requires two sets of command wrappers:

- **Bash wrappers** (in `knowledge-management/` and `bin/`): Used by Git Bash
- **Batch wrappers** (in `bin/*.bat`): Used by CMD/PowerShell
  - These are self-detecting and automatically find the installation directory
  - No manual environment variable configuration needed

### 2. Path Handling

- Windows uses backslashes (`\`) for paths
- The system internally converts to forward slashes (`/`) for cross-platform compatibility
- Environment variables use forward slashes (e.g., `CODING_TOOLS_PATH=/c/Users/...`)

### 3. Temporary Directory

- Unix systems use `/tmp/`
- Windows uses `os.tmpdir()` which typically resolves to:
  `C:\Users\YourUsername\AppData\Local\Temp`

This affects:
- `lib/vkb-server/index.js`: PID and log files
- Any temporary file operations

### 4. Process Management

- Unix command `lsof` doesn't exist on Windows
- `src/knowledge-management/GraphDatabaseService.js` includes platform detection to skip `lsof` on Windows

### 5. Line Endings

- Windows uses CRLF (`\r\n`)
- Unix uses LF (`\n`)
- Git should be configured to handle this automatically (`core.autocrlf=true`)

### 6. Environment Variable Configuration

Git Bash users get automatic configuration via `~/.bash_profile`:
```bash
export CODING_REPO="/c/Users/YourUsername/coding"
export PATH="/c/Users/YourUsername/coding/bin:$PATH"
```

CMD/PowerShell users need to add to Windows System Environment Variables manually (see Step 2 above).

## Troubleshooting

### Commands Not Found

**Problem**: `coding`, `ukb`, or `vkb` commands not recognized

**Solutions**:
1. **For Git Bash**: Run `source ~/.bash_profile` or restart Git Bash
2. **For CMD/PowerShell**:
   - Verify `C:\Users\YourUsername\coding\bin` is in your PATH
   - Restart your terminal after adding to PATH

### VKB Server Won't Start

**Problem**: Error about missing files or ports in use

**Solutions**:
1. Check if port 8080 is already in use:
   ```cmd
   netstat -ano | findstr :8080
   ```
2. Kill the process using the port if needed
3. Ensure memory-visualizer is built:
   ```bash
   cd integrations/memory-visualizer
   npm install
   npm run build
   ```

### Git Bash Not Found

**Problem**: Install script warns about Git Bash not in PATH

**Solution**:
1. Reinstall Git for Windows
2. During installation, select "Use Git and optional Unix tools from the Command Prompt"
3. Or add Git Bash to PATH manually:
   - Default location: `C:\Program Files\Git\bin`

### Permission Errors

**Problem**: Access denied or permission errors during installation

**Solutions**:
1. Run Command Prompt or PowerShell as Administrator
2. Ensure antivirus isn't blocking npm or Git operations
3. Check file/folder permissions in the coding directory

### Node Version Mismatch

**Problem**: npm warnings about Node version

**Solution**:
1. Check installed Node version: `node --version`
2. Ensure you're using Node 18 or higher
3. Update Node.js if needed from https://nodejs.org/

## File Locations

After successful installation:

```
C:\Users\YourUsername\coding\
├── .env                          # Environment configuration
├── .data\
│   └── knowledge-graph\          # Graph database storage
├── bin\
│   ├── coding.bat               # Main command (CMD/PowerShell)
│   ├── ukb.bat                  # Update KB (CMD/PowerShell)
│   ├── vkb.bat                  # View KB (CMD/PowerShell)
│   ├── coding                   # Main command (Git Bash)
│   ├── ukb                      # Wrapper script (Git Bash)
│   └── vkb                      # Wrapper script (Git Bash)
├── knowledge-management\
│   ├── ukb                      # Actual ukb bash script
│   └── vkb                      # Actual vkb bash script
├── integrations\
│   └── memory-visualizer\       # Knowledge graph visualizer
│       └── dist\                # Built web UI
├── lib\
│   ├── knowledge-api\           # Knowledge API library
│   └── vkb-server\              # VKB server library
└── shared-memory.json           # Shared knowledge storage
```

## Next Steps

After installation:

1. **Configure API Keys** (optional):
   - Edit `.env` file
   - Add your API keys for AI services

2. **Start Using the System**:
   ```bash
   # View knowledge base
   vkb start

   # Open browser to http://localhost:8080

   # Update knowledge base
   ukb update

   # Use coding command
   coding --help
   ```

3. **Explore Documentation**:
   - See `README.md` for general usage
   - See `CLAUDE.md` for development guidelines

## Known Limitations

1. **No Network Detection**: Unlike `install.sh`, `install.bat` doesn't detect Corporate CN vs Public networks
2. **No VSCode Extension Install**: VSCode extension must be installed manually
3. **No Automatic MCP Configuration**: MCP server configuration in Claude Desktop must be done manually
4. **No Hook Setup**: Git hooks and status line must be configured manually if needed

## Getting Help

If you encounter issues:

1. Check this document's Troubleshooting section
2. Verify all prerequisites are installed correctly
3. Check the GitHub repository issues
4. Ensure you're using Git Bash for the best Windows experience

## Differences from install.sh

The `install.bat` script provides core installation functionality but differs from `install.sh` in these areas:

| Feature | install.sh | install.bat |
|---------|-----------|-------------|
| Dependency checking | ✓ | ✓ |
| Network detection | ✓ | ✗ |
| Main dependencies | ✓ | ✓ |
| Lib subdirectories | ✓ | ✓ |
| Memory visualizer | ✓ | ✓ |
| MCP servers | ✓ | ✓ (if present) |
| .env creation | ✓ | ✓ |
| Command wrappers | ✓ | ✓ (self-detecting) |
| PATH configuration | ✓ | ✓ (automated) |
| Shell configuration | ✓ | ✓ (Git Bash) |
| Knowledge DB init | ✓ | ✓ |
| VSCode extension | ✓ | ✗ (manual) |
| MCP config | ✓ | ✗ (manual) |
| Hooks setup | ✓ | ✗ (manual) |
| Status line | ✓ | ✗ (manual) |

## Advanced: Manual Configuration

If you need features not covered by `install.bat`:

### VSCode Extension

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X)
3. Search for and install relevant extensions
4. Configure in `.vscode/settings.json`

### MCP Configuration

1. Locate Claude Desktop configuration file
2. Add MCP server configurations manually
3. Restart Claude Desktop

### Git Hooks

1. Navigate to `.git/hooks`
2. Create hook scripts as needed
3. Make them executable: `chmod +x .git/hooks/*`

## Conclusion

The Windows installation provides all core functionality needed to run the Claude Knowledge Management System. While some advanced features require manual configuration, the automated installer handles the majority of the setup process.

For the best experience on Windows, we recommend using Git Bash as your primary terminal.

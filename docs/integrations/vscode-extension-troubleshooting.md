# VSCode Extension Troubleshooting Guide

## Common Issues and Solutions

### 1. "Command 'View Knowledge Base' results in an error - command 'km-copilot.vkb' not found"

This error indicates the VSCode extension is not properly installed or loaded.

#### Solution Steps:

1. **Build and Install the Extension**:
   ```bash
   cd ~/coding/vscode-km-copilot
   npm install
   npm run package
   code --install-extension km-copilot-bridge-*.vsix
   ```

2. **Restart VSCode**:
   - Close all VSCode windows
   - Start VSCode fresh
   - Check status bar for "KM Ready" indicator

3. **Verify Extension Installation**:
   ```bash
   code --list-extensions | grep km-copilot
   # Should show: coding-tools.km-copilot-bridge
   ```

4. **Start Fallback Services**:
   ```bash
   # The extension requires fallback services running
   coding --copilot
   ```

5. **Check Extension Logs**:
   - Open VSCode
   - View → Output → Select "Extension Host" from dropdown
   - Look for "KM Copilot Bridge activating..." messages

### 2. "Extension installed but commands don't work"

#### Possible Causes:

1. **Fallback services not running**:
   ```bash
   # Start services first
   coding --copilot
   
   # Test services are running
   curl http://localhost:8765/health
   ```

2. **Extension not activated**:
   - Check VSCode status bar for "KM Ready"
   - If missing, restart VSCode

3. **Port conflict**:
   - Default port is 8765
   - Check VSCode settings: `kmCopilot.fallbackServicePort`

### 3. "Failed to launch knowledge viewer"

#### Solutions:

1. **Check memory visualizer installation**:
   ```bash
   cd ~/coding
   ./scripts/test-coding.sh
   # Look for "Memory visualizer" section
   ```

2. **Manually start vkb**:
   ```bash
   # Test from command line first
   vkb
   # Should open browser at localhost:8080
   ```

3. **Check port availability**:
   ```bash
   lsof -i :8080
   # Kill any conflicting process
   ```

### 4. Building Extension from Source

If the extension VSIX is missing or corrupted:

```bash
# Clean build
cd ~/coding/vscode-km-copilot
rm -rf node_modules package-lock.json *.vsix
npm install
npm run package

# Find the built extension
ls -la *.vsix
# Should show: km-copilot-bridge-0.1.0.vsix

# Install
code --install-extension km-copilot-bridge-0.1.0.vsix
```

### 5. Manual Command Palette Setup

If automatic registration fails:

1. Open VSCode Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Type: "Preferences: Open Keyboard Shortcuts (JSON)"
3. Add these bindings:
   ```json
   [
     {
       "key": "ctrl+alt+v",
       "command": "km-copilot.vkb",
       "when": "editorTextFocus"
     },
     {
       "key": "ctrl+alt+u", 
       "command": "km-copilot.ukb",
       "when": "editorTextFocus"
     }
   ]
   ```

### 6. Testing Extension Functionality

Run this test sequence:

```bash
# 1. Start fallback services
coding --copilot

# 2. Test service health
curl http://localhost:8765/health

# 3. Open VSCode
code

# 4. Check extension
# - Look for "KM Ready" in status bar
# - Open Command Palette (Ctrl+Shift+P)
# - Type "View Knowledge"
# - Should see "View Knowledge Base" command

# 5. Test Copilot Chat integration
# - Open Copilot Chat
# - Type: @KM vkb
# - Should respond with viewer launch
```

### 7. Complete Reinstall

If all else fails:

```bash
# 1. Uninstall extension
code --uninstall-extension coding-tools.km-copilot-bridge

# 2. Clean build
cd ~/coding/vscode-km-copilot
rm -rf node_modules *.vsix

# 3. Rebuild
npm install
npm run package

# 4. Reinstall
code --install-extension km-copilot-bridge-*.vsix

# 5. Restart VSCode completely
```

### 8. Debug Mode

Enable extension debugging:

1. Open VSCode
2. Run → Start Debugging → Select "Extension" 
3. This opens a new VSCode window with extension loaded
4. Check Debug Console for errors

### Required Components Checklist

✅ VSCode installed  
✅ GitHub Copilot extension (for chat integration)  
✅ Fallback services running (`coding --copilot`)  
✅ Port 8765 available for HTTP server  
✅ Port 8080 available for knowledge viewer  
✅ Extension built and installed  
✅ VSCode restarted after installation  

## Getting Help

If issues persist:

1. Run diagnostic test:
   ```bash
   ./scripts/test-coding.sh
   ```

2. Check extension source:
   ```bash
   ls -la ~/coding/vscode-km-copilot/src/
   # Should have: extension.js, chatParticipant.js, fallbackClient.js
   ```

3. Verify package.json configuration:
   ```bash
   cat ~/coding/vscode-km-copilot/package.json | grep -A5 "commands"
   # Should show km-copilot.ukb and km-copilot.vkb commands
   ```
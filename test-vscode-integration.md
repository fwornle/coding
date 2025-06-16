# VSCode Knowledge Management Integration Test

## Setup Steps

1. **Clone the repo** (if not already done):
   ```bash
   git clone <repo-url>
   cd coding
   ```

2. **Run installation**:
   ```bash
   ./install.sh
   ```
   This will:
   - Install Node.js dependencies
   - Build and install the VSCode extension
   - Set up all required services

3. **Start services**:
   ```bash
   coding --copilot
   ```
   You should see:
   ```
   [CoPilot] Starting fallback services...
   Initializing CoPilot fallback services...
   ✓ Memory service (Graphology) started
   ✓ Knowledge base imported successfully
   ✓ Browser service (Playwright) started
   ✓ All fallback services started successfully
   ```

## Test VSCode Integration

1. **Open VSCode** in your project directory

2. **Open Copilot Chat** (Ctrl+Shift+I or from Command Palette)

3. **Test basic KM commands**:
   ```
   @km ukb
   ```
   Should analyze session data and show transferable insights

   ```
   @km vkb
   ```
   Should launch the knowledge graph viewer

   ```
   @km search performance
   ```
   Should search the knowledge base

4. **Test manual pattern entry**:
   ```
   @km ukb Problem: slow API responses, Solution: implement caching layer
   ```
   Should add a new pattern to the knowledge base

## Expected Behavior

- **Auto-analysis**: `@km ukb` automatically analyzes:
  - Recent git commits (fix:, feat:, refactor:)
  - .specstory/history conversation logs
  - Extracts transferable patterns
  
- **Knowledge persistence**: All insights saved to shared-memory.json

- **Graph visualization**: `@km vkb` opens localhost:8080 with interactive graph

- **Search functionality**: Find relevant patterns from knowledge base

## Verification

Check that insights were captured:
```bash
cat shared-memory.json | jq '.entities[] | select(.entityType == "GitPattern" or .entityType == "ConversationPattern")'
```

## Troubleshooting

### Extension not loading
- Check VSCode Extensions panel for "Knowledge Management Copilot Bridge"
- If missing, manually install from `vscode-km-copilot/*.vsix`

### Services not starting
- Ensure port 8765 is available
- Check `.coding-tools/fallback-services.pid` exists
- Restart with: `pkill -f fallback-services; coding --copilot`

### No insights found
- Make some git commits with conventional format (fix:, feat:)
- Have some conversation history in `.specstory/history/`
- Run `@km ukb` again
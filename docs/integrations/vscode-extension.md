# VSCode Extension Bridge for Knowledge Management

## Overview

The VSCode Extension Bridge (`vscode-km-copilot`) seamlessly integrates knowledge management commands (`ukb`, `vkb`) into GitHub Copilot's interactive chat window within Visual Studio Code. This integration allows developers to capture insights, update the knowledge base, and visualize knowledge graphs directly from their IDE without switching contexts.

## Architecture

### System Architecture

![VSCode Integrated Architecture](../images/vscode-integrated-architecture.png)

The VSCode Extension Bridge integrates seamlessly with the existing knowledge management system, providing a unified interface through GitHub Copilot's chat functionality. The architecture features a Memory Service Layer with Graphology in-memory graph processing and automatic synchronization with shared-memory.json.

### Component Architecture

![VSCode Component Diagram](../images/vscode-component-diagram.png)

The extension consists of several key components:
- **Extension Main**: Entry point and lifecycle management
- **Chat Participant**: Handles @KM commands in Copilot chat
- **Fallback Client**: HTTP and WebSocket communication with services
- **Service Manager**: Manages service discovery and auto-start functionality
- **Knowledge Base**: Graphology In-Memory Graph with auto-sync to shared-memory.json

### Integration Flow

![VSCode Extension Flow](../images/vscode-extension-flow.png)

The extension follows a comprehensive flow for handling commands:

1. **Extension Activation**: VSCode loads the extension and registers the `@km` chat participant
2. **Service Discovery**: Extension checks for running fallback services on port 8765
3. **Service Startup**: If services aren't running, extension can start them automatically
4. **Command Processing**: Chat commands are processed through the fallback service client
5. **Response Handling**: Results are displayed in the Copilot chat interface
6. **Real-time Updates**: WebSocket connections provide live service status updates

## Testing the Integration

For a detailed testing guide with step-by-step instructions, see [VSCode Testing Guide](vscode-testing-guide.md).

## Features

### Chat Participant Integration

The extension registers a **`@KM`** chat participant in GitHub Copilot, enabling:

- **Direct UKB Commands**: `@KM ukb Problem: slow rendering, Solution: use React.memo`
- **VKB Visualization**: `@KM vkb` - Launch knowledge graph viewer
- **Knowledge Search**: `@KM search Redux patterns`
- **Contextual Queries**: `@KM What patterns do we have for state management?`

### Command Support

#### UKB (Update Knowledge Base)
```
@KM ukb Problem: API calls are slow, Solution: implement caching with Redis
```

**Features:**
- **Auto-analysis mode**: `@KM ukb` (without specific pattern) analyzes session data
- **Manual pattern entry**: Structured problem/solution capture
- **Interactive feedback**: Shows entity name, type, and significance
- **Action buttons**: Quick access to knowledge graph viewer

#### VKB (Visualize Knowledge Base)
```
@KM vkb
```

**Features:**
- **One-click launch**: Opens knowledge graph at localhost:8080
- **Statistics display**: Shows entity count, relation count, last updated
- **Direct navigation**: Clickable links to open in browser

#### Knowledge Search
```
@KM search performance optimization
@KM find React patterns
```

**Features:**
- **Fuzzy search**: Searches across entity names, types, and observations
- **Structured results**: Shows problem, solution, code examples
- **Relevance scoring**: Results ordered by significance and relevance

### Command Palette Integration

Direct commands available via Command Palette:
- `KM: Update Knowledge Base` - Interactive UKB input
- `KM: Launch Knowledge Viewer` - Opens VKB in browser

## Installation & Setup

### Prerequisites

1. **Install main system**:
   ```bash
   cd /path/to/coding
   ./install.sh
   ```

2. **Start fallback services**:
   ```bash
   coding --copilot
   ```

### Extension Installation

1. **Build the extension**:
   ```bash
   cd vscode-km-copilot
   npm install
   npm run package
   ```

2. **Install in VSCode**:
   - Open VSCode
   - Extensions view → "..." menu → "Install from VSIX..."
   - Select `km-copilot-bridge-0.1.0.vsix`

3. **Verify installation**:
   - Look for "KM Ready" in status bar
   - Try `@km` in Copilot chat

## Technical Implementation

### Extension Structure

```
vscode-km-copilot/
├── src/
│   ├── extension.js          # Main extension entry point
│   ├── chatParticipant.js    # Copilot chat integration
│   ├── fallbackClient.js    # HTTP client for services
│   └── serviceManager.js     # Service lifecycle management
├── media/
│   └── km-icon.svg          # Extension icon
├── package.json             # Extension manifest
└── km-copilot-bridge-0.1.0.vsix  # Built extension
```

### Key Components

#### 1. Extension Activation (`extension.js`)

```javascript
async function activate(context) {
    // Start fallback services if needed
    await startFallbackServiceIfNeeded(servicePort);
    
    // Initialize HTTP client
    client = new FallbackServiceClient(servicePort);
    await client.connect();
    
    // Register chat participant
    chatParticipant = new KMChatParticipant(client);
    const participant = vscode.chat.createChatParticipant('km-assistant', 
        async (request, context, response, token) => {
            await chatParticipant.handleRequest(request, context, response, token);
        });
    
    // Register commands and UI elements
    context.subscriptions.push(participant);
}
```

#### 2. Chat Participant (`chatParticipant.js`)

**Command Routing:**
- `ukb` → `handleUKB()` - Pattern capture and knowledge updates
- `vkb` → `handleVKB()` - Knowledge graph visualization
- `search` → `handleSearch()` - Knowledge base search
- General queries → `handleGeneralQuery()` - Contextual assistance

**UKB Processing:**
- **Auto-analysis**: Analyzes session data for transferable insights
- **Manual entry**: Parses problem/solution from user input
- **Structured response**: Formatted results with action buttons

#### 3. Fallback Service Client (`fallbackClient.js`)

**HTTP API Integration:**
```javascript
class FallbackServiceClient {
    async updateKnowledge(pattern) {
        return await axios.post(`${this.baseUrl}/api/knowledge/update`, {
            entity: pattern
        });
    }
    
    async search(query) {
        return await axios.get(`${this.baseUrl}/api/knowledge/search`, {
            params: { q: query }
        });
    }
    
    async launchViewer() {
        const response = await axios.post(`${this.baseUrl}/api/viewer/launch`);
        return response.data.url;
    }
}
```

**WebSocket Integration:**
- Real-time service status updates
- Knowledge base change notifications
- Error handling and reconnection

### Service Communication

#### HTTP API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health check |
| `/api/knowledge/update` | POST | Update knowledge base |
| `/api/knowledge/search` | GET | Search knowledge base |
| `/api/knowledge/stats` | GET | Get statistics |
| `/api/viewer/launch` | POST | Launch knowledge viewer |
| `/api/knowledge/context` | POST | Get relevant context |
| `/api/knowledge/analyze-session` | POST | Auto-analyze session |

#### WebSocket Events

| Event | Description |
|-------|-------------|
| `knowledge_updated` | Knowledge base updated |
| `service_status` | Service status change |
| `viewer_launched` | Knowledge viewer started |

## Usage Examples

### Basic Pattern Capture

```
User: @KM ukb Problem: Components re-render too often, Solution: Use React.memo and useMemo
Extension: ✅ Knowledge base updated successfully!
Entity: ComponentOptimizationPattern
Type: Pattern
Significance: 7/10
```

### Auto-Analysis Mode

```
User: @KM ukb
Extension: 🔍 Auto-analyzing session data for transferable insights...
Found 3 transferable insights:
### ReduxAsyncPattern
Problem: Async actions cause race conditions
Solution: Use RTK Query with proper caching
Significance: 8/10
Source: Current session analysis
```

### Knowledge Search

```
User: @KM search state management
Extension: Found 5 results:
### ReduxStateManagementPattern
Type: Pattern
Significance: 9/10
Problem: Complex state mutations difficult to track
Solution: Use Redux Toolkit with typed slices
```

### Visual Knowledge Base

```
User: @KM vkb
Extension: 🌐 Knowledge base viewer launched at: http://localhost:8080
Statistics:
- Total entities: 47
- Total relations: 23
- Last updated: 2025-06-16T10:30:00Z
```

## Configuration

### Extension Settings

Available in VSCode settings (`settings.json`):

```json
{
    "kmCopilot.fallbackServicePort": 8765,
    "kmCopilot.autoStartServices": true,
    "kmCopilot.enableWebSocket": true,
    "kmCopilot.debugMode": false
}
```

### Service Configuration

The extension connects to fallback services configured in the main system:

```bash
# Start with custom port
coding --copilot --port 8765

# Start with specific services
coding --copilot --services=memory,browser,logger
```

## Benefits

### Developer Experience

1. **Context Preservation**: Capture insights without leaving VSCode
2. **Integrated Workflow**: Knowledge management in familiar chat interface
3. **Visual Feedback**: Rich markdown responses with action buttons
4. **Real-time Updates**: WebSocket notifications for service changes

### Knowledge Management

1. **Continuous Capture**: Encourages regular pattern documentation
2. **Auto-analysis**: Discovers insights from development sessions
3. **Cross-project Learning**: Shared knowledge base across projects
4. **Visual Exploration**: Interactive knowledge graph visualization

### Team Collaboration

1. **Standardized Process**: Consistent knowledge capture workflow
2. **Shared Vocabulary**: Common pattern names and descriptions
3. **Onboarding Aid**: New team members can explore existing knowledge
4. **Best Practice Sharing**: Proven solutions readily accessible

## Troubleshooting

### Common Issues

#### Extension Not Loading
```bash
# Check if services are running
curl http://localhost:8765/health

# Start services manually
coding --copilot

# Check VSCode developer console
# Help → Toggle Developer Tools → Console
```

#### Commands Not Working
```bash
# Verify extension is active
# Look for "KM Ready" in status bar

# Check service connection
# Open Command Palette → "Developer: Reload Window"
```

#### WebSocket Connection Failed
```bash
# Check firewall settings
# Ensure port 8765 is not blocked

# Try without WebSocket
# Set "kmCopilot.enableWebSocket": false in settings
```

### Debug Mode

Enable debug logging:

```json
{
    "kmCopilot.debugMode": true
}
```

Check logs in:
- VSCode Developer Console
- Extension Host log
- Fallback service logs

## Future Enhancements

### Planned Features

1. **Enhanced Auto-completion**: Suggest knowledge-based code completions
2. **Pattern Templates**: Pre-built templates for common patterns
3. **Team Sync**: Real-time knowledge sharing across team members
4. **AI Integration**: Claude-powered pattern suggestions
5. **Metrics Dashboard**: Usage analytics and knowledge growth tracking

### Integration Opportunities

1. **GitHub Integration**: Sync patterns with repository wikis
2. **Slack Integration**: Share insights with team channels
3. **JIRA Integration**: Link patterns to development tickets
4. **Documentation Generation**: Auto-generate docs from patterns

## Troubleshooting

For common issues and solutions, see **[VSCode Extension Troubleshooting Guide](vscode-extension-troubleshooting.md)**.

## Related Documentation

- [VSCode Extension Troubleshooting](vscode-extension-troubleshooting.md) - Common issues and solutions
- [UKB User Guide](../ukb/user-guide.md) - Knowledge management workflows
- [Memory Systems](../architecture/memory-systems.md) - MCP memory architecture
- [Cross-Project Knowledge](../architecture/cross-project-knowledge.md) - Knowledge sharing
- [Quick Start Installation](../installation/quick-start.md) - System installation
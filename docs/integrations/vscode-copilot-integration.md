# VSCode CoPilot Integration with Semantic Analysis

> **Note**: The CoPilot HTTP server (port 8765) and semantic bridge functionality described in this document are planned features. Currently, the semantic analysis system is fully functional via Claude Code's MCP integration. The CoPilot integration will provide an HTTP API alternative for VSCode users.

## Overview

The `coding --copilot` command will automatically integrate with the semantic-analysis agent system, providing advanced AI-powered code analysis capabilities directly in VSCode through the CoPilot extension.

## How It Works

### 1. **Auto-Start Architecture**

```text
coding --copilot
    ↓
launch-copilot.sh
    ↓
Auto-starts semantic agents (if API keys configured)
    ↓
Starts CoPilot fallback services + HTTP server (port 8765)
    ↓
Semantic Analysis Bridge connects to agents
    ↓
VSCode extension can call semantic analysis APIs
```

### 2. **Dual Service Integration**

**Fallback Services (Always Available):**
- Memory service (Graphology graph database)
- Browser automation (Playwright)
- Knowledge management APIs
- Conversation logging

**Semantic Analysis Services (When Agents Running):**
- Repository semantic analysis
- Conversation insight extraction  
- Technical documentation search
- Advanced pattern recognition

## VSCode Extension Integration

### **HTTP API Endpoints**

The CoPilot HTTP server (port 8765) exposes these endpoints for VSCode:

#### Knowledge Management
```http
GET  /health                          # Service status check
POST /api/knowledge/update            # Update knowledge base
GET  /api/knowledge/search?q=pattern  # Search knowledge
GET  /api/knowledge/stats             # Knowledge statistics
```

#### Semantic Analysis (New)
```http
POST /api/semantic/analyze-repository  # Analyze codebase
POST /api/semantic/analyze-conversation # Extract insights from discussions
POST /api/semantic/search-web         # Search technical docs
GET  /api/semantic/status             # Check agent system status
```

### **WebSocket Integration**

Real-time notifications for VSCode:
```javascript
// VSCode extension connects to WebSocket
const ws = new WebSocket('ws://localhost:8765');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  switch(event.type) {
    case 'knowledge_updated':
      // Refresh knowledge panel
      break;
    case 'semantic_analysis_completed':
      // Show analysis results
      break;
  }
});
```

## Usage in VSCode

### **CoPilot Chat Commands**

The system supports knowledge management commands in CoPilot chat:

```
@KM ukb 'How do I handle async errors in React?'
@KM vkb                                    # Open knowledge viewer
@KM search 'logging patterns'             # Search knowledge
@KM stats                                  # View statistics
```

### **Semantic Analysis Integration**

When semantic agents are running, additional capabilities are available:

```javascript
// VSCode extension can trigger semantic analysis
fetch('http://localhost:8765/api/semantic/analyze-repository', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    repository: workspace.rootPath,
    depth: 10,
    significanceThreshold: 7
  })
});
```

## Configuration

### **API Key Setup**

Configure in `semantic-analysis-system/.env`:

```bash
# Option 1: Anthropic only
ANTHROPIC_API_KEY=sk-ant-your-key-here
DEFAULT_LLM_PROVIDER=claude

# Option 2: OpenAI only  
OPENAI_API_KEY=sk-your-openai-key-here
DEFAULT_LLM_PROVIDER=openai

# Option 3: Both (recommended)
ANTHROPIC_API_KEY=sk-ant-your-key-here
OPENAI_API_KEY=sk-your-openai-key-here
DEFAULT_LLM_PROVIDER=claude
```

### **Service Status Check**

Use the `mcp-status` command to verify configuration:

```bash
mcp-status
```

Shows:
- ✓/✗ API key configuration
- ✓/✗ Agent system status
- ✓/✗ Service availability

## Development Integration

### **Auto-Analysis on Code Changes**

The system can automatically analyze code changes:

1. **File Save Analysis**: Trigger semantic analysis when files are saved
2. **Commit Analysis**: Analyze commits for patterns and insights
3. **Real-time Context**: Provide relevant context for AI assistants

### **Knowledge Integration**

All analysis results automatically feed into the shared knowledge base:

- **Patterns**: Detected code patterns stored as entities
- **Insights**: Extracted insights from conversations
- **Context**: Relevant documentation and examples

## Fallback Behavior

The system gracefully degrades when semantic agents aren't available:

### **With Semantic Agents**
- Full semantic analysis capabilities
- Advanced pattern recognition  
- LLM-powered insight extraction
- Technical documentation search

### **Without Semantic Agents** 
- Basic knowledge management
- Manual knowledge updates via ukb
- Browser automation for web search
- Conversation logging

## Benefits

### **For VSCode Users**
1. **Zero Setup**: Auto-starts with `coding --copilot`
2. **Integrated Knowledge**: Seamless access to accumulated insights
3. **Real-time Analysis**: Code analysis as you type
4. **Enhanced Context**: Better AI responses with relevant patterns

### **For Development Teams**
1. **Shared Knowledge**: Team knowledge accumulates automatically
2. **Pattern Recognition**: Consistent coding patterns across team
3. **Documentation**: Auto-generated insights and examples
4. **Code Quality**: Proactive pattern and anti-pattern detection

## Troubleshooting

### **Semantic Analysis Not Available**

Check status: `mcp-status`

Common issues:
1. **Missing API Keys**: Configure ANTHROPIC_API_KEY or OPENAI_API_KEY
2. **Agents Not Running**: Use `coding --copilot` to auto-start
3. **Port Conflicts**: Ensure ports 1883 (MQTT) and 8080 (RPC) are free

### **VSCode Extension Not Connecting**

1. **Check HTTP Server**: Should be running on port 8765
2. **Firewall**: Ensure localhost connections allowed
3. **Extension Logs**: Check VSCode output panel for connection errors

## Example Usage Flows

### **1. Code Review with Semantic Analysis**

```bash
# Start CoPilot with semantic analysis
coding --copilot

# In VSCode CoPilot chat:
@KM "Analyze the current repository for code patterns"

# Triggers: POST /api/semantic/analyze-repository
# Results: Patterns stored in knowledge base, shown in chat
```

### **2. Learning from Conversations**

```bash
# After a team discussion in VSCode
# CoPilot can analyze the conversation

# Extension calls: POST /api/semantic/analyze-conversation  
# Results: Insights extracted and stored in knowledge base
```

### **3. Enhanced Context for AI**

```bash
# When asking CoPilot for help:
@KM search "error handling patterns"

# Extension gets relevant patterns from knowledge base
# Provides better context for CoPilot responses
```

This integration creates a powerful development environment where VSCode users benefit from advanced semantic analysis capabilities without manual setup or intervention.
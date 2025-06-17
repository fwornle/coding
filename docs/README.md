# Documentation Index

Welcome to the Coding Knowledge Management System documentation. This system provides intelligent knowledge capture, sharing, and visualization for development teams.

## 🚀 Getting Started

**New to the system?** Start here:

1. **[Quick Start Installation](installation/quick-start.md)** - Get up and running in 30 seconds
2. **[UKB User Guide](ukb/user-guide.md)** - Learn knowledge management basics
3. **[System Overview](architecture/system-overview.md)** - Understand how it all works

## 📁 Documentation Structure

### 🔧 Installation & Setup

Setting up the system on your machine or team.

- **[Quick Start](installation/quick-start.md)** - Basic installation for individuals and teams
- **[Network Setup](installation/network-setup.md)** - Corporate networks, proxies, firewalls
- **[MCP Configuration](installation/mcp-configuration.md)** - Claude Code integration setup

### 🏗️ System Architecture

Understanding how the system works internally.

- **[System Overview](architecture/system-overview.md)** - High-level architecture and components
- **[Knowledge Flow](architecture/knowledge-flow.md)** - How information moves through the system
- **[Memory Systems](architecture/memory-systems.md)** - MCP memory server and Graphology integration
- **[Agent Detection](architecture/agent-detection.md)** - Multi-agent support and routing
- **[Fallback Services](architecture/fallback-services.md)** - Non-Claude agent support
- **[Agent-Agnostic Design](architecture/agent-agnostic.md)** - Cross-agent compatibility
- **[Cross-Project Knowledge](architecture/cross-project-knowledge.md)** - Knowledge sharing across projects

### 📚 Knowledge Management (UKB)

Core knowledge capture and management workflows.

- **[User Guide](ukb/user-guide.md)** - Complete UKB usage documentation
- **[Use Cases](ukb/ukb-use-cases.md)** - Detailed workflow examples and scenarios

### 📝 Conversation Logging

Automatic capture and organization of AI interactions.

- **[Automatic Logging](logging/automatic-logging.md)** - Post-session conversation capture
- **[MCP Logger](logging/mcp-logger.md)** - Technical implementation details
- **[Specstory Integration](logging/specstory-integration.md)** - VSCode extension integration

### 🔌 Tool Integrations

Connecting with IDEs and development tools.

- **[VSCode Extension](integrations/vscode-extension.md)** - GitHub Copilot chat integration
- **[API Reference](integrations/api-reference.md)** - Agent adapter APIs

### 📖 Reference Materials

Supporting documentation and troubleshooting.

- **[Portable Paths](reference/portable-paths.md)** - Avoiding hardcoded file paths
- **[Graph Databases](reference/graph-databases.md)** - Database comparison and selection

### 📂 Legacy Documentation

Historical documents and planning materials.

- **[Legacy Files](legacy/)** - Superseded documentation and planning materials

## 🎯 Quick Navigation by Use Case

### "I want to start using this system"

→ [Quick Start Installation](installation/quick-start.md) → [UKB User Guide](ukb/user-guide.md)

### "I need to set this up for my team"

→ [Quick Start Installation](installation/quick-start.md) → [Network Setup](installation/network-setup.md)

### "I want to use this with Claude Code"

→ [MCP Configuration](installation/mcp-configuration.md) → [System Overview](architecture/system-overview.md)

### "I want to integrate with VSCode/Copilot"

→ [VSCode Extension](integrations/vscode-extension.md) → [Automatic Logging](logging/automatic-logging.md)

### "I want to understand how it works internally"

→ [System Overview](architecture/system-overview.md) → [Knowledge Flow](architecture/knowledge-flow.md)

### "I have questions about knowledge management workflows"

→ [UKB User Guide](ukb/user-guide.md) → [Use Cases](ukb/ukb-use-cases.md)

### "I need to troubleshoot network/installation issues"

→ [Network Setup](installation/network-setup.md) → [MCP Configuration](installation/mcp-configuration.md)

## 🔍 Key Concepts

### Knowledge Management

- **UKB (Update Knowledge Base)**: Captures insights from development activities
- **VKB (View Knowledge Base)**: Interactive visualization of knowledge graphs
- **Shared Memory**: Git-tracked knowledge base for team collaboration
- **Transferable Patterns**: Reusable solutions extracted from code and conversations

### Multi-Agent Support

- **Claude Code**: Primary agent with MCP memory server integration
- **Fallback Services**: Graphology-based services for other agents (Copilot, etc.)
- **Agent Detection**: Automatic routing based on runtime environment
- **Cross-Agent Sync**: Knowledge sharing between different AI tools

### Conversation Logging

- **Post-Session Capture**: Automatic logging after AI sessions complete
- **Smart Routing**: Content-aware organization into project directories
- **Cross-Project Detection**: Identifies knowledge management work regardless of location
- **Specstory Integration**: VSCode extension for conversation management

## 🛠️ Common Commands

```bash
# Knowledge management
ukb                    # Update knowledge base (auto-analysis)
ukb --interactive      # Manual insight capture
vkb                    # View knowledge graph in browser

# System management
./install.sh           # Install or update system
./scripts/test-coding.sh # Comprehensive test & repair
claude-mcp            # Start Claude with MCP integration
coding --copilot      # Start fallback services for Copilot

# Diagnostics
ukb --verify          # Check knowledge base integrity
ukb search "pattern"  # Search existing knowledge
```

## 📞 Support

### Common Issues

- **Installation problems**: See [Network Setup](installation/network-setup.md)
- **MCP configuration**: See [MCP Configuration](installation/mcp-configuration.md)
- **Knowledge management workflows**: See [UKB User Guide](ukb/user-guide.md)
- **VSCode integration**: See [VSCode Extension](integrations/vscode-extension.md)

### Getting Help

1. Check the specific documentation section for your issue
2. Enable debug mode: `DEBUG=1 <command>`
3. Review log files in `.specstory/history/` and `~/.coding-tools/logs/`
4. Search existing knowledge: `ukb search "your problem"`

## 🔄 Recent Updates

This documentation has been reorganized for better navigation and reduced duplication. Key improvements:

- **Consolidated installation guides** into focused quick-start and network setup
- **Merged UKB documentation** to eliminate overlapping content
- **Streamlined logging documentation** with unified automatic logging guide
- **Added clear navigation paths** for different user types and use cases
- **Organized files into logical folders** by functional area

For the previous documentation structure, see git history. All content has been preserved and enhanced.
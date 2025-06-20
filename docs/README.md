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

### 📚 Knowledge Management (UKB-CLI)

Modern Node.js-based knowledge capture and management system.

- **[UKB-CLI User Guide](ukb/user-guide.md)** - Complete modern UKB-CLI documentation
- **[Technical Architecture](../knowledge-management/insights/UkbCli.md)** - Comprehensive technical documentation with PlantUML diagrams
- **[Use Cases](ukb/ukb-use-cases.md)** - Detailed workflow examples and scenarios
- **[Migration Guide](ukb/user-guide.md#migration-guide)** - Transitioning from legacy bash UKB

### 📊 Knowledge Visualization (VKB-CLI)

Modern Node.js-based knowledge visualization server with cross-platform support.

- **[VKB-CLI Overview](vkb/README.md)** - Complete VKB-CLI documentation and quick start
- **[Technical Architecture](vkb/architecture.md)** - Server architecture and component design
- **[API Reference](vkb/api-reference.md)** - CLI commands and programmatic JavaScript API
- **[Use Cases](vkb/use-cases.md)** - Development workflows and integration patterns
- **[Migration Guide](vkb/migration-guide.md)** - Transitioning from legacy bash VKB
- **[Technical Deep Dive](../knowledge-management/insights/VkbCli.md)** - Comprehensive implementation details with diagrams

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

### "I want to set up knowledge visualization"

→ [VKB-CLI Overview](vkb/README.md) → [VKB Use Cases](vkb/use-cases.md)

### "I need to troubleshoot network/installation issues"

→ [Network Setup](installation/network-setup.md) → [MCP Configuration](installation/mcp-configuration.md)

## 🔍 Key Concepts

### Knowledge Management

- **UKB-CLI (Modern Node.js CLI)**: Advanced knowledge capture with enhanced performance and features
- **VKB-CLI (Modern Node.js Server)**: Cross-platform knowledge visualization server with programmatic API
- **Shared Memory**: Git-tracked knowledge base for team collaboration with full backward compatibility
- **Transferable Patterns**: Reusable solutions with structured problem-solution-rationale format

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
# Modern Knowledge Management (UKB-CLI)
ukb                    # Enhanced auto-analysis with git processing (3x faster)
ukb --interactive      # Advanced interactive capture with validation
ukb --list-entities    # Browse knowledge base entities
ukb search "pattern"   # Enhanced search with filtering
ukb --add-entity "Name" --type TransferablePattern  # Add specific entities
ukb --validate         # Comprehensive data integrity checks

# Knowledge Visualization (VKB-CLI)
vkb                    # Start visualization server at localhost:8080
vkb status             # Check server status and health
vkb restart            # Restart server with fresh data
vkb logs               # View server logs with formatting
vkb-cli server health  # Advanced health monitoring
vkb-cli data refresh   # Refresh data without restart

# System management
./install.sh           # Install or update system
./scripts/test-coding.sh # Comprehensive test & repair
claude-mcp            # Start Claude with MCP integration
coding --copilot      # Start fallback services for Copilot

# Advanced UKB-CLI Features
ukb --analyze-git --depth 20     # Deep git history analysis
ukb --export-json --format pretty # Export with formatting
ukb --remove-entity "EntityName"  # Safe entity removal
ukb --rename-entity "Old" "New"   # Entity renaming
ukb --verify-references           # URL validation
```

## 📞 Support

### Common Issues

- **Installation problems**: See [Network Setup](installation/network-setup.md)
- **MCP configuration**: See [MCP Configuration](installation/mcp-configuration.md)
- **Knowledge management workflows**: See [UKB User Guide](ukb/user-guide.md)
- **VSCode integration**: See [VSCode Extension](integrations/vscode-extension.md)
- **Database corruption/bloat**: See [Knowledge Base Troubleshooting](troubleshooting-knowledge-base.md)

### Getting Help

1. Check the specific documentation section for your issue
2. Enable debug mode: `DEBUG=1 <command>`
3. Review log files in `.specstory/history/` and `~/.coding-tools/logs/`
4. Search existing knowledge: `ukb search "your problem"`

## 🔄 Recent Updates

### 🆕 2025 Major Update: Modern CLI Implementation

**UKB-CLI (Knowledge Capture):**

- **Complete UKB Modernization**: Replaced 3000+ line bash script with modular Node.js CLI
- **Performance Improvements**: 3x faster JSON processing, 50% memory reduction
- **Enhanced Features**: Content validation, URL verification, custom entity naming, batch operations
- **Stable API**: Programmatic interface for coding agent integration
- **Full Backward Compatibility**: All existing commands work unchanged

**VKB-CLI (Knowledge Visualization):**

- **Complete VKB Refactoring**: Replaced 579-line bash script with modular Node.js server
- **Cross-Platform Support**: Identical behavior on Windows, macOS, and Linux
- **Programmatic API**: VKBServer class for development tool integration
- **Enhanced Server Management**: Health monitoring, graceful shutdown, automatic recovery
- **Improved Error Handling**: Clear error messages with actionable suggestions
- **50% Faster Startup**: Optimized server initialization and resource management

### Documentation Improvements

- **Updated UKB documentation** to reflect modern ukb-cli capabilities with comprehensive API reference
- **New VKB documentation structure** matching UKB style with complete architecture documentation
- **Added technical architecture documentation** for both UKB and VKB with comprehensive diagrams
- **Enhanced API references** with programmatic integration examples for both tools
- **Migration guides** for seamless transition from legacy bash implementations
- **Consolidated installation guides** into focused quick-start and network setup
- **Streamlined logging documentation** with unified automatic logging guide

For detailed technical information:

- **UKB-CLI**: See [UkbCli Architecture](../knowledge-management/insights/UkbCli.md) with complete PlantUML diagrams
- **VKB-CLI**: See [VkbCli Architecture](../knowledge-management/insights/VkbCli.md) with implementation details and use cases

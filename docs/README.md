# Documentation Hub

Complete documentation for the Semantic Analysis & Knowledge Management System.

## 📖 Documentation Structure

### 🚀 Getting Started

#### [Quick Start Guide](installation/quick-start.md)
Get the system running in 30 seconds. Covers installation, basic configuration, and first usage.

#### [Network Setup](installation/network-setup.md)
Corporate firewall configuration, proxy settings, and network troubleshooting.

#### [MCP Configuration](installation/mcp-configuration.md)
Claude Code integration setup, MCP server configuration, and tool registration.

---

### 🏗️ Architecture & Design

#### [System Overview](architecture/system-overview.md)
Complete architectural overview including multi-agent system, communication patterns, and data flow.

#### [Knowledge Flow](architecture/knowledge-flow.md)
How knowledge moves through the system, from capture to visualization to AI assistance.

#### [Memory Systems](architecture/memory-systems.md)
Storage architecture, synchronization mechanisms, and persistence strategies.

#### [Agent Detection](architecture/agent-detection.md)
How the system detects and selects between Claude Code and GitHub CoPilot.

---

### 🧩 Component Documentation

#### UKB-CLI (Update Knowledge Base)
- **[Overview](components/ukb/README.md)** - Command-line knowledge capture tool
- **[Architecture](components/ukb/architecture.md)** - Internal design and Node.js implementation
- **[Use Cases](components/ukb/use-cases.md)** - Common workflows and examples
- **[API Reference](components/ukb/api-reference.md)** - Programmatic interface

#### VKB-CLI (View Knowledge Base)
- **[Overview](components/vkb/README.md)** - Web-based knowledge visualization
- **[Architecture](components/vkb/architecture.md)** - Server architecture and data flow
- **[User Guide](components/vkb/user-guide.md)** - Web interface walkthrough
- **[API Reference](components/vkb/api-reference.md)** - HTTP API endpoints

#### Semantic Analysis System ✨ (Enhanced)
- **[Overview](components/semantic-analysis/README.md)** - Enhanced multi-agent analysis system with sync & deduplication
- **[Enhanced Architecture](components/semantic-analysis/enhanced-architecture.md)** - Complete enhanced system architecture
- **[Architecture](components/semantic-analysis/architecture.md)** - Original agent communication and coordination
- **[Installation Guide](components/semantic-analysis/installation.md)** - Complete setup and configuration
- **[Use Cases](components/semantic-analysis/use-cases.md)** - Comprehensive usage examples and workflows
- **[API Reference](components/semantic-analysis/api-reference.md)** - Agent APIs and interfaces
- **[MCP Server Setup](components/semantic-analysis/mcp-server-setup.md)** - Claude Code integration
- **[Troubleshooting](components/semantic-analysis/troubleshooting.md)** - Common issues and solutions

---

### 🔌 Integrations

#### [VSCode CoPilot Integration](integrations/vscode-copilot-integration.md)
Complete guide to enhanced VSCode experience with semantic analysis integration.

#### [API Reference](integrations/api-reference.md)
HTTP REST APIs, MCP tools, and WebSocket interfaces for external integrations.

#### [Testing Guide](integrations/testing-guide.md)
Integration testing strategies, test automation, and validation procedures.

---

### 📋 Reference Materials

#### Command Reference
- **[UKB Commands](reference/ukb-commands.md)** - All UKB-CLI options and examples
- **[VKB Commands](reference/vkb-commands.md)** - All VKB-CLI options and examples
- **[Coding Commands](reference/coding-commands.md)** - Agent launcher and system commands

#### Configuration
- **[Environment Variables](reference/environment-variables.md)** - All configuration options
- **[Configuration Files](reference/configuration-files.md)** - YAML and JSON configuration
- **[API Keys Setup](reference/api-keys-setup.md)** - LLM provider configuration

#### Troubleshooting
- **[Common Issues](reference/troubleshooting.md)** - FAQ and problem resolution
- **[System Diagnostics](reference/system-diagnostics.md)** - Health checks and monitoring
- **[Performance Tuning](reference/performance-tuning.md)** - Optimization guidelines

---

### 📊 Diagrams & Visualizations

All architectural diagrams are available in two formats:
- **Source**: [PlantUML files](puml/) - Editable diagram source code
- **Images**: [PNG files](puml/) - Generated diagrams for documentation

#### Key Diagrams
- **[System Overview](images/semantic-analysis-system-overview.png)** - Complete enhanced architecture
- **[Enhanced Architecture](images/semantic-analysis-enhanced-architecture.png)** - New agents & infrastructure ✨
- **[UKB-CLI Architecture](images/ukb-cli-architecture.png)** - Knowledge capture system
- **[Communication Patterns](images/semantic-analysis-communication.png)** - Agent communication
- **[Knowledge Schema](puml/knowledge-schema.png)** - Data structures and relationships

---

### 📁 Archive & Legacy

#### [Archive](archive/)
Historical documentation, migration guides, and completed project summaries.

#### [Legacy](legacy/)
Superseded documentation maintained for reference and troubleshooting.

---

## 🎯 Documentation Conventions

### File Naming
- Use kebab-case for all filenames: `semantic-analysis-system.md`
- Use lowercase directories: `components/`, `integrations/`
- No underscores in filenames: use hyphens instead

### Structure
- Each component has its own directory with README.md as entry point
- Related documents grouped logically in subdirectories
- Cross-references use relative paths for portability

### Diagrams
- PlantUML source files in `puml/` directory
- Generated PNG images co-located with source
- Professional color scheme for consistency
- Descriptive titles and legends

### Navigation
- Main README.md provides overview and quick navigation
- This docs README.md provides comprehensive navigation
- Each section README.md links to related documents
- Breadcrumb navigation where helpful

---

## 🔍 Quick Navigation

**Looking for something specific?**

| I want to... | Go to... |
|--------------|----------|
| **Install the system** | [Quick Start Guide](installation/quick-start.md) |
| **Understand the architecture** | [System Overview](architecture/system-overview.md) |
| **Use UKB-CLI** | [UKB Documentation](components/ukb/) |
| **Use VKB-CLI** | [VKB Documentation](components/vkb/) |
| **Set up semantic analysis** | [Semantic Analysis Setup](components/semantic-analysis/mcp-server-setup.md) |
| **Integrate with VSCode** | [VSCode Integration](integrations/vscode-copilot-integration.md) |
| **Configure API keys** | [API Keys Setup](reference/api-keys-setup.md) |
| **Troubleshoot issues** | [Troubleshooting Guide](reference/troubleshooting.md) |
| **View system diagrams** | [Architecture Diagrams](puml/) |

---

**💡 Tip**: Use your browser's search function (Ctrl/Cmd + F) to quickly find specific topics within any documentation page.
# Claude Scripts Collection

This repository contains various scripts and tools created with Claude Code, focused on knowledge management and development productivity.

![Viewer](docs/imag/viewer.png)

## 📚 Documentation

- **[Complete Documentation](docs/documentation.md)** - Comprehensive system documentation
- **[Team Setup Guide](TEAM_KNOWLEDGE_SETUP.md)** - Quick start for team collaboration
- **[Architecture Diagrams](docs/imag/)** - System architecture and workflow diagrams

## 🎯 Quick Start

### Knowledge Management System

The primary focus of this repository is an intelligent knowledge management system that automatically captures and visualizes programming insights.

```bash
# Update knowledge base (capture session insights)
ukb

# View knowledge base (interactive visualization)
vkb
```

**Key Features:**

- 🤖 **Automatic capture** from git commits
- 🌐 **Interactive visualization** at localhost:8080
- 🔄 **Team sharing** via git-tracked knowledge base
- 🎯 **Transferable patterns** in central green hub
- 🔗 **MCP integration** for persistent memory
- 📝 **Conversation logging** to `.specstory/history/` for AI interaction history

## 📁 Directory Structure

```
~/Claude/
├── README.md                  # This file
├── TEAM_KNOWLEDGE_SETUP.md    # Quick setup guide
├── docs/                      # Complete documentation
│   ├── documentation.md       # Main documentation
│   ├── claude-logger-mcp.md  # Conversation logging docs
│   ├── puml/                  # PlantUML source files
│   └── imag/                  # Generated diagrams
├── shared-memory.json         # Knowledge base (git-tracked)
├── .specstory/               # Claude Code conversation history
│   └── history/              # Auto-logged conversations
├── knowledge-management/      # Core KM system
│   ├── ukb                   # Update Knowledge Base command
│   ├── vkb                   # View Knowledge Base command
│   ├── browser               # Browser integration
│   └── dist/                 # Visualization files
├── browser-access/           # Browser automation tools
│   ├── src/                  # TypeScript source
│   └── dist/                 # Compiled MCP server
└── claude-logger-mcp/        # Conversation logging MCP server
    ├── src/                  # TypeScript source
    └── dist/                 # Compiled server
```

## 🚀 Core Commands

| Command | Purpose | Usage |
|---------|---------|-------|
| `ukb` | Update Knowledge Base | Analyzes git commits, extracts insights |
| `vkb` | View Knowledge Base | Starts visualization server on :8080 |
| `vkb restart` | Restart Visualization | Refreshes server with latest data |
| `vkb stop` | Stop Server | Stops background visualization server |

## 🔧 System Components

### Knowledge Capture

- **Git Integration**: Analyzes conventional commit messages
- **Automatic Classification**: Categorizes insights by type (fix, feat, perf, etc.)
- **Entity Generation**: Creates structured knowledge entities
- **Relationship Mapping**: Links insights to projects and patterns

### Visualization

- **Interactive Graph**: D3.js-based knowledge graph visualization
- **Color Coding**: Entity types have distinct colors (System=green, Project=blue)
- **Filtering**: Search and filter by entity type or relationship
- **Detail Views**: Click nodes for comprehensive information

### Team Collaboration

- **Git-Tracked Knowledge**: `shared-memory.json` is version controlled
- **Automatic Sharing**: Push/pull shares knowledge across team
- **Conflict Resolution**: Merge strategies for concurrent updates
- **Backup System**: Automated backups of knowledge base

### Conversation Logging

- **Automatic Capture**: Enable with "Enable automatic logging" in Claude Code
- **SpecStory Format**: Conversations saved to `.specstory/history/`
- **Full History**: Complete AI interaction logs with metadata
- **Searchable Archive**: Compatible with SpecStory VS Code extension

## 🎨 Knowledge Graph Features

### Central Hub Pattern

The system uses a **green "CodingKnowledge" hub** that aggregates transferable programming patterns:

- **ConditionalLoggingPattern**: Debug logging with runtime level checking
- **ReduxStateManagementPattern**: React state management with TypeScript
- **ThreeJSReactIntegrationPattern**: 3D graphics integration patterns
- **MCPKnowledgeIntegrationPattern**: Persistent memory workflows

### Entity Types

- 🟢 **System**: Core hubs and frameworks (green nodes)
- 🔵 **Project**: Software projects (blue nodes)  
- ⚪ **TransferableKnowledge**: Cross-project reusable patterns
- ⚪ **TechnicalInsight**: Project-specific learnings
- ⚪ **Technology**: Tools and frameworks

## 🔗 Browser Automation

The repository also includes browser automation tools for extended workflows:

```bash
cd browser-access
npm install    # Install dependencies
npm run build  # Build MCP server
```

This enables browser automation through MCP (Model Context Protocol) integration with Claude Code.

## 📈 Usage Examples

### Daily Development Workflow

```bash
# 1. Normal development with conventional commits
git commit -m "feat: add conditional logging for debug mode"
git commit -m "fix: resolve memory leak in timeline rendering"

# 2. Capture insights at end of session
ukb

# 3. Explore knowledge graph
vkb
# Opens browser at localhost:8080
```

### Team Knowledge Sharing

```bash
# Share your insights
git add shared-memory.json
git commit -m "knowledge: add React performance patterns"
git push

# Get team insights
git pull
vkb restart  # Refresh visualization with team updates
```

### Pattern Discovery

1. **Browse Graph**: Use visualization to identify common patterns
2. **Extract Patterns**: Promote successful solutions to transferable knowledge
3. **Apply Elsewhere**: Reference patterns in new projects
4. **Continuous Learning**: Build institutional knowledge over time

## 🛠️ Requirements

- **Git**: Version control and team collaboration
- **Python 3**: HTTP server for visualization
- **Node.js**: Browser automation tools
- **jq**: JSON processing (install via `brew install jq`)
- **PlantUML**: Documentation diagram generation (optional)

## 🔧 Installation

The system is ready to use after cloning. Optional setup:

```bash
# Add convenient aliases to ~/.zshrc or ~/.bashrc
echo 'alias ukb="~/Claude/knowledge-management/ukb"' >> ~/.zshrc
echo 'alias vkb="~/Claude/knowledge-management/vkb"' >> ~/.zshrc
source ~/.zshrc
```

## 🤝 Contributing

When adding new functionality:

1. **Document Changes**: Update relevant documentation
2. **Follow Patterns**: Use conventional commit format
3. **Test Integration**: Verify knowledge capture works
4. **Update Schema**: Document new entity types or relationships

## 📄 License

These tools are designed for development productivity enhancement and team knowledge sharing.

---

**For complete documentation, see [docs/documentation.md](docs/documentation.md)**

# UKB-CLI Documentation

## Overview

UKB-CLI (Update Knowledge Base Command Line Interface) is a modern, cross-platform knowledge management system designed for software development teams. It provides an agent-agnostic interface for capturing, organizing, and discovering technical knowledge across projects.

## Documentation Structure

### 📐 Architecture
Comprehensive technical architecture documentation including:
- System architecture diagrams
- Component design
- Data flow architecture
- Plugin architecture
- Security and performance considerations

### 📚 [API Reference](./api-reference.md)
Complete API documentation covering:
- CLI commands and options
- Programmatic JavaScript API
- Data types and schemas
- Error handling

### 🎯 Use Cases
Real-world scenarios and examples:
- Daily development workflows
- Knowledge capture patterns
- Team collaboration
- Integration examples

### 🔄 Migration Notes
Step-by-step guide for migrating from legacy UKB:
- Installation instructions
- Command mapping
- Troubleshooting tips
- Best practices

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/coding-tools.git
cd coding-tools/lib/knowledge-api

# Install dependencies
npm install

# Verify installation
./bin/ukb-cli.js --version
```

### Basic Usage

```bash
# Check status
ukb-cli status

# Add an entity
ukb-cli entity add -n "MyPattern" -t "TechnicalPattern" -s 8

# Search knowledge base
ukb-cli entity search "error handling"

# Interactive mode
ukb-cli interactive
```

## Key Features

### 🌐 Cross-Platform
- Works on Windows, macOS, and Linux
- No bash dependencies
- Pure Node.js implementation

### 🧩 Modular Architecture
- Clean separation of concerns
- Pluggable storage backends
- Extensible analysis engines

### 🔍 Advanced Search
- Full-text search
- Type filtering
- Significance ranking
- Graph traversal

### 📊 Knowledge Graph
- Entity relationships
- Path finding
- Cluster detection
- Pattern extraction

### 🤝 Team Collaboration
- Import/export functionality
- Merge capabilities
- Git-friendly JSON format

### 🔌 Integration Ready
- Programmatic API
- CI/CD friendly
- IDE integration
- MCP compatibility

## Architecture Highlights

**System Architecture**:

![UKB System Architecture](../images/ukb-architecture.png)

The system follows a layered architecture:
- **CLI Layer**: User interface and command routing
- **API Layer**: Core business logic (KnowledgeAPI, EntityManager, RelationManager)
- **Storage Layer**: Pluggable persistence with file-based storage adapter
- **Integration Layer**: External system connections (MCP, Git)

## Common Workflows

### Capturing Insights

```bash
# Interactive insight capture
ukb-cli insight --interactive

# Quick pattern capture
ukb-cli entity add -n "CachingPattern" -t "TechnicalPattern" \
  -o "Implement Redis for API response caching"
```

### Knowledge Discovery

```bash
# Search for solutions
ukb-cli entity search "performance" --type "Solution"

# Find related patterns
ukb-cli relation list --from "MicroservicePattern"
```

### Team Sharing

```bash
# Export team knowledge
ukb-cli export team-patterns.json

# Import and merge
ukb-cli import colleague-patterns.json --merge
```

## Comparison with Legacy UKB

| Aspect | Legacy UKB | UKB-CLI |
|--------|------------|---------|
| Lines of Code | 3,827 (monolithic) | ~2,000 (modular) |
| Platform Support | Linux/macOS | Cross-platform |
| Testing | None | 90%+ coverage |
| Architecture | Procedural bash | Object-oriented JS |
| Extensibility | Limited | Plugin-based |
| Performance | O(n) searches | Optimized lookups |

## Contributing

We welcome contributions! Areas of focus:
- Storage adapter implementations
- Analysis engine plugins
- Documentation improvements
- Test coverage expansion

## Roadmap

### Near Term
- [ ] GraphQL API endpoint
- [ ] Real-time synchronization
- [ ] VS Code extension
- [ ] Enhanced visualizations

### Long Term
- [ ] Graph database backend
- [ ] Machine learning insights
- [ ] Cloud storage options
- [ ] Mobile companion app

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Documentation**: This directory
- **Examples**: See [Use Cases](#🎯-use-cases) section above

## License

MIT License - see LICENSE file for details.
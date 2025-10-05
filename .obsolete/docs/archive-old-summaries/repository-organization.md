# Repository Organization

This document describes the clean, organized structure of the coding repository after the cleanup and reorganization process.

## Root Directory Structure

The root directory now contains only essential files and organized subdirectories:

```
coding/
├── CLAUDE.md                    # Main project instructions
├── README.md                    # Project overview
├── install.sh / install.bat     # Installation scripts
├── uninstall.sh                 # Uninstallation script
├── package.json                 # Main project dependencies
├── shared-memory.json           # Knowledge base storage
├── claude-code-mcp*.json       # MCP configuration files
├── bin/                        # Executable scripts
├── lib/                        # Core library code
├── integrations/               # MCP servers and integrations
├── knowledge-management/       # Knowledge base content
├── memory-visualizer/          # Web-based visualization
├── scripts/                   # Utility and automation scripts
├── tests/                     # Test suites
└── docs/                      # Documentation
```

## Detailed Structure

### `/bin/` - Executable Scripts
- `ukb-cli.js` - Main CLI wrapper (delegates to knowledge-api)
- `ukb-wrapper` - Feature-complete bash wrapper (329 lines)
- `ukb-lightweight` - Minimal backward-compatible wrapper (200 lines)

### `/lib/` - Core Library Code
- `knowledge-api/` - Main knowledge management API
  - `cli.js` - Comprehensive CLI implementation
  - `index.js` - Knowledge API core
  - `core/` - Entities, relations, insights management
  - `utils/` - Git analyzer, configuration, logging
  - `adapters/` - Storage adapters
- `adapters/` - Agent adapters (Claude MCP, Copilot, etc.)
- `fallbacks/` - Fallback services for offline use
- `integrations/` - Integration adapters
- `utils/` - System utilities

### `/integrations/` - MCP Servers & External Integrations
- `browser-access/` - Stagehand browser automation MCP server
- `claude-logger-mcp/` - Manual logging MCP server
- `mcp-server-browserbase/` - Browserbase integration
- `vscode-km-copilot/` - VS Code extension for knowledge management

### `/knowledge-management/` - Knowledge Base Content
- `ukb` - Original UKB script (preserved for fallback)
- `vkb` - Knowledge visualizer script
- `insights/` - Pattern documentation and insights
- `schemas/` - JSON schemas for knowledge structures
- `relations/` - Relationship definitions

### `/scripts/` - Utility Scripts
- `knowledge-management/` - KM-specific scripts
  - `analyze-code.js` - Code analysis utilities
  - `analyze-conversations.js` - Conversation processing
  - `migrate-entities.js` - Entity migration tools
- `legacy/` - Legacy UKB script versions
  - `ukb-agent-aware` - Agent-aware variant
  - `ukb-enhanced` - Enhanced variant
  - `ukb-refactored` - Refactored variant
- `templates/` - File templates
- Post-session loggers and automation scripts
- Testing and validation scripts

### `/tests/` - Test Suites
- `ukb-migration/` - UKB migration compatibility tests
  - `quick-test.sh` - Basic functionality test
  - `test-ukb-compatibility.sh` - Comprehensive compatibility
  - `wrapper-compatibility-test.sh` - Wrapper validation

### `/docs/` - Documentation
- `architecture/` - System architecture documentation
- `installation/` - Installation guides
- `integrations/` - Integration documentation
- `ukb/` - UKB-specific documentation
- `puml/` - PlantUML diagrams and images
- Migration and troubleshooting guides

### `/memory-visualizer/` - Web Visualization
- React-based knowledge graph visualizer
- Standalone web application for exploring knowledge base
- Real-time visualization of entities and relations

## Key Organizational Principles

### 1. **Clean Root Directory**
- Only essential configuration files and README in root
- All implementation code organized in subdirectories
- Clear separation of concerns

### 2. **Logical Grouping**
- **`/bin/`**: User-facing executables
- **`/lib/`**: Internal library code
- **`/integrations/`**: External system interfaces
- **`/scripts/`**: Automation and utilities
- **`/tests/`**: All testing code

### 3. **Path Consistency**
- All moved components have updated path references
- Configuration files reflect new locations
- Install/uninstall scripts updated accordingly

### 4. **Legacy Preservation**
- Original UKB script preserved in `knowledge-management/ukb`
- Legacy variants moved to `scripts/legacy/`
- Backward compatibility maintained through wrappers

## Migration Summary

### Removed Files
- Temporary analysis scripts (`analyze-kb-duplicates.js`, etc.)
- Backup files (`shared-memory-backup.json`, etc.)
- Test backup files
- Root-level clutter files

### Moved Components
- **Browser Access**: `browser-access/` → `integrations/browser-access/`
- **Claude Logger**: `claude-logger-mcp/` → `integrations/claude-logger-mcp/`
- **MCP Browserbase**: `mcp-server-browserbase/` → `integrations/mcp-server-browserbase/`
- **VS Code Extension**: `vscode-km-copilot/` → `integrations/vscode-km-copilot/`
- **Templates**: `templates/` → `scripts/templates/`
- **Legacy Scripts**: Various UKB variants → `scripts/legacy/`
- **KM Scripts**: `knowledge-management/scripts/` → `scripts/knowledge-management/`

### Updated References
- `claude-code-mcp.json` - Updated browser-access path
- `install.sh` - Updated all integration paths
- `uninstall.sh` - Updated cleanup paths
- All wrapper scripts maintain correct references

## Benefits of New Organization

### 1. **Clarity**
- Clear purpose for each directory
- Easy to locate specific functionality
- Reduced cognitive load for navigation

### 2. **Maintainability**
- Logical separation of concerns
- Easier to update specific components
- Clear dependency relationships

### 3. **Scalability**
- Room for growth in each category
- Easy to add new integrations
- Modular architecture supports expansion

### 4. **Developer Experience**
- Quick orientation for new contributors
- Standard project layout conventions
- Clear distinction between public and internal APIs

## Usage After Reorganization

### For End Users
```bash
# All user commands work exactly as before
./bin/ukb-lightweight --list-entities
./bin/ukb-wrapper --stats
node ./bin/ukb-cli.js entity list
```

### For Developers
```bash
# Clear paths for development
cd lib/knowledge-api/          # Core API development
cd integrations/browser-access/ # MCP server development
cd scripts/knowledge-management/ # Utility script development
cd tests/ukb-migration/        # Testing
```

### For System Administration
```bash
# Installation and configuration
./install.sh                  # Installs with new paths
./uninstall.sh               # Cleans up correctly
```

This reorganization provides a clean, maintainable, and scalable foundation for the knowledge management system while preserving all functionality and backward compatibility.
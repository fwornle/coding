# Project Structure & Organization

## Directory Structure Overview

```
coding/
├── .specstory/                     # Session logs and analysis
│   ├── history/                    # Session and trajectory files
│   ├── logs/                      # Classification and operational logs
│   ├── health/                    # Health monitoring status
│   └── config/                    # Project-specific configuration
├── .spec-workflow/                # Specification workflow system
│   ├── specs/                     # Feature specifications
│   ├── steering/                  # Project steering documents
│   └── templates/                 # Document templates
├── bin/                           # Executable commands and CLI tools
├── config/                        # System-wide configuration
├── docs/                          # Comprehensive documentation
├── integrations/                  # External service integrations
├── knowledge-management/          # Knowledge capture and insights
├── lib/                           # Reusable libraries and utilities
├── scripts/                       # Automation and utility scripts
├── src/                           # Core source code
└── shared-memory-*.json           # Topic-specific knowledge bases
```

## Core Directory Organization

### `/src/` - Core Source Code
**Purpose**: Main application logic and core functionality
**Organization**: Organized by functional domain

```
src/
├── live-logging/                  # Live session logging system
│   ├── ReliableCodingClassifier.js    # Three-layer classification engine
│   ├── PathAnalyzer.js                # Layer 1: File path analysis
│   ├── KeywordMatcher.js              # Layer 2: Keyword matching
│   ├── SemanticAnalyzer.js            # Layer 3: LLM-based analysis
│   ├── SemanticAnalyzerAdapter.js     # Adapter for classification use
│   ├── OperationalLogger.js           # Comprehensive logging system
│   ├── ExchangeRouter.js              # Session file routing
│   └── SessionDatabase.js             # Session data management
├── knowledge-management/          # Knowledge capture and storage
├── constraint-monitoring/         # Real-time constraint checking
└── utils/                         # Shared utilities and helpers
```

**Guidelines**:
- **Single Responsibility**: Each file handles one specific domain or functionality
- **Clear Naming**: File names directly reflect their primary responsibility
- **Logical Grouping**: Related functionality grouped in subdirectories
- **Interface Consistency**: Common interface patterns across similar components

### `/scripts/` - Automation and Utilities
**Purpose**: Executable scripts for automation, testing, and system management
**Organization**: Grouped by functionality with clear naming

```
scripts/
├── enhanced-transcript-monitor.js     # Real-time transcript monitoring
├── generate-proper-lsl-from-transcripts.js  # Batch LSL generation
├── live-logging-coordinator.js        # Global LSL coordination
├── combined-status-line.js            # Status display system
├── post-session-logger.js             # Traditional session logging
├── semantic-tool-interpreter.js       # Tool interaction analysis
├── start-live-logging.js              # Service startup coordination
├── test-*.js                          # Testing utilities
└── knowledge-management/              # Knowledge-specific scripts
    ├── analyze-code.js
    ├── analyze-conversations.js
    └── verify-patterns.sh
```

**Naming Conventions**:
- **Action-oriented**: Scripts start with verbs (generate, analyze, test, start)
- **Domain-specific**: Clear indication of what the script operates on
- **Test scripts**: Prefixed with `test-` for easy identification
- **Utility scripts**: Clear, descriptive names for their primary function

### `/config/` - Configuration Management
**Purpose**: Centralized configuration with environment-specific overrides
**Organization**: Hierarchical configuration with clear precedence

```
config/
├── live-logging-config.json          # Core LSL system configuration
├── semantic-analysis-config.json     # AI provider settings
├── constraint-monitoring-config.json # Constraint checking rules
└── defaults/                         # Default configurations
    ├── development.json
    ├── production.json
    └── testing.json
```

**Configuration Principles**:
- **Single Source of Truth**: One primary config file per major system
- **Environment Overrides**: Environment-specific files override defaults
- **Validation**: All configurations validated at startup
- **Documentation**: Inline comments explain all configuration options

### `/docs/` - Documentation System
**Purpose**: Comprehensive documentation with visual diagrams
**Organization**: Structured by audience and information type

```
docs/
├── README.md                          # Main documentation entry point
├── architecture/                     # System architecture documentation
│   ├── system-overview.md
│   ├── unified-knowledge-flow.md
│   └── unified-memory-systems.md
├── components/                       # Component-specific documentation
│   └── semantic-analysis/
│       ├── README.md
│       ├── architecture.md
│       └── api-reference.md
├── features/                         # Feature documentation
│   ├── real-time-constraint-monitoring.md
│   └── status-line-icons-reference.md
├── installation/                    # Setup and installation guides
├── integrations/                    # Integration documentation
├── reference/                       # Reference materials
├── use-cases/                       # Use case examples
├── images/                          # Generated PNG diagrams
└── puml/                            # PlantUML source files
```

**Documentation Standards**:
- **Audience-Focused**: Documentation organized by user needs
- **Visual Diagrams**: PlantUML sources with generated PNG images
- **Living Documentation**: Updated with code changes
- **Cross-References**: Clear links between related documentation

### `/integrations/` - External Service Integration
**Purpose**: Integration code for external services and tools
**Organization**: One directory per integration with consistent structure

```
integrations/
├── browser-access/                   # Web browser automation
├── claude-logger-mcp/               # Claude Code MCP integration
├── mcp-constraint-monitor/          # Constraint monitoring MCP server
├── system-health-dashboard/         # VKB dashboard interface
└── mcp-server-semantic-analysis/    # Semantic analysis MCP server
```

**Integration Standards**:
- **Self-Contained**: Each integration is self-contained with its own dependencies
- **Consistent Structure**: README, package.json, src/, docs/ in each integration
- **Standard APIs**: Common interface patterns across integrations
- **Independent Deployment**: Integrations can be deployed separately

### `/lib/` - Reusable Libraries
**Purpose**: Shared libraries and utilities used across the system
**Organization**: Functional grouping with clear separation of concerns

```
lib/
  adapters/                        - Service adapters and bridges
  agent-api/                       - Agent abstraction API (multi-agent support)
  fallbacks/                       - Fallback implementations
  integrations/                    - Integration utilities
  knowledge-api/                   - Knowledge management API
  utils/                           - General utilities
  vkb-server/                      - Knowledge visualization server
```

**Library Standards**:
- **Pure Functions**: Stateless, predictable functions where possible
- **Clear Interfaces**: Well-defined public APIs with JSDoc documentation
- **Error Handling**: Comprehensive error handling with meaningful messages
- **Testing**: Unit tests for all public functions

### `/knowledge-management/` - Knowledge System
**Purpose**: Knowledge capture, storage, and analysis
**Organization**: Separated by function with clear data flow

```
knowledge-management/
├── schemas/                         # Data schemas and validation
│   └── enhanced-entity-schema.json
├── insights/                        # Captured knowledge insights
│   ├── *.md                        # Individual insight files
│   ├── images/                     # Generated diagrams
│   └── puml/                       # PlantUML sources
├── ukb/                            # Universal Knowledge Base CLI
├── vkb/                            # View Knowledge Base web interface
├── ckb/                            # Clean Knowledge Base utilities
└── browser/                        # Browser-based knowledge tools
```

**Knowledge Organization Principles**:
- **Structured Data**: JSON schemas define entity and relationship structures
- **Human-Readable**: Markdown files for human consumption
- **Machine-Processable**: JSON files for automated processing
- **Version Control**: All knowledge artifacts version controlled

### `/bin/` - Command Line Interface
**Purpose**: User-facing command line tools and executable scripts
**Organization**: Simple, focused executables with clear purposes

```
bin/
├── coding                          # Main entry point
├── claude-mcp                     # Claude Code launcher
├── ukb                            # Universal Knowledge Base
├── vkb                            # View Knowledge Base
├── status                         # System status display
├── mcp-status                     # MCP server health check
└── clean-knowledge-base           # Knowledge cleanup utilities
```

**CLI Standards**:
- **Unix Philosophy**: Single-purpose tools that do one thing well
- **Consistent Interface**: Common argument patterns across tools
- **Help Documentation**: --help flag provides comprehensive usage information
- **Error Messages**: Clear, actionable error messages

## File Naming Conventions

### Source Code Files
- **Classes**: PascalCase (e.g., `ReliableCodingClassifier.js`)
- **Utilities**: camelCase (e.g., `semanticAnalyzer.js`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `API_CONSTANTS.js`)
- **Tests**: `*.test.js` suffix

### Configuration Files
- **System Config**: `*-config.json` (e.g., `live-logging-config.json`)
- **Environment**: Environment name (e.g., `development.json`)
- **Templates**: `*.template` suffix

### Documentation Files
- **Main Docs**: `README.md` for primary documentation
- **Specific Docs**: Descriptive names (e.g., `system-overview.md`)
- **Diagrams**: Match documentation name (e.g., `system-overview.png`)

### Session and Log Files
- **LSL Sessions**: `YYYY-MM-DD_HHMM-HHMM_hash_from-project.md`
- **Trajectories**: `YYYY-MM-DD_HHMM-HHMM-trajectory.md`
- **Logs**: `*.log` files with descriptive names

## Code Organization Principles

### Functional Grouping
- **Related Functionality**: Group related functions and classes together
- **Clear Boundaries**: Well-defined interfaces between different functional areas
- **Minimal Dependencies**: Reduce coupling between different parts of the system
- **Consistent Patterns**: Use consistent patterns for similar functionality

### Separation of Concerns
- **Data Layer**: Pure data operations and storage
- **Business Logic**: Core functionality and processing
- **Presentation Layer**: User interfaces and output formatting
- **Integration Layer**: External service communication

### Configuration Management
- **Centralized Defaults**: Default configurations in dedicated files
- **Environment Overrides**: Environment-specific configuration files
- **Runtime Configuration**: Environment variables for sensitive data
- **Validation**: Configuration validation at startup

### Error Handling
- **Structured Errors**: Consistent error object structure across the system
- **Error Propagation**: Clear error propagation with context preservation
- **Recovery Strategies**: Graceful degradation and fallback mechanisms
- **Logging**: Comprehensive error logging with debugging information

## Development Workflow

### Adding New Features
1. **Create Feature Specification**: Use spec workflow system to define requirements
2. **Design Architecture**: Document component interactions and data flow
3. **Implement Core Logic**: Add source code in appropriate `/src/` subdirectory
4. **Add Scripts**: Create automation scripts in `/scripts/` if needed
5. **Update Configuration**: Extend configuration files as necessary
6. **Write Tests**: Add comprehensive tests with appropriate naming
7. **Document**: Update documentation and create diagrams
8. **Integration**: Test with existing system components

### Modifying Existing Features
1. **Review Current Implementation**: Understand existing code and architecture
2. **Update Specifications**: Modify spec documents if requirements change
3. **Refactor Carefully**: Maintain backwards compatibility when possible
4. **Update Tests**: Ensure test coverage for modified functionality
5. **Update Documentation**: Keep documentation current with changes
6. **Integration Testing**: Verify compatibility with existing system

### File Organization Guidelines
- **One Responsibility Per File**: Each file should have a single, clear purpose
- **Logical Grouping**: Related files should be in the same directory
- **Clear Dependencies**: Minimize and clearly document file dependencies
- **Consistent Structure**: Follow established patterns for similar file types

This project structure ensures maintainability, scalability, and clear separation of concerns while providing excellent developer experience and system reliability.
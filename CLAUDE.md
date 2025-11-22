# CLAUDE.md - Coding Project Guidelines

Essential guidance for Claude Code working in the coding infrastructure project.

---

## 🚨 MANDATORY: SKILLS USAGE

### Documentation-Style Skill

**ALWAYS invoke the `documentation-style` skill when:**
- Creating or modifying PlantUML (.puml) files
- Generating PNG files from PlantUML diagrams
- Working with Mermaid diagrams
- Creating or updating documentation artifacts
- User mentions: diagrams, PlantUML, PUML, PNG, visualization, architecture diagrams

**How to Invoke:**
```
Use Skill tool with command: "documentation-style"
```

**Why:** Enforces naming conventions, prevents incremental naming violations, ensures proper validation workflow, and applies correct style sheets.

---

## 📋 PROJECT CONFIGURATION

### Location & Purpose
- **Path**: `/Users/q284340/Agentic/coding`
- **Purpose**: Development environment with MCP services, knowledge management, and LSL system

### Startup & Services
- **Command**: `claude-mcp` or `coding --claude` (starts all services)
- **Services**: VKB Server (port 8080), Semantic Analysis, Graph Database
- **Never use**: Just `claude` - always start via 'coding' infrastructure

### Knowledge Management
- **Graph Database**: Graphology + Level persistent storage
- **Commands**: `vkb` (visualize)
- **Storage**: `.data/knowledge-graph/`

### Session Logging (LSL)
- **Primary**: Live Session Logging with enhanced transcript monitor
- **Location**: `.specstory/history/`
- **Format**: `YYYY-MM-DD_HHMM-HHMM-<user-hash>[_from-<project>].md`

### Technical Standards
- **TypeScript**: Mandatory with strict type checking
- **Working Directory**: Always start in top-level project directory
- **File Interference**: Avoid `.mcp-sync/` for importable modules
- **API Design**: Never modify working APIs for TypeScript; fix types instead

### MCP & Tools
- **Serena MCP**: ONLY for reading/searching/analyzing code
- **File Operations**: Use standard Edit/Write tools, NEVER Serena for editing
- **Memory**: `.serena/memories/` for context persistence

---

## 🎯 DEVELOPMENT PRACTICES

### Quality & Verification
- Always verify results with actual command output
- Never assume success - check and report actual state
- Follow quality gates before considering work complete

### Session Continuity
- Maintain context via LSL system (started via coding/bin/coding)
- Use `/sl` command to read session history for continuity

### Git & Commits
- Descriptive commit messages with clear context
- Commit after small increments/milestones
- Follow project-specific branch strategies

---

**Note**: Code quality constraints (parallel versions, naming patterns, etc.) are enforced by the constraint monitoring system.

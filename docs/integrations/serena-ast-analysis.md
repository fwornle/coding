# Serena AST Analysis Integration

**Component**: [serena](../../integrations/serena/)
**Type**: MCP Server (AST-based code analysis)
**Purpose**: Structure-aware code search and semantic analysis

---

## What It Provides

Serena provides AST (Abstract Syntax Tree) based code analysis, enabling structure-aware code search rather than simple text pattern matching.

### Core Capabilities

- **Semantic Code Search** - Search by code structure, not text patterns
- **Relationship Understanding** - Function calls, inheritance, dependencies
- **Security Analysis** - Find vulnerabilities through code structure
- **Refactoring Support** - Intelligent code reorganization suggestions
- **Cross-Language Support** - Works with multiple programming languages

### Key Features

- **Symbol-Based Search** - Find functions, classes, methods by structure
- **Dependency Analysis** - Understand code relationships
- **Pattern Matching** - Detect anti-patterns and code smells
- **Safe Refactoring** - Analyze impact before changes

---

## Integration with Coding

### How It Connects

Serena integrates as an MCP server providing semantic code analysis tools to Claude Code.

### Configuration

Configured in Claude Code's MCP settings via the main installer.

### Usage Examples

**Smart Code Search:**
```
# Find authentication functions by structure
search_code_by_ast {
  "pattern": "function_def",
  "context": "authentication",
  "include_dependencies": true
}
```

**Security Analysis:**
```
# Find potential SQL injection points
search_code_by_ast {
  "pattern": "function_call",
  "name": "*.query",
  "context": "user_input",
  "analysis_type": "security"
}
```

**Refactoring Assistant:**
```
# Analyze dependencies before refactoring
retrieve_semantic_code {
  "target": "UserService",
  "relationship": "calls",
  "depth": 3,
  "suggest_improvements": true
}
```

---

## Full Documentation

For complete documentation, see:

**[integrations/serena/README.md](https://github.com/oraios/serena/blob/main/README.md)**

Topics covered:
- Complete tool reference
- Language support
- Query syntax
- Configuration options
- Advanced features
- Development guide

---

## See Also

- [System Overview](../system-overview.md#serena-ast-analysis)
- [Integration Overview](README.md)

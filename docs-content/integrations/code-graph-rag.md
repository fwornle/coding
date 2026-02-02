# Code Graph RAG

AST-based code indexing and semantic search via Memgraph.

## Overview

| Property | Value |
|----------|-------|
| Component | `code-graph-rag` |
| Type | MCP Server |
| Port (Docker) | 3850 |
| Database | Memgraph (port 7687) |
| UI | Memgraph Lab (port 3100) |

## What It Does

- **AST Indexing** - Parses code into Abstract Syntax Tree
- **Graph Storage** - Stores entities and relationships in Memgraph
- **Semantic Search** - Natural language queries about codebase
- **Call Graph** - Function dependency analysis
- **Similar Code** - Find similar code patterns

## MCP Tools

| Tool | Description |
|------|-------------|
| `index_repository` | Build code graph from repository |
| `query_code_graph` | Natural language code queries |
| `get_code_snippet` | Retrieve source code by qualified name |
| `surgical_replace_code` | Targeted code replacement |
| `read_file` | Read file contents |
| `write_file` | Write file contents |
| `list_directory` | List directory contents |
| `comprehensive_analysis` | LLM-powered entity analysis |

## Actions

### Index Repository

```
index_repository {}
```

Parses and indexes the entire codebase into Memgraph.

### Natural Language Query

```
query_code_graph {
  "natural_language_query": "What functions call UserService.create_user?"
}
```

### Get Code Snippet

```
get_code_snippet {
  "qualified_name": "app.services.UserService.create_user"
}
```

Returns source code, file path, line numbers, and docstring.

### Comprehensive Analysis

```
comprehensive_analysis {
  "qualified_name": "app.services.UserService",
  "scope": "full"
}
```

Scopes: `full`, `structure`, `behavior`, `dependencies`

## Configuration

**Native Mode**:

```json
{
  "mcpServers": {
    "code-graph-rag": {
      "command": "node",
      "args": ["/path/to/code-graph-rag/build/index.js"],
      "env": {
        "MEMGRAPH_HOST": "localhost",
        "MEMGRAPH_PORT": "7687"
      }
    }
  }
}
```

**Docker Mode**:

```json
{
  "mcpServers": {
    "code-graph-rag": {
      "command": "node",
      "args": ["/path/to/code-graph-rag/dist/stdio-proxy.js"],
      "env": {
        "CODE_GRAPH_RAG_SSE_URL": "http://localhost:3850"
      }
    }
  }
}
```

## Memgraph Database

**Bolt Protocol**: port 7687
**Lab UI**: http://localhost:3100

### Direct Queries

```bash
# Connect via Memgraph Lab
open http://localhost:3100

# Or via cypher-shell
docker exec memgraph cypher-shell -u memgraph -p memgraph \
  "MATCH (n) RETURN count(n);"
```

## Indexed Entities

| Entity Type | Description |
|-------------|-------------|
| `Function` | Functions and methods |
| `Class` | Classes and types |
| `Module` | Files and packages |
| `Import` | Import relationships |
| `Call` | Function call relationships |

## Use Cases

### Understanding Code

```
"What functions call registerWithPSM?"
"Show me all classes that implement the Repository interface"
"How does the authentication flow work?"
```

### Finding Dependencies

```
"What modules import UserService?"
"Show the call graph for processPayment"
```

### Code Navigation

```
"Find the definition of handleError"
"What files contain database queries?"
```

## Health Check

```bash
# MCP server
curl http://localhost:3850/health

# Memgraph
docker exec memgraph cypher-shell -u memgraph -p memgraph "RETURN 1;"
```

## Integration with UKB

Code graph is automatically updated during `ukb` runs via the CodeGraphAgent in Semantic Analysis.

## Troubleshooting

### Memgraph not connecting

```bash
# Check container status
docker compose -f docker/docker-compose.yml ps memgraph

# View logs
docker compose -f docker/docker-compose.yml logs memgraph

# Restart Memgraph
docker compose -f docker/docker-compose.yml restart memgraph
```

### Index not updating

```bash
# Force re-index
index_repository {}

# Check index status
query_code_graph { "natural_language_query": "How many functions are indexed?" }
```

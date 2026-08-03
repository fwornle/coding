---
name: graphify
description: Query and rebuild the project's code knowledge graph (graphify). Use for any question about the codebase — architecture, "what calls X", "where is Y", file/function relationships, data-flow tracing — instead of blind greps. The graph is a static graph.json served over MCP by the coding-graphify container; rebuild it with `graphify update` when it's stale.
---

# /graphify

Graphify turns this repo into a navigable code knowledge graph (tree-sitter AST → static
`graph.json`), served over an HTTP MCP endpoint. All Python runs **inside the `coding-services`
container** — the host `graphify` command (`bin/graphify`) forwards to it via `docker exec`.

- **Graph output:** `.data/graphify/graphify-out/graph.json` (bind-mounted; `built_at_commit` stamps the indexed commit)
- **MCP endpoint:** `http://localhost:3851/mcp` (tools: `query_graph`, `get_node`, `get_neighbors`, `shortest_path`, `graph_stats`, `god_nodes`, …)
- **Host CLI:** `graphify …` (shim → container)

## When to use

Prefer this over grepping the codebase for structural questions ("how does X work?",
"what calls Y?", "trace the flow through Z", "what depends on this module?"). Query the graph
first; fall back to grep only if the graph lacks the answer.

## Querying (fast path — graph already built)

Use the **MCP tools** (`mcp__graphify__query_graph`, `get_node`, `get_neighbors`,
`shortest_path`, `god_nodes`) when available. Equivalent CLI via the shim:

```bash
graphify query "How does the ETM watchdog reclaim a stalled session?"   # BFS, broad context
graphify query "what calls captureForegroundTokens" --dfs               # DFS, trace a path
graphify path "ObservationWriter" "obs-api"                             # shortest path between two concepts
graphify explain "CodeGraphAgent"                                       # plain-language node explanation
graphify god-nodes --top 20                                            # most-connected hubs
```

## Rebuilding the graph

The dashboard shows how many commits behind the graph is and has a **Re-index** button.
To rebuild from the CLI:

```bash
graphify update /workspace/coding        # incremental (AST only, no LLM) — fast, use this most of the time
graphify extract /workspace/coding       # full re-extract incl. docs/PDF semantic pass (routes docs LLM via the proxy)
graphify extract /workspace/coding --code-only   # full code re-extract, no LLM/network
```

Note: paths are **container paths** — this repo is mounted read-only at `/workspace/coding`;
output is written to the bind-mounted `.data/graphify`.

## Notes

- If `graphify: container 'coding-services' is not running` appears, start it:
  `cd docker && docker-compose up -d coding-services`.
- The graph is file-based — no database. It persists across sessions in `.data/graphify`.
- This replaces the former code-graph-rag / Memgraph stack.

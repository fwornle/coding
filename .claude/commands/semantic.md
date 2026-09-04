---
name: semantic
description: Run UKB knowledge-base workflows (wave-analysis and friends), manage the ontology, refresh stale knowledge entities, and reach the semantic-analysis tools. Use whenever the user says "ukb", "ukb full", "ukb debug", asks to run or check a knowledge workflow, or asks about ontology classes and entity refresh. Replaces the former semantic-analysis MCP tools.
---

# /semantic

The `semantic` CLI (`bin/semantic`) is the entry point to the semantic-analysis tools. It POSTs to
`/tool/<name>` on the SSE server the `coding-services` container already runs at **:3848**.

That transport is deliberate, not incidental: `execute_workflow` dispatches into an **in-process**
workflow state machine, and the broadcaster subscribed to it is what feeds the dashboard's
`/workflow-events` view. Running the same handler in a one-shot process would start the workflow
and leave the UI blind to it.

- **Dashboard:** http://localhost:3032 → Performance → UKB
- **Service health:** `curl -s localhost:3848/health`
- **Every available tool:** `semantic tools`

## 🚨 UKB Workflow Control — match the flags to what the user actually said

| User says | Mode | Command |
|---|---|---|
| "ukb", "full ukb", "ukb full" | **PRODUCTION** — real LLM calls, runs for 10–20 min | `semantic workflow run wave-analysis --team coding` |
| "ukb full debug", "ukb debug" | **DEBUG** — mock LLM, single-step, step-into-substeps | `semantic workflow run wave-analysis --team coding --debug` |

- **NEVER default to debug** unless the user explicitly said "debug".
- **NEVER run bare `ukb`** as a shell command — that is the retired legacy script, not this CLI.
- Long workflows are async by default: the command returns a workflow id and leaves the run going.
  Watch it on the dashboard or poll `semantic workflow status`. Do not wait on it.

Workflow names: `wave-analysis` (the UKB pass), `batch-analysis`, `incremental-analysis`,
`complete-analysis`.

## Commands

```bash
semantic workflow run wave-analysis --team coding          # production UKB pass
semantic workflow run wave-analysis --team coding --debug  # mock LLM + single-step
semantic workflow run batch-analysis --param fullAnalysis=true
semantic workflow status                                   # progress of the current run

semantic ontology status --team coding      # config, paths, validation mode, registered teams
semantic ontology classes --team coding     # available entity classes
semantic ontology suggest --team coding     # propose new classes from unclassified entities
semantic ontology inject --team coding      # hot-swap an ontology config

semantic refresh KnowledgePersistencePattern --team coding
semantic refresh '*' --team coding --dry-run          # preview a batch refresh
semantic refresh '*' --team coding --parallel 8

semantic checkpoint reset --days-ago 7      # re-analyse from N days back

semantic insights notes.md --type architecture
semantic analyze code src/foo.ts --focus security
semantic analyze repo "$CODING_REPO" --max-files 200

semantic tools                              # names + descriptions of all 19 tools
semantic tool <name> '{"key":"value"}'      # generic escape hatch for anything unmapped
```

`--json` prints the raw response envelope instead of just the tool's text.

## Code-graph questions go to /graphify

`semantic tool analyze_code_graph …` still works, but for "what calls X", "where is Y", or
tracing a flow, prefer the **`/graphify`** skill — it reads the same `graph.json` and has richer
traversal (`get_neighbors`, `shortest_path`, `god_nodes`).

## If the service is down

```
semantic: no semantic-analysis service at http://localhost:3848
```

means the container is not up: `cd docker && docker-compose up -d coding-services`. Check
`docker exec coding-services supervisorctl status mcp-servers:semantic-analysis`.

After changing TypeScript under `integrations/semantic-analysis/src/`, `dist/` is
live-mounted read-only into the container, so `npm run build` plus
`docker exec coding-services supervisorctl restart mcp-servers:semantic-analysis` is enough — no
image rebuild.

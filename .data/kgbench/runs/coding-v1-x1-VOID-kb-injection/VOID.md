# VOID — knowledge injection reached the cells

66 cells. Not results.

`knowledge-injection-hook.js` is registered as a USER-LEVEL `UserPromptSubmit` hook, so it fired
for every claude cell regardless of working directory. It semantically retrieves this project's
knowledge base against the PROMPT and prepends what it finds — which for a retrieval benchmark
is the answer.

Reproduced from an empty temp directory, against a real question prompt:

    prompt    "Which file defines the shell variable MANAGED_MCP_KEYS?"
    injected  "## Digests — Smoke Test Execution: MANAGED_MCP_KEYS Answer File Written
               Located definition via grep in install.sh at line 1180"

That digest is a record of a PREVIOUS run answering the same question. The leak is
self-reinforcing: running the benchmark creates observations about the answers, and the next run
is handed them.

Containment could not see this. The sandbox governs what is in the TREE; this channel never
touches the tree.

Fixed by setting `CODING_KNOWLEDGE_INJECTION=0` in `agentEnv()`, which covers cells, baseline
probes and tool discovery alike. Runs r5/r6/r7 predate the fix and their claude cells are
affected in the same way.

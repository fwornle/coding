# CodeGraph

Alternative code-graph backend: tree-sitter parsing into a SQLite/FTS5 index, served to
agents over stdio MCP. Sits alongside [graphify](graphify.md) behind the backend
registry, so which one agents use is a config choice rather than a code change.

**Available but not active.** `config/code-graph.json` resolves to `graphify`;
CodeGraph is installed and gated but only becomes the default when the benchmark
justifies it.

| | |
|---|---|
| Package | `@colbymchenry/codegraph@1.5.0` (MIT), installed **in the coding-services image** |
| Transport | stdio MCP — `docker exec -i coding-services codegraph serve --mcp` |
| Tools | `codegraph_explore` (others exist but are unlisted unless `CODEGRAPH_MCP_TOOLS` names them) |
| Index | `.data/codegraph/codegraph.db` (SQLite, WAL) |
| Host CLI | `bin/codegraph` — a `docker exec` shim, the only host artifact |

## Why the repo contains an empty `.codegraph/`

This looks odd and is load-bearing.

`CODEGRAPH_DIR` accepts a plain directory **name** and rejects absolute paths outright
(*"must be a plain directory name … not absolute"*), so the index cannot be redirected
to `.data` by environment alone — it always writes to `<target>/.codegraph`. The repo is
mounted read-only at `/workspace/coding`, and Docker **cannot create a mountpoint under
a read-only parent**.

So the directory has to pre-exist for the bind to attach:

```yaml
# docker/docker-compose.yml
- ${HOME}/Agentic:/workspace:ro
- ${CODING_REPO:-.}/.data/codegraph:/workspace/coding/.codegraph
```

The parent stays read-only; only that subpath is writable, and every byte lands in
`.data/codegraph` on the host. `.gitignore` tracks `.codegraph/.gitkeep` and ignores
everything else in it.

Delete `.codegraph/` and the container fails to start.

## Operating it

```bash
docker exec coding-services codegraph-index.sh full     # rebuild from scratch
docker exec coding-services codegraph-index.sh update   # incremental
bin/codegraph status                                    # index stats, from the host
bash scripts/backend-smoke.sh codegraph --full          # acceptance gate
```

Freshness is driven explicitly by `codegraph-index.sh`, not by CodeGraph's own watcher
or git hooks: `CODEGRAPH_NO_WATCH` and `CODEGRAPH_NO_DAEMON` are set in the image so
indexing is deterministic and observable. `CODEGRAPH_TELEMETRY=0` and `DO_NOT_TRACK=1`
are also set — the container is keyless and must not phone home.

`codegraph init` ends with an interactive "how should I keep the index fresh?" prompt.
`codegraph-index.sh` closes stdin on every call; without that it hangs the exec.

## Switching to it

```bash
# whole project
node -e 'const f="config/code-graph.json",c=require("./"+f);c.active="codegraph";
         require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
bash scripts/generate-docker-mcp-config.sh

# one agent only — config/code-graph.json → agents.opencode.backend = "codegraph"
# one command   — CODE_GRAPH_BACKEND=codegraph <cmd>
```

The registry is the single source of truth: the MCP config generators, `install.sh`'s
converters, the agent-startup contract test and kgbench's arm definitions all read it,
so switching updates native mode and Docker mode together.

## Measured behaviour

From `scripts/backend-smoke.sh codegraph --full` on this repo:

| Metric | Value |
|---|--:|
| Cold index | 36s — 1,599 files, 27,020 nodes, 85,894 edges |
| Incremental (no changes) | ~0s |
| Artifact | 108 MB |
| MCP cold start | 160ms (budget: 5s, paid per agent session) |
| Degradation with no index | clean JSON-RPC error, does not crash |

**Corpus scope differs from graphify** and the two are not comparable at face value:
CodeGraph indexes code only, graphify also ingests docs and PDFs. Node counts say
nothing about which retrieves better — that is what the
[benchmark](../benchmarks/kgbench-replication/README.md) is for.

## Known constraints

- **SQLite over a bind mount.** The index is WAL-mode SQLite on `.data`. This repo has
  prior scars here — `.observations` was removed from the bind mounts after WAL/SHM
  corruption from concurrent openers. Writes are confined to the single indexer
  process; concurrent multi-session reads are not yet stress-tested.
- **stdio fails harder than HTTP.** A crashing stdio server turns the agent's whole MCP
  list red, where graphify's HTTP transport fails per call. Hence the smoke gate's
  explicit "degrades cleanly with no index" check.
- **No host install.** If `codegraph` appears on PATH as a real binary rather than a
  `docker exec` shim, remove it (`npm -g uninstall @colbymchenry/codegraph`): it
  shadows the container backend and can serve a different version against a host-side
  index. `install.sh` warns when it detects this.

# Graphify-vs-Grep Benchmark — Phase 1 Report

**Repo:** coding @ `20469b25d` (grep and graph saw identical state; graph `built_at == HEAD`).
**Driver:** `claude -p` headless, model `claude-sonnet-5`, `--strict-mcp-config`.
**Arms (forced):** `grep` = Glob/Grep/Read only · `graph` = Graphify MCP (:3851) tools + Read, no Grep/Glob.
**Queries:** 9 (3 lookup, 3 structural, 2 blast-radius, 1 architecture) × 3 reps = 54 runs.
**Grading:** deterministic (8 queries, ground truth grep-verified from source) + LLM-judge (arch).

## Headline (perf medians over completed runs; reliability/correctness over all)

| Arm | median tool-calls | median total tokens | median latency | mean cost | hard-fail rate | correctness |
|---|--:|--:|--:|--:|--:|--:|
| **grep** | 2 | 218,828 | 19s | $0.157 | **0 / 27 (0%)** | **1.00** |
| **graph** | 2 | 221,970 | 16s | $0.188 | 2 / 27 (7%) | 0.94 (0.98 completed-only) |

**Bottom line:** On this repo the graph is at **rough token parity** with plain agentic grep, is **~20% more expensive per query**, is **marginally faster** in the median but has a **fat latency tail** (200s+ stalls), and has **equal answer quality when it completes**. The article's 5–70× token multiples are **not reproduced** here.

## Per-query total tokens (median across reps) + winner

| Query | class | grep tok | graph tok | winner | note |
|---|---|--:|--:|---|---|
| L1 | lookup (def) | 145,524 | 148,053 | tie | simple `def` — grep 1 grep, graph 1 query |
| L2 | lookup (def) | 144,922 | 147,673 | tie | graph had 1 stall (correctness 0.67) |
| L3 | lookup (x-subsystem) | 217,516 | **147,642** | **graph 1.5×** | dashboard route: graph found `server.js` in 1 call |
| S1 | structural (list refs) | **145,627** | 223,144 | **grep 1.5×** | "all files referencing X in one dir" = grep home turf |
| S2 | structural (caller) | 293,478 | 296,123 | tie | — |
| S3 | structural (x-subsystem) | 219,179 | **147,829** | **graph 1.5×** | which script dashboard spawns |
| B1 | blast-radius | 391,881 | 376,562 | ~tie | — |
| B2 | blast-radius | 294,495 | **223,278** | **graph 1.3×** | fewer tool rounds |
| A1 | architecture | 295,422 | **149,930** | **graph 2×** | but correctness 0.83 vs 1.00 (compact ≠ complete) |

**Pattern:** the graph wins ~1.3–2× on **cross-subsystem lookups (L3, S3), multi-hop blast-radius (B2), and the open-ended architecture question (A1)** — where grep needs several rounds of search+read. Grep wins on **single-directory reference listing (S1)** and ties on **simple `def` lookups (L1/L2)**. Simple-and-local → grep; broad-and-structural → graph.

## Why no 5–70×

1. **Fixed-overhead floor dominates.** ~140k tokens of every run is the Claude Code system prompt + tool schemas, identical-ish across arms. The variable (repo-content) tokens are a minority, so total-session ratios compress. The article's big multiples measure *content* tokens on huge single queries, not total session tokens with a fixed floor. On content alone the graph's edge is larger (e.g. A1 ≈ 2.9× fewer content tokens), but you still pay the floor every call.
2. **Your queries are mostly 1–3 targeted greps.** The graph's structural advantage widens with query complexity and codebase size; most of this 9-query set is answerable cheaply by grep.
3. **The graph arm carries MCP overhead** (6 tool schemas in context + verbose tool responses), which is why its cost is *higher* despite similar tokens.

## Reliability (a real operational cost)

- **grep: 0/27 failures.** **graph: 2/27 (7%)** — one 218s zero-output stall (L2) and one hard timeout (S1), both graph-arm. The live MCP dependency adds a tail-latency/availability risk that stateless grep doesn't have. Answer *quality* when it completed was on par (0.98).

## Caveats

- Single model (sonnet-5), single machine, N=3. Latency is noisy; token/tool-call medians are stable.
- **Forced arms** (graph can't fall back to grep). Realistic production mode is "agent chooses" (hybrid) — usually the best of both; not yet measured.
- Correctness graders are strict-but-narrow (path/set/regex/LLM). The arch LLM-judge is one call per run.
- This measures *retrieval efficiency to a correct answer*, not indexing cost or freshness.

## Suggested next steps

1. **Add a hybrid arm** (all tools, agent chooses) — the honest production number; cheap to add.
2. **Harden the graph arm** against the 7% stall (retry-on-timeout in the harness; investigate the :3851 MCP stall).
3. **Scale the query set** toward harder multi-hop questions + a larger repo, where the graph should separate from grep.
4. **Phase 2:** same harness, add `codebase-memory-mcp` / `CodeGraph` as extra arms (all verified real, MIT, local).

## Files

| File | What |
|---|---|
| `README.md` | This report (run of 2026-08-04). |
| `bench.py` | Harness. One fresh `claude -p` per (arm, query, rep); grades and appends to `results.jsonl`. |
| `report.py` | Aggregates `results.jsonl` into the tables above. |
| `queries.json` | The 9 queries with their ground truth and grader spec. |
| `results.jsonl` | Raw output of the run — 54 records (tokens, tool calls, cost, latency, score). |
| `full_run.log.txt` | Harness stdout for that run. |

`mcp_graphify_only.json` is written by `bench.py` at startup, so it is not checked in.

## Re-running

Needs graphify's MCP endpoint up on `:3851` (it runs in `coding-services`) and a
`graph.json` built at the commit under test — otherwise the two arms are not
looking at the same repo state and the comparison is meaningless.

```bash
cd docs/benchmarks/graphify-vs-grep
python3 bench.py --reps 1 --only L1,S1,A1   # pilot
python3 bench.py --reps 3                   # full run (54 runs, ~30 min)
python3 report.py                           # regenerate the tables
```

`results.jsonl` is appended to, not truncated — move it aside first for a clean run.
Env knobs: `KGBENCH_MODEL` (default `claude-sonnet-5`), `KGBENCH_TIMEOUT` (300s),
`KGBENCH_REPO` (defaults to this checkout's root).

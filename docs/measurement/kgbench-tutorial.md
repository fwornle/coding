# Tutorial — Running and Extending the Benchmark

Hands-on. By the end you will have run a measurement, read its output, written a new question,
added a retrieval backend, and added an agent.

> Terms (*arm*, *cell*, *axis*, *gated*, *containment*, *baseline*) are defined in the
> [Glossary](kgbench-guide.md#glossary). Read that first if any of them are unfamiliar.

---

## Before you start

Three things must be true.

**The local LLM proxy is running.** Every model call — the agents' and the judge's — goes
through it, which is what makes the work measurable and puts it on the right billing path. The
harness fails closed if it is unreachable, because a run that silently bypassed the proxy would
report numbers for a path nobody uses.

```bash
curl -s http://127.0.0.1:12435/health | head -c 200
# If unreachable:
launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy
```

**The retrieval backends you intend to compare are up and indexed.** A down backend is
indistinguishable from a backend that answers badly, and a whole matrix run under that condition
is worthless. The harness preflights them, so just ask:

```bash
node scripts/kgbench-run.mjs --set coding-v1 --preflight-only
```

**Your working tree is committed.** The sandbox is built from a *commit*, so uncommitted work is
not what gets searched. The runner warns about this; heed the warning or your results describe a
tree that no longer exists.

---

## 1. Your first measurement

Start with one question, one repetition, one arm. This costs a couple of minutes and exercises
the entire pipeline.

```bash
node scripts/kgbench-run.mjs \
  --set coding-v1 \
  --arms grep \
  --only L1 \
  --reps 1 \
  --run-id my-first-run \
  --no-judge
```

What you will see, in order — and each line is a control doing its job:

```
kgbench: LLM proxy ok at http://127.0.0.1:12435 (network=public, providers=...)
kgbench: preflighting 1 arm(s)...
  ok    grep
kgbench: building sandboxed run tree (this takes ~1 min on a large repo)...
  tree     /var/folders/.../kgbench-tree-1Ard2V
  commit   29bb31678
  excluded config/kgbench/questions, ... , .data, .specstory, CLAUDE.md, .claude
  verified no question prompt or provenance note survives in the tree
kgbench: discovering CLI tool surface...
  40 built-in tools; each arm denies all but its own grant
kgbench: measuring token baselines...
  grep         claude     baseline_in_tokens=22437 (3 samples, stream-json), tools=3
  [  1/1] grep         L1   rep1  1.00     9.7s
kgbench: done. results -> .data/kgbench/runs/my-first-run/results.jsonl
```

Read that `tools=3` — it is the isolation assertion. The arm was granted three tools and the
live session reports exactly three. If a denied tool were still present, the run would have
aborted here rather than producing cells that compare nothing.

### Read the result

```bash
node -e 'const r=JSON.parse(require("fs").readFileSync(".data/kgbench/runs/my-first-run/results.jsonl","utf8").trim());
process.stdout.write(JSON.stringify({outcome:r.outcome,score:r.score,detail:r.grade_detail,
 tools:r.tools_executed,tokens:r.total_tokens,source:r.token_source,audit:r.tool_audit},null,2))'
```

```json
{
  "outcome": "ok",
  "score": 1,
  "detail": "2/2 required",
  "tools": ["Grep", "Write"],
  "tokens": 46467,
  "source": "stream-json",
  "audit": "audited"
}
```

`audit: "audited"` means a tool trace existed and was checked against the grant. On an ungated
agent this reads `"unavailable"` — weaker, and deliberately not the same as "clean".

### Render a report

```bash
node scripts/kgbench-report.mjs --run my-first-run
```

---

## 2. A real matrix

```bash
node scripts/kgbench-run.mjs --set coding-v1 --reps 3 --run-id r-baseline
```

All enabled arms, all questions, three repetitions. This runs for hours, so use the supervisor
instead — it detaches, survives a signal death, and resumes from where it stopped:

```bash
bash scripts/kgbench-supervise.sh --run-id r-baseline --set coding-v1 --reps 3
```

Watch it:

```bash
tail -f .data/kgbench/runs/r-baseline/supervise.log
grep -c . .data/kgbench/runs/r-baseline/results.jsonl   # cells completed
cat .data/kgbench/runs/r-baseline/supervise.status
```

Resume is idempotent — re-running the same command skips every cell already recorded, so an
interrupted run costs only the cell that was in flight.

---

## 3. Adding the agent axis

```bash
bash scripts/kgbench-supervise.sh --run-id r-cross --set coding-v1 --reps 3 \
  --agents claude,copilot,opencode
```

Check the shape before spending anything:

```bash
node scripts/kgbench-run.mjs --set coding-v1 --agents claude,copilot,opencode --preflight-only
```

```
kgbench: 8 (arm, agent, model) combination(s):
  run    grep         claude     [builtins enforced, answer via stream-json]
  run    grep         copilot    [builtins not_enforced, answer via answer-file]
  run    grep         opencode   [builtins ungated, answer via answer-file]
  run    graphify     claude     [builtins enforced, answer via stream-json]
  ...
  REFUSE graphify     copilot    arm "graphify" is defined by WITHHOLDING built-in search ...
  REFUSE graphify     opencode   ...
```

**The refusals are the framework working, not a limitation to route around.** An arm whose
identity is a restriction can only exist where that restriction is enforceable — see
[the asymmetry](kgbench-experimental-design.md#part-3-the-asymmetry-that-cannot-be-fixed).

Afterwards, fill in tokens that arrived late:

```bash
node scripts/kgbench-backfill-tokens.mjs --run r-cross
```

### Adding the model axis

```bash
node scripts/kgbench-run.mjs --set coding-v1 --models claude-sonnet-4.6,claude-opus-5
```

Names are the benchmark's canonical spelling; each agent's dialect is derived. Do **not** take
the proxy's advertised catalog as the list of usable models — it advertises models providers
reject and omits models they serve. Establish the real list by probing:

```bash
node scripts/llm-model-probe.mjs
```

---

## 4. Writing a new question

Questions live in `config/kgbench/questions/<set>.json`. A question is a prompt plus a
machine-checkable definition of a right answer plus human-verified provenance.

```json
{
  "id": "S4",
  "cls": "structural",
  "prompt": "Which module owns the retry policy for outbound webhook delivery, and what is the backoff strategy? Give the repo-relative path and one sentence.",
  "checklist": [
    {
      "id": "f1",
      "must": true,
      "desc": "names the owning module",
      "match": { "type": "path", "value": "lib/webhooks/retry.mjs" }
    },
    {
      "id": "f2",
      "must": true,
      "desc": "identifies the backoff strategy",
      "match": { "type": "any-of", "value": ["exponential", "doubling", "backoff factor"] }
    }
  ],
  "provenance": {
    "verified_by": "human",
    "evidence": ["lib/webhooks/retry.mjs:42"]
  }
}
```

**Fields that carry weight**

| Field | Why it matters |
|---|---|
| `cls` | Determines which class median the question lands in. Misclassifying makes a class average meaningless |
| `checklist[].must` | Only `must` facts count toward the required score |
| `match.type` | `path`, `any-of`, `regex`, `near` (binds a claim to a subject) |
| `provenance.evidence` | **Load-bearing.** The harness refuses to run if containment would delete a file listed here |
| `leak_terms` | Optional. Strings that must appear nowhere in the tree; one occurrence aborts the run |
| `forbidden` | Facts a correct answer must not assert. Mostly for `abstain` questions |

### The rules that are not obvious

**Verify the answer yourself, by hand, before writing the key.** Two published findings on this
set turned out to be wrong keys: the arms were right and the benchmark was wrong. A wrong key is
also the one defect the judge cannot catch, because the judge's prompt is built from the same
checklist — so both graders agree and there are zero disagreements.

**Do not write a question answerable from general knowledge.** It measures the model's recall,
not the retrieval layer. Two questions here had to be rewritten for exactly this.

**Check the question does not collide with a tool's own self-description.** A question about a
concept that a retrieval backend names in its own documentation gives that arm a free hit.

**Never quote question content in code or docs that ship in the tree.** This is the leak that
recurred four times, each time in a comment written to explain the previous one. If you must
describe a question in source, describe it abstractly — or add the file to the exclusion set.

**For an `abstain` question, declare `leak_terms`.** Its subject must appear nowhere, and that is
exactly the kind of leak the five-word window scan cannot catch.

### Verify before running

```bash
node scripts/kgbench-verify-questions.mjs --set coding-v1
```

This checks that every evidence file exists and that the declared facts are actually present in
it — catching a key that names the wrong file before it costs you a matrix.

---

## 5. Adding a new arm

An arm is a tool surface. Add one to `config/kgbench/arms.json`:

```json
"docs": {
  "kind": "agent",
  "enabled": true,
  "label": "Curated docs only",
  "note": "Markdown plus an index, no source access.",
  "allowedTools": ["Read", "Glob"],
  "mcp": { "mcpServers": {} },
  "preflight": []
}
```

**Never hand-write MCP tool names.** Use the `$backendTools` token, which expands to the tool
list declared for that backend. Deriving them is what guarantees the benchmark exercises the
same tool surface production exposes, rather than drifting from it silently:

```json
"myindex": {
  "kind": "agent",
  "enabled": true,
  "label": "My index",
  "backend": "myindex",
  "allowedTools": ["Read", "$backendTools"],
  "preflight": [
    { "type": "http", "url": "http://localhost:${MYINDEX_PORT:-3860}/mcp" },
    { "type": "artifact", "backend": "myindex" }
  ]
}
```

`$allBackendTools` expands to every enabled backend's tools, and derives the server list from the
same expansion — which is what the `hybrid` arm uses. Naming one backend while granting every
backend's tools is the defect that shape invites: the unconfigured server's tools are absent
rather than refused, so the arm loses a strategy silently and still fills the table with numbers.

---

## 6. Adding a retrieval backend beyond graphify and codegraph

This is the extension most likely to matter, and the registry exists precisely so that
evaluating an alternative does not mean editing every consumer.

`config/code-graph.json` is the single place that says which backends exist.

### Step 1 — Register it

```json
"backends": {
  "myindex": {
    "enabled": false,
    "displayName": "MyIndex",
    "summary": "embedding retrieval over chunked source, served over HTTP MCP",
    "capabilities": ["search", "context", "incremental"],
    "mcp": {
      "serverName": "myindex",
      "transport": "http",
      "url": "http://localhost:${MYINDEX_PORT:-3860}/mcp",
      "toolPrefix": "mcp__myindex__",
      "tools": ["search_code", "get_context", "list_symbols"]
    },
    "runtime": {
      "location": "container",
      "container": "coding-services",
      "supervisorProgram": "myindex",
      "port": 3860,
      "portEnv": "MYINDEX_PORT"
    },
    "artifact": {
      "containerDir": "/coding/.data/myindex",
      "hostDir": ".data/myindex",
      "primary": "index.db"
    }
  }
}
```

**Ship it `enabled: false`.** Backends are switched on only after their smoke gate passes. A
backend that is registered but not working produces an arm that scores zero, which reads as a
finding about the backend's *quality* rather than its *availability*.

**Declare capabilities honestly.** Consumers gate on them — the dashboard's graph viewer, for
example, checks for `html-export` rather than assuming every backend can do what one of them can.

**`tools` is the contract.** This list is what `$backendTools` expands to. If it drifts from what
the server actually advertises, the arm is granted tools that do not exist (silently weaker) or
denied tools it needs (silently different).

### Step 2 — Make it reachable

An HTTP MCP server needs to be running and registered. A stdio backend needs no long-lived
process but does need its command line resolvable. The registry abstracts the MCP-registration
path; supervisord and the Dockerfile keep literal references and abstract by naming convention,
because a Dockerfile cannot read JSON at build time.

### Step 3 — Build its artifact

Whatever the backend indexes, it must be indexed *before* the run and the preflight must be able
to see it. That is what `{ "type": "artifact", "backend": "myindex" }` checks.

### Step 4 — Smoke-gate it

```bash
node scripts/kgbench-run.mjs --set coding-v1 --arms myindex --only L1 --reps 1 \
  --run-id myindex-smoke --no-judge
```

Confirm three things, in this order:

1. Preflight passes — the server is up and the artifact exists
2. `tools=N` in the baseline line matches the grant — the arm is isolated
3. `tools_executed` in the result row contains the backend's own tools and nothing else

If step 3 shows a text-search tool, the arm is not what its label says and the cell will be
voided as `tool_escape`.

### Step 5 — Enable it and compare

Flip `enabled: true`, add an arm that references it, and run against the incumbents. The `hybrid`
arm picks it up automatically through `$allBackendTools`.

### What the registry deliberately does *not* do

There is **no query-type routing and no "use all backends" mode**. Which backend suits which
kind of question is exactly what the benchmark exists to measure; encoding a guess in the
registry would bias the thing measuring it.

---

## 7. Adding a new agent

An agent adapter needs four things: how to launch it, how to get an answer out, what can be
enforced on it, and how its MCP configuration is written.

**1. Launch.** An argv builder producing that CLI's command line, including whatever flag makes
it run non-interactively without blocking on a permission prompt.

**2. Elicitation.** How the answer comes back. There are two modes:

- `stream-json` — the CLI emits structured output including the answer, the tool trace and token
  usage. Best case; only one agent supports it.
- `answer-file` — the prompt is extended with a directive to write the answer to a file. This
  exists because an analysis-shaped prompt makes some CLIs exit within seconds having answered
  nothing; giving them something to *do* on turn one is what makes them act.

The directive must be explicit that the answer file is the *only* write permitted. An agent that
"helpfully" edits the repository corrupts every later cell in the same worktree.

**3. Enforcement descriptor.** Two parts — MCP servers and built-ins — each honestly stated. If
the CLI can gate tools but you have not verified the name mapping, say `not_enforced` (unfinished
work), not `ungated` (a capability limit). Collapsing those makes a fixable gap look permanent.

**4. MCP configuration.** Where that CLI reads its server list. One reads a repo-level file
inside the working directory (isolated per cell for free); another reads a file under its config
home, which is pinned per run.

> **The trap here, learned the hard way.** Pinning a config home means *writing* that CLI's
> configuration file — and that file is usually not only MCP. Writing a fresh file containing
> only the MCP block deleted the `provider` declaration that made the model ids resolvable, and
> the cell died with "Model not found" for a model that was in the catalog. Copy the user's real
> config and replace only the MCP key.

**5. Declare faithfulness.** Given the enforcement descriptor, the harness decides which arms
this agent may run. If built-ins are ungated, arms defined by withholding built-in search are
refused automatically — you do not need to enumerate them.

### Smoke-test it for real

Unit tests cannot find the failures that matter here. The first real cross-agent run found two
defects no test reached: a config pin that deleted a provider, and an agent that read an
environment variable and wrote its answer into the live repository. Run one real cell and check:

- Did the agent honour the answer-file directive, or exit having written nothing?
- Did the MCP config land where it actually reads it?
- Was the model you asked for the model served?
- Did anything appear in the **live** repository? (`git status`)

---

## 8. Pitfalls

| Symptom | Likely cause |
|---|---|
| Every arm scores identically | The arms are not isolated. Check the `tools=N` line against each grant |
| An arm scores 0 on one question, others fine | Containment deleted that question's evidence, or the key names the wrong file |
| Cells are `tool_escape` | The arm used a tool outside its grant. Its numbers are correctly unscorable |
| Many `host_stalled` | The machine is loaded. Those cells are void; three consecutive aborts the run |
| Token column empty for some agents | Rows arrived late. Run `kgbench-backfill-tokens.mjs` |
| `content_tokens` null but `total_tokens` present | The cell's token source differs from its baseline's — the subtraction is refused on purpose |
| `token_ambiguous` set | Another session of that agent ran inside the cell's window. Re-run on an idle machine before quoting cost |
| Judge disagrees everywhere | Look at the key and the matcher first. It has never once been the question |
| Zero disagreements and suspiciously high scores | A wrong key makes both graders agree. Verify by hand |
| Report says "3 reps/arm" when you ran 1 | You ran 3 agents. Per-agent counting was a real bug here; make sure you are on a current version |
| A stray file appears in the live repo | Sandbox escape. Check `PWD` pinning for the agent that did it |

---

## Command reference

```bash
# Plan without spending
node scripts/kgbench-run.mjs --set coding-v1 --preflight-only
node scripts/kgbench-run.mjs --set coding-v1 --agents claude,copilot --preflight-only

# Run
node scripts/kgbench-run.mjs --set coding-v1 --reps 3 --run-id my-run
node scripts/kgbench-run.mjs --set coding-v1 --arms grep,hybrid --only L1,S1 --reps 1
bash scripts/kgbench-supervise.sh --run-id my-run --set coding-v1 --reps 3 \
     --agents claude,copilot,opencode

# Fix up afterwards
node scripts/kgbench-backfill-tokens.mjs --run my-run            # late tokens
node scripts/kgbench-backfill-tokens.mjs --run my-run --dry-run
node scripts/kgbench-regrade.mjs --run my-run                    # re-apply a fixed grader

# Report
node scripts/kgbench-report.mjs --run my-run
node scripts/kgbench-charts.mjs --run my-run --out docs/images

# Validate the question set
node scripts/kgbench-verify-questions.mjs --set coding-v1
```

Useful flags: `--arms`, `--agents`, `--models`, `--only`, `--reps`, `--run-id`, `--no-judge`,
`--no-baseline`, `--baseline-reps N`, `--no-sandbox` (**never** for publishable numbers).

---

## Where to go next

- [Experimental Design](kgbench-experimental-design.md) — why each control exists
- [Framework Guide](kgbench-guide.md) — architecture and concepts
- [Operator Reference](kgbench.md) — full flag list and prerequisites
- [Measurement & Judging Lessons](../benchmarks/measurement-lessons.md) — grading case notes

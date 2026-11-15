## Two ways to compare

| | `glass ab` | by hand |
|---|---|---|
| What varies | the model (provider/model) of one agent | anything: agent, model, instruction files, MCP servers |
| Who runs it | glass: interleaved, repeated, each trial in a fresh copy | you, one run after the other |
| Result quality | your `--check` command's exit code | you read the answers |
| Where to read it | `glass ab report`, `glass ui` → **A/B** | `glass ui` → **Sessions** |

## `glass ab`

```sh
glass ab run --agent pi|opencode|claude|copilot \
  --variant <label>=<provider>/<model> --variant <label>=<provider>/<model> [more variants] \
  --prompt "…" | --prompt-file task.md \
  [--repeats N] [--check "<command>"] [--repo <dir>] [--label <name>] \
  [--timeout <s>] [--check-timeout <s>] [--seed N] [--keep] [--agent-arg <arg>]… \
  [--before-trial "<command>"] [--before-trial-timeout <s>]
glass ab list [--json]
glass ab report [<id>|latest] [--json|--csv]
```

### What one trial is

1. **A fresh copy of the repository.** For a git checkout: a clone at your `HEAD` (it
   shares the object store, so it is quick), with every path that differs from `HEAD`
   laid over it — staged, unstaged, deleted — and every untracked file that is not
   ignored. Ignored files (`node_modules`, `.venv`, build output) are **not** copied: a
   `--check` that needs installed dependencies must find them outside the repository.
   Not a git checkout: a plain copy. The agent starts where `--repo` points inside it.
2. **The `--before-trial` hook**, when given: run in the copy through the system shell
   (as the check is), its output in `before.log`, with these set:

    | Variable | Value |
    |---|---|
    | `GLASS_AB_EXPERIMENT` | the experiment id |
    | `GLASS_AB_VARIANT` | the variant's label |
    | `GLASS_AB_TRIAL` | the trial number (1, 2, …, in the order trials run) |
    | `GLASS_AB_MODEL` | the variant's `provider/model` (claude, copilot: the model) |

    A non-zero exit, or running longer than `--before-trial-timeout` (default 60 s),
    fails the trial: it is recorded with the reason (`before-trial failed (exit 3)`,
    `before-trial timed out after 60 s`), counted among the variant's agent failures,
    and neither the agent nor the check runs. The experiment goes on with the next
    trial. The hook runs before the trial's session opens, so a failed one has no
    session.
3. **A glass session of its own**, tagged with the experiment id, the variant and the
   trial number (the tag is on the session record in `data/measurements/`). Every call
   of the trial is a row under the session's task id; the experiment file records which
   task id each trial had. That is the join.
4. **The agent, non-interactively**, with stdout and stderr kept in the trial's
   `agent.log`. Each agent gets the flag it needs to act without asking, because a
   question nobody can answer would hang the run:

    | Agent | Command line |
    |---|---|
    | pi | `pi -p --no-session --approve --provider <p> --model <m> <prompt>` |
    | opencode | `opencode run -m <p>/<m> --dangerously-skip-permissions <prompt>` |
    | claude | `claude -p <prompt> --model <m> --permission-mode acceptEdits` |
    | copilot | `copilot -p <prompt> --model <m> --allow-all-tools --no-ask-user` |

    The copy is a scratch directory, but the agent's tools still run on your machine
    with your rights. `--agent-arg` adds arguments (repeatable). The prompt is passed
    exactly as given: single-turn modes (`opencode run`, `copilot -p`) may stop after a
    plan without editing anything — ask for the change explicitly in the prompt.
5. **The check**, in the same copy, through the system shell: exit code 0 = pass. Its
   output is in `check.log`. It runs even when the agent failed (an agent can exit
   non-zero after doing the work).
6. The copy is removed (`--keep` keeps it, under the trial's directory).

A trial whose agent exits non-zero, times out (`--timeout`, default 1800 s) or cannot
start is an **agent failure**: recorded on the trial, counted per variant, never left
out. A trial with no measured call is counted as **unmeasured** — usually a provider
that did not go through glass (an HTTPS host glass does not intercept).

### One server, two weights

Two variants may name the same `provider/model`; only their labels must differ. That is
how a base model and its LoRA fine-tune are compared on **one** llama-server: start it
with the adapter loaded but switched off, and let `--before-trial` switch it per trial.

```sh
llama-server -m base.gguf --lora tuned.gguf --lora-init-without-apply \
  --slot-save-path ./slots --cache-ram 0 --port 8080
```

- `--lora-init-without-apply` loads the adapter at scale 0: the server starts as the
  base model.
- `--slot-save-path` is required for any `POST /slots/<id>?action=…`, erase included
  (without it llama-server answers that it does not support slot actions).
- `--cache-ram 0` switches off the host-memory prompt cache. It keeps prompts of idle
  slots and loads the best-matching one back into a slot by tokens alone, whatever
  adapter scale they were computed under, and erasing a slot does not clear it.

`lora-scale.mjs`, the hook (Node, so it runs the same on Windows):

```js
// Put llama-server on this trial's weights, then start every slot cold.
const server = process.env.LLAMA_URL || 'http://127.0.0.1:8080';
const scale = process.env.GLASS_AB_VARIANT === 'tuned' ? 1 : 0;
const call = async (method, route, body) => {
  const r = await fetch(server + route, {
    method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${route}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
};
await call('POST', '/lora-adapters', [{ id: 0, scale }]);
for (const slot of await call('GET', '/slots')) await call('POST', `/slots/${slot.id}?action=erase`);
console.log(`${process.env.GLASS_AB_TRIAL} ${process.env.GLASS_AB_VARIANT}: lora scale ${scale}, slots erased`);
```

```sh
glass ab run --agent pi \
  --variant base=local-llama/qwen --variant tuned=local-llama/qwen \
  --before-trial "node lora-scale.mjs" --prompt-file task.md --check "python -m pytest -q" --repeats 5
```

Put the script where the trial's copy finds it — in the repository (it is copied with
your uncommitted files) or by an absolute path. A failed call throws, the hook exits
non-zero, and the trial is recorded as failed instead of running on the wrong weights.

**Why the erase matters.** `POST /lora-adapters` only sets the server's global scale. A
request that carries no `lora` field of its own — the agents' requests do not — runs on
that global scale, but llama.cpp clears a slot's prompt cache only when a request's own
`lora` field differs from the slot's. So after a switch the slot would reuse the
key-value cache of the previous trial's prompt — the system prompt and tool definitions
every trial shares — computed under the other weights: the tuned trial would partly run
on the base model's activations, and the cache hit would also make it look faster. The
erase makes every trial start cold on its own weights. "answered by" in the report does
not catch this: both variants name the same model.

### Order

Each round runs every variant once, in an order shuffled for that round from a seeded
random generator (`--seed`, recorded either way). Interleaving puts whatever drifts
during the experiment — a warming prompt cache, a busy model server, the network — on
every variant alike, rather than on the one that happened to run last. Trials run one
after the other, never in parallel.

### What the report measures

Per variant:

| Row | Meaning |
|---|---|
| answered by | the model the calls' rows name — check that each variant really ran where you pointed it |
| trials, agent failures, unmeasured | as above |
| pass rate | trials whose `--check` passed ÷ trials checked. Without `--check`: none |
| wall time mean ± sd | the agent run of each trial, start to exit (sample standard deviation) |
| call latency p50 / p95 | request to the last byte of the response, over all calls of the variant |
| TTFT p50 | time to first token: request to the first generated token — content, reasoning or a tool call — of a **streamed** response, over the streamed calls (their number in brackets). A buffered response has none |
| tokens in / trial | fresh input, cache reads apart (as everywhere in glass) |
| tokens out / trial | output tokens, reasoning included |
| of which reasoning | reasoning tokens as the server reports them (`completion_tokens_details` / `output_tokens_details`). llama.cpp's server reports none, so its rows say 0 — its reasoning text is in the output count |
| calls, tool calls, turns / trial | LLM calls; tool calls the model emitted; turns = calls of the agent's own loop (those that carried tool definitions — titles and summaries are not turns) |

Means are per trial, latencies over calls. `--json` has the same per variant plus totals
and every trial; `--csv` is one row per trial.

!!! warning "What the numbers do not say"
    - **Quality is your check, nothing else.** glass has no LLM judge and does not read
      the answers. A check that passes too easily makes every variant look good.
    - **Few trials are noisy.** With three rounds, a difference smaller than the ± spread
      is not a difference. Repeat more before concluding.
    - **Latency is measured at glass**, between the agent and the model server: the
      network to a remote server is in it, the agent's own work between calls is not
      (that is in wall time).
    - TTFT, tool calls and reasoning tokens are recorded from the release that brought
      `glass ab` on; calls recorded before it read as not measured (—), never as 0.

### Where it lives

`~/.glass/data/ab/<id>/experiment.json` — the experiment, rewritten after every trial —
and `trials/<n>-<variant>/agent.log`, `check.log` (and `before.log` with `--before-trial`). The UI reads it through the daemon
(`/api/ab`, `/api/ab/<id>`), so **A/B** updates while `glass ab run` is still going.
Ctrl-C stops the running agent and ends the experiment as `aborted`; its trials so far
stay in the report. An experiment whose `glass ab run` died shows as `interrupted`.

## By hand

Anything you can vary between two `glass <agent>` runs:

| Variant A | Variant B |
|---|---|
| `glass claude` | `glass opencode` — different agents, same task |
| `--model …-haiku…` | `--model …-sonnet…` — different models |
| a project with a long `CLAUDE.md` | the same project without it — instruction-file cost |
| many MCP servers enabled | few — tool-definition cost |

1. **Fix the task.** Use the same prompt, the same repository state and non-interactive
   mode (`-p`, `run`) so both runs do the same work.
2. **Run each variant** through glass, one after the other.
3. **Compare in Sessions** — one row per run:

    ![Sessions, four agents on one task](images/ui-sessions-one-task.png)

    Above, four rows ran the same task: Claude Code (10:02) used 2 calls and 116K tokens,
    OpenCode (10:03) 4 calls and 88K, pi (10:03) 2 calls and 6.8K, copilot (19:09) 2
    calls and 58K — mostly a difference in how much context (system prompt, tool
    definitions) each agent sends. The 10:09 and 10:11 rows are interactive Claude Code
    sessions with other prompts.

4. **Compare the windows** — **Context** on each row:

    | | OpenCode | Claude Code |
    |---|---|---|
    | Explainer | ![opencode](images/ui-context-explainer.png) | ![claude](images/ui-context-explainer-claude.png) |

5. **Repeat** each variant a few times. A single run is an anecdote: agents are
   non-deterministic, and the first run of a session writes the cache that later runs
   read.

## Reading the result

- **Tokens per run** — the total cost of doing the task.
- **Cache share** — a variant that keeps its prefix stable re-uses the cache; one that
  changes the prompt early in the window pays full price every turn.
- **Window anatomy** — where the bytes go. Tool descriptions and instruction files are
  the usual levers.
- **Context** on a trial's session (A/B → Session) works for `glass ab` trials too.

## Not included

No LLM judge, no significance test, no parallel trials, and no comparison of different
agents within one `glass ab` experiment (variants differ in the model only).

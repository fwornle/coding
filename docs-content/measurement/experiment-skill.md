# The `/experiment` Skill

## Overview

`/experiment` is the single command that drives the whole measurement pipeline: it synthesizes a spec, runs the matrix across your chosen agents/models, auto-compares the variants, and writes the report the dashboard reads live. It is a **thin wrapper** over three CLIs and reimplements no runner or comparison logic:

1. **`scripts/experiment-write-spec.mjs`** — `buildExperimentSpec()` + `writeExperimentSpec()` emit a validated `config/experiments/<id>.yaml` (this is what makes a `/experiment`-authored spec appear in the dashboard's **Launch experiment** listbox, via `GET /api/experiments/specs`). It rejects unknown agents, empty variants, a missing goal, or a non-closed-6 `task_class`.
2. **`scripts/experiment-run.mjs --spec <yaml>`** — `runMatrix`: the sequential, idempotent, resumable per-cell loop.
3. **`scripts/experiments-compare.mjs`** — aggregates + ranks the runs and writes the report JSON.

The only skill-side computation is re-deriving the `task_hash` so the run→compare handoff is mechanically closed.

It works in **two modes**, chosen automatically:

- **Natural language (default)** — describe the experiment in plain English.
- **Structured flags (power users)** — the explicit `run --goal … --variants …` form.

---

## Natural-language mode

Just describe what you want to compare:

```
/experiment compare Claude Sonnet against OpenCode Haiku on writing a fizzbuzz
function, run each twice
```

The skill synthesizes the experiment and **shows you a preview before spending any tokens**:

```
Experiment (from your description)
  goal:      Create fizzbuzz.mjs exporting fizzbuzz(n) returning 'Fizz'/'Buzz'/'FizzBuzz'/n…
  variants:  claude / sonnet          (framework=straight, env=default)
             opencode / rapid-proxy/claude-haiku-4-5
  repeats:   2          task_class: new-feature          snapshot: smoke-spec
  test gate: node --test fizzbuzz.test.mjs
  rank by:   composite
```

You then confirm: **Run it** · **Run ungated** (drop the test) · **Edit** (correct any field). Nothing runs until you confirm.

### What the skill derives from your prose

| Field | How it's derived | Default |
|-------|------------------|---------|
| `goal_sentence` | your description rewritten as one precise imperative sentence (the `task_hash` source) | — |
| variants | agents you name → `claude` / `copilot` / `opencode` / `mastracode`, each with its model-string convention | `claude` (sonnet) + `opencode` (haiku) |
| `repeats` | "run each N times" | `1` |
| `task_class` | the zero-LLM keyword scorer `deriveClassFromText` over the goal | `new-feature` |
| `test_command` | a drafted `node --test` gate if the goal is checkable — **shown for confirmation** | ungated if not checkable |
| `snapshot_id` / `rank_by` | overridable in the prose | `smoke-spec` / `composite` |

Per-agent model strings (the **same** model needs three spellings — see [Architecture → Experiment identity](architecture.md#experiment-identity)): `claude` takes a hyphenated catalog id `claude-sonnet-4-6` (the `sonnet` alias resolves to the *latest* Sonnet and breaks parity; the dotted `claude-sonnet-4.6` 404s on the claude CLI); `opencode` takes `rapid-proxy/claude-sonnet-4.6` (dotted); `copilot` takes `claude-sonnet-4.6` (dotted). Cross-agent specs pin **sonnet-4.6** for opencode/copilot — haiku *narrates* its plan under their heavy agentic context and emits no tool calls, so it writes nothing.

### The knowledge axis (kb-on / kb-off)

The `env` axis A/Bs knowledge injection. `env: default` / `kb-off` runs with `CODING_KNOWLEDGE_INJECTION=0`; `env: kb-on` injects **gated** knowledge into the agent via its native channel (see [Architecture → Knowledge-injection axis](architecture.md#knowledge-injection-axis-kb-on-kb-off)). Add a matched `kb-on` / `kb-off` pair of variants to measure whether injection actually helps for a given task.

---

## Structured-flag mode

For scripted or exact runs, the original form still works unchanged:

```
/experiment run --goal "Create a file HELLO.txt containing the word hello" \
  --variants A,B --agents claude,opencode --repeats 3 \
  --task-class new-feature --snapshot-id smoke-spec --rank-by composite
```

Flags override everything; there is no synthesis step. The skill detects this mode whenever the input begins with `run ` and contains `--goal`.

---

## The task classes (CLOSED_6)

`task_class` must be one of the closed taxonomy (`config/task-taxonomy.yaml`). A run with an invalid class is quarantined and won't appear in the dashboard, so the skill always emits a valid one:

`refactor` · `bugfix` · `new-feature` · `migration` · `debug` · `docs`

## Ranking options

`--rank-by` (or "rank by …" in prose):

- **`composite`** *(default)* — ascending `totalTokens / goal_aligned_ratio` (cheapest per quality).
- **`tokens`** — ascending by mean tokens.
- **`wallclock`** — ascending by mean latency.
- **`score`** — descending by rubric quality.

---

## What you get back

- A **ranked variant table** printed to your terminal (with the failed / ungated / unscored groups shown honestly).
- `.data/experiments/reports/<task_hash>.json` — the report the dashboard **Compare** tab reads live at [http://localhost:3032](http://localhost:3032). A completed run can also be **forked into avenues** from the Runs table.

## Operational notes

- **Run unattended.** Each cell binds its own tokens **per-request** (claude via an `x-task-id` header, opencode via a provider-config splice on both wires), so a cell captures reliably even under concurrency. But a cell still opens the ambient `active-measurement.json` span as a fallback, so a *concurrent* interactive call in the same repo that carries no binding of its own can be swept into the open cell — keep the matrix unattended.
- **`test_command` must be fixed-argv.** The spec validator rejects shell metacharacters (`&&`, `|`, `;`, `$()`, newline). Use a single command — e.g. `grep -qi stall notes.md`, not `test -s notes.md && grep …` — or the whole matrix aborts before run 0.
- **Phrase deliverables as execution, not analysis.** opencode's headless `run` ends its agentic loop on the first assistant message with *no* tool call; an analysis-shaped goal ("explain how…") gets narrated and never written. Say "create file X, write it directly, done only once it exists" to get a real artifact (this affects sonnet too, not just haiku).
- **A free-form model WARN is expected.** `WARN: unrecognized model 'rapid-proxy/claude-sonnet-4.6' — free-form, not blocked (D-05)` is informational, not an error.
- **Judge flakes ≠ agent failures.** An `UNSCORED` / `FAILED` cell can come from malformed judge JSON or a null `goal_aligned_ratio` even though the agent's own `node --test` passed — re-score rather than re-run.
- **Agents:** `claude` and `opencode` are the RUN-verified drivable agents; `copilot` is probe-gated; `copilot` + `headless` is an unsupported combination and is dropped.

See the [Tutorial](tutorial.md) for a full worked example and the [Architecture](architecture.md) for how the measurement works under the hood.

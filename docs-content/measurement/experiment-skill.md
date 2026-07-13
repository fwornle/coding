# The `/experiment` Skill

## Overview

`/experiment` is the single command that drives the whole measurement pipeline: it synthesizes a spec, runs the matrix across your chosen agents/models, auto-compares the variants, and writes the report the dashboard reads live. It is a **thin wrapper** — it shells to `scripts/experiment-run.mjs` and `scripts/experiments-compare.mjs` and reimplements no runner or comparison logic.

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

Per-agent model strings: `claude` takes an alias (`opus`/`sonnet`/`haiku`); `opencode` takes `rapid-proxy/claude-haiku-4-5`; `copilot` takes `auto`.

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
- `.data/experiments/reports/<task_hash>.json` — the report the dashboard **Comparison** tab reads live at [http://localhost:3032](http://localhost:3032).

## Operational notes

- **Run unattended.** Each cell opens one global measurement span; don't drive an interactive agent in the same repo while a matrix runs, or its calls get mis-attributed.
- **Agents:** `claude` and `opencode` are the RUN-verified drivable agents; `copilot` is probe-gated; `copilot` + `headless` is an unsupported combination and is dropped.

See the [Tutorial](tutorial.md) for a full worked example and the [Architecture](architecture.md) for how the measurement works under the hood.

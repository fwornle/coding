---
description: Describe a cross-agent experiment in plain English (or with flags), then auto-run the matrix, compare, and render the ranked variant table
argument-hint: "<describe your experiment in plain English>"  |  run --goal "…" --variants A,B --agents claude,opencode --repeats N [--task-class new-feature] [--snapshot-id smoke-spec] [--rank-by composite]
---

# Experiment (/experiment) — describe → run → compare in one command

Wrap the full cross-agent experiment flow as a single operator command: synthesize a
spec (from a **plain-English description** or from headline flags), run the whole matrix,
then auto-compare the variants and print the ranked table (and write the report JSON the
dashboard Comparison tab reads live).

**Two ways to invoke — same pipeline (Step 0 chooses):**

- **Natural language (default):** just describe the experiment, e.g.
  `/experiment compare Claude Sonnet against OpenCode Haiku on writing a fizzbuzz function, run each twice`.
  The skill synthesizes the spec, **shows you a preview + drafted test, and asks you to confirm** before spending tokens.
- **Structured flags (power users):** `/experiment run --goal "…" --variants A,B --agents claude,opencode --repeats N`.

**This skill is a THIN wrapper (D-09).** It shells to three existing CLIs and
reimplements NO runner, serialization, or comparison logic:

- `scripts/experiment-write-spec.mjs` — builds, validates, and persists the spec YAML to
  `config/experiments/gen-<id>.yaml` (so it lists in the dashboard Launch listbox + is re-launchable).
- `scripts/experiment-run.mjs` — runs the matrix (spec-file driven; RUN-02/03/04, Phase 78).
- `scripts/experiments-compare.mjs` — aggregates + ranks the Runs and writes the report JSON.

The ONLY skill-side computation is re-deriving the `task_hash` (the sha256 the runner itself
computes at close) so the run→compare handoff is mechanically closed — no manual lookup, no
scraping of runner stdout.

> **DO NOT pre-solve the task. The analysis IS the experiment.** The whole point is to compare
> how each agent *independently* investigates and solves the task, in its own isolated sandbox.
> The orchestrator's job is to turn the user's description into a `GOAL_SENTENCE` and run the
> matrix — **never** to read the codebase, locate the bug, design the fix, or otherwise do the
> work before running. Doing so contaminates the comparison (you'd be feeding one agent's answer
> to all cells) and defeats the purpose. Write the goal from **symptoms + the observable
> deliverable** the user described (e.g. "the REC indicator wrongly toggles between black and
> green — make it stable"), optionally with a one-line orienting pointer the user themselves gave,
> and let each cell do its own analysis. If you catch yourself grepping the target code to "craft a
> better goal," stop — that is the cells' job.

> **Parallel is the default execution mode.** Run cells concurrently (Step 4) unless the user
> explicitly asks for serial/sequential execution, or the matrix includes an agent whose tokens
> must be measured and that agent is ambient-slot-bound (opencode / mastracode — see Step 4). Only
> then fall back to serial.

## Instructions

**Goal**: From either a plain-English description or `run --goal "<sentence>" --variants A,B
--agents claude,opencode --repeats N`, synthesize a classified + baselined spec YAML, run the matrix
via `experiment-run.mjs --spec`, compute the concrete `task_hash`, and auto-run
`experiments-compare.mjs --task-hash "$TASK_HASH"`.

### Step 0: Detect the mode (flags vs. natural language)

Inspect `$ARGUMENTS`:

- If it **begins with `run `** (after trimming) **and contains `--goal`** → **structured mode**.
  Go straight to **Step 1** (the flag parser) — the natural-language path is skipped entirely.
- **Otherwise** → **natural-language mode**. The whole `$ARGUMENTS` is a prose description of the
  experiment. Run **Step 0-NL** to synthesize the same values the flag parser produces
  (`GOAL_SENTENCE`, the variant list, `REPEATS`, `TASK_CLASS`, `SNAPSHOT_ID`, `RANK_BY`, and a
  drafted `TEST_COMMAND`), get operator confirmation, then continue at **Step 2** (spec synthesis)
  with those values. Steps 2–5 are shared by both modes and are NOT reimplemented.

Empty `$ARGUMENTS` (a bare `/experiment`) → briefly show both usages and stop; do not spend tokens.

### Step 0-NL: Synthesize the spec from a plain-English description

Apply these deterministic rules so every agent behaves identically. This is **spec synthesis only**
(prose → the same YAML the flag path writes); it adds NO runner or comparison logic.

1. **`GOAL_SENTENCE`** — rewrite the prose into ONE precise, self-contained imperative sentence that
   names the concrete deliverable and any acceptance details the user gave (file names, function
   signatures, expected outputs). **This exact string is the `task_hash` source** (Step 3), so keep
   it stable and free of shell metacharacters (same refuse-list as Step 1: `;` `` ` `` `$(` `&&` `|`
   and literal newlines).

2. **Variants (agent × model)** — map every agent named in the prose to a member of the known set
   `claude | copilot | opencode | mastracode` (`lib/experiments/experiment-spec.mjs` `KNOWN_AGENTS`).

   **Resolve the model ONCE, per agent, with the shared resolver — never hand-formulate the three
   spellings.** The user names a model ONE way ("opus 4.8", "Sonnet 4.6", "claude-opus-4.8", …); the
   same model is spelled differently by each agent's CLI/catalog (hyphenated for claude, dotted for
   copilot, `rapid-proxy/…` dotted for opencode). `lib/experiments/model-resolve.mjs` does the mapping:

   ```bash
   # Emit the per-agent model string for whatever the user said. Prints e.g.
   #   claude-opus-4-8   (claude) | claude-opus-4.8 (copilot) | rapid-proxy/claude-opus-4.8 (opencode)
   node -e 'import("./lib/experiments/model-resolve.mjs").then(m =>
     process.stdout.write(m.resolveModelForAgent(process.argv[1], process.argv[2]) || ""))' <agent> "<user model ref>"
   ```

   Call it for each agent when building `VARIANTS_JSON` (Step 2). It accepts `opus 4.8`, `opus-4.8`,
   `claude-opus-4.8`, `claude-opus-4-8` — all equivalent — and returns `null` for a non-Claude ref
   (e.g. `gpt-4o`), in which case keep the user's raw string. This is why the dotted/hyphenated model
   chaos no longer needs to be spelled out per agent: **say the model once, resolve per agent.**

   Notes: pin the concrete version, not a bare `sonnet`/`opus` alias — the alias floats to the latest
   in-tier model and silently breaks version parity across the cells (the resolver always pins a
   concrete `<major>-<minor>`/`<major>.<minor>`). Default model when the prose names none:
   `claude-sonnet-4-6` (claude) / `rapid-proxy/claude-sonnet-4.6` (opencode).

   - **If no agent is named, default to two variants: `claude` + `opencode`**, both on `sonnet 4.6`
     (resolved per agent) — the two RUN-verified drivable agents.
   - Each variant is `{ agent, model, framework: straight, env: default }` unless the prose asks for
     a different framework/env. **Drop any `UNSUPPORTED_COMBINATIONS`** (e.g. `copilot`+`headless`,
     "Copilot headless drivability is unproven") and note the drop in the preview.
   - If the prose describes a model/framework sweep for one agent (e.g. "claude with opus and
     sonnet"), emit one variant per combination.

3. **`REPEATS`** — parse "run each N times", "N repeats", "N runs"; **default `1`**. Must be a positive integer.

4. **`TASK_CLASS`** — derive with the zero-LLM keyword scorer
   `deriveClassFromText(GOAL_SENTENCE, taxonomy)` (`lib/experiments/taxonomy.mjs`; taxonomy from
   `config/task-taxonomy.yaml`). Quick host-side derivation:

   ```bash
   TASK_CLASS=$(node -e '
     import("./lib/experiments/taxonomy.mjs").then(m => {
       const tax = m.loadTaxonomy();
       const { taskClass, confident } = m.deriveClassFromText(process.argv[1], tax);
       process.stdout.write((confident && taskClass) ? taskClass : "");
     });' "$GOAL_SENTENCE")
   ```

   - If the scorer returns a **confident** class → use it.
   - If not confident (empty above) → **you** pick the best-fitting closed-6 member
     (`refactor | bugfix | new-feature | migration | debug | docs`) from the prose; if genuinely
     ambiguous → `new-feature`.
   - The value MUST pass `isValidClass` (it will, if it is one of the closed-6). **Never emit an
     invalid/`unclassified` class** — that quarantines every Run and renders the Comparison tab EMPTY
     (see Step 2's warning).

5. **`TEST_COMMAND` (the objective gate) — draft, then confirm.** The gate is what makes variants
   *rankable* (it drives the honesty spine: ranked vs. failed vs. **ungated**).
   - If the goal implies a checkable outcome (a function that returns X, a file with contents Y, a
     bug that a test now catches), **draft a fixed-argv test command** — typically
     `node --test <name>.test.mjs` — with NO shell metacharacters. Do NOT invent brittle assertions;
     draft the smallest deterministic check that proves the goal.
   - If the goal implies nothing objectively checkable, set `TEST_COMMAND` empty → **ungated** (the
     variant will show in the `ungated` group, compared on tokens/wallclock only, never cost-ranked).

6. **`SNAPSHOT_ID`** default `smoke-spec`; **`RANK_BY`** default `composite` (override only if the
   prose asks to rank by `tokens` / `wallclock` / `score`).

### Step 0-NL confirmation gate (mandatory before spending tokens)

Present a compact preview, then confirm with **AskUserQuestion** — never run the matrix silently:

```
Experiment (from your description)
  goal:      <GOAL_SENTENCE>
  variants:  claude / sonnet          (framework=straight, env=default)
             opencode / rapid-proxy/claude-haiku-4-5
  repeats:   <N>          task_class: <class>          snapshot: <SNAPSHOT_ID>
  test gate: <TEST_COMMAND>            (or: "ungated — no objective test")
  rank by:   <RANK_BY>
```

Offer these options:

- **Run it** — proceed to Step 2 with the drafted values (including the test gate).
- **Run ungated** — proceed, but drop `TEST_COMMAND` (variants land in the `ungated` group).
- **Edit** — the operator corrects any field in free text; re-derive and re-preview, then re-confirm.

On **Run it / Run ungated**, fall through to **Step 2** using `GOAL_SENTENCE`, the variant list,
`REPEATS`, `TASK_CLASS`, `SNAPSHOT_ID`, `TEST_COMMAND`, `RANK_BY`. (Structured mode reaches Step 2
with the same variables via Step 1.)

### Step 1: Parse and validate the operator flags (structured mode)

Parse from `$ARGUMENTS`:

- `--goal "<sentence>"` — the full goal sentence. **This is the task_hash source** (Step 3).
- `--variants A,B,...` — comma-separated variant names (one matrix column each).
- `--agents claude,opencode,...` — comma-separated agents, paired positionally with `--variants`
  (or a single shared agent applied to every variant).
- `--repeats N` — positive integer; how many times each variant×repeat cell runs.
- `--task-class <c>` — the closed-taxonomy class (see Step 2). **Default `new-feature`** if omitted.
- `--snapshot-id <id>` — the restore baseline (see Step 2). **Default `smoke-spec`** if omitted.
- `--rank-by composite|tokens|wallclock|score` — passed through to the compare step (default `composite`).

**Argv-safety (T-80-02-01, threat model).** Reject shell metacharacters in `--goal`,
`--variants`, and `--agents` BEFORE they become the goal_sentence / spec fields. Refuse any of
`;`  `` ` ``  `$(`  `&&`  `|`  and a literal newline. Never interpolate operator strings into a
shell command line — pass each flag value as a discrete argv element to `node scripts/*.mjs`
(no `sh -c "... $goal ..."`). This mirrors the spec's "fixed argv, no shell meta" test_command
discipline.

### Step 2: Synthesize a classified + baselined spec YAML

**Shared by both modes.** Use the resolved values from Step 1 (flags) or Step 0-NL (prose):
`GOAL_SENTENCE`, the variant list, `REPEATS`, `TASK_CLASS`, `SNAPSHOT_ID`, `TEST_COMMAND`. In
natural-language mode these were already operator-confirmed in the Step 0-NL gate, so write the spec
without re-asking.

**Persist the spec via the code serializer — do NOT hand-author the YAML.** Call
`scripts/experiment-write-spec.mjs`, which BUILDS the spec, VALIDATES it through the SAME
`resolveExperimentSpec` the dashboard listbox (`handleSpecList`) and launch gate
(`handleExperimentRun`) use, and WRITES it to `config/experiments/gen-<experiment_id>.yaml`
(path-safe via `sanitizeTaskId`, `gen-` prefix marks it auto-generated so it's distinguishable
from curated specs in the listbox). This guarantees the experiment appears in the **Launch
experiment** listbox and is one-click re-launchable — the prior prose-authored YAML had no such
guarantee. Capture the printed path into `SPEC_FILE`:

```bash
# EXPERIMENT_ID: path-safe [A-Za-z0-9._-] (e.g. "compare-fizzbuzz-v10"). VARIANTS_JSON: one
# object per cell. --test-command optional (omit for an ungated run). Prints the spec path.
SPEC_FILE=$(node scripts/experiment-write-spec.mjs \
  --experiment-id "$EXPERIMENT_ID" \
  --goal "$GOAL_SENTENCE" \
  --snapshot-id "${SNAPSHOT_ID:-smoke-spec}" \
  --task-class "${TASK_CLASS:-new-feature}" \
  --repeats "${REPEATS:-1}" \
  ${TEST_COMMAND:+--test-command "$TEST_COMMAND"} \
  --variants "$VARIANTS_JSON")
# VARIANTS_JSON — build each `model` with resolveModelForAgent(agent, ref) (point 2 above). Example
# for the ref "sonnet 4.6" across three agents (the resolver emits these; do NOT hand-type them):
#   [{"agent":"claude","model":"claude-sonnet-4-6","framework":"straight","env":"default"},
#    {"agent":"opencode","model":"rapid-proxy/claude-sonnet-4.6","framework":"straight","env":"default"},
#    {"agent":"copilot","model":"claude-sonnet-4.6","framework":"straight","env":"default"}]
# The resolver handles the per-agent spelling (hyphenated claude id / dotted copilot id / dotted
# rapid-proxy opencode id) so you never formulate "with hyphen / without / with prefix" by hand.
# It always PINS a concrete version (never the floating `sonnet`/`opus` alias, which would run a
# DIFFERENT model per cell and break cross-agent parity).
# MODEL TIER for agentic tasks: prefer sonnet+ for the opencode/copilot cells. Verified (2/2 each)
# that claude-haiku-4.5, under opencode's heavy agentic context (full system prompt + many tools),
# NARRATES its plan instead of emitting tool_use — opencode's single-turn `run` then ends with no
# files (gate_passed=False). haiku tool-calls fine with a trivial single tool, so it's an
# agentic-robustness-under-load gap, not raw capability. sonnet-4.6 tool-calls reliably.
```

The serializer **rejects** (non-zero exit, nothing written) an unknown agent, an empty variant
list, a missing goal, or a non-closed-6 `task_class` — so a broken spec never reaches the run.
If it exits non-zero, surface the error and stop; do not fall back to hand-writing YAML.

**task_class MUST be a member of the closed-6** (`lib/experiments/taxonomy.mjs` CLOSED_6):

```
refactor | bugfix | new-feature | migration | debug | docs
```

Use the resolved `TASK_CLASS` — from `--task-class` (structured mode) or the Step 0-NL derivation
(prose mode); **if absent, default deterministically to `new-feature`**. If the value is NOT a
closed-6 member, **reject the command** — do not emit the spec. An absent/invalid task_class makes
every Run quarantine as `unclassified` (pending), which is hidden from the default dashboard runs
query → the Comparison tab renders **EMPTY** (a silent success-criterion-3 failure). So NEVER emit a
spec without a valid closed-6 class.

Likewise `snapshot_id` must be a **resolvable** baseline — default to `smoke-spec` (the baseline
`compare-fizzbuzz.yaml` uses); never leave it blank.

### Step 3: Compute the concrete task_hash (closes the run→compare loop)

The runner derives `task_hash = sha256(goal_sentence)` hex at close
(`scripts/measurement-stop.mjs:805-806`):

```js
crypto.createHash('sha256').update(span.goal_sentence).digest('hex')
```

The skill already OWNS the goal_sentence (it wrote it into the spec in Step 2), so it computes the
SAME value deterministically — store-free, no open store, CONSTANT across every cell of the matrix
(all cells share one goal_sentence):

```bash
TASK_HASH=$(printf '%s' "$GOAL_SENTENCE" | shasum -a 256 | awk '{print $1}')
# or, equivalently:
TASK_HASH=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$GOAL_SENTENCE")
```

**Do NOT scrape the hash from `experiment-run.mjs` output** — that CLI prints per-cell `task_id`
(`expId--slug--rN`, to stderr), a DIFFERENT key. It NEVER prints `task_hash`.

**Belt-and-braces fallback (only if the skill's goal_sentence could ever diverge from the runner's
`span.goal_sentence` — it should not, same string):** after the matrix completes, read the newest
Run's persisted `metadata.task_hash` via `readRuns` (`lib/experiments/query.mjs`); all cells share
one task_hash. Prefer the direct sha256 — no open store needed.

### Step 4: Run the matrix (UNATTENDED — parallel by default)

**Watch it in the dashboard.** Run through the **Performance tab of the running health dashboard** so
the live mini-terminal grid is visible. Ensure the dashboard is up (spin it up if not), open it
**visibly** on Performance, then launch with a `--run-dir` so `progress.json` + per-cell logs exist —
the Run monitor **auto-attaches** to the active run and streams the mini-terminals (no Launch click
needed; auto-attach is `GET /api/experiments/active-run`, added Phase 90):

```bash
# 1) Dashboard up + visible on the Performance tab.
if ! curl -sf -m 3 http://localhost:3032 >/dev/null 2>&1; then
  (cd docker && docker compose up -d coding-services) >/dev/null 2>&1 || true
  for i in $(seq 1 30); do curl -sf -m 2 http://localhost:3032 >/dev/null 2>&1 && break; sleep 2; done
fi
open "http://localhost:3032/performance" >/dev/null 2>&1 || true   # visible in the operator's browser

# 2) Launch parallel (default) with a run-dir so the monitor auto-attaches.
RUN_ID="r$(date +%s | tail -c 9)"   # ≤12-char id (vkb-server _validRunId)
node scripts/experiment-run.mjs --spec "$SPEC_FILE" \
  --repeats <N> --task-class <class> --parallel \
  --run-id "$RUN_ID" --run-dir ".data/experiments/runs/$RUN_ID"
```

Pass `--task-class` through so the runner classifies the Runs (belt-and-braces with the spec field).
`--max-parallel N` (1–8, default 4) caps concurrency if needed. Do NOT launch via a hidden/automation
browser (e.g. gsd-browser) when the operator wants to watch — the Run monitor renders in whatever tab
sees the active run, and auto-attach makes the operator's own dashboard show it.

**All agents route their LLM calls through the shared rapid-proxy** (`:12435`) — that is how every
cell's tokens are captured at all; it is NOT special to any one agent, so don't single one out for
"goes through the proxy." What differs per agent is only *how each proxy row is bound to the cell's
`task_id`*, and that binding is what parallel mode stresses:

| Agent | token→cell binding | measured in parallel? |
|-------|--------------------|-----------------------|
| claude | per-request `x-task-id` header | ✅ yes |
| copilot | per-request task-scoped adapter path | ✅ yes |
| opencode | rows carry opencode's own session id | ❌ needs the serial slot |
| mastracode | rows land `task_id=''` | ❌ needs the serial slot |

**When to run SERIAL instead** (drop `--parallel`): only when the matrix includes **opencode** or
**mastracode** *and* you need their **token** numbers. Their rows aren't per-request bound, so only
the serial global `active-measurement.json` slot re-stamps them with the cell's `task_id`. In
**parallel** mode there is no global slot, so those cells still run and are **rubric-scored on their
diff** (goal/quality/coverage) but report **0 tokens (unmeasured)** on the cost axis. If the
comparison is about the *fix* (not cost), parallel is fine; if you need opencode/mastracode **cost**,
run serially. State which you chose and why in the preview.

**RUN UNATTENDED.** In **parallel** mode spans are slotless (per-cell), so there is no global slot for
a stray call to be mis-stamped into — but still kick this off standalone. In **serial** mode a cell
opens the ambient `active-measurement.json` span the shared host proxy reads to stamp any *unbound*
`token_usage.task_id`, so a concurrent main-session LLM call in THIS repo could be mis-stamped with
the cell's task_id. Either way: do not drive the matrix from an interactive agent working the same repo.

Env knobs the runner honours (surface if the operator needs them): `CODING_REPO`,
`LLM_PROXY_DATA_DIR`, `LLM_PROXY_PORT`, `CODING_PROXY_ROUTE`.

### Step 5: Auto-compare with the concrete task_hash

```bash
node scripts/experiments-compare.mjs --task-hash "$TASK_HASH" --rank-by <rank_by>
```

`$TASK_HASH` is the real 64-char hex from Step 3 — **never a `<placeholder>`**. This prints the
ranked variant table AND writes `.data/experiments/reports/$TASK_HASH.json` — the SAME file the
dashboard Comparison tab reads live (closes the D-04↔D-07 loop; success-criterion 3). The compare
CLI re-validates the hash via `sanitizeTaskHash` (allowlist regex) before it becomes the report
filename, so a malformed hash is rejected, not written (T-80-02-04).

## Agent quirks (D-09) — when driving this skill from a non-Claude agent

- **Copilot**: hooks must use the `{version:1,hooks:{...}}` schema with `type`/`bash` fields
  (NOT `command`/`args`), and must NOT put `$CODING_REPO` in `cwd` (ENOENT). See memory
  `feedback_copilot_hook_schema`.
- **OpenCode**: headless invocation needs `--dangerously-skip-permissions`. See memory
  `reference_uniform_token_capture_agents`.

## Thin-wrapper discipline

This skill shells to `scripts/experiment-run.mjs` and `scripts/experiments-compare.mjs` and
reimplements NO runner or comparison logic. The only skill-side computation is re-deriving the
sha256 the runner already computes — that is NOT comparison logic. Natural-language mode adds only
*spec synthesis* (prose → the YAML the flag path already writes) and reuses the repo's own
`deriveClassFromText` scorer for classification — still no runner/comparison logic. There are no
package installs (`npm`/`pip`/`cargo`); it uses stdlib sha256 (`shasum` / `node:crypto`) only.

---

**Begin at Step 0 (detect mode). Natural language → Step 0-NL (synthesize + confirm) → Step 2.
Flags → Step 1 → Step 2. Both modes share Steps 2–5.**

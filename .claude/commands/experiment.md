---
description: Declare + run a cross-agent experiment matrix, then auto-compare and render the ranked variant table
argument-hint: run --goal "…" --variants A,B --agents claude,opencode --repeats N [--task-class new-feature] [--snapshot-id smoke-spec] [--rank-by composite]
---

# Experiment (/experiment) — declare → run → compare in one command

Wrap the full cross-agent experiment flow as a single operator command: synthesize a
spec from headline flags, run the whole matrix, then auto-compare the variants and print
the ranked table (and write the report JSON the dashboard Comparison tab reads live).

**This skill is a THIN wrapper (D-09).** It shells to the two existing CLIs and
reimplements NO runner or comparison logic:

- `scripts/experiment-run.mjs` — runs the matrix (spec-file driven; RUN-02/03/04, Phase 78).
- `scripts/experiments-compare.mjs` — aggregates + ranks the Runs and writes the report JSON.

The ONLY skill-side computation is re-deriving the `task_hash` (the sha256 the runner itself
computes at close) so the run→compare handoff is mechanically closed — no manual lookup, no
scraping of runner stdout.

## Instructions

**Goal**: Given `run --goal "<sentence>" --variants A,B --agents claude,opencode --repeats N`,
synthesize a classified + baselined spec YAML, run the matrix via `experiment-run.mjs --spec`,
compute the concrete `task_hash`, and auto-run `experiments-compare.mjs --task-hash "$TASK_HASH"`.

### Step 1: Parse and validate the operator flags

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

Write a spec to `config/experiments/<derived-id>.yaml` (derive `<derived-id>` from a path-safe
allowlist — `[A-Za-z0-9._-]` only — so no operator string can traverse out of `config/experiments/`;
T-80-02-02). Mirror the fully-populated `config/experiments/compare-fizzbuzz.yaml` shape:

```yaml
version: 1
experiment_id: <derived, path-safe id>
snapshot_id: smoke-spec            # RESOLVABLE baseline (from --snapshot-id; default smoke-spec).
                                   # An absent/unresolvable snapshot → no restore baseline for the cells.
goal_sentence: "<the exact --goal string>"   # ← the task_hash source (sha256 of THIS string)
repeats: <N>
task_class: new-feature            # MUST be a member of the closed-6 taxonomy (below)
test_command: "node --test <yourtest>.test.mjs"   # score-time gate, fixed argv, NO shell meta
variants:
  - { agent: claude,   model: sonnet,                        framework: straight, env: default }
  - { agent: opencode, model: rapid-proxy/claude-haiku-4-5,  framework: straight, env: default }
  # one entry per --variants/--agents pair
```

**task_class MUST be a member of the closed-6** (`lib/experiments/taxonomy.mjs` CLOSED_6):

```
refactor | bugfix | new-feature | migration | debug | docs
```

Take it from `--task-class`; **if omitted, default deterministically to `new-feature`**. If the
supplied value is NOT a closed-6 member, **reject the command** — do not emit the spec. An
absent/invalid task_class makes every Run quarantine as `unclassified` (pending), which is hidden
from the default dashboard runs query → the Comparison tab renders **EMPTY** (a silent
success-criterion-3 failure). So NEVER emit a spec without a valid closed-6 class.

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

### Step 4: Run the matrix (UNATTENDED)

```bash
node scripts/experiment-run.mjs --spec config/experiments/<derived-id>.yaml \
  --repeats <N> --task-class <class>
```

Pass `--task-class` through so the runner classifies the Runs (belt-and-braces with the spec field).

**RUN UNATTENDED** (one-global-span caveat): each cell opens ONE global `active-measurement.json`
span slot that the shared host proxy reads to stamp `token_usage.task_id`. Any concurrent
main-session LLM call in THIS repo while a cell is open would be mis-stamped with the cell's
task_id. Kick this off standalone — do not drive it from an interactive agent working the same repo.

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
sha256 the runner already computes — that is NOT comparison logic. There are no package installs
(`npm`/`pip`/`cargo`); it uses stdlib sha256 (`shasum` / `node:crypto`) only.

---

**Begin by parsing `$ARGUMENTS` (Step 1), then synthesize the classified spec (Step 2).**

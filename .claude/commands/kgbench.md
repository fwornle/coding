---
description: Run, resume, regrade and report the kgbench code-retrieval benchmark (coding-v1) across retrieval arms, agents and models — and diagnose the routing that decides which model actually answers
argument-hint: run [--set coding-v1] [--arms grep,graphify,codegraph,hybrid] [--only A1,A2] [--reps N] [--run-id ID]  |  status  |  report  |  regrade [--rejudge --only ID]  |  doctor
---

# kgbench (/kgbench) — run, resume, grade and diagnose the retrieval benchmark

Operator front-end for the `coding-v1` code-retrieval benchmark: which retrieval strategy
answers questions about *this* repository best, at what token and latency cost.

**This skill is a THIN WRAPPER.** It shells to existing CLIs and reimplements no runner,
grader, judge or report logic:

| Script | Role |
|---|---|
| `scripts/kgbench-supervise.sh` | detached, self-resuming matrix supervisor |
| `scripts/kgbench-run.mjs` | the matrix itself (`--set --arms --only --reps --run-id`) |
| `scripts/kgbench-regrade.mjs` | re-apply graders offline; `--rejudge` re-runs the judge |
| `scripts/kgbench-report.mjs` | render `README.md` + `report.json` |
| `scripts/kgbench-charts.mjs` | render the SVG figures |
| `scripts/kgbench-verify-questions.mjs` | validate questions and every evidence `file:line` |

**Read [docs/benchmarks/measurement-lessons.md](../../docs/benchmarks/measurement-lessons.md)
before changing a question, a matcher or an answer key.** It records defects that cost a
full investigation each, and one blind spot that makes the obvious diagnosis wrong.

---

## Step 0 — always launch detached

A full matrix runs for hours and was twice killed part-way with no error, because a
supervising task manager signalled the process group. **Never** run `kgbench-run.mjs`
directly in the foreground for a full matrix. Use the supervisor, which re-execs itself
under `nohup` and resumes only after a *signal* death:

```bash
scripts/kgbench-supervise.sh --run-id coding-v1-r8 --set coding-v1 --reps 3 \
                             --deepen A1,A2,A3,A4 --deepen-reps 10
```

It returns immediately with a pid, a log path and a status path. It refuses to
double-launch the same `--run-id`.

**It does not retry a refusal.** kgbench exits 2 when it declines to run — preflight
failure, containment leak, three consecutive API errors — and those must never be retried:
a supervisor that restarts through them turns a loud refusal into a quiet infinite loop.

Cell arithmetic, which is easy to get wrong: a `--deepen` pass **replaces** the base pass's
cells for those questions, it does not add to them. 16 questions × 4 arms × 3 reps with
A1–A4 deepened to 10 reps is `12×4×3 + 4×4×10 = 304` cells, not 352.

## Step 1 — `run`

```
/kgbench run [--set coding-v1] [--arms ...] [--only L1,A4] [--reps N] [--run-id ID]
             [--agents claude,copilot,opencode] [--models ...]
```

Before spending hours, do the cheap checks in this order:

1. `node scripts/kgbench-run.mjs --set <set> --preflight-only` — every arm's MCP server and
   index. A down server is indistinguishable from a backend that answers badly, and a whole
   matrix under that condition is worthless.
2. `node scripts/kgbench-verify-questions.mjs --set <set>` — every evidence `file:line`.
3. **Index freshness.** The graph backends index the real repo, not the sandbox. Confirm
   nothing indexed has changed since the graph was built:
   ```bash
   node -e "console.log(JSON.parse(require('fs').readFileSync('.data/graphify/graphify-out/graph.json','utf8')).built_at_commit)"
   git diff --name-only <that-commit>..HEAD | grep -vE '^(docs/|\.data/|config/kgbench/|lib/kgbench/|scripts/kgbench-|tests/)'
   ```
   Empty output means the indexed tree is unchanged and a reindex would be a no-op. Note
   edges live under `links` in `graph.json`, not `edges` — reading the wrong key makes a
   healthy graph look empty.
4. `/kgbench doctor` — see below. Confirms which model will actually answer.

Commit any question or grader change **first**, so `run.json` records a real commit rather
than `dirty: true`.

## Step 2 — `status`

```bash
RUN=.data/kgbench/runs/<runId>
head -1 $RUN/supervise.status;  grep -c . $RUN/results.jsonl;  tail -4 $RUN/supervise.log
```

Report cells done, outcome tally, and any `host_stalled`.

**`host_stalled` is not a slow arm.** A 300 s timer that fires after 1000 s means the host
was starved (corporate AV scanning the 5,000-file worktrees is the known cause). Those cells
carry `score: null` and are excluded by design. Re-run them once load drops — and note that
resume keys on `arm|id|rep` regardless of outcome, so a voided row must be **removed** from
`results.jsonl` first or it will be skipped as already done. Keep a backup beside it.

When watching a long run, filter for terminal states *and* failure signatures, not just the
happy path. And scope the watch to lines appended since it armed — `supervise.log` is
append-only across passes, so a naive grep replays old stalls as if they were new.

## Step 3 — `report`

```bash
node scripts/kgbench-report.mjs --run <runId> --out /tmp/kgb/README.md
node scripts/kgbench-charts.mjs --run <runId> --out docs/images
cp /tmp/kgb/{README.md,report.json} docs/benchmarks/coding-v1/
```

Check before publishing, using the run's own data rather than by eye:

- **Provenance**: how many commits, which passes, which questions in each. This section has
  been wrong before precisely because it is the section nobody re-reads.
- **Secondary scorer**: is `judge.served` present and equal to `judge.requested`?
- **Disagreements**: cause identified for each — *not assumed to be the question*.

## Step 4 — `regrade`

Answers are stored in full so grading can be redone offline. A scoring fix should cost one
pass over a file, never a re-run.

```bash
node scripts/kgbench-regrade.mjs --run <runId> --dry-run                    # ALWAYS first
node scripts/kgbench-regrade.mjs --run <runId>                              # checklist only
node scripts/kgbench-regrade.mjs --run <runId> --rejudge --only L2          # key changed
```

Three rules, each learned by breaking it:

- **`--dry-run` first, every time.** It shows the blast radius. One matcher change looked
  local and silently cost S2 a required fact in all 12 of its cells.
- **A key change obliges `--rejudge`**, because the judge's prompt is built from the
  checklist. Regrading alone leaves the judge scoring the old key and manufactures
  disagreements. **Scope it with `--only`** — re-judging untouched questions regenerates
  good scores with a non-deterministic model.
- **A defect that moves every arm identically is a grader bug, not a finding.** Arms differ;
  graders apply uniformly.

Never select cells to re-judge on `judge_score == null`. Abstain (T-class) questions have no
checklist and are **never judged by design**, so they look identical to a judge failure. The
real predicate is `judge_pending === true`.

## Step 5 — `doctor`

The payoff of a long investigation. Prints, for each relevant process, the model the proxy
**actually serves** — which is not what the code requests:

```bash
for p in kgbench-judge; do
  curl -s -X POST http://127.0.0.1:12435/api/complete -H 'Content-Type: application/json' \
    -d "{\"process\":\"$p\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply OK.\"}]}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('$p ->', d.get('model'), d.get('provider'), d.get('error',''))"
done
scripts/configure-wave-analysis-routing.sh --show | grep kgbench
```

Then also run `--preflight-only` and the question verifier, and report all three together.

**Why this exists** — three facts that invalidate the obvious mental model:

1. `/api/complete` **ignores the request-body `model`.** Only `processOverrides`, keyed on
   the `process` literal, select a model.
2. The **`claude-code` path ignores model selection entirely** and serves
   `claude-haiku-4-5`, even with an override naming `claude-opus-4.6`. Only `copilot`
   honours the model.
3. **`providerModels` advertises models the provider rejects** — it lists
   `claude-opus-4.6` for copilot, which answers `400 The requested model is not supported`.

So the judge silently ran on haiku through runs r6 and r7 while `run.json` published
`claude-opus-4.8`, a model no provider serves. Install routing with
`scripts/configure-wave-analysis-routing.sh` rather than a manual PUT, so it survives a
`.data/` wipe. If `doctor` reports a model you did not ask for, fix the override before
trusting a single number.

---

## Guardrails

- **Never** foreground a full matrix (Step 0).
- **Never** publish without checking `judge.served` and the Provenance table against the data.
- **Never** retire a question for scoring badly — only for a false premise. Retiring on
  score is selection and inflates whichever arm you were hoping for.
- **Never** widen a single regex to fix a phrasing failure. Normalisation belongs once, in
  `lib/kgbench/graders.mjs`, and applies to literal needles only — folding the haystack
  breaks author-written `regex`/`near` patterns.
- Grader changes must keep `tests/integration/kgbench-graders.test.js` green:
  ```bash
  NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/integration/kgbench-graders.test.js
  ```

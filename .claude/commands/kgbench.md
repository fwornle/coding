---
description: Run, resume, regrade and report the kgbench code-retrieval benchmark (coding-v1) across retrieval arms, agents and models — and diagnose the routing that decides which model actually answers. Also covers the Performance → Benchmarks dashboard sub-tab, the second front-end over the same scripts.
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
| `scripts/kgbench-report.mjs` | render `RESULTS.md` + `report.json` (refuses to clobber hand-written files) |
| `scripts/kgbench-charts.mjs` | render the SVG figures |
| `scripts/kgbench-verify-questions.mjs` | validate questions and every evidence `file:line` |
| `scripts/kgbench-backfill-tokens.mjs` | re-resolve token fields offline; refuses a window narrower than the cell |
| `scripts/kgbench-repair-attempt-windows.mjs` | transitional: reconstruct per-attempt windows on runs recorded before the runner wrote them |

**Read [docs/benchmarks/measurement-lessons.md](../../docs/benchmarks/measurement-lessons.md)
before changing a question, a matcher or an answer key.** It records defects that cost a
full investigation each, and one blind spot that makes the obvious diagnosis wrong.

## Two front-ends, one benchmark

There is also a **Performance → Benchmarks** sub-tab at
[localhost:3032/performance](http://localhost:3032/performance). It is a second front-end
over the *same* scripts, not a second implementation: its launcher shells to
`kgbench-supervise.sh` on the host, and its results view renders what
`lib/kgbench/report.mjs` produces — the function `kgbench-report.mjs` calls. A number shown
there and a number in the published report can differ only because the data changed.

| | CLI (`/kgbench`) | Dashboard |
|---|---|---|
| run / resume | ✅ | ✅ (`Launch`, and a resume offer when the id has cells) |
| watch a run | `status` | ✅ live monitor + supervisor log tail |
| cancel a run | Ctrl-C, or kill the group | ✅ `Cancel` |
| results | `report` → `RESULTS.md` | ✅ live aggregate, and the published artefacts |
| **regrade / rejudge** | ✅ | ❌ — CLI only, deliberately (Step 4) |
| **publish** | ✅ | ❌ — CLI only (Step 3) |
| doctor | ✅ | partial: a model probe, not the judge probe (Step 5) |

Use whichever fits. The dashboard is better for starting a run and watching it; the CLI is
the only way to regrade or publish, and those are the operations that need `--dry-run` and a
commit anyway.

**One run at a time — and the guard is one-sided.** The dashboard refuses to launch while any
kgbench run is live (it scans every run dir for a live supervisor). `kgbench-supervise.sh`
has no such check: it only refuses to double-launch *the same* `--run-id`. So a CLI launch
will happily start a second concurrent matrix on top of a dashboard run, and the two will
interleave their cells' token attribution and fight over the measurement slot. Before
launching from the CLI, check nothing is already running:

```bash
curl -s localhost:3032/api/kgbench/active-run     # {"runId":null} when the coast is clear
```

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

The dashboard's `Launch` button runs exactly this, on the host via the coordinator seam —
there is no second launch path to keep in sync. Two consequences worth knowing:

- The pid it reports is the **supervisor's**, read from `supervise.pid`, not the process it
  spawned. The wrapper invocation exits within milliseconds having re-exec'd itself under
  `nohup`, so a pid taken from the spawn would be dead on arrival.
- A dashboard run therefore survives everything the CLI's does — closing the tab, a
  `docker-compose restart coding-services`, a signal death (it resumes). Verified, not assumed.

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

**The dashboard monitor** shows the same thing without the shell: overall state, cells done
against the expected total, and a per arm×agent×model grid with mean score and hard-fail
count. It auto-attaches to whatever is running, so a matrix launched from the CLI appears
there too. Its `Supervisor log` toggle tails `supervise.log` — reach for it whenever the cell
count is not moving, because a preflight refusal and a slow first cell look identical in the
grid (the first cell builds a worktree, which takes about a minute before anything is written).

**One status value the CLI never writes: `cancelled:`.** The supervisor updates
`supervise.status` only at pass boundaries and its EXIT trap removes the lock without touching
it, so a group-kill would otherwise leave `running` on disk forever and every reader would
call a dead run live. The dashboard's `Cancel` patches the terminal status itself. If you kill
a run by hand, write it yourself or the run keeps reporting as active:

```bash
echo "cancelled: killed by hand $(date -u +%FT%TZ)" > .data/kgbench/runs/<runId>/supervise.status
```

Cancelling sends SIGTERM to the whole process group, which is what lets the runner clean up
its worktree — a SIGKILL leaks one, and `git worktree prune` cannot reclaim it because its
directory still exists.

## Step 3 — `report`

**Two files, two owners.** `RESULTS.md` is generated and may be re-rendered at will.
`README.md` is hand-written analysis built around those numbers — the charts, the question
set, the measurement defects — and **nothing regenerates it**.

**The dashboard reads, it does not publish.** Its results view offers two sources and labels
which one you are looking at, because they answer different questions:

- **live aggregate** — a run's rows aggregated *now*, straight from `results.jsonl`. Use it
  to see a matrix before anyone has published it, and to see the effect of a regrade.
- **published artefact** — the committed `docs/benchmarks/<name>/report.json` that the
  README's prose was written around.

They can legitimately differ: a regrade moves the live numbers and leaves the document alone.
That gap is the signal to re-render and update the prose — the commands below — and telling
the two apart is the difference between "the docs are stale" and "someone is wrong". Nothing
in the dashboard writes to `docs/`.

```bash
node scripts/kgbench-report.mjs --run <runId> --out docs/benchmarks/coding-v1/RESULTS.md
node scripts/kgbench-charts.mjs --run <runId> --agent claude --out docs/images
node scripts/kgbench-verify-report-claims.mjs      # does README still match the data?
```

Pass `--agent` to the charts on any multi-agent run, or every bar pools agents whose tool
enforcement differs — the comparison the report itself marks as not meaningful. The script
warns when you omit it.

**Publication.** The site (`https://fwornle.github.io/coding`) builds from `docs-content/`
only, so a benchmark written to `docs/` reaches GitHub and nothing else — which is why
coding-v1 sat unpublished. It is now reachable through symlinks:

```
docs-content/benchmarks/coding-v1/README.md  -> ../../../docs/benchmarks/coding-v1/README.md
docs-content/benchmarks/coding-v1/RESULTS.md -> ../../../docs/benchmarks/coding-v1/RESULTS.md
```

Symlinks rather than copies, because the sibling `kgbench-replication` benchmark is a hand-made
copy and copies drift. `kgbench-charts.mjs` writes figures to **both** image trees for the same
reason — a figure in `docs/images` alone renders on GitHub and is broken on the site. Verify a
publish with `python3 -m mkdocs build --strict`; `--strict` catches a dangling markdown link
but **not** a broken image inside a raw `<picture>` block, so look at the page as well.

Publishing used to be `--out /tmp/kgb/README.md` followed by a `cp` onto the published
`README.md`. That replaced 632 lines of analysis with the machine version — twice, at
`f6bb7875c` and again on 2026-08-09, neither time mentioned in the commit that did it,
because a diff against the already-collapsed file shows only growth. `--out` now refuses
any target lacking its generated marker, so the old command fails loudly instead of
succeeding destructively. Use `--force` only when replacing prose is the actual intent.

After a re-render, update `README.md` **by hand** wherever it quotes a number, then run
`kgbench-verify-report-claims.mjs` — it recomputes every figure the prose asserts from
`results.jsonl` and fails on the ones that drifted. Its first run caught a chart generated on
every publish but embedded nowhere, and a judge claim describing one agent's split as the whole
run's. Also check, using the run's own data rather than by eye:

- **Provenance**: how many commits, which passes, which agents in each. This section has
  been wrong before precisely because it is the section nobody re-reads.
- **Secondary scorer**: is `judge.served` present and equal to `judge.requested`? A mixed
  list means the proxy substituted mid-run; the medians are unaffected (they use the
  deterministic checklist score) but the disagreements section is.
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

**The dashboard covers fact 3 only, and it is a different question.** Its launcher marks each
model `verified` / `unverified` / `rejected` and blocks a launch on an unverified one until
you tick an override. That comes from `.data/llm-proxy/model-availability.json`, written by
`scripts/llm-model-probe.mjs` — which the `Re-probe models` button runs host-side (minutes:
probes serialise on a shared override key, and each one is a real completion).

The two probes answer different questions and neither substitutes for the other:

| | asks | protects against |
|---|---|---|
| `doctor` | which model will the **judge** be served? | a scorer running on something other than what `run.json` publishes |
| launcher probe | which candidate models does a provider **serve at all**? | a three-hour matrix that 400s at cell one |

So still run `doctor` before a run you intend to publish, even if every model in the launcher
shows green.

---

## Guardrails

- **Never** foreground a full matrix (Step 0).
- **Never** launch from the CLI without checking `/api/kgbench/active-run` first. The
  dashboard refuses a concurrent run; `kgbench-supervise.sh` does not, and two live matrices
  corrupt each other's token attribution.
- **Never** publish from a screenshot of the dashboard. It renders a *live* aggregate that
  moves with every regrade; the published numbers come from `kgbench-report.mjs`, and the
  prose around them is checked by `kgbench-verify-report-claims.mjs`.
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

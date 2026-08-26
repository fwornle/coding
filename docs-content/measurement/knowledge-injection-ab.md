# Does Knowledge Injection Help? A Controlled A/B

This project maintains a knowledge base built from its own history — insights distilled from past
sessions, a graph of components, digests, raw observations. A retrieval service selects the pieces
relevant to whatever an agent is about to do and prepends them to its prompt. That machinery is
expensive to build and to run, and this report measures whether it works.

Two rounds were run, answering two different questions. The first used three hand-written tasks and
measured **how large the effect is when it occurs**. The second derived its tasks mechanically from
the knowledge base and measured **how often it occurs at all** — the number that decides whether
the system earns its keep.

The report is written to be readable without prior exposure to this codebase.

---

## Summary

**The setup.** Two arms of the same agent — same model, same tools, same frozen copy of the
repository — differing only in whether retrieved knowledge is prepended to the prompt. The graded
fact is deliberately **absent** from the repository, so this is a closed-book/open-book exam, not a
needle-in-a-haystack test. Each task asks for an operator runbook and is graded mechanically, by
regular expressions over the produced file, with no model in the loop.

| | Round 1 — curated | Round 2 — sampled |
|---|---|---|
| Tasks | 3, hand-written | 11, derived mechanically from KB insights |
| Cells | 18 | 66 |
| Answers | how *large* is the effect | how *often* does it arise |
| Headline | 6/6 accepted vs 0/6 on the two surviving tasks | **9 of 11 tasks discriminate — 82%** (95% Wilson 52%–95%) |

**The result.** On tasks whose answers live in the knowledge base rather than in the code, the
control arm failed where the treatment arm succeeded in nine cases out of eleven — and spent
**3.1x the steps, 1.8x the wall-clock and 6.8x the tokens** failing. Injection was not a trade of
cost against accuracy. It was cheaper *and* correct.

**The caveat that travels with the number.** 82% is not the probability that injection helps on an
arbitrary task, and must never be quoted as though it were. Round 2's gates are mined from what the
treatment arm actually wrote, so the treatment arm passes them close to by construction. The
load-bearing half of the measurement is the *control* arm's failure — a quantity nothing in the
gate's construction arranged, because **the control arm is never consulted while a gate is built.**
What the number means precisely is set out under [Design](#design-how-the-experiment-avoids-fooling-itself).

**What it does not establish.** One model, one repository. Deliverables are documents, not code that
must compile and pass tests. At n=11 the interval is wide enough to size the next round rather than
settle the question — report it as a pilot. And one curated task showed injection making things
*worse*, which is the most transferable finding here.

### Reading guide

| If you want | Read |
|---|---|
| the result, and nothing else | this summary |
| grounds to believe it | [Design](#design-how-the-experiment-avoids-fooling-itself) — isolation, task provenance, the rules governing selection |
| what a task actually looks like | [The tasks, verbatim](#the-tasks-verbatim) |
| the numbers | [Results](#results) |
| the limits | [What this establishes](#what-this-establishes-and-what-it-does-not) |
| how measurements like this go wrong | [Pitfalls](#pitfalls-and-the-measures-built-to-defeat-them) — nine real failures, each with the measure that closed it |

---

## The question

The project maintains a knowledge base built from its own history — insights distilled from
past sessions, a knowledge graph of components, daily digests, raw observations. A retrieval
service selects the most relevant pieces for whatever the agent is about to do and prepends
them to the prompt.

That machinery is expensive to build and run. The question it has to answer is simple:

> **Given a task whose answer is recorded in the knowledge base but not in the code, does an
> agent with injection do better than the same agent without it?**

"Better" is deliberately narrow here: does it produce a *correct* answer, and at what cost in
tokens, tool calls and wall-clock time.

---

## What kind of test this is

This is frequently mistaken for a needle-in-a-haystack test. It is the opposite, and the
difference decides how the results should be read.

A needle-in-a-haystack test plants a fact *inside* a long context and asks whether the model can
still find it. The needle is in the haystack; the question is attention over distance.

Here the fact is deliberately **absent** from the haystack. Both arms are dropped into the same
frozen copy of the repository, with the knowledge base stripped out of it. Only the treatment arm
additionally receives the fact — a few kilobytes of retrieved insights, prepended to its system
prompt. It is a **closed-book / open-book exam in which the textbook does not contain the
answer**: both students get the repository, one also gets the lecturer's private notes, and the
exam question is one the textbook never covers.

That framing splits the headline question into two independent ones, and a task is only
informative if both are live:

1. **Does the treatment arm use what it was handed?** Having a fact in the prompt does not put it
   in the answer. One task in this run received the correct knowledge and wrote a runbook
   contradicting it.
2. **Can the control arm reconstruct the fact from the repository?** If it can, the knowledge base
   is redundant *for that task* — the project is paying to store something the code already says.

Every combination of those two carries a different meaning, and all four occurred at some point
during the design:

| kb-on produces it | kb-off produces it | What it means |
|---|---|---|
| yes | no | Injection carried the answer. **The task discriminates** — this is the measurable case. |
| yes | yes | The repository already answers it. The task is uninformative and the KB adds nothing here. |
| no | no | Either the gate demands something the KB does not contain, or the task is beyond both arms. |
| no | yes | Injection actively **hurt**. Investigate — this happened, and the reason is the most transferable finding in this report. |

Getting a task into the first row is the hard part, and it is where three earlier attempts failed.
It requires a fact that is simultaneously carried by the knowledge base, absent from the
repository, and naturally demanded by a realistic goal — an intersection that is nearly empty,
because knowledge-base insights are prose *about* this repository and therefore tend to name
identifiers that also exist in it.

---

## Terminology


Terms used throughout, defined once.

| Term | Meaning |
|---|---|
| **Arm** | One side of the comparison. `kb-on` receives injected knowledge; `kb-off` is identical in every other respect and receives none. |
| **Cell** | One execution: a single arm × a single repeat of a single task. This run had 18 cells. |
| **Spec** | A task definition — goal sentence, deliverable filename, grading rule, number of repeats. |
| **Snapshot** | A frozen copy of the repository at a known commit, plus its knowledge base and config, from which every cell starts. Guarantees all cells begin from identical state. |
| **Sandbox** | The throwaway working directory a cell runs in, materialised from the snapshot. Discarded afterwards. |
| **Fact** | One checkable claim the deliverable must contain, expressed as a regular expression. |
| **Conjunction gate** | A cell passes only if it produces **all** required facts. Replaces earlier single-token grading. |
| **Coinage** | Whether a model produces a fact unprompted, from its own prior knowledge, with no repository and no knowledge base. A fact the model coins cannot distinguish the arms. |
| **Recoverable** | Whether the control arm could find a fact by searching the sandbox. |
| **Leak** | Any path by which a cell reaches information outside its sandbox — the failure mode this experiment spent most of its effort eliminating. |
| **Blind signal** | A property of a candidate fact measurable *before any cell runs* — and therefore usable to drop it without biasing the result. |
| **Discrimination rate** | The fraction of knowledge-derived tasks whose answer the control arm cannot reproduce. |
| **Mined gate** | A conjunction whose facts were taken from deliverables the treatment arm actually produced, intersected across repeats. |

---

## Design — how the experiment avoids fooling itself

An A/B of this shape has one dominant failure mode: producing a clean, confident, **wrong** number.
Three separate rounds did exactly that before the design below settled. Everything in this section
exists to close a specific way the measurement can flatter itself, and each measure is traceable to
a failure recorded under [Pitfalls](#pitfalls-and-the-measures-built-to-defeat-them).

### The four threats

| Threat | If unaddressed | Closed by |
|---|---|---|
| **Leakage** — the control arm reaches the answer from outside its sandbox | both arms pass; the effect vanishes | isolation, audited per cell |
| **Coinage** — the model already knows the fact | both arms pass; the KB gets credit for the model's training | a bare-model probe per fact |
| **Selection** — facts chosen because they flatter the treatment arm | the rate restates the choices made while building it | blind signals only |
| **Gate difficulty** — the conjunction is unsatisfiable for a working agent | both arms fail; reads as a hard task | gates mined from real deliverables |

### Isolation

Both arms start from the same snapshot: a frozen copy of the repository at a known commit, with the
knowledge base stripped out, materialised into a throwaway sandbox. Isolation turned out not to be
one property but four, each of which had to be closed and verified separately — an allow-list
naming host paths, project identity leaking through `git` linkage, agent instruction files
discovered by walking *up* out of the sandbox, and ambient environment. The full account is
[pitfall 1](#1-the-sandbox-leaked-the-answer); the surviving measure is that every cell's transcript
is audited for out-of-sandbox paths, and the audit is reported beside the results rather than
assumed. Round 1: **zero leaks across 18 cells.**

### Where the tasks come from

**Round 1 — curated.** Three tasks were written by hand because their answers were known to live in
the knowledge base and not in the code. This yields an existence result and a clean effect size, and
says nothing about frequency: the tasks were chosen *because* they had the property being tested.

**Round 2 — sampled.** To get a frequency, the task population must not be chosen task by task. The
derivation is mechanical: take every knowledge-base insight above a confidence threshold, draw from
that frozen population against a recorded seed, and turn each drawn insight into a runbook goal
built from the symptom it describes. The round reported here drew 36 from a population of 162 at
confidence ≥ 0.8, under seed `pilot-3`.

Candidate *generation* uses a model, and is deliberately not a measurement: any capable model may
propose candidate facts, because nothing a generator proposes survives without passing the filters
below. The round reported here nonetheless carries an **empty generator-provenance record** — see
[pitfall 10](#10-provenance-that-was-promised-but-not-written) — which does not invalidate it, for
exactly that reason, but does mean the derivation cannot be fully replayed from the ledger alone.
The coinage probe's model *is* recorded (`claude-sonnet-4.6`), and that one is load-bearing.

### How a gate is built

A cell passes only if its deliverable contains **every** required fact — a conjunction, not a
single token. How those facts are chosen is the crux of the whole design.

The instinct is to predict what a good answer looks like: hand a model the insight, let it write an
ideal runbook, and keep the facts that appear in every such reference. That was tried, and it
failed measurably. A reference is written with no sandbox, no tools, no instruction to actually do
the work and no pressure to be brief; a real cell writes under all four. Every fact in a conjunction
can appear in every reference and the conjunction still be jointly unsatisfiable for an agent doing
the job for real — which is what produced a round where seven of eight tasks failed in *both* arms.

The design that replaced it stops predicting a good answer and reads one. **Gates are mined from
what the treatment arm actually wrote.** The injected arm runs first, three times per task, and a
fact is eligible only if it appears in **every one** of those deliverables. A task producing fewer
than two deliverables is dropped outright: one deliverable cannot distinguish a stable fact from an
incidental one. This is how the three curated tasks were built, which is precisely why they never
had this problem.

### The rules that govern selection

Mining the gate from injected output means the treatment arm passes close to by construction. That
is an acceptable cost only because of what it does *not* touch — and three rules, each the inverse
of an instinct, keep the surviving quantity a measurement.

**1. Only blind signals may drop a fact.** A candidate is dropped if it fails a shape check, if it
does not appear in the block retrieval actually returns, if the bare pinned model coins it
unprompted, or if the goal sentence gives it away. Every one of those is measurable *before any cell
runs.* **No arm outcome ever feeds selection.** That is the property that keeps the rate an estimate
rather than a restatement of the choices made while building it.

**2. The recoverability audit is a covariate, never a filter.** The obvious design runs only the
tasks whose facts the control arm could not find by searching. It is wrong, and this experiment
measured why: a curated task whose four facts are *all* grep-able still discriminated decisively,
because the control arm searched 123 times across three cells and never found two of them. Filtering
on the audit discards discriminating tasks and biases the rate upward by an unknown amount. Every
sampled task runs; the verdict is recorded beside it as a column.

**3. The same logic forbids dropping a fact merely because it sits in the sandbox.** Whether the
control arm can actually reach a fact is the outcome being measured — not an assumption to bake into
selection.

Finally, **the control arm is never consulted while a gate is built.** Nothing the control arm does
can widen or narrow the set of facts it is later graded on. That single property is what makes the
discrimination rate a genuine measurement despite everything conditioned above.

### What the resulting number means, precisely

> The **discrimination rate** is the fraction of knowledge-derived tasks whose answer the *control*
> arm cannot reproduce. It is a direct measure of how much of the knowledge base is non-redundant.

It is conditional on the derivation — the population, the confidence threshold, the blind filters,
and gates mined from treatment output — and it is not the unconditional probability that injection
helps. Reported alongside it is the **effect size on the tasks that discriminate**, because a rate
without an effect size says nothing about whether the wins are worth having.

### Measurement

Same model (`claude-sonnet-4-6`), same snapshot, same goal text, same tooling; the injected block is
the only difference between arms. Three repeats per arm. Grading is mechanical — regular expressions
over the produced file — so it cannot drift. Tokens, tool-call counts and wall-clock are recorded
per cell from the proxy that meters every LLM call. A task counts as discriminating when a
*majority* of the treatment arm's repeats are accepted and a majority of the control arm's are not;
the stricter all-or-nothing reading is reported beside it, because the choice moves the number.

Cells that never executed are excluded rather than scored. A skipped cell writes a row, and counting
rows rather than graded results reports "neither arm solved it" about an agent that was never
invoked — see [pitfall 9](#9-a-cell-that-never-ran-counted-as-a-cell-that-failed).

---

## The tasks, verbatim

These are round 1's three hand-written tasks, shown in full because they make the shape of the
exercise concrete; round 2's eleven are built the same way but derived mechanically. Each arm
receives the goal sentence and nothing else task-specific. Same model, same snapshot, same tools;
the injected block is the only difference.

### Task 1 — `kb-ab-etm-crashloop`

> Create a file named `etm-crashloop-runbook.md` at the repository root that diagnoses this
> symptom for an operator: the tmux statusline shows `[LSL red]` and the project's agent letter
> turns yellow, while the Health API at port 3033 still reports every service green. The file must
> state the root cause, give the exact shell commands to confirm it, and give the exact command
> that fixes it.

The real cause is a hand-made symlink — `node_modules/@fwornle/km-core`, which appears in no
`package.json`, so `npm install` neither creates nor restores it. When it disappears, every
telemetry-writer spawn dies instantly, yet the Health API stays green *because the writer is not a
service*. Nothing at the import site hints at any of this.

| Fact | Pattern | Why it is decisive |
|---|---|---|
| `symlink-path` | `node_modules/@fwornle/km-core` | The root cause. The import site gives no hint that the dependency is a hand-made link. |
| `fix-command` | `ln -s` | An agent that only diagnoses has not finished the task. |
| `launchctl-check` | `launchctl` | The crash-loop is visible as a non-zero exit in the launchd job, not in any service log. |
| `health-is-wrong-place` | *green **because** it is not a service* | The decisive insight — it explains why the obvious diagnostic tool lies. |

### Task 2 — `kb-ab-leveldb-amplification`

> Create a file named `leveldb-amplification-runbook.md` at the repository root that diagnoses
> this symptom for an operator: a dashboard HTTP route that only READS data is polled every 30
> seconds, and the container serving it is killed by the kernel out-of-memory killer on roughly
> every poll, even though its own startup logs are clean and fast. The file must state the root
> cause, name the option that fixes it, and give a cheap positive test that confirms the diagnosis
> before any fix is applied.

The cause is a chain no single file states: the graph store's `close()` persists by default, and
it writes the *whole* graph as one value under one key — so a store opened purely to read rewrites
everything on close. At one megabyte per poll against an eight-megabyte graph, `open()` alone
eventually exceeds the container's memory limit.

| Fact | Pattern | Why it is decisive |
|---|---|---|
| `persist-option` | `persistOnClose` | The option that fixes it. It landed *after* the snapshot, so it cannot be found in the sandbox at all. |
| `read-open-still-writes` | *close persists even on a read-only open* | The mechanism. Reaching it without the KB means inventing the close-path behaviour — measured 0/3 in the control and 0/3 with no knowledge at all. |
| `cgroup-not-docker-stats` | `memory.events` / `cgroup` | Pure experience: `docker stats` under-reports, because the spike outruns its one-second sampling. |
| `cheap-positive-test` | `du -sh` / `.ldb` | The goal demands confirmation before a fix — one GET adding a megabyte of SST files is it. |

### Task 3 — `kb-ab-llm-routing` *(retired)*

> Create a file named `llm-routing-runbook.md` at the repository root explaining to an operator how
> this project decides which provider and model serves a given background job. The file must say
> where the routing configuration lives, what each provider declares about the models it can serve,
> what happens at start-up when that configuration cannot be parsed, and how a change to it is
> picked up.

Retired after the run, for a reason that turned out to be worth more than the task. See
[Where injection fails](#where-injection-fails-it-fails-in-an-interesting-way).

### How a deliverable is graded

`node scripts/kb-ab-assert.mjs <topic>` reads the produced file and tests each pattern against it.
There is **no model in the loop** — grading is a conjunction of regular expressions, so it cannot
drift between runs. Two numbers are reported:

- **Facts** — the mean count of the four patterns present. Partial credit, showing *how far* an arm
  got.
- **Accepted** — the all-four conjunction. A cell passes only if it produced every required fact.

The obvious objection to regex grading is that it tests for a string, not for understanding: a cell
could in principle emit the right token inside a wrong sentence. Three things bound that risk. The
gate is a conjunction of four *independent* facts spanning cause, confirmation and fix, which is
hard to satisfy accidentally. The facts were selected empirically against deliverables already on
disk rather than chosen by intuition (see [pitfall 4](#4-a-gate-demanding-a-fact-the-knowledge-base-does-not-contain)).
And the judge separately scores the remaining rubric dimensions from the diff, so a cell that games
the strings does not thereby score well overall. Grading was previously a single `grep` for one
token; that gate could not tell diagnosing the cause apart from giving the fix, and every cell of an
earlier run passed it while differing sharply in what it actually explained.

---

## How injection works


Every prompt the agent submits triggers a retrieval pass. The dashboard exposes exactly what
happened on each one, which is what makes the experiment auditable rather than a black box.

### What gets retrieved, and what gets rejected

![Retrieval funnel — 80 candidates fetched, 4 injected, with the drop at each stage](../images/knowledge-injection-retrieval-funnel.png)

The panel above is from a real `kb-on` cell in this run. Reading it top to bottom:

- **The prompt that drove retrieval** is shown verbatim. It is embedded and searched — nothing
  else is used as the query.
- **80 candidates** were fetched (80 by semantic similarity, 0 by keyword search) and fused.
- Five stages then reduce 80 to 4:

| Stage | In → Out | What it does |
|---|---|---|
| Relevance floor | 80 → 80 | Drops candidates below a similarity threshold. Nothing fell out here. |
| Curated-tier gate | 80 → 40 (−40) | Drops whole content tiers — see below. |
| Top-K trim | 40 → 12 (−28) | Keeps only the best-ranked candidates per tier. |
| LLM relevance judge | 12 → 6 (−6) | A model reads each survivor and rejects the ones that do not actually bear on the prompt. |
| Budget assembly | 6 → 4 (−2) | Fills the token budget in rank order; the rest do not fit. |

- **Budget: 3,000 tokens**, of which **1,928 were actually used**. The budget is the binding
  constraint on how much knowledge reaches the model.
- The tier table shows *why* whole categories were rejected. **Digests** and **Observations**
  are retrieved and ranked, then deliberately **gated out**: digests are an upstream precursor
  of insights rather than independent knowledge, and observations outnumber insights roughly
  11:1, so they crowd the budget without adding information. Only **Insights** (≤4 items) and
  **Entities** (≤3 items) survive into the prompt.

This is the sense in which "rejected" is meaningful here: rejection happens at five distinct
stages for five different reasons, and the panel attributes each drop to its stage.

### What actually gets injected

![Context window anatomy for a treatment cell — 8.3 KB of retrieved knowledge](../images/knowledge-injection-context-explainer.png)

The same cell's context window, measured in exact bytes rather than estimated. **Retrieved
Knowledge: 8.3 KB** is the injected block. It sits near the front of the prompt, ahead of the
conversation, which is also why it is cheap: it becomes part of the cacheable prefix and is
re-read from the provider cache on later turns rather than re-sent.

### The control arm, for contrast

![Context window anatomy for a control cell — 0 B retrieved knowledge, 341.5 KB of tool outputs](../images/knowledge-injection-control-arm.png)

The same task, same model, `kb-off`. **Retrieved Knowledge: 0 B.** Note what replaces it: the
largest turn is **535.2 KB across 7 messages** versus the treatment cell's **218.0 KB across
3**, and **Tool Outputs alone are 341.5 KB** against the treatment's 0 B. The control arm is
not idle — it is searching the repository hard, and paying for it. Whether that search
succeeds is the experiment.

---

## Results

### Round 1 — three curated tasks: how large the effect is


18 cells, zero leaks, zero untraced cells, all treatment cells confirmed injected.

| Task | Arm | n | Facts | Accepted | Steps | Seconds | Tokens |
|---|---|---|---|---|---|---|---|
| etm-crashloop | **kb-on** | 3 | **4.00 / 4** | **3 / 3** | 1.7 | 35 | 3,955 |
| | kb-off | 3 | 1.33 / 4 | 0 / 3 | 41.0 | 429 | 31,905 |
| leveldb-amplification | **kb-on** | 3 | **4.00 / 4** | **3 / 3** | 1.3 | 38 | 3,788 |
| | kb-off | 3 | 1.00 / 4 | 0 / 3 | 12.0 | 179 | 9,665 |
| llm-routing *(retired)* | kb-on | 3 | 1.00 / 4 | 0 / 3 | 44.0 | 222 | 14,881 |
| | kb-off | 3 | 2.00 / 4 | 0 / 3 | 5.0 | 394 | 27,305 |

### Where injection works, it works decisively

On both surviving tasks the treatment arm produced **every** required fact in **every** repeat,
while the control produced roughly one in four and never passed the gate.

The per-fact breakdown shows the split is not uniform — it falls exactly where knowledge is
required rather than reasoning:

```
etm-crashloop  kb-on   symlink-path 3/3   fix-command 3/3   launchctl 3/3   health-insight 3/3
               kb-off  symlink-path 0/3   fix-command 0/3   launchctl 3/3   health-insight 1/3
```

The control reliably produces the fact that can be inferred (`launchctl`) and sometimes the
reasoning step, and **never** the two facts that must be known.

**Cost runs the same direction.** On `etm-crashloop` the control used **24× the steps, 12× the
wall-clock and 8× the tokens** — and still failed. Injection was not a trade of cost for
accuracy; it was cheaper *and* correct.

### Where injection fails, it fails in an interesting way

The third task was **retired**, and the reason is the most transferable finding here.

Its treatment arm scored **worse than its control** (1.00 vs 2.00 facts) while making 44 tool
calls to the control's 5. This was not a delivery failure: replaying the exact retrieval showed
the injected block **did** contain the two facts the arm scored 0/3 on, and the same injection
path fed the two successful tasks in the same run.

The cause is a **conflict between injected knowledge and the repository**. The graded facts
describe configuration living in a *separate* repository; meanwhile this repository ships its own
older, plausible, contradicting configuration file. The cells explored, found the local file, and
wrote about that.

> **When a repository contains a confident answer that contradicts injected knowledge, the model
> believes the repository — and searches harder to confirm it.**

Attempting to rescue the task by re-selecting its graded facts was tried and failed: mining every
candidate from the injected block returned **zero** usable facts, because every term the treatment
arm wrote was also grep-able from its own sandbox and also appeared in the control. There was
nothing left to grade.

---

### Round 2 — eleven sampled tasks: how often it happens

Thirty-six insights were drawn from a frozen population of 162 above the confidence threshold.
Eleven survived derivation into runnable tasks; all eleven ran, two arms by three repeats — 66 cells.

> **9 of 11 sampled tasks discriminate — 82%** (95% Wilson 52%–95%).
> Strict reading, requiring every treatment repeat accepted and no control repeat accepted:
> **7 of 11 — 64%** (35%–85%).

| Outcome | Tasks | Meaning |
|---|---:|---|
| **discriminates** | **9** | injection carried the answer — the measurable case |
| kb-redundant | 2 | the repository already answers it; the KB adds nothing here |
| neither-solves | 0 | a broken gate, or beyond both arms |
| injection-hurt | 0 | injection actively hurt |

Per task, accepted repeats out of graded repeats:

| Task | Audit | kb-on | kb-off | Outcome |
|---|---|---:|---:|---|
| category-sub-modal-text-overflow | WARN | 3/3 | 0/3 | discriminates |
| claude-run-session-title-generation | WARN | 3/3 | 3/3 | kb-redundant |
| cross-agent-experiment-failure-modes | FAIL | 3/3 | 0/3 | discriminates |
| graphify-corpus-cache-invalidation | PASS | 3/3 | 0/3 | discriminates |
| graphify-incremental-rebuild-call-chain | PASS | 3/3 | 0/3 | discriminates |
| health-coordinator-idle-gate | FAIL | 2/3 | 2/3 | kb-redundant |
| kgbench-grader-false-positives | PASS | 3/3 | 0/3 | discriminates |
| llm-proxy-egress-coverage | WARN | 3/3 | 0/3 | discriminates |
| ontologyfilter-component-unified-viewer | FAIL | 3/3 | 0/3 | discriminates |
| retrieval-service-hybrid-search-rrf | FAIL | 3/3 | 1/3 | discriminates |
| smoke-spec-snapshot-restore-blockers | FAIL | 3/3 | 1/3 | discriminates |

**The cost separation reproduces at scale.** Averaged over the nine discriminating tasks:

| Arm | Steps | Seconds | Tokens |
|---|---:|---:|---:|
| **kb-on** | **7.3** | **185** | **2,692** |
| kb-off | 22.6 | 340 | 18,328 |

Three times the steps, nearly twice the wall-clock and **6.8x the tokens** — to reach an answer the
control arm mostly did not reach at all. Because these measures are continuous rather than binary,
they carry far more statistical power per cell than the pass/fail gate, and they stay informative
even where correctness ties.

#### The recoverability audit, as a column

Every task carries a verdict on whether the control arm could grep its way to its graded facts. No
task is filtered on it — that is design rule 2 — which makes the split itself a measurement:

| Verdict | Tasks | Discriminate |
|---|---:|---:|
| **FAIL** — every required fact is grep-able | 5 | **4** |
| WARN — some reachable, some not | 3 | 2 |
| PASS — none reachable by search | 3 | 3 |

**Four of the five FAIL-verdict tasks discriminated anyway.** Had the audit been used as the
inclusion filter that the obvious design calls for, those four would have been discarded as
unmeasurable and most of the round's signal would have gone with them. This is [pitfall
2](#2-grep-able-is-not-recoverable) reproduced across a sampled set rather than argued from a single
task: static searchability describes what a determined grep *could* reach, not what an agent under
task pressure actually retrieves.

#### Most candidates die before becoming tasks

The funnel matters more than the rate, because it sets what a round of this size costs. Of 36 drawn,
25 produced no runnable task:

| Reason | Count |
|---|---:|
| no deliverable in the window — one cannot show stability | 10 |
| fewer than the three facts a conjunction needs | 11 |
| no token appeared in *every* treatment-arm deliverable | 3 |
| mined token absent from the block the treatment arm receives | 1 |

Two-thirds attrition is the blind filters doing their job, not a defect — but it means a round costs
roughly three times its visible cell count in candidates, which is the practical constraint on
scaling this to a number that would settle the question rather than size the next attempt.

#### Reading the two rounds together

Round 1 says that when injection matters it matters decisively and costs less. Round 2 says the
case arises for roughly four in five knowledge-derived tasks, with the true value plausibly anywhere
between half and nearly all. The two `kb-redundant` tasks are the honest counterweight: for those,
the repository already held the answer and the knowledge base earned nothing.

---

## What this establishes — and what it does not

The effect above is large and perfectly consistent, which makes it easy to over-read. Three
constraints bound what it supports.

**The tasks were selected, not sampled.** They were written *because* their answers live in the
knowledge base and not in the code. That yields an existence result — when injection helps, it
helps decisively and costs less — and it says nothing about how often that case arises in real
work. A larger set of hand-picked knowledge-decisive tasks would tighten the confidence interval
around a number that is biased by construction.

**The denominator is three, not two.** The retired task is a result, not an administrative
nuisance. One of three hand-picked tasks — picked with a thumb on the scale for the treatment —
had its effect **reversed** by a stale file sitting in the repository. On a curated set biased
toward success, that adverse rate is arguably the more decision-relevant number of the two.

**The statistics are conditional on that selection.** Pooling the two surviving tasks gives 6/6
accepted against 0/6 (Fisher exact, one-sided *p* ≈ 0.001); a single task alone gives 3/3 vs 0/3,
*p* = 0.05. Those quantify how *consistent* the effect is within these tasks. They are not the
probability that injection helps on an arbitrary task, because the tasks were not drawn at random.

**And the deliverable is a document, not working code.** Nothing here shows that injection improves
software that has to compile and pass tests.

These constraints bound **round 1**. The first of them is what round 2 was built to answer, and it
does: a mechanically derived population supplies a rate that no curated set can. That does not make
round 1's tasks a random sample — it means the two rounds carry different conditioning, and the
[design section](#design-how-the-experiment-avoids-fooling-itself) states round 2's in full.

---

## Where this goes next

### Cheaper power, without new tasks

- **More models.** Everything here ran on a single pinned model. A result that holds for one model
  is not yet a property of the knowledge base. The matrix already carries an agent/model axis.
- **Cost as a co-primary outcome.** Steps, tokens and wall-clock separated the arms by factors of 3
  to 8. Being continuous and low-variance, they carry far more power per cell than a binary gate,
  and stay informative when correctness ties.
- **More repeats, where they help.** Within-arm variance was near zero on the tasks that
  discriminate, so repeats buy little there. They become necessary as soon as the task type is
  noisier — which is exactly the programming case.
- **A larger draw.** At n=11 the interval spans 52%–95%. Narrowing it is a matter of more drawn
  insights, at roughly three candidates per runnable task.

### Programming tasks: possible, but grade a different thing

The concern that non-determinism will drown the signal is the right concern, in the wrong place.
The problem is not that programming outcomes are stochastic; it is that a programming cell can fail
for many reasons that have nothing to do with knowledge — a botched edit, a tool error, a timeout,
a flaky test. That variance is unrelated to the treatment and it lands directly on a binary
pass/fail outcome. Four measures keep the signal above it.

- **Grade the knowledge-dependent step, not the whole solution.** Not "does the feature work", but
  "does the diff touch the right file and encode the right mechanism", with the existing test suite
  as a guard against regression. This isolates the knowledge signal from general coding competence,
  which is not what the experiment is about.
- **Choose bugs where diagnosis is hard and the fix is small.** This project's own history is full
  of them — each recorded lesson is a symptom whose obvious cause is wrong. A recent example: a test
  that passed alone and failed in a batch, where the obvious explanation (cross-file interference)
  was wrong and the real cause was a wall-clock race against synchronous filesystem work. An agent
  without that lesson chases the obvious explanation; the fix itself is a few lines.
- **Measure the noise before designing around it.** Run one candidate programming task ten times on
  the *control arm only*. That gives the within-arm pass rate and its variance directly, and from it
  the number of repeats needed to detect a given effect. This is an afternoon's pilot, not a guess —
  and it is the step that answers the question rather than arguing about it.
- **Keep cost in the outcome set.** Correctness is more likely to tie on programming tasks, because
  a determined agent can often grind its way to a working answer. The cost difference is where the
  effect will show, and it is the cheaper measurement.

Three things genuinely get harder, and should be planned for rather than discovered:

- **The snapshot must build and test.** The documentation tasks needed only a filesystem. A
  programming task needs dependencies restored in the sandbox, which for this repository means
  submodules whose build output is not tracked in version control. That is real engineering work
  before the first cell runs.
- **The contradiction failure mode gets worse, not better.** The retired task failed because the
  repository held a confident, stale, wrong answer and the agent believed it over the injected
  knowledge. Code is far more likely than operational lore to have a competing implementation
  sitting in plain sight. Every programming spec needs the check that task lacked: does the sandbox
  contain a rival answer to this goal?
- **A diff is more forgiving to grade than a file.** A regex conjunction over a produced runbook is
  unambiguous. A diff can achieve the right outcome in a shape no pattern anticipates. Expect the
  test suite to become the primary gate with the pattern conjunction as corroboration, rather than
  the reverse.

**Suggested order.** Sample the documentation-task population first: it is cheap, it reuses
machinery that already works, and it produces the discrimination rate — the single number that
justifies or condemns the whole knowledge-injection system. Then pilot one programming task purely
to measure its noise. Then decide whether a full programming matrix is worth its cost, on evidence
rather than on intuition about how noisy such a matrix would be.

---

## Pitfalls, and the measures built to defeat them

Every item below is a real failure that produced plausible but invalid results, followed by the
measure now in place. Together they are why the numbers above can be believed: over half were found
*after* a run had already produced a clean-looking table, and would not have been found by reading
that table.

They are also the transferable part. The specific facts being graded are peculiar to this project;
the ways an isolated experiment turns out not to be isolated are not.

### 1. The sandbox leaked the answer

**Three independent leaks were found, each invalidating a run.**

The first was an allow-list file in the snapshot that named the host's agent-memory directory
by absolute path. Cells followed the pointer and read the answer directly. Stripping the file
closed it — and the next run still leaked.

The second was **project identity via git**. Sandboxes were created with `git worktree`, which
keeps pointing at the origin repository's `.git`. The agent runtime derives a session's project
— and therefore the memory index injected into its system prompt — from that. Cells were handed
the real project's memory index and read the graded fact out of it as their *first tool call*,
in **both arms**.

Two proposed fixes were tested and **both failed**: scrubbing every repository-naming
environment variable changed nothing, and moving the sandbox outside the repository tree
changed nothing. The channel is the git linkage itself. The measure that works is to give the
sandbox **its own `.git`** — an independent local clone at the same commit, with the origin's
module store copied in so submodules resolve without network access.

The third was the **parent-directory rules walk**. Agent instruction files are discovered by
walking *up* from the working directory. A file at the user's home directory therefore reaches
any sandbox beneath it, and this project's own instruction file contains **all nine graded
facts verbatim**. No in-sandbox strip can remove a file that lives in an ancestor directory.
The measure is to place sandboxes outside that ancestry entirely.

> **Generalisable lesson.** Isolation is not one thing. A sandbox can be isolated by filesystem
> location and still leak through version-control identity, ambient configuration discovery, or
> inherited environment. Each channel has to be closed and *verified* separately.

**Verification measure.** Every cell's transcript is now audited for paths outside its sandbox,
and the audit is reported *beside* the results rather than after them. This run: **0 leaks
across 18 cells**.

### 2. "Grep-able" is not "recoverable"

One task was designated a null control on the reasoning that all its facts are findable by
searching the sandbox. They are. Under clean isolation the control arm searched **123 times
across three cells and still never found two of the four facts**.

The measure is to stop treating static searchability as decisive. A static audit still runs and
reports whether a fact is reachable, but its verdict is advisory; the empirical arm difference
is the evidence. The audit's own documentation notes it over-reports by design.

### 3. Testing coinage on the wrong model

A fact was retired as "the model just invents this" on the strength of a probe that had
silently run on a cheaper model than the one answering the cells. Re-run on the correct model,
the fact was coined **0 times out of 3** — the original retirement was wrong, and the fact was
in reality being supplied by a leak.

**Measure:** the coinage probe runs on the cell's actual model, in a bare directory with no
repository and no knowledge base, and every graded fact is checked against it.

### 4. A gate demanding a fact the knowledge base does not contain

One fact scored **0 out of 6 across both arms**. That reads like a hard task; it was a broken
gate. The phrasing existed in the project's instruction file but not in the knowledge base, so
retrieval could never inject it and the treatment arm could not possibly supply what the gate
demanded.

**Measure:** candidate facts are now selected **by measurement** against deliverables already on
disk, and must satisfy four conditions — present in the injected block, absent from the sandbox,
produced by the treatment arm, and absent from both the control arm and bare-model coinage. When
this was applied, one plausible-looking candidate turned out to appear in **3/3 control cells and
2/3 coinage runs** while the treatment arm never wrote it. It would have graded backwards.

### 5. Silent mis-measurement from a path-encoding mismatch

Moving sandboxes to the system temp directory broke transcript location in two ways at once, on
macOS: `/var` is a symlink to `/private/var`, so the recorded path and the resolved path
disagreed; and the temp path contains an underscore, which the agent runtime rewrites when
naming its per-project transcript directory while the harness's locator does not.

The result was not an error. Cells closed as **`complete` with a null step count** — scored as
trivial runs, with a plausible score attached. Caught on the *first* cell because step counts
were checked before trusting anything.

**Measure:** two assertions now fail the restore loudly — the sandbox path must be its own
canonical path, and it must contain only characters both encoders agree on. Both are enforced on
the production path only, since injected test stubs legitimately use paths of the rejected shape.

### 6. An audit that over-reported leaks

The leak audit initially scanned the entire tool-call input, which counted paths appearing in
text the agent *wrote* — a runbook mentioning a log file path — as if the agent had accessed it.
Two cells were wrongly flagged.

**Measure:** the audit scans only fields denoting access (`file_path`, `command`, `path`, …) and
explicitly excludes authored content. Absolute paths legitimately exist inside the restored tree,
so quoting one is not an escape.

### 7. A dependency that fails open

The retrieval service was found **wedged** mid-run — process alive, port unresponsive. Injection
is deliberately fail-open, so a treatment cell retrieving against a dead service gets **zero
knowledge and still completes normally**. The arm would have been silently untreated.

**Measure:** injected byte counts are logged per cell and checked for consistency, and service
health is monitored for the duration of a run. In this run all nine treatment cells logged
identical injection sizes within their task (5,395 / 5,519 / ~9,000 chars), confirming none was
degraded.

### 8. A generated gate that silently kept pointing at the gate it replaced

The mined round derives a new gate per task and writes a spec beside the pilot's. The generator
produced that spec by rewriting the pilot's YAML as text:

```js
.replace(`kb-ab-assert.mjs ${topic}`, `kb-ab-assert.mjs ${minedTopic}`)
```

The YAML serialiser folds a scalar at 80 columns. `test_command` is `node scripts/kb-ab-assert.mjs
<topic>` — two spaces of indent plus thirty characters of command — so the moment a topic pushed the
line past eighty, the value became a folded `>-` block with the topic on its **own line**. The
single-space literal then matched nothing, `String.replace` returned its input unchanged, and the
spec was written still naming the pilot's fact set. No error, no warning: three tasks were graded
against the very reference-derived gate the round existed to replace.

The boundary is exact. Eight tasks sat at 80 columns or fewer and were gated correctly; the three at
82, 82 and 84 were not. Those three were also, precisely, the round's anomalies — two of its three
`neither-solves` verdicts, and one task counted as *discriminating*. The defect moved the headline
in both directions at once, which is why reading the results did not reveal it.

> **Generalisable lesson.** A string rewrite that finds no match is indistinguishable from one that
> had nothing to do. Any generated artefact encoding *which thing is being measured* must be edited
> structurally and then asserted, because the failure mode is not a crash — it is a well-formed file
> that measures the wrong thing.

**The same fold defeated a second script, in a different way.** The recoverability audit read the
spec's scalars with a `^key:\s*(.+?)$` regex — "avoids a YAML dep for the three scalars we need" —
so a folded `test_command` yielded the literal string `>-` as the command. It found no gate in it
and returned SKIP: *"no `grep -F` gate in test_command"*, for a spec whose gate was perfectly well
formed. Three tasks audited as SKIP for no reason but the length of their topic, and a SKIP is not
an error — it is a non-answer that looks like a considered one. The two scalars that never fold,
`experiment_id` and `snapshot_id`, are why this went unnoticed for so long.

**Measure:** the generator parses the spec, replaces the gate argument in the parsed argv, and
re-serialises. A spec whose `test_command` does not carry the expected topic argument **throws**
rather than being emitted. Every emitted spec is checked to assert its own mined topic, and every
topic to resolve in the fact table, before a run starts. The audit parses YAML rather than matching
lines. And specs are now emitted unfolded (`lineWidth: -1`), because "nothing else parses this by
line" turned out not to be a safe assumption to make once, and is not worth betting on twice.

### 9. A cell that never ran, counted as a cell that failed

A cell skipped before the agent starts still writes a row. A preflight route failure lands with a
null terminal state, a null step count, no score and a `skip_reason` — after about five seconds. The
discrimination report counted rows rather than results: an arm's denominator was the row count and
its numerator the rows with a passing gate, so six preflight skips read as `0/3` in both arms and
the task was recorded as `neither-solves` — whose stated meaning is "a broken gate, or beyond both
arms". That is a positive claim about an agent that was never invoked. The report even computed the
number of ungraded rows, and then never read it.

> **Generalisable lesson.** "Absent" and "negative" are different measurements, and a schema
> representing both as a missing pass will report the first as the second. It is the same error as
> this project's own rule about dashes never meaning zeros, one layer down.

**Measure:** the report counts only *scored* repeats. A task with an ungraded arm is classified
`not-run`, excluded from the rate's denominator rather than counted as a failure, and named in the
output with the instruction to re-run it. The aggregate splits are computed over the graded set, so
a never-run task cannot dilute those either.

### 10. Provenance that was promised but not written

A derivation is only auditable if you can say what produced it. Extracting the sampler's probes into
their own module dropped the line that recorded which model generated each task's candidate facts.
The comment promising the derivation "stays auditable" moved across with the code; the recording did
not. The ledger for the round reported here carries `generatorModels: []` — 36 drawn tasks with no
record of what proposed their candidates.

Fixing that exposed a second fault underneath it. The generator's process name carried a `bg-`
prefix that the proxy *also* prepends, so it resolved to `bg-bg-…`, matched no route, and silently
fell through to a default — meaning a routing change made hours earlier had never taken effect. It
had *looked* verified, because the check queried the routing resolver with the already-resolved
name. That confirms what the resolver does with a name; it says nothing about what the caller's
name resolves *to*.

> **Generalisable lesson.** Verifying a fix by asking the component downstream of the bug will
> confirm the bug is fixed. The check has to start where the real caller starts.

This does not invalidate the round: candidate generation is explicitly not a measurement, and the
blind filters do the selecting. What was lost is replayability — the draw cannot be reconstructed
from its own ledger — and resilience, since a derivation that should have been independent of one
account's quota was not.

**Measure:** provenance is recorded inside the completion call itself, keyed on the process, so a
caller cannot omit it. Route checks are made by sending the caller's own string end to end and
reading which provider answered, rather than by consulting the resolver.

---

## Recommendations


**For this knowledge-injection system**

1. **Keep it, for knowledge that is not in the code.** Roughly four in five knowledge-derived tasks
   were beyond the control arm, and the wins were large, cheap and repeatable — precisely where the
   answer is operational know-how rather than something derivable from source.
2. **Expect a redundant minority, and do not begrudge it.** Two of eleven sampled tasks were
   answered perfectly well by the repository alone. That is the honest cost of a knowledge base
   that also records things the code already says.
3. **Treat contradiction as a first-class failure mode.** Injection does not override what the
   agent can read. Where injected knowledge supersedes something still present in the repository,
   expect the repository to win. The mitigation is to fix or remove the stale artefact, not to
   inject harder.
4. **Do not let the dependency fail silently.** A fail-open retrieval path plus a wedged service
   produces an untreated arm that looks normal. Injected byte counts should be asserted, not merely
   logged.

**For anyone running a similar experiment**

5. **Never let selection see an arm's outcome.** Every filter that drops a task or a fact must be
   computable before any cell runs. This is the single property separating a measurement from a
   restatement of the choices made while building it.
6. **Keep the plausible-looking filter as a covariate.** Screening tasks on whether the control arm
   *could* find the answer by searching would have discarded four of the five hardest-won results
   here. Record the verdict; never filter on it.
7. **Verify isolation empirically, per cell, and report it beside the results.** Not as a
   precondition assumed once. Three separate leaks survived at least one round of "we fixed that".
8. **Prefer a direct probe to an inference about the mechanism.** The decisive test throughout was
   a no-tools question — *"name your memory directory from your system prompt alone"* — which
   settled in seconds what two rounds of reasoning had got wrong. The same rule applies to verifying
   a fix: start where the real caller starts, not downstream of the bug.
9. **Select graded facts by measurement, from real output.** Require: present in the treatment
   input, produced by the treatment arm in *every* repeat, and absent from bare-model coinage.
   Facts chosen by intuition graded backwards more than once; facts predicted from an idealised
   answer produced a round in which neither arm could pass.
10. **Check the cheap invariants before trusting a batch.** A null step count on cell one saved a
    50-minute run that would have produced a full, plausible, meaningless table. Distinguish a cell
    that failed from a cell that never ran.

**Limits** are stated in full under [What this establishes — and what it does
not](#what-this-establishes-and-what-it-does-not); remaining work — more models, a larger draw, and
whether programming tasks can carry the same measurement — is under
[Where this goes next](#where-this-goes-next).

---

## Reproducing


```bash
# Run a spec (both arms, three repeats)
node scripts/experiment-run.mjs --spec config/experiments/kb-ab-etm-crashloop.yaml

# Grade a produced deliverable against its conjunction gate
node scripts/kb-ab-assert.mjs kb-ab-etm-crashloop

# Check that the control arm cannot reach the graded facts by searching
node scripts/experiment-audit-recoverability.mjs --spec config/experiments/kb-ab-etm-crashloop.yaml
```

Fact definitions, and the retirement note explaining why the third task could not be rescued,
are in `lib/experiments/kb-ab-facts.mjs`.

The sampled round adds two steps in front of that, because its gates are derived rather than
written by hand:

```bash
# Build the injected-arm-only specs whose deliverables the gates are mined from
node scripts/kb-ab-make-mine-specs.mjs

# Mine each task's gate from those deliverables
# --dry-run reports what would be kept without calling a model or writing anything
node scripts/kb-ab-mine-facts.mjs --dry-run

# Run a mined spec (both arms, three repeats), then report the rate over the whole round
node scripts/experiment-run.mjs --spec .data/kb-ab-sampler/specs/<kbm-topic>.yaml --parallel
node scripts/kb-ab-discrimination-report.mjs --ledger .data/kb-ab-sampler/ledger-mined.json
```

The report names any task it had to exclude for want of a graded repeat. An excluded task is not a
zero — see pitfall 9 — so re-run it rather than reading past it.

## See also


- [The /experiment Skill](experiment-skill.md) — running experiment matrices
- [Experimental Design](kgbench-experimental-design.md) — design principles for the retrieval benchmark
- [Measurement & Judging Lessons](../benchmarks/measurement-lessons.md)

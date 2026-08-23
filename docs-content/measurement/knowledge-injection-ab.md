# Does Knowledge Injection Help? A Controlled A/B

This report documents a controlled experiment run on 2026-08-23 that measured whether
automatically injecting curated project knowledge into a coding agent's prompt makes it
better at its task.

It is written to be readable without prior exposure to this codebase. The methodology
section matters as much as the result: the first two attempts at this experiment produced
confident-looking numbers that were **wrong**, and the measures described here exist
specifically to stop that happening again.

---

## What the experiment set out to show

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

## Methodology

**Design.** Two arms, three tasks, three repeats per arm — 18 cells. The only difference
between arms is whether the injected block is present. Same model (`claude-sonnet-4-6`), same
snapshot, same goal text, same tooling.

**Task selection.** A task only carries information if the answer is in the knowledge base and
*not* reachable from the code. Each task grades a piece of operational know-how that was
learned after the snapshot was taken.

**Grading.** Each deliverable is checked against a conjunction of required facts. Partial
credit is reported (facts present) but a cell is only *accepted* if it produces all of them.
Grading is mechanical — regular expressions over the produced file — with no model in the loop,
so it cannot drift.

**Cost measurement.** Tokens, tool-call counts and wall-clock are recorded per cell from the
proxy that meters every LLM call.

---

## Pitfalls, and the measures built to defeat them

This is the substance of the report. Every item below is a real failure that produced
plausible but invalid results, followed by the measure now in place.

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

---

## Results

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

## Recommendations

**For this knowledge-injection system**

1. **Keep it, for knowledge that is not in the code.** Two tasks showed a large, cheap, repeatable
   win precisely where the answer is operational know-how rather than something derivable from
   source.
2. **Treat contradiction as a first-class failure mode.** Injection does not override what the
   agent can read. Where injected knowledge supersedes something still present in the repository,
   expect the repository to win. The practical mitigation is to fix or remove the stale artefact,
   not to inject harder.
3. **Do not let the dependency fail silently.** A fail-open retrieval path plus a wedged service
   produces an untreated arm that looks normal. Injected byte counts should be asserted, not
   merely logged.

**For anyone running a similar experiment**

4. **Verify isolation empirically, per cell, and report it beside the results.** Not as a
   precondition assumed once. Three separate leaks survived at least one round of "we fixed that".
5. **Prefer a direct probe to an inference about the mechanism.** The decisive test throughout was
   a no-tools question — *"name your memory directory from your system prompt alone"* — which
   settled in seconds what two rounds of reasoning had got wrong.
6. **Select graded facts by measurement.** Require: present in the treatment input, absent from
   the control's reach, produced by the treatment, absent from the control and from bare-model
   coinage. Facts chosen by intuition graded backwards in this experiment more than once.
7. **Check the cheap invariants before trusting a batch.** A null step count on cell one saved a
   50-minute run that would have produced a full, plausible, meaningless table.

**Limits of this result.** Two tasks, three repeats per arm, one model, one repository. The effect
where it appears is large and consistent, but this establishes *when* injection helps — not a
general law about how much.

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

## See also

- [The /experiment Skill](experiment-skill.md) — running experiment matrices
- [Experimental Design](kgbench-experimental-design.md) — design principles for the retrieval benchmark
- [Measurement & Judging Lessons](../benchmarks/measurement-lessons.md)

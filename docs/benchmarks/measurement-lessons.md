# Measurement and Judging Lessons

Everything here was learned by getting it wrong first, on the `coding-v1` set across runs
r5 through r7. It is written down because the same defects keep reappearing in different
costumes, and because the tooling that is supposed to detect them has a blind spot that is
not obvious until it bites.

Read this before writing a question, changing a matcher, or believing a table.

---

## The pattern: the detector names a symptom, never a cause

The harness reports **disagreements** — cells where the deterministic checklist and the LLM
judge differ by more than 0.25. It is a good alarm and a bad diagnosis. Four times it
pointed at a question, and four times the question was not the problem:

| Alarm said | Actual cause |
|------------|--------------|
| B3 is a bad question | The **judge's rubric** listed optional facts under a "REQUIRED FACTS" heading, so it marked answers down for skipping a bonus. 43 judge scores moved; no cell re-run. |
| B1 is a bad question | The **answer key was false**. It required naming MCP config generation as affected by `mcp.tools`; it is not. The arms had worked that out and were penalised for it. |
| B1 is still wrong | A **regex**. The replacement matcher could not read `## …? No.` or `is **not** affected`, where markdown split the phrase. |
| A1 is a bad question | The **matcher**, simultaneously too loose and too narrow on the same fact. |

The corollary is uncomfortable: **a question landing in the disagreement list is weak
evidence that the question is at fault.** Of every investigation run this week, none ended
at the question. Two ended at the answer key, two at a matcher, one at the judge's prompt.

---

## Lesson 1 — A disagreement detector cannot see a wrong key

The judge's prompt is built from the same checklist the deterministic grader uses. So when
the **key** is wrong, both graders are wrong in the same direction, they agree, and the
detector stays silent.

L2 is the worked example. All 12 cells — every arm, no exceptions — named
`lib/kgbench/report.mjs` as the implementer, which is correct. Score was decided entirely
by whether the answer also *mentioned* `lib/experiments/compare.mjs`: 1.00 if it did (5
cells), 0.15 if it did not (7 cells). Identical correct answers, opposite scores. Judge and
checklist agreed on all 12. **L2 contributed zero disagreements.**

Three key defects were found this week — T2, B1, L2. The detector caught one.

**What to do instead:** audit keys directly. If an arm's answer contradicts the key,
resolve it against the source before assuming the arm is wrong. Cheap heuristic: a question
where *every* arm converges on the same answer that the key calls wrong is a key bug, not a
capability finding.

---

## Lesson 2 — A false-premise key looks exactly like arms failing

Three questions asserted something untrue about the repository:

- **T2** claimed the Cypher path was gone. `runCypherQuery` still existed. Arms that
  produced the query were scored 0; the arm that abstained scored 1. Retired, not deleted,
  so the defect stays visible.
- **B1** required MCP config generation to be affected by `mcp.tools`.
  `generate-docker-mcp-config.sh` never reads the tools list.
- **L2** required the `/experiment` harness's file for a question scoped to the retrieval
  benchmark. Nothing imports that copy at all.

In each case the arms were *right* and the scoreboard said they were wrong. In B1 the two
graders even cancelled out: the judge penalised the arms for "contradicting" the key while
the checklist handed them the point anyway, because its matcher accepted the path inside a
sentence denying it.

**Retire for a false premise, never for scoring badly.** Retiring a question because an arm
does poorly on it is selection, and it silently inflates whatever arm you were rooting for.

---

## Lesson 3 — Matcher normalisation is a family, not a bug

Four separate cells were failed by *decoration* rather than content:

| Answer wrote | Matcher wanted | Cause |
|---|---|---|
| `is **not** affected` | `is not affected` | markdown emphasis |
| `## Is registration affected? No.` | prose phrasing | heading form |
| `single-owner` | `single owner` | hyphen for space |
| `Observations API` | `observations-api` | space for hyphen |

Each was individually fixable by widening one regex, and widening one regex fixes one
phrasing and leaves the next. So normalisation happens **once, centrally**, in
`lib/kgbench/graders.mjs`: `stripEmphasis()` removes `*` and backticks, `foldSeparators()`
folds hyphens, unicode dashes and whitespace runs to a single space.

Two boundaries on that, both learned the hard way:

**`_` is never folded.** It is load-bearing in the symbols these questions ask about —
`CODEGRAPH_MAX_DEPTH`, `ANTHROPIC_BASE_URL`, `MANAGED_MCP_KEYS`.

**Folding applies to literal needles only.** Folding the haystack for every branch broke
S2, whose `f2` is the regex `graphify-serve\.sh`: a haystack folded to `graphify serve.sh`
no longer matched the pattern, and **all 12 of its cells lost a required fact, in all four
arms at once.** A hyphen in author-written pattern source is deliberate. `regex`, `near` and
`symbol` match unfolded text; `path`, `any-of`, `all-of` match folded.

That last failure is worth internalising as a signature: **a defect that moves every arm
identically is a grader bug, not a finding.** Arms differ; graders apply uniformly.

---

## Lesson 4 — A question can collide with a tool's own self-description

A4 originally asked about "CodeGraph's runtime and index configuration … several deliberate
constraints, each recorded with a reason." That is also an accurate description of the
CodeGraph MCP server's own operating instructions — `projectPath` required per call,
`maxFiles` capped, returned source is Read-equivalent, never run `codegraph init` — which
sit in the codegraph arm's context and **in no other arm's**.

Result: 9 of 10 codegraph cells answered from those instructions. True statements about the
wrong subject. The arm scored **0.00 across all 10 reps** while grep, graphify and hybrid
sat at 0.91–1.00, and it looked exactly like a capability gap. Rescoping the prompt to name
*this repository* as the thing doing the pinning — no change to facts, matchers or evidence
— moved codegraph to **0.82, at parity with every other arm**, with zero cells answering
from tool instructions.

**The test:** could one arm read this question as being about its own tooling? If yes, the
question measures susceptibility to a naming collision, and only for the arm you were
trying to measure.

---

## Lesson 5 — A question answerable from general knowledge measures recall, not retrieval

The old A3 and A4 were answerable from general knowledge of transports and tooling: **34 of
40 cells used zero tools.** A2 still has a milder form of this — its facts are close enough
to general benchmark-design practice that an arm which cannot find the source still scores.
Its remaining disagreements are all cells that say, in as many words, *"I can't locate
kgbench source in this sandbox … answering from general benchmarking principles."* The judge
marks those down. The checklist cannot, because generic token-accounting vocabulary —
`overhead`, `system prompt`, `baseline` — satisfies it.

**Two detectors, both cheap:**

- **Zero-tool cells.** An arm answering a repo-specific question without reading anything
  is either lucky or the question is not repo-specific.
- **Hedge phrases** — "can't locate", "based on general practice", "from standard
  principles". Grep the stored answers for them.

---

## Lesson 6 — Test a candidate matcher against the stored answers before adopting it

The plan for A2 was to drop `baseline` from `f2`, on the sound-looking theory that sharing
one token with `f1` let a single word satisfy two supposedly independent facts.

Tested against the stored answers first, it would have taken A2's disagreements from
**6 to 29**. Those answers state the derivation exactly — `content_tokens = total_tokens -
baseline` — expressing subtraction as a *formula* rather than the word. The check that
"proved" they omitted it was a regex looking for `subtract|minus|empty`, which is the same
narrow-vocabulary error the fix was meant to repair.

Full answers are stored precisely so grading can be redone offline. Use them:

```bash
# Never adopt a matcher change before seeing its blast radius across the whole run
node scripts/kgbench-regrade.mjs --run <runId> --dry-run
```

A dry-run regrade is seconds. It caught the S2 regression in Lesson 3 too.

---

## Lesson 7 — Record what was served, not what was requested

`lib/kgbench/judge.mjs` requested `claude-opus-4.8` and `run.json` published that name for
runs r6 and r7. **Every judge call was answered by `claude-haiku-4-5`.** The harness logged
its own intent and never checked the response.

The requested name was simply stale — there is no `claude-opus-4.8`. Opus itself is very
much available: `claude-code`, on the personal Max subscription, serves **`claude-opus-5`**
and `claude-sonnet-5`. What it will not do is serve a version that no longer exists, and the
proxy answers such a request with its own default instead of an error.

**Do not conclude a model is unavailable from a catalog or a single probe.** Both mislead,
in opposite directions, and the second one is not even deterministic:

- `providerModels` **over-reports**: it lists `claude-opus-4.6` for copilot, which answers
  `400 The requested model is not supported`. Copilot has no Opus at all.
- `providerModels` **under-reports**: it lists no Opus 5 or Sonnet 5 anywhere, yet
  `claude-code` serves both.
- A **cold** model falls back. The first probe of `claude-code` + `claude-opus-5` was
  answered by haiku; a second probe on identical settings was answered by
  `claude-opus-5`, and three consecutive repeats were then stable. A one-shot probe
  produces a truth table that is confidently wrong.

So availability is established by probing each provider directly, **more than once**, and
comparing on a canonical name — the same model is spelled `claude-haiku-4.5` (catalog),
`claude-haiku-4-5-20251001` (response) and `haiku` (CLI alias), so raw string comparison
reports substitutions that did not happen. That is what `scripts/llm-model-probe.mjs` does;
it writes `.data/llm-proxy/model-availability.json` and flags any request answered by a
different model, plus any result that changed across repeats.

```bash
node scripts/llm-model-probe.mjs                      # every provider, catalog + aliases
node scripts/llm-model-probe.mjs --provider claude-code --repeats 3
node scripts/llm-model-probe.mjs --show               # cached result, no calls
```

That advice used to end here, with a network-dependent answer: Opus is on the personal
subscription and absent from Copilot, so pick `claude-code/claude-opus-5` at home and
`copilot/claude-sonnet-4.6` at work. **It was wrong, and probing is what hid it.** A probe
establishes that a provider *can* serve a model. It does not establish that it *will* under
load, and those are different questions.

`claude-code` serves `claude-opus-5` — probed stable, three repeats, ~1.7s. But its direct
API answers `RATE_LIMITED` most of the time, and the proxy's fallback (CLI worker pool, same
subscription, different rate-limit bucket) returns `claude-haiku-4-5` **whatever model was
asked for** — the worker is spawned under `key=claude-opus-5::…` and still answers as haiku.
On 2026-08-09 the judge got 21 opus-5 calls and 2065 haiku ones, and the haiku stretch covered
run `coding-v1-x2`.

So the judge is pinned to the provider that **honours** the model, not the one with the best
catalogue: `copilot/claude-sonnet-5` on both networks (probed 2026-08-10 — copilot returns
exactly what it is asked for, and 400s on every Opus variant). A grading instrument whose
model changes with a rate-limit window is not a yardstick, and the gap between "strongest
model reachable" and "strongest model reliably served" is where that stops being obvious.

**Generalise it:** probe availability *and* probe it under the conditions the caller will
actually meet. A capability check answers a narrower question than the one being asked.

Cells now carry `judge_model_served`, `judge_model_requested` and
`judge_served_as_requested`; `run.json` carries `judge.requested` and `judge.served`; a
mismatch prints a warning once per run. The comparison is on the **model only** —
provider is recorded but never alarmed on, because a network-aware reroute is legitimate
and a flag that fires on every legitimate event is a flag nobody reads.

**Generalise it:** any field describing what the harness *asked for* is provenance only.
Publish what came back.

---

## Lesson 8 — Judge capability was not the binding constraint

Given Lesson 7, the obvious worry is that a weak judge corrupted the results. It did not.
An A/B over 18 cells with independently established ground truth — LevelDB-vs-SQLite
answers that must be marked down, formula derivations that must be credited, L2's correct
and transitive-consumer answers — scored:

```
haiku-4.5 (what actually ran)   18/18
sonnet-4.6                      18/18
```

sonnet is *harsher* on the same verdicts, so it separates more sharply, but it never
disagrees in direction. Where the two graders diverged and the cause was chased down, **the
judge was right more often than the deterministic checklist** — including once against a
hand-written check.

Every substantive judge error found this week traced to the **prompt or key it was handed**,
not to its judgment. Spend effort on keys and rubrics before model tiers.

*Caveat: 18 cells, deliberately drawn from cases already understood. This does not prove
haiku is adequate everywhere.*

---

## Lesson 9 — `host_stalled` is a fact about the machine, not the arm

A 300 s timer that fires after 1010 s means the process was descheduled, not that the arm
was slow. `lib/kgbench/runner.mjs` distinguishes the two: `timeout` counts against the arm's
hard-fail rate, `host_stalled` records `score: null` and is excluded from everything.

r7 lost two cells this way when Microsoft Defender and Spotlight drove load average to 40.
Both were re-run once load returned to 4. Scoring them would have blamed codegraph for
corporate AV.

**Watch for it:** a cell whose `wall_s` far exceeds the arm's median while other arms are
unaffected. Check load before concluding anything about the arm.

---

## Lesson 10 — Changing a key obliges a re-judge, not just a regrade

`kgbench-regrade.mjs` re-applies the **deterministic** grader by default and deliberately
does not touch judge fields — silently regenerating them would destroy the disagreement
signal the report depends on.

But the judge's prompt is built from the checklist. So a key change leaves the judge scoring
against the *old* key. After correcting L2, the checklist moved and the judge did not, and
L2 briefly showed **7 disagreements where it had 0** — an artefact of the half-applied fix.

```bash
node scripts/kgbench-regrade.mjs --run <runId>                      # key unchanged
node scripts/kgbench-regrade.mjs --run <runId> --rejudge --only L2   # key changed: scope it
```

Scope `--rejudge` with `--only`. Re-judging questions whose key did not change regenerates
good scores with a non-deterministic model for no reason.

---

## Lesson 11 — Abstain questions carry no checklist and are never judged

T-class questions test whether an arm correctly says "that does not exist". They are graded
deterministically and have no checklist, so the re-judge target filter excludes them by
design.

Their `judge_score` is therefore `null` — which looks identical to "the judge failed here".
Acting on that appearance judged 36 T-class cells that were intentionally unjudged and
manufactured 2 fake disagreements. Restored from the backup.

**Select on cause, not symptom.** "Needs a judge score" is
`judge_pending === true && judge_reason != null`, not `judge_score == null`.

---

## Lesson 12 — A row must be able to reproduce its own number

`runCell` resolved a cell's tokens over a window spanning every attempt, then built the row by
spreading the **last** attempt's result. The row therefore carried the last attempt's
`started_at` and `wall_s` beside an all-attempts token total. Nothing crashed and nothing looked
wrong; the row simply described a different thing from the number printed next to it.

Three failures fell out of that one line, and only the third was ever noticed:

- **The offline backfill would have destroyed the data it was written to protect.** It
  re-resolves from `r.started_at`/`r.ended_at`, which on a retried cell is about half the cell,
  so `--all` would have overwritten 21 correct totals with halved ones — as an improvement.
- **`wall_s` charged a cell that burned 73.6s as 35.6s.** Which flatters exactly the arms that
  needed a second attempt.
- **Every retried cell was flagged ambiguous**, because a retry is a fresh spawn and opens a
  session of its own, and ambiguity was judged per *cell*.

**The ambiguity flag was then diagnosed wrongly twice, and the second diagnosis was believed
because it came with arithmetic.** It said one flagged cell's 274,139 tokens was "its own
139,727 plus its predecessor's 134,412" — which balances exactly, and is wrong. The 134,412 was
the *same cell's first attempt*; the real predecessor was a third session of 172,223 tokens that
was never counted. **An identity that balances is not a causal claim.** Two numbers summing to a
third tells you nothing about which two, and there were three sessions to choose from. The check
that would have settled it in one query — *does any session start inside more than one cell's
window?* — was never run until the fix. It returns zero.

**The correction moved the numbers the wrong way, which is the part worth remembering.** Acting
on the bad diagnosis, the analysis excluded those 21 rows from opencode's medians. A retried cell
pays for two attempts, so the excluded rows were the expensive ones: the "correction" pushed
opencode's measured cost from 1.38× claude's down to 1.16×. A cleanup that makes a result *more
flattering* deserves the same scrutiny as one that makes it worse.

**Three rules.**

1. A row must carry the window its own number was computed over. If it cannot be re-derived from
   the row alone, offline, the row is a claim rather than a measurement.
2. Attribute at the granularity work is *spawned* at. Sessions belong to attempts, not to cells.
3. When a repair reconstructs anything, give it a control that fails loudly. Here: per-attempt and
   whole-span attribution must agree to the token, which is only possible if every session lands
   inside exactly one attempt window. It refused all four cells of the budget-2 run — correctly,
   because that run has a second defect (a continuation `wall_s` that dropped its middle legs)
   which makes the reconstruction land in the wrong place.

---

## Proxy routing facts

These invalidate the obvious mental model and cost a full investigation to establish:

1. **`/api/complete` ignores the request-body `model`.** Only `processOverrides`, keyed on
   the `process` literal, select a model.
2. **A cold model falls back silently on the `claude-code` path.** The first request for a
   model the CLI has not served recently is answered by `claude-haiku-4-5`; a repeat is
   answered correctly, and stays correct. This is what made the path look as though it
   ignored model selection altogether — it does not. Probe twice before believing either
   answer.
3. **`providerModels` is wrong in both directions.** It advertises `claude-opus-4.6` for
   copilot, which answers `400 The requested model is not supported`; and it omits
   `claude-opus-5` / `claude-sonnet-5`, which `claude-code` serves.
4. **Opus is subscription-dependent.** `claude-code` (personal Max) serves Opus 5; Copilot
   has no Opus at any version. The strongest available judge therefore differs by network.
5. **Probe, never assume.** The response body carries `model` and `provider`. One curl
   settles what a config file only suggests — but run it twice, per (2):

```bash
curl -s -X POST http://127.0.0.1:12435/api/complete \
  -H 'Content-Type: application/json' \
  -d '{"process":"kgbench-judge","messages":[{"role":"user","content":"Reply OK."}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("model"), d.get("provider"))'
```

Because of (1), model choice for any process is a `processOverrides` entry. Install via
`scripts/configure-wave-analysis-routing.sh` (`--show` to list, `--reset` to remove only the
`wave-analysis-*` entries) rather than a manual PUT, so it survives a `.data/` wipe. Verify
what a process actually gets with `scripts/llm-model-probe.mjs`, never by reading the config
back — reading back confirms only what was stored, not what will be served.

---

## Lesson 13 — Know the noise floor before publishing an effect

Two claims on the published page were smaller than this benchmark's own run-to-run variance,
and both survived review because they were *modest*.

**The effect that was noise.** The continuation budget was reported to buy completion at the
cost of quality: mean score over answered cells falling 0.977 → 0.948. Re-running the same 48
cells at the same budget gives 0.975. The claimed effect was −0.029; between two runs identical
in arm, agent, model, budget and questions, single questions move the 48-cell mean by −0.011,
+0.021, +0.018. It was never bigger than the noise.

**Measure the floor, don't assume it.** Within a SINGLE run, the same question at the same
settings varies across its 3 reps by a median factor of:

| agent | median max/min content tokens | worst |
|---|--:|--:|
| claude | 1.5× | 2.6× |
| copilot | 1.7× | 5.0× |
| opencode | 1.9× | 6.1× |

At budget 2, opencode reaches 2.1–3.1× median and 12.5× worst. **A per-question token figure on
this benchmark is worth nothing without a replicate.** Arm medians over 48 cells are far more
stable, which is why the headline arm comparison survives three runs while per-question token
figures swing ±100% between two.

**The number that was impossible.** A shared-denominator mean of `0.935` was published for a run
answering 44 of 48 cells whose scores sum to 43.00. The mean over 48 is 0.896; 0.935 would need
those 44 cells to average 1.020, above the maximum score. One multiplication would have caught
it at any point.

**Why both survived.** Each sat next to numbers that were correct, and each pointed the way the
surrounding argument already went. A candidly-admitted cost and a modest gain are exactly the
claims nobody audits — they read as the author being careful. **Scrutiny should scale with how
well a number fits the story, not with how surprising it is.** The corrected figures made the
budget look *better* than the retracted ones (0.896 → 0.975 against 0.935 → 0.948), so neither
error was motivated; they were simply never recomputed.

**Two more shapes of the same error, found by re-checking the page against `r7` and `x2`.**

**A keyword test cannot distinguish an assertion from its negation.** "Does the answer cite
`docker-compose.yml`?" was implemented as `/docker-compose/i.test(answer)`, and on that basis
CodeGraph was published as reaching the file and failing anyway — its A1 losses filed as a
separate, unexplained problem. Six of the ten matching cells name the file only to say they
could *not* read it (*"the real 'coding' repo isn't checked out here"*). The metric scored a
denial identically to a citation, and the conclusion it supported was the exact reverse of the
truth. Re-classified by what the answer *claims* rather than which words it contains, the axis
is perfect: 29 of 29 cells claiming to have read the file score 1.00, 0 of 6 claiming the
repository is absent do. **When a metric is a substring match, the first thing to check is what
the surrounding sentence is doing with it** — and prefer a test that matches the assertion
("found it in `<file>:<line>`") over one that matches the topic.

**An arm's infrastructure must be verified against the tree under test, not against the
repository.** The kgbench sandbox builds a de-contaminated worktree in `os.tmpdir()` and greps
it to prove containment. The CodeGraph arm queries a container-side index of `/workspace/coding`
— the main working tree — which the sandbox never inspected and the container-side server cannot
even see the sandbox to replace. The preflight checked that an index *file existed on the host*;
it never checked that the index *covered the tree the arms were about to search*. **A preflight
that proves a resource exists has not proved it is the right resource.** For anything
path-addressed, assert on the path.

**A refusal is a result, and a rubric that scores it zero will bury a broken tool.** Five L2
cells said, accurately, "there is no index for this project and I will not guess file paths."
They scored 0.00, while cells that named one right file and one wrong one scored 0.50 — so the
scoring paid better for guessing than for a correct report of broken infrastructure, and the
diagnosis sat in the data for three runs looking like a retrieval failure. **When an arm's score
is unusually bad, read its answers before believing the number**: the distinction between "could
not" and "got it wrong" is invisible in a mean and is usually the more actionable of the two.

**Enumerating phrasings is the same defect as matching a substring.** The fix for the lesson
above was a regex listing the ways an answer might say it could not read the file. It published
"five failing cells make no claim in either direction"; reading all sixteen answers gives two.
It missed a denial phrased *"no `.codegraph/` index or file access available in this sandbox"* —
words the list did not contain — and scored two cells that name memory as their source as
silent. The cross-question count it produced, 7, is at least 18. **Both tests decide a semantic
question with a lexical one, and both fail by under-matching, which is silent.** A lexical test
is fit for *finding candidates* and unfit for *counting categories*. Where the population is
small enough to read — sixteen answers — read it, pin the classification cell by cell, and keep
the regex only as a tripwire on the hit count so changed data forces a re-read. Where it is not,
label the number a lower bound.

**An agent's report about its own environment is data, not ground truth.** Those five cells
state that the repository is not checked out. It is: the sandbox is a verified worktree whose
exclusion list covers `.data`, `.specstory` and `CLAUDE.md` — anti-leakage, not source. The
arm had `Read` but no `Glob`/`Grep`, so with an index that does not cover YAML it had no path
to read, and inferred absence from its own inability to search. Only one of four arms ever made
this claim (at least 18 cells of 172; zero for the other three), which is what made it visible. **Check
environment claims against the harness config, not against plausibility.**

**A per-question median hides a bad cell, exactly as a class median hides a bad question.**
This is Lesson 1's defect at a smaller scale, and it was committed *by the audit written to
catch it*. Grading each per-question claim on its per-run medians published B3 as an `r8`-only
artifact; counting cells shows CodeGraph also failing a B3 cell in `x2`, the minority value of
a 1.00 / 1.00 / 0.00 triple. The same recount surfaced Graphify missing 5 of 16 A1 cells across
two runs, which no version of the page had mentioned. **Count cells. A median is a summary of
the thing you are trying to inspect.**

**A bimodal question has no meaningful median.** A4 scores either 0.82 or 1.00 and nothing
else, so a three-rep median is decided by which value lands twice. In `r8` all four arms
produced both values and the medians split 2–2, which the page reported as "graphify and hybrid
drop A4". Pooled over three runs the arms sit at 0.78–0.89 with **hybrid highest**; `r7` alone,
at ten reps per arm, puts all four at exactly 0.82. **Print the distinct scores a question
takes before quoting its median.** If there are two, the median is a coin flip and the question
needs many more reps or none at all.

**A hedged claim is still a claim.** Zero hallucinations in the forced graph arms was called
"the one result that favours an index", correctly hedged as too small to lean on, and then
repeated in three places. Balanced claude-only across four runs it is 2/72 against 0/72:
expected count under a shared rate 1.0, **P(observing zero) = 0.37**. Per-run counts are
0, 0, 1, 4 — the run that made the pattern visible is the outlier. Detecting a real 1.4%
difference needs roughly 400 abstain cells per family against the 72 available. **Compute the
power before publishing an absence.** If the sample cannot distinguish the effect from zero,
the hedge does not rescue the claim; only deleting it does.

**Rules.** Derive published figures from the rows in the claims checker rather than matching
them as text — a checker that greps for `0.935` confirms the typo. Before publishing an
effect, compute the same metric on two runs of the identical configuration; if the effect is
not larger than that gap, it is not an effect. And **do not pin a null result in the claims
checker** — a green check on "no graph arm hallucinated" reads to the next author as a
finding the tooling endorses.

---


## Checklist — before adding a question

- [ ] Is every required fact **true of the repository**? Verify against source, not memory.
- [ ] Could an arm read the question as being about **its own tooling**? (Lesson 4)
- [ ] Is it answerable **without reading the repo**? If so it measures recall. (Lesson 5)
- [ ] Does any match token appear in **two different facts**? They stop being independent.
- [ ] Do the matchers survive markdown, hyphens and headings? (Lesson 3)
- [ ] Does `scripts/kgbench-verify-questions.mjs` confirm every evidence `file:line`?

## Checklist — before publishing a run

- [ ] Outcomes: any `host_stalled` re-run at low load? Any `timeout` genuinely the arm's?
- [ ] `run.json` `judge.served` present, and equal to `judge.requested`?
- [ ] Zero-tool cells: expected for this question class, or a sign of Lesson 5?
- [ ] Disagreements: for each, cause identified — and **not assumed to be the question**?
- [ ] Any defect that moved **every arm identically**? That is a grader bug. (Lesson 3)
- [ ] Provenance: how many commits, which passes, which questions re-run in each?
- [ ] `--dry-run` regrade clean, and grader tests passing?
- [ ] Every row's `wall_s` at least the sum of its own `attempts[]`? (Lesson 12)
- [ ] Every published figure multiplied out — does `mean × n` equal the score sum? (Lesson 13)
- [ ] Any claimed effect smaller than the single-question run-to-run swing? (Lesson 13)
- [ ] Any question whose cells take only two distinct scores? Its median is a coin flip. (Lesson 13)
- [ ] Any claim resting on an **absence** — is the sample large enough to have seen one? (Lesson 13)
- [ ] `kgbench-backfill-tokens.mjs --all --dry-run` refuses nothing and shrinks nothing?
- [ ] Any subset excluded from a median — is the exclusion's *cause* established, and does the
      exclusion move the result in the flattering direction? (Lesson 12)

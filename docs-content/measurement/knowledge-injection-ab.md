# Does Knowledge Injection Help? A Controlled A/B

Two arms of the same agent, differing only in whether retrieved knowledge is prepended to
the prompt. Graded mechanically, with no model in the loop.

=== "⚡ Quick (~3 min)"

    ## The headline

    On tasks whose answers live in the knowledge base rather than in the code, the control arm
    failed where the treatment arm succeeded in **9 of 11 cases (82%, 95% Wilson 52–95%)** — and
    spent **3.1× the steps, 1.8× the wall-clock and 6.8× the tokens** failing.

    Injection was not a trade of cost against accuracy. It was cheaper *and* correct.

    ## The kind of test

    Closed-book versus open-book, **not** needle-in-a-haystack. The graded fact is deliberately
    **absent** from the frozen repository copy both arms work in, so the only way to know it is
    to have been given it.

    Each task asks for an operator runbook, graded by regular expressions over the produced file.

    ## The caveat that must travel with the number

    82% is **not** the probability that injection helps on an arbitrary task, and must never be
    quoted as though it were.

    The gates are mined from what the treatment arm wrote, so the treatment arm passes them close
    to by construction. The load-bearing half of the measurement is the **control arm's failure**
    — which nothing in the gate's construction arranged, because the control arm is never
    consulted while a gate is built.

    ## What it does not establish

    One model, one repository, deliverables that are documents rather than code that must compile
    and pass tests. At n=11 the interval is wide enough to size the next round rather than settle
    the question — **report it as a pilot**.

    One curated task showed injection making things *worse*. That is the most transferable
    finding here.

=== "📖 Standard (~15 min)"

    ## Two rounds, two different questions

    | | Round 1 — curated | Round 2 — sampled |
    |---|---|---|
    | Tasks | 3, hand-written | 11, derived mechanically from KB insights |
    | Cells | 18 | 66 |
    | Answers | how **large** is the effect | how **often** does it arise |
    | Headline | 6/6 accepted vs 0/6 on the two surviving tasks | 9 of 11 tasks discriminate — 82% |

    The split matters. Hand-written tasks can show that an effect is real and large, but they
    cannot tell you how often it occurs, because you chose them. Mechanically derived tasks can
    answer the frequency question, at the cost of a subtler bias that has to be argued about
    rather than assumed away.

    ## Why the design is believable

    **Isolation.** Both arms get the same model, the same tools and the same frozen copy of the
    repository. The only difference is whether retrieved knowledge is prepended.

    **The fact is absent.** Because the graded fact does not exist anywhere in the sandbox, an arm
    without injection cannot find it by searching harder. This is what makes the comparison
    closed-book against open-book rather than a test of retrieval skill within a corpus.

    **Grading has no model in it.** Regular expressions over the produced file. A model-graded
    result would put the thing being measured on both sides of the experiment.

    **The control arm is never consulted while a gate is built.** This is the single most
    important property. It means the treatment arm's near-guaranteed pass rate is uninformative
    and discarded, while the control arm's failure rate — the number the conclusion rests on — is
    untouched by how the gates were made.

    ## Reading the result correctly

    The honest statement is: *on tasks constructed from knowledge the codebase does not contain,
    an agent without that knowledge failed 82% of the time, while burning several times the
    resources doing so.*

    The dishonest paraphrase — "injection helps 82% of the time" — silently swaps the population.
    The tasks were selected to be ones where knowledge could matter; the frequency of such tasks
    in real work is **not measured here**.

    The cost figures are the part that generalises most comfortably. A failing agent does not fail
    quickly: it searches, re-reads and retries, which is why the control arm spent 6.8× the tokens
    to arrive nowhere.

    ## The next round

    A larger n to narrow the interval, a second repository to test whether the effect is a
    property of this codebase, and deliverables with objective pass/fail tests rather than
    documents. The negative case from round 1 — where injection hurt — deserves its own
    investigation before the positive result is scaled.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/measurement/knowledge-injection-ab.deep.md"

# Experimental Design

Every control standing between a benchmark run and a number you should not trust — and,
for each, the specific failure that made it necessary.

=== "⚡ Quick (~3 min)"

    ## Nothing here is hypothetical

    Every control below exists because a run without it produced a plausible, publishable, wrong
    result.

    ## The seven parts

    | Part | Controls |
    |------|----------|
    | 1 | **Containment** — what the system is allowed to read |
    | 2 | **Enforcement** — what it is allowed to do |
    | 3 | **The asymmetry that cannot be fixed** |
    | 4 | **The environment** it inherits |
    | 5 | **Making token counts comparable** |
    | 6 | **Scoring** without fooling yourself |
    | 7 | **What is still not controlled** |

    Part 7 is not an omission. A design document that lists only solved problems is telling you
    less than it appears to.

    ## The one principle

    Measure the thing you claim to be measuring. Every failure catalogued here is a case of
    something else varying at the same time — the answer reachable by an unaccounted route, the
    harness overhead differing between arms, or the grader itself being under test.

    ## If you read one part

    **Part 3.** Some asymmetries between arms cannot be engineered away, only stated. Knowing
    which ones those are is the difference between a limitation and a flaw.

=== "📖 Standard (~15 min)"

    ## Containment and enforcement

    The first two parts are about the gap between what an arm is *supposed* to see and do, and
    what it *can*.

    An agent with tools can reach an answer by routes the design never considered: the repository
    itself, output it produced earlier in the same run, environment it inherited, or an artefact
    cached from a previous run. Six such channels were found here — and one of them was
    structurally invisible to the sandbox built specifically to prevent that class of leak, which
    is the more useful lesson. A containment mechanism you cannot see through is a containment
    mechanism you cannot verify.

    Enforcement is the other half: restricting what an arm may *do* — which tools it may call —
    is what makes an arm a strategy rather than a label. An arm whose restriction is not actually
    enforced is measuring the unrestricted system under a different name.

    ## The asymmetry that cannot be fixed

    Some differences between arms are not engineering defects; they are properties of the
    comparison. Where that is the case the honest response is to state it prominently rather than
    to add machinery that appears to address it. A control that looks like it removes a bias, but
    does not, is worse than no control — it converts a known limitation into an unknown one.

    ## Comparable token counts

    Raw totals are not comparable across arms because each arm carries different harness
    overhead. The floor is measured with dedicated probes and subtracted, so what remains is
    attributable to the strategy.

    This is also where double-counting hides. A token column that sums two overlapping sources
    produces numbers that are wrong by a consistent factor, which is exactly the kind of error
    that survives review — everything is internally consistent and merely wrong.

    ## Scoring

    Two rules. **Grade mechanically where possible**, because a model in the grading loop puts
    the thing under test on both sides of the experiment. And **test the grader against known-bad
    answers**, not only known-good ones: a grader that has never rejected anything has not been
    shown to discriminate.

    Storing full answers rather than verdicts is what makes a grading defect recoverable — the
    grader can be corrected and re-applied offline, and results that change under the correction
    can be recognised as artefacts rather than findings.

    ## What is still not controlled

    Part 7 of the Deep Dive enumerates the known-open items. They are listed deliberately: the
    checklist at the end of that section is a tool for reading someone else's benchmark as much
    as for running this one.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/measurement/kgbench-experimental-design.deep.md"

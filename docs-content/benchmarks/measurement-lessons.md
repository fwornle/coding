# Measurement and Judging Lessons

Everything here was learned by getting it wrong first. Read it before writing a question,
changing a matcher, or believing a table.

=== "⚡ Quick (~3 min)"

    ## The one pattern

    **The detector names a symptom, never a cause.**

    The harness flags *disagreements* — cells where the deterministic checklist and the LLM judge
    differ materially. It is a good alarm and a bad diagnosis. Four times it pointed at a
    question; four times the question was fine:

    | The alarm said | The actual cause |
    |----------------|------------------|
    | B3 is a bad question | The judge's rubric listed optional facts under "REQUIRED FACTS" |
    | B1 is a bad question | The **answer key was false** — the arms had worked that out and were penalised for it |
    | B1 is still wrong | A regex that could not read the phrase split across markdown |
    | A1 is a bad question | A matcher simultaneously too loose and too narrow on the same fact |

    ## The corollary

    **A question appearing in the disagreement list is weak evidence that the question is at
    fault.** Of every investigation run, none ended at the question: two ended at the answer key,
    two at a matcher, one at the judge's prompt.

    ## Before you change anything

    Test a candidate matcher **against the stored answers** before adopting it. Changing an answer
    key obliges a re-judge, not just a regrade — the judge scored against the old key.

    ## Record what was served

    Not what was requested. The two differ, and only one of them is what happened.

=== "📖 Standard (~15 min)"

    ## Why these keep recurring

    The defects below reappear in different costumes because they share a shape: something other
    than the system under test is varying, and the machinery built to detect that has a blind spot
    in exactly the same place.

    ## The lessons that generalise

    **A disagreement detector cannot see a wrong key.** If the answer key is false, both the
    checklist and the judge score against it, agree with each other, and the detector stays quiet.
    Agreement is not correctness — it is only the absence of one particular kind of error.

    **A false-premise key looks exactly like arms failing.** When a key requires asserting
    something untrue, competent arms work out that it is untrue and are marked down for it. The
    table shows a hard question; the reality is a wrong question.

    **Matcher normalisation is a family, not a bug.** Fixing one normalisation failure — markdown
    splitting a phrase, emphasis inside a match, a heading form — reliably surfaces siblings.
    Treat the first as evidence of a class.

    **A question can collide with a tool's own self-description**, which makes it measure whether
    the tool describes itself rather than whether retrieval works.

    **A question answerable from general knowledge measures recall, not retrieval.** If the model
    already knows the answer, every arm scores well and the benchmark has measured nothing about
    the retrieval strategies it was built to compare.

    **Judge capability was not the binding constraint.** The instinct on a bad judging result is
    to reach for a stronger judge. In every case here the problem was the rubric or the key, and a
    stronger judge would have applied the same wrong standard more consistently.

    **`host_stalled` is a fact about the machine, not the arm.** Attributing an environmental
    failure to the strategy under test corrupts exactly the comparison the run exists to make.

    ## The discipline that follows

    Test a candidate matcher against the **stored answers** before adopting it — a matcher that
    looks right and has never been run against real output is a hypothesis.

    Changing a key obliges a **re-judge**, not merely a regrade: the judge's scores were produced
    against the old key and do not survive it changing.

    Record **what was served**, not what was requested. The gap between the two is where several
    of these failures hid, and it is invisible unless the served value is written down.

    Abstain questions carry no checklist and are never judged — which is correct, and worth
    knowing before you go looking for their missing scores.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/benchmarks/measurement-lessons.deep.md"

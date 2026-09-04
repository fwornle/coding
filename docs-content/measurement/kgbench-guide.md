# Benchmarking Agent Systems

How to measure systems that do cognitive work with LLMs so the numbers survive scrutiny.
kgbench is the worked example; the hazards are the point.

=== "⚡ Quick (~3 min)"

    ## The hazard

    Every control described here exists because a run without it produced a **plausible,
    publishable, wrong** result. Among them: six distinct channels by which answers leaked into
    the systems being tested, a comparison that turned out to be one configuration measured
    against itself, a token column that silently double-counted, and a report that published a
    grading model which had never graded anything.

    Each of those produced a tidy table. That is what makes this hard — the failure mode is not
    an error message, it is a believable number.

    ## The vocabulary

    Five terms carry the whole framework:

    | Term | Means |
    |------|-------|
    | **Arm** | One retrieval strategy under test |
    | **Cell** | One (arm × agent × model × question × rep) — a single measured run |
    | **Axis** | A dimension the matrix varies |
    | **Containment** | What a system is allowed to read |
    | **Baseline** | The token floor that must be subtracted before arms are comparable |

    ## The one rule

    **Measure the thing you claim to be measuring.** Almost every failure below is a case of
    something else varying at the same time — the environment, the harness overhead, the grader,
    or the answer being reachable by a route nobody accounted for.

    ## Read next

    The [Glossary](kgbench-guide.md#glossary) defines every term precisely. The
    [Tutorial](kgbench-tutorial.md) is hands-on. [Experimental Design](kgbench-experimental-design.md)
    enumerates each control and the failure that motivated it.

=== "📖 Standard (~15 min)"

    ## Three reasons this is hard

    A benchmark over a deterministic system is mostly bookkeeping. A benchmark over an LLM agent
    is not, for three reasons that compound.

    **The system can reach the answer by routes you did not design.** An agent has tools. If the
    answer exists anywhere it can read — the repository, its own prior output, an environment
    variable, a cached artefact — then an arm that was supposed to be handicapped is not. Six
    such channels were found here, one of them structurally invisible to the sandbox built to
    prevent exactly that class of leak.

    **Cost is not a single number.** Raw token totals conflate the strategy's cost with the
    harness overhead around it. Two arms with identical retrieval can differ in totals purely by
    how much scaffolding each needs, which is why a measured floor must be subtracted before
    arms are compared.

    **Grading is itself a system under test.** A grader that is wrong produces results that are
    wrong in a *consistent* direction, which reads as signal.

    ## The shape of a run

    A **cell** is the atom: one arm, one agent, one model, one question, one repetition. The
    matrix is the product of those axes, and the report aggregates cells that share a question
    across repetitions.

    Each cell runs in its own git worktree of the benchmark commit. That containment is not
    hygiene — it is what allows the claim that an arm saw only what its strategy permits. A run
    outside a worktree cannot make that claim, so the harness refuses to start.

    ## What comes out, and what to distrust

    Results stream to disk as cells complete, and full answers are stored rather than only
    verdicts. That choice is load-bearing: it means a grading defect can be corrected and
    re-applied offline, and a result that changes under a corrected grader can be recognised as
    never having been a finding.

    Three questions to ask of any table this produces:

    1. **How many cells actually ran?** Refused combinations are reported by preflight and are
       easy to skim past. A matrix missing cells still renders as a complete-looking table.
    2. **Was the token floor subtracted?** Without it, the comparison includes the harness.
    3. **Has the grader itself been checked against known-good and known-bad answers?** A grader
       that has never rejected anything has not been tested.

    ## Applying this elsewhere

    The transferable parts are not the scripts. They are: contain the system so it can only reach
    what you intend; measure the floor so cost comparisons are about the thing that varies; store
    raw output so grading is revisable; make refusals loud so an incomplete matrix cannot pass as
    a complete one; and treat any result that looks clean on the first run as a hypothesis about
    your harness rather than about the world.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/measurement/kgbench-guide.deep.md"

# Tutorial — Running and Extending the Benchmark

Hands-on: run a measurement, read its output, then add a question, an arm, a retrieval
backend and an agent.

=== "⚡ Quick (~3 min)"

    ## What must be true first

    Three things must be true: you are in a **git checkout** (each run is a worktree), the **LLM
    proxy is up on `:12435`**, and each graph arm has a **built index**.

    Preflight checks all three and tells you the fix for whichever is missing:

    ```bash
    node scripts/kgbench-run.mjs --set coding-v1 --preflight-only
    ```

    ## Your first measurement

    ```bash
    node scripts/kgbench-run.mjs --set coding-v1 --only L1 --reps 1 --run-id first
    node scripts/kgbench-report.mjs --run first
    ```

    One question, one repetition — enough to see the shape of the output without spending much.

    ## Then a real matrix

    ```bash
    node scripts/kgbench-run.mjs --set coding-v1 --reps 3 --run-id real
    ```

    Repetitions matter: a single run of a non-deterministic system is an anecdote.

    ## What you can extend

    New questions, new arms, new retrieval backends and new agents are all additive — each has a
    worked walkthrough in the Deep Dive, in that order of difficulty.

    ## The pitfall to know first

    Run `--preflight-only` before every real run. Some combinations are deliberately refused, and
    a matrix that quietly ran fewer cells than you expected still produces a tidy table.

=== "📖 Standard (~15 min)"

    ## Getting a first number

    Start small enough to iterate. One question and one repetition finishes quickly and produces
    the same artefacts as a full run, so you can learn the output format before committing to a
    matrix:

    ```bash
    node scripts/kgbench-run.mjs --set coding-v1 --only L1 --reps 1 --run-id first
    node scripts/kgbench-report.mjs --run first
    ```

    Results land in `.data/kgbench/runs/first/results.jsonl`, one line per completed cell. The run
    can be inspected while it is still going, and resumed later with the same `--run-id`.

    ## Scaling up

    ```bash
    node scripts/kgbench-run.mjs --set coding-v1 --reps 3 --run-id real
    ```

    Three repetitions is the practical minimum for a claim, because the variance between
    identical cells is real and sometimes large. If two arms differ by less than the spread within
    one arm, you have not measured a difference.

    Add axes as needed — `--agents` and `--models` widen the matrix multiplicatively, so grow one
    axis at a time and check the cell count in preflight before starting.

    ## Extending it

    The four extension points, in increasing order of work:

    **A new question** is a data change: the question, the expected answer, and the grading
    pattern. Write the grading pattern so that it rejects a plausible wrong answer, not merely
    that it accepts the right one — a pattern that accepts everything looks identical to one that
    works.

    **A new arm** declares a retrieval strategy and the tools it may use. The tool restriction is
    the arm; getting it wrong means measuring something other than what you named.

    **A new retrieval backend** is the substantial one — it needs an index, a query path and a
    preflight check that fails loudly when the index is missing.

    **A new agent** slots into the agent axis and mostly needs its invocation and its token
    accounting wired up correctly.

    ## Pitfalls

    - **Skipping preflight.** Refused combinations are reported there and nowhere as loudly later.
    - **One repetition.** Not a measurement.
    - **Comparing raw token totals.** Subtract the measured floor first.
    - **Trusting a first clean run.** Treat it as evidence about the harness until something has
      failed the way you expect it to.
    - **Grading patterns that only accept.** Test them against a deliberately wrong answer.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/measurement/kgbench-tutorial.deep.md"

# kgbench: the code-retrieval benchmark

One question: is a code-graph backend worth its cost, compared with an agent that just
greps?

=== "⚡ Quick (~3 min)"

    ## What it does

    The same questions run through several **arms** — each a headless agent restricted to one
    retrieval strategy — scored on correctness, tokens, latency and failure rate.

    ## How to run it

    ```bash
    # check every arm is reachable before spending anything
    node scripts/kgbench-run.mjs --set coding-v1 --preflight-only

    # the full matrix
    node scripts/kgbench-run.mjs --set coding-v1 --reps 3 --run-id my-run

    # render the report
    node scripts/kgbench-report.mjs --run my-run
    ```

    Always start with `--preflight-only`. It prints which combinations will run **and which will
    be refused, with reasons**, before anything is spent.

    ## Resuming and re-grading

    Results stream to `.data/kgbench/runs/<run-id>/results.jsonl` as they complete, so a run can
    be inspected mid-flight and resumed with the same `--run-id`. Full answers are stored, which
    means a corrected grader can be re-applied offline instead of re-running the matrix.

    ## The disposition

    The harness is built to **fail loudly rather than produce a plausible number**, because its
    output informs a keep-or-drop decision. Two of its properties exist specifically because the
    benchmark got a wrong answer past its own author on the first real run.

=== "📖 Standard (~15 min)"

    ## The matrix

    Runs are **arm × agent × model × question × rep**. The agent and model axes default to what
    the single-agent runner used to do, so a run passing neither flag is identical to one from
    before those axes existed — and stays comparable with the earlier results.

    ```bash
    node scripts/kgbench-run.mjs --set coding-v1 --arms grep,hybrid \
      --agents claude,copilot,opencode --reps 3 --run-id cross

    node scripts/kgbench-run.mjs --set coding-v1 --models claude-sonnet-4.6,claude-opus-5
    ```

    Useful flags: `--arms` and `--only` to select arms and questions, `--no-judge` to skip the
    LLM cross-check, `--no-baseline` to skip token-floor measurement, and `--baseline-reps` to
    change how many probes measure each floor.

    ## What must be true before it runs

    | Requirement | Why | If missing |
    |-------------|-----|------------|
    | A git checkout | Each run tree is a `git worktree` of the benchmark commit | Hard error — it will not run uncontained |
    | The LLM proxy on `:12435` | Every call is routed and measured | Preflight aborts and names the fix |
    | A built index per graph arm | The backend needs its graph to exist | Preflight names the reindex command |

    The containment requirement is not a formality. The whole comparison rests on each arm seeing
    only what its strategy is supposed to see, and a run outside a worktree cannot promise that.

    ## Reading a result honestly

    Three habits, each learned from a wrong answer that looked right:

    **Check the refusals, not just the successes.** Some (arm, agent, model) combinations are
    deliberately refused; a matrix that quietly ran fewer cells than you think will still produce
    a tidy table.

    **Distinguish a grading defect from a finding.** Because full answers are stored, a suspicious
    result can be re-graded offline. A result that changes under a corrected grader was never a
    finding about retrieval.

    **Treat token counts as needing a floor.** Comparing raw totals across arms conflates the cost
    of the strategy with the cost of the harness around it, which is what the baseline probes
    measure and subtract.

    ## Where to go next

    - [Benchmarking Agent Systems](kgbench-guide.md) — the framework and its vocabulary
    - [Tutorial](kgbench-tutorial.md) — run one, then extend it
    - [Experimental Design](kgbench-experimental-design.md) — every control and the failure that motivated it

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/measurement/kgbench.deep.md"

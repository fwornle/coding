# Code-retrieval benchmark: `coding-v1`

**Does a code-graph backend earn its keep, compared with an agent that just greps?**

=== "⚡ Quick (~3 min)"

    ## The answer

    **No measurable correctness gain.** Every arm's median correctness is 1.00 — grep, graphify,
    codegraph and hybrid alike. What differs is what asking costs.

    | | grep | graphify | codegraph | hybrid |
    |---|--:|--:|--:|--:|
    | Correctness (median) | 1.00 | 1.00 | 1.00 | 1.00 |
    | Tokens per query | **69,164** | 139,809 | 72,662 | 78,854 |
    | Latency per query | 16.2s | 29.3s | 15.1s | **14.4s** |
    | Hard failures | 0/48 | 0/48 | 0/48 | 0/48 |

    ## Read the claude column only

    It is the only agent whose tool surface is actually **enforced**, so it is the only one where
    "the grep arm" means the agent *could not* reach a graph tool rather than merely wasn't
    configured with one.

    ## What the agent does when free to choose

    Given every tool and no instruction, it reaches for text search **91%** of the time. But a
    single rate is the wrong summary: of 16 questions, **4 ever elicit a graph call and 12 never
    do**. That is a near-deterministic policy, not a low sampling rate.

    ## The honest framing

    A **null result on 16 questions** — not proof that code graphs are worthless. One question
    still runs against the graph arms, two now run in their favour, and the earlier headline
    finding was withdrawn when it turned out to measure a broken index rather than a backend.

=== "📖 Standard (~15 min)"

    ## What changed, and why the old finding was wrong

    For four runs this page reported CodeGraph failing every L2 cell and called it "the finding —
    nothing else is that clean". It was an artefact: the index was serving the wrong tree, so the
    arm was quietly degraded to *Read, with a broken tool attached*. Reading files is expensive,
    which is also where its apparent cost penalty came from.

    With the index repaired, that arm takes all of those cells and its median tool calls on L2
    drop from 12 to 2 — it had been flailing against a tool returning nothing. **The cleanest
    result on the page was the cleanest measurement of a defect.**

    Two lessons travel with that. A benchmark's most striking finding deserves the most suspicion,
    and a cost comparison against a broken backend measures the breakage.

    ## Reading the arms

    CodeGraph now runs at 1.05× grep's tokens and 0.93× its latency — marginally *faster* than
    grep at roughly the same cost to run. Graphify remains the expensive one at 2.0× tokens and
    1.8× latency.

    The **hybrid** arm is the one to read the others against, because it is the only one shaped
    like production: every tool available, free choice. It is now the fastest arm on the page.

    ## What the agent actually reaches for

    Across 48 cells hybrid made 227 tool calls, 20 of them graph queries, with 18 of 48 cells
    consulting a graph at all. Pooled across four runs with a byte-identical tool surface — 248
    cells, 1,084 tool calls — **17 reach a graph tool: 1.57%, 95% CI [0.1%, 3.0%]** when the
    interval is clustered on the question rather than computed over calls.

    That clustering matters. Computing the interval over calls treats 1,084 correlated
    observations as independent and produces a confidently wrong band.

    ## The surviving finding

    **A1** is the only result left running against the graph arms: CodeGraph misses all three of
    its cells, Graphify and hybrid one of three, grep none. The answer is a six-line YAML comment,
    and neither backend indexes YAML — a fact about what a code index *contains*, not about how
    well it searches.

    It is trustworthy precisely because the index repair left it untouched, while erasing L2.

    ## What it does not show

    Sixteen questions, one repository, one model. The hypothesis the set was built to test — that
    a graph answers *"that isn't here"* better than grep — did not reproduce; all four arms
    abstained correctly on every trap.

    Two questions tip *toward* the graph arms by one cell each. That is noise, and is reported as
    noise rather than as a counter-finding — a discipline this page adopted after one of them was
    once misread the other way.

    ## Reproducing it

    ```bash
    node scripts/kgbench-run.mjs --set coding-v1 --preflight-only
    node scripts/kgbench-report.mjs --run <run-id>
    ```

    Stored answers mean a corrected grader can be re-applied offline without re-running anything.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/benchmarks/coding-v1/README.deep.md:3"

# Performance Dashboard — Full Reference

Every tab, column, badge and score dimension on the Performance dashboard — including the
hover tooltips, written out as visible prose.

=== "⚡ Quick (~3 min)"

    ## Where it is

    [localhost:3032](http://localhost:3032) → **Performance**.

    ## The tabs

    | Tab | Shows |
    |-----|-------|
    | **Runs** | Every measured and ambient run, grouped, with its timeline |
    | **Avenues** | One prompt swept across agent, model, framework and knowledge axes |
    | **Compare** | Variants ranked for one task |
    | **Reports** | Generated experiment reports |

    Plus a **Context & Caching** explainer for the per-turn context breakdown.

    ## The rule to remember

    A variant is **only cost-ranked if it passed an objective test gate**. Anything that failed,
    was never gated, or could not be scored appears separately and is never averaged into the
    ranking — so an empty ranked section means nothing passed, not that nothing ran.

    ## Why this page exists

    The dashboard hides a lot of load-bearing explanation behind hover tooltips. They are all
    reproduced here as text, because a tooltip you have to know exists is not documentation.

    ## Softer entry points

    For a screenshot-driven walkthrough, start with the [Tutorial](tutorial.md). For the model
    behind the numbers, read the [Overview](overview.md).

=== "📖 Standard (~15 min)"

    ## What the page is for

    The Performance dashboard is the single front-end over every measured run — ambient ones
    recorded passively, named measurement spans, and full experiment matrices. The tabs differ in
    how much they ask of you, not in where their data comes from.

    ## Runs

    The grouped table of every run in the window, each expandable into a role-lane **timeline**
    showing where its time and tokens went. Ambient runs appear here alongside deliberate ones and
    are distinguishable by carrying no quality score — the judge is not run for them.

    ## Avenues

    A completed run can be forked into **avenues**: the same prompt swept across the agent, model,
    framework and knowledge axes, each on its own isolated branch. This is the tab for "what if we
    had done it the other way" without re-typing the goal.

    ## Compare

    Variants for one task, ranked. The ranking obeys the grouping rule that runs through this
    whole system: **ranked**, **failed**, **ungated** and **unscored** are four distinct
    outcomes, and only the first is cost-ranked. That is deliberate — a comparison that promoted a
    failing variant because it was cheap would be worse than no comparison.

    When the ranked section is empty, the honest reading is that nothing passed its gate, which is
    usually a message about the gate rather than about the variants.

    ## Badges and glossary

    The dashboard uses badges to carry provenance — whether a figure was observed live or
    reconstructed afterwards, and whether a run's tokens are complete. Reconstructed values are
    badged rather than silently blended, because a number rebuilt against today's configuration
    is wrong wherever the configuration has since changed.

    Every badge, column and score dimension is catalogued in the Deep Dive below, along with each
    hover tooltip written out in full.

    ## Related

    - [Overview](overview.md) — run, score, comparison
    - [Tutorial](tutorial.md) — a guided walkthrough
    - [Architecture](architecture.md) — the measurement sequence and data model

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/measurement/dashboard-reference.deep.md"

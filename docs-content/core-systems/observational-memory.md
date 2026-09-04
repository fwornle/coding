# Observational Memory

The system notices what you do, distils it daily, and turns the durable parts into project
knowledge.

=== "⚡ Quick (~3 min)"

    ## Three tiers

    | Tier | What | When | Volume |
    |------|------|------|--------|
    | **Observations** | Per-exchange summaries — intent, approach, artifacts, result | Real time | ~30/day |
    | **Digests** | Daily thematic summaries of a work session | End of day | ~7/day |
    | **Insights** | Persistent project knowledge | Weekly, or after ≥5 new digests | ~10 total |

    Each tier is a compression of the one below it. Nothing is promoted for being recent — only
    for surviving the distillation.

    ## Where it lives

    The runtime store is km-core's graph store at `.data/knowledge-graph/`, with git-tracked JSON
    exported to `.data/observation-export/` so knowledge travels with the repository.

    The observations API is on **port 12436**.

    ## Historical note when reading the Deep tier

    Sections describing SQLite, WAL mode and single-owner corruption recovery are **historical**.
    All four writer, consolidator, pruner and retrieval surfaces are km-core-native now; that
    prose is kept for context, not as current behaviour.

    ## Seeing it

    The dashboard's memory tiers let you browse observations, digests and insights, and the same
    material is what gets injected into later sessions.

=== "📖 Standard (~15 min)"

    ## Why a hierarchy rather than a log

    Raw observations are too numerous and too specific to be useful later — thirty a day, each
    about one exchange. Digests compress a day into themes. Insights keep only what stayed true
    across days.

    The value is in the discarding. A system that kept everything would retrieve everything, and
    retrieval that returns everything is the same as no retrieval.

    Promotion is by survival, not recency: an insight exists because the pattern behind it kept
    recurring, which is a much stronger signal than having happened lately.

    ## What is captured

    Each observation is structured rather than free text — intent, approach, artifacts, result —
    so that later consolidation has fields to work with instead of prose to re-parse. All four
    agents feed it.

    ## Storage, and what the Deep tier says about it

    The runtime store is the km-core graph store at `.data/knowledge-graph/`. Git-tracked JSON
    under `.data/observation-export/` is what makes the knowledge portable between machines,
    mirroring the pattern the knowledge base uses.

    The Deep tier below contains substantial material about SQLite, WAL mode, single-owner access
    and corruption recovery. That describes **historical** behaviour: the SQLite store was
    archived once the writer, consolidator, pruner and retrieval paths all moved to km-core. It is
    retained because it explains why several current design choices exist, not because it
    describes what runs today.

    ## The API

    The observations API on port 12436 is also the only mount point for km-core's shared REST
    surface, under `/api/km/`. That makes this system the first consumer of the three-system
    km-core architecture rather than a separate store that happens to look similar.

    ## How this reaches your prompts

    Observations, digests and insights are all retrievable tiers at injection time, weighted
    differently — insights rank above digests, which rank above raw observations. See
    [Knowledge Context Injection](../architecture/knowledge-injection.md) for how the selection
    and budgeting work.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/core-systems/observational-memory.deep.md"

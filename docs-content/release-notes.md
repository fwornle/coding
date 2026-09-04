# Release Notes

Highlights since the v6.0 Knowledge Context Injection milestone, grouped by subsystem.

=== "⚡ Quick (~3 min)"

    ## How to read this

    Entries are grouped by **subsystem**, newest first within each, and dated. They record what
    changed and — more usefully — what the change was found to be hiding.

    ## The recurring theme

    A striking number of these entries are the same shape: something reported success while doing
    nothing. A backfill that measured its own conversion rather than trusting it found **five
    silent data-losing bugs**, three in the backfill itself, all before any write.

    That is the pattern worth carrying: verification against ground truth, not against the thing
    being verified.

    ## If you are catching up

    Read the subsystem you work in rather than the whole file. Each group is self-contained, and
    the entries name the commits so a change can be traced from here.

=== "📖 Standard (~15 min)"

    ## What this file is

    A running record of what changed since the v6.0 milestone, grouped by subsystem rather than
    strictly by date, so that catching up on one area does not mean reading everything.

    Entries are written to be useful after the fact rather than at release time: alongside what
    changed, they record what the change revealed, which is usually the part that transfers.

    ## The pattern across entries

    Read enough of them together and one shape dominates: **a process that reported success while
    doing nothing**. A docs gate that skipped a build and went green. A backfill that was silently
    a no-op. An index serving the wrong tree, producing a benchmark result clean enough to be
    called "the finding". A classifier routed by a field nothing read.

    None of these announced themselves. Each was found by measuring an outcome against ground
    truth rather than trusting the report — which is why so many entries here pair a fix with a
    guard, and why several guards have their own negative controls.

    ## Using it

    Each entry names its commits, so anything here can be traced back to the change that made it.
    Where a change altered a contract — a storage format, a routing key, a command — the entry
    says what the old behaviour was, because that is what you need when something in your own
    setup still assumes it.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/release-notes.deep.md"

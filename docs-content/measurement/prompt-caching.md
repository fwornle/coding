# Prompt Caching, End to End

Why cache-write is zero for some agents, why the cache-read band sits on a floor and then
jumps — and why neither is a bug.

=== "⚡ Quick (~3 min)"

    ## The one-sentence model

    Caching never stores your *text*. It stores the **provider's computation over a stable
    prefix** of the prompt, so the next request beginning with the same prefix skips
    re-computing it. Everything else follows from that.

    ## Why there is a prefix at all

    An LLM API is **stateless**. Every turn re-sends the whole conversation — system
    instructions, tool definitions, all prior messages, then the new input. The front of that
    barely changes between turns; history only grows at the end. That unchanging front is the
    only thing that can be cached.

    A prefix runs from the very start. The first token that differs ends the reusable span — so
    changing something in the middle makes everything after it fresh again.

    ## Why agents differ

    Your prompt reaches a provider over one of two API formats, and **the two have different
    caching capabilities**. Which one is used depends on the provider your work routed to, not on
    anything you chose.

    That is the whole explanation for cache-write being 0 on one agent and not another.

    ## When reading totals

    `total_tokens` counts fresh input plus output. **Cache reads and writes are additive**, in
    their own columns. For a cache-heavy foreground session the raw total can understate real
    consumption by more than two orders of magnitude — always add the cache columns back.

=== "📖 Standard (~15 min)"

    ## Every turn re-sends everything

    The provider keeps nothing between requests, so each turn transmits the entire conversation
    so far as one prompt. The system instructions and tool definitions are identical every time,
    and the history only ever grows at the end, so the **front of the prompt is stable** and the
    tail is fresh.

    Caching operates only on prefixes, because the provider hashes from the beginning: the first
    differing token ends the reusable span.

    This is why an edit near the start of a conversation is expensive in a way that an edit at
    the end is not — it invalidates the cached computation for everything after it.

    ## The wire decides what is possible

    Requests go through the proxy on `:12435`, which speaks to providers in one of two API
    formats. The format — the wire — is what determines the caching behaviour you observe:

    | | Anthropic wire | OpenAI wire |
    |---|---|---|
    | Cache writes | Explicit, and reported | Not surfaced the same way |
    | How fresh input is counted | Excludes cache reads | Prompt tokens **include** them |

    That second row is the one that bites. The same conceptual number is reported differently by
    the two wires, so a column holding both conventions cannot be summed across providers without
    normalising first — which the proxy now does at the parse boundary, subtracting cached tokens
    from the OpenAI-side prompt count so that cache columns are additive everywhere.

    ## Reading the bands

    A cache-read band sitting on a flat floor and then jumping, with no write in between, is the
    expected shape: the floor is the stable prefix being re-read every turn, and the jump is that
    prefix growing when enough new conversation has accumulated to be worth caching.

    An agent showing **zero cache writes** is not failing to cache. It is on a path where writes
    are not surfaced, while reads still are.

    ## What this means for cost

    Two practical consequences.

    **Displaying consumption requires adding the cache columns back.** `total_tokens` answers
    "what did we newly send and receive", not "what did this cost". A cache-heavy interactive
    session can read as a small fraction of its real consumption otherwise — the measured gap on
    one 24-hour window was large enough to invert which of two consumers looked dominant.

    **Stability at the front of the prompt is worth money.** Anything that reorders or rewrites
    system instructions or tool definitions between turns discards the cached prefix and pays
    full price for it again.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/measurement/prompt-caching.deep.md"

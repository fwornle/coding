# Why the agent picks grep

Given every tool and no instruction, an agent reaches for text search almost every time.
This is why — and why a single rate is the wrong way to say it.

=== "⚡ Quick (~3 min)"

    ## The headline, and its correction

    Pooled across four runs with an identical tool surface, **1.57%** of tool calls reach a graph
    tool (95% CI [0.1%, 3.0%], clustered on the question).

    But **a single rate is the wrong summary**. Of 16 questions, **4 ever elicit a graph call and
    12 never do**. The agent is not sampling a strategy at a low rate — it applies a
    near-deterministic policy that selects the graph for a small, stable set of questions.

    ## This is a finding about one agent

    Only claude has its tool surface actually enforced. For the other agents "the grep arm" means
    the agent merely wasn't configured with a graph tool, not that it couldn't reach one — so the
    selection behaviour is only measurable on claude.

    ## Coverage is not the driver

    The obvious explanation — the agent avoids the graph because the graph does not cover what it
    needs — **does not hold**. The null result on coverage is one of the more useful things on
    this page, because it rules out the comfortable answer.

    ## Why the interval moved

    Clustering on the question rather than computing over calls. Treating 1,084 correlated tool
    calls as independent observations produces a confidently narrow and wrong band.

=== "📖 Standard (~15 min)"

    ## What was measured

    Four runs whose hybrid arm offers a byte-identical tool surface — 248 claude cells, 1,084
    executed tool calls, 17 of which reach a graph tool. No run is an outlier, which is what makes
    pooling legitimate rather than convenient.

    ## Why the per-question view is the real result

    A 1.57% rate invites the reading that the agent occasionally tries a graph. It does not. The
    distribution is bimodal at the question level: a small set of questions reliably provoke a
    graph call, and the large remainder reliably do not.

    That distinction matters for what you would do about it. A low sampling rate would suggest
    nudging the policy — a better tool description, a hint in the prompt. A near-deterministic
    per-question policy suggests the agent has already decided which questions graphs are for, and
    that changing the aggregate means changing which questions get asked.

    ## The clustering correction

    The first version of this number computed its interval over tool calls. Calls within one
    question are not independent — one decision produces several calls — so that treats a few
    dozen effective observations as a thousand and reports a far narrower interval than the data
    supports.

    Clustering on the question widens the interval to [0.1%, 3.0%] and is the honest form. This is
    the single most transferable methodological point on the page: **the unit of analysis is the
    decision, not the action it produced.**

    ## What the null result rules out

    Coverage does not drive the choice. The intuitive story — the agent learns the graph is
    missing what it needs, and stops asking — is not supported. Ruling it out is more useful than
    it sounds, because it is the explanation everyone reaches for first, and it would have implied
    a fix (improve coverage) that would not have worked.

    ## Scope

    One agent, one repository, 16 questions. It says what claude does when given both tools and no
    instruction. It does not establish what any other agent does, and cannot, because their tool
    restrictions are not enforced the same way.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/benchmarks/coding-v1/tool-selection.deep.md"

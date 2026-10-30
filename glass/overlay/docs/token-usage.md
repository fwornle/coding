# Token Usage

How many tokens your agents used — totals, trends and every single call.

=== "⚡ Quick (~3 min)"

    ## Where the tokens went

    Open `glass ui` → **Token Usage**. The cards show total tokens (fresh input, output,
    cached), number of calls, average latency and the split per account (GitHub Copilot,
    Claude Max, OpenAI). **Tokens · € · $** (top right) switches every view between tokens
    and what they cost. The tabs below:

    | Tab | Answers |
    |---|---|
    | Overview | Which agent and which model used the most? |
    | Evolution | When did usage happen, and how did it grow? |
    | Cost | What did each account cost this month, and where is it heading? |
    | Trials | Can a cheaper model take over a background job? (where coding is installed) |
    | Classes | What kind of job was each turn? ([Job classes](job-classes.md), opt-in) |
    | Recent Calls | What exactly did each call cost? |

    ![Token Usage overview](images/ui-token-usage-overview.png)

    ![Token Usage evolution](images/ui-token-usage-evolution.png)

    ![Cost](images/ui-token-usage-cost.png)

    The Copilot tile also shows GitHub's own figure for the account, so you see what glass
    did not ([what it covers](#what-the-copilot-figure-covers)).

    Use the time range (top right) to look further back. **Next:** what filled those
    tokens — [Context Window](context-window.md).

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/token-usage.deep.md"

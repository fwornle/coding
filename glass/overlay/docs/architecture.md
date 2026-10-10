# Architecture

One CLI, one local daemon, one data directory. The agent talks to its usual model host;
glass sits on the path and measures.

=== "⚡ Quick (~3 min)"

    ## Two capture paths

    ```mermaid
    graph TD
        U[glass agent] --> Q{which agent?}
        Q -->|claude| B[ANTHROPIC_BASE_URL → daemon on 127.0.0.1]
        Q -->|copilot · opencode · pi| P[HTTPS_PROXY → daemon<br/>glass CA trusted for this run]
        B --> M[daemon measures the call]
        P --> M
        M --> H[real model host, via your corporate proxy]
        M --> S[(~/.glass: token rows, context captures)]
        S --> V[glass ui · status line]
    ```

    The daemon forwards every call unchanged and reads the token usage from the
    response. Only five model hosts are decrypted; all other traffic is tunnelled.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/architecture.deep.md"

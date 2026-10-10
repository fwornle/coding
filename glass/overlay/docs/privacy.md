# Privacy & Data

Everything glass stores is on your machine, in `~/.glass`. Nothing is sent anywhere
except your agent's own model calls, to the host they always went to.

=== "⚡ Quick (~3 min)"

    ## The short version

    - Stored locally only; the daemon listens on 127.0.0.1; no telemetry.
    - Token counts are kept until you uninstall; context previews for 7 days.
    - Secrets are redacted before anything is written (keys, tokens, e-mail addresses).
    - Your agents' credentials pass through the daemon and are **never stored**.
    - glass's CA is **never added to any system trust store** — only the agents glass
      starts trust it, for that run.
    - `glass uninstall` removes everything.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/privacy.deep.md"

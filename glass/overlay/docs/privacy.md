# Privacy & Data

Everything glass stores is on your machine, in `~/.glass`. Nothing is sent anywhere
except your agent's own model calls, to the host they always went to — and, only if you
switch them on, offload's calls to your endpoint, job-class labels from your Copilot account
and, when you publish them, your job-class gate counts to your team's repo.

=== "⚡ Quick (~3 min)"

    ## The short version

    - Stored locally only; the daemon listens on 127.0.0.1; no telemetry.
    - Token counts are kept until you uninstall; context previews for 7 days.
    - Secrets are redacted before anything is written (keys, tokens, e-mail addresses).
    - Your agents' credentials pass through the daemon and are **never stored**.
    - glass's CA is **never added to any system trust store** — only the agents glass
      starts trust it, for that run.
    - Job classes (off by default): with labelling on, each prompt is redacted and sent to
      **your own Copilot account**, where the teacher model labels it.
    - `glass job-classes publish` (or **Publish my gate counts**) pushes per-class
      **counts** — labelled, checked, agreed, confusions — to your team's repo as
      `job-classes/gate/<pseudonym>.json`, with your own git credentials. Never a prompt;
      the pseudonym is a hash of host and user name. Nothing is published unless you run it.
    - `glass uninstall` removes everything.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/privacy.deep.md"

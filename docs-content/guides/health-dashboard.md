# Health Dashboard

Where to look when something is unhealthy, and the supervision design that decides what
"unhealthy" even means.

=== "⚡ Quick (~3 min)"

    ## Open it

    [localhost:3032](http://localhost:3032). The same state is available raw:

    ```bash
    coding --health
    curl -s localhost:3034/health/state | jq .
    ```

    ## What the dashboard shows

    Service health and container state, per-project session activity, the knowledge-workflow
    monitor with its debug controls, database health, and performance metrics.

    ## The one idea behind the design

    **Every layer assumes the one below it might be lying.** A process that exists is not a
    process that works, so liveness is judged by heartbeats rather than by the process being
    present. That is what catches a wedged service — alive, answering `ps`, doing nothing.

    ## Diagnosing in order

    1. Is the **coordinator** reachable? A grey badge means the reader has nothing to read.
    2. Is the state **fresh**? Older than 180s means the writer stopped, not the services.
    3. Then, and only then, look at what the state says about individual services.

    Skipping to step 3 is how a coordinator problem gets misdiagnosed as five service problems.

    ## Watching a knowledge run

    The workflow monitor shows the extraction pass live, with debug controls for single-stepping
    against a mocked LLM — which is the cheap way to understand the workflow.

=== "📖 Standard (~15 min)"

    ## The supervision model

    Health is layered, and the layers escalate. At the base a process registry tracks every
    system process with atomic, lock-protected writes. Above it a watchdog runs on a system timer
    as the ultimate failsafe — its only job is ensuring the coordinator is alive, and it cannot
    be killed by the processes it supervises. Above that, coordinators perform health checks on
    fifteen-second intervals with exponential-backoff recovery.

    The reason for the layering is the failure mode that a single monitor cannot catch: a monitor
    that has itself stopped reports nothing, which is indistinguishable from everything being
    fine. Each layer exists to notice that the one below it went quiet.

    ## What the dashboard surfaces

    **Service and container health**, from the coordinator's own probes. **Sessions**, per project,
    showing which agents are active and what they are logging. **The workflow monitor**, which
    renders the knowledge extraction pass while it runs, including the debug controls that
    single-step it against a mocked LLM. **Database health**, broken into individual checks —
    LevelDB lock state, vector-store availability, graph integrity — rather than one opaque
    verdict. **Performance metrics** over time.

    ## Auto-recovery

    Failures are handled two ways. Proactively, a coordinator that sees a service down restarts
    it without anyone watching. Reactively, the dashboard offers a restart control for when you
    have decided something needs bouncing. Most failures resolve by the first path; the history
    view shows what was restarted and when, which is how you find a service that is quietly
    flapping rather than cleanly failing.

    ## Reading it when things are wrong

    The order matters, because the failure modes nest:

    | Observation | What it actually means |
    |-------------|------------------------|
    | Health badge grey | The coordinator is unreachable — nothing else on the page is trustworthy |
    | State older than 180s | The writer stopped; the services may be perfectly fine |
    | One service unhealthy | Genuinely that service |
    | A project absent from sessions | No session monitor for it — not an unhealthy one |
    | Everything green, nothing happening | Look for a wedged process; sample it rather than checking it exists |

    That last row is the one worth internalising. A wedged process does not die: it holds its
    event loop, answers `ps`, keeps its ports open, and stops producing work. Only the heartbeat
    notices, which is precisely why liveness here is defined as "recently did something" rather
    than "is running".

    ## Storage

    Health state is written by exactly one process and read by all the consumers — the dashboard,
    the status line and the prompt hooks. When two of those disagree, that is not two opinions
    about health; it means one of them is reading a stale copy, and that is the bug to chase.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/guides/health-dashboard.deep.md"

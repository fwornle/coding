# Verify & Repair

Checking that the installation actually works, and fixing it when it does not.

=== "⚡ Quick (~3 min)"

    ## The check

    ```bash
    coding --health
    ```

    Everything should be green. For a deeper pass:

    ```bash
    ./scripts/test-coding.sh --interactive
    ```

    ## Diagnose in order

    The failures nest, so checking out of order misdiagnoses them:

    1. **Is Docker running?** Most failures are this.
    2. **Is the coordinator reachable?** `curl -s localhost:3034/health/state | jq .` — a grey
       badge means nothing else on the dashboard can be trusted.
    3. **Is that state fresh?** Older than ~3 minutes means the writer stopped, not the services.
    4. **Only then**, look at individual services.

    ## The usual suspects

    | Symptom | Usually |
    |---------|---------|
    | Everything red | Docker not running |
    | `coding` not found | Shell not reloaded since install |
    | Missing tools in the agent | A container that never started |
    | A project absent from the status line | No session monitor for it |

    ## Full reset

    The Deep tier has a complete-reset procedure. Try the targeted repairs first — a reset
    discards local state that is usually fine.

=== "📖 Standard (~15 min)"

    ## Verifying

    ```bash
    coding --health                          # every service at once
    ./scripts/test-coding.sh --interactive   # a guided pass with repairs offered
    curl -s localhost:3034/health/state | jq .   # the raw truth
    ```

    The three differ in what they can tell you. The first is a summary, the second walks through
    each subsystem and offers fixes, and the third is the document the other two are rendering —
    useful precisely when they disagree with each other.

    ## Why the order matters

    Health is layered, and so are its failures. Checking a service before checking the thing that
    reports on it produces confident wrong answers:

    - **Docker down** makes everything red, including things that are fine.
    - **The coordinator unreachable** makes the dashboard grey — that is the reader having nothing
      to read, not the services being down.
    - **Stale state** (older than roughly three minutes) means the process writing it stopped. The
      services it describes may be perfectly healthy; you are looking at a snapshot.
    - **A single unhealthy service** is the only one of these that means what it appears to mean.

    ## Common fixes

    **`coding: command not found`** — the shell has not been reloaded since the install. `source
    ~/.zshrc` or open a new terminal.

    **Tools missing inside the agent** — a container did not start. Check what is actually running
    before suspecting configuration; a service absent from `docker ps` never started, which is a
    Docker problem rather than a coding one.

    **A project missing from the status line** — that project has no session monitor. This is
    different from having an unhealthy one, and the fix is different too.

    **Everything looks fine but nothing is happening** — look for a wedged process. One that has
    stalled does not die: it answers `ps`, holds its ports, and stops doing work. Sample it rather
    than checking whether it exists.

    ## Resetting

    There is a complete-reset procedure in the Deep tier. Reach for it last: it discards local
    state — caches, indexes, health files — that is usually not the problem, and a reset that
    "fixes" an issue without identifying it tends to be a reset you perform repeatedly.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/getting-started/verify-repair.deep.md"

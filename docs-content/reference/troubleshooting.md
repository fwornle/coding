# Troubleshooting

Indexed by symptom. Start with the quick diagnostics, then the section matching what you
are seeing.

=== "⚡ Quick (~3 min)"

    ## First three commands

    ```bash
    coding --health                               # what the system thinks
    docker compose -f docker/docker-compose.yml ps  # what is actually running
    curl -s localhost:3034/health/state | jq .    # the raw state document
    ```

    If those three disagree with each other, that disagreement **is** the diagnosis — something is
    reading a stale copy.

    ## By symptom

    | What you see | Section |
    |--------------|---------|
    | Install failed, `coding` not found | Installation issues |
    | Sessions not being logged | Session logging issues |
    | Containers missing or restarting | Docker issues |
    | The knowledge graph is empty or stale | Knowledge base issues |
    | A tool call was blocked unexpectedly | Constraint monitor issues |
    | Everything is slow | Performance issues |

    ## The rule that saves the most time

    **Check the reporter before the thing reported.** A grey or stale health badge means the
    process writing that state has stopped — the services it describes may be entirely fine.

    ## Last resort

    A complete reset exists in the Deep tier. Try targeted fixes first; a reset discards state
    that is usually not the cause.

=== "📖 Standard (~15 min)"

    ## Diagnosing in the right order

    Nearly every confusing failure here comes from checking things in the wrong order, because the
    layers nest. Docker underpins the services; the coordinator reports on them; the dashboard and
    status line read the coordinator. A failure at any level makes everything above it look
    broken.

    So: Docker, then the coordinator, then state freshness, then the individual service. Only the
    last of those means what it appears to mean.

    ## The categories

    **Installation** — almost always Docker not running, a shell not reloaded, or submodules that
    did not come down with the clone.

    **Session logging** — a per-project monitor that is absent, or one that is alive but wedged.
    Those need different fixes, and the status line distinguishes them: no badge means healthy, a
    badge means unhealthy, and a project missing from the list entirely means no monitor at all.

    **Docker** — a container that never started is a different problem from one that is
    restarting. `docker ps` distinguishes them and the container logs explain the second.

    **Knowledge base** — an empty or stale graph usually means no extraction pass has run
    recently, rather than a broken store. The pass is asynchronous and takes 10–20 minutes.

    **Constraints** — a blocked call is usually correct. When it is genuinely a false positive,
    the supported response is an explicit override naming the constraint, not rewording until the
    pattern stops matching.

    **Performance** — check whether something is wedged before assuming load. A stalled process
    consumes a slot without consuming CPU, and looks like everything simply being slow.

    ## Resetting everything

    The full procedure is in the Deep tier. It is the last resort rather than a first move,
    because it discards caches, indexes and health state that are usually not the cause — and a
    reset that resolves a problem without identifying it is a reset you will perform again.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/reference/troubleshooting.deep.md"

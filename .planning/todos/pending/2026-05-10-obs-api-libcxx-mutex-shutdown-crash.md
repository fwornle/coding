---
created: 2026-05-10T10:30:00.000Z
title: obs-api crashes on SIGTERM with libc++abi mutex error
area: observability
files:
  - scripts/observations-api-server.mjs
  - src/retrieval/retrieval-service.js (fastembed init)
  - src/live-logging/ObservationWriter.js (better-sqlite3 close)
  - scripts/restart-obs-api.mjs (current SIGKILL workaround)
---

## Problem

`scripts/observations-api-server.mjs` does not shut down cleanly on SIGTERM.
After the writer's database connection closes, the process aborts with:

```
[obs-api] SIGTERM — shutting down
[ObservationWriter] Database connection closed.
libc++abi: terminating due to uncaught exception of type std::__1::system_error: mutex lock failed: Invalid argument
```

Reproduces reliably on macOS arm64 — observed across multiple SIGTERM
cycles (orchestrator-driven and manual). The crash fires *after* the
writer close completes, so it is downstream of `_writer.close?.()` in
the `shutdown()` handler at observations-api-server.mjs:711.

This is the bug papered over by the SIGKILL fallback in
`scripts/restart-obs-api.mjs` (its `STOP_GRACE_MS` is 6s; in practice
SIGTERM-then-grace always falls through to SIGKILL because the process
dies via the abort, not via a clean exit).

## Impact

- **Consolidation drain unreliable.** `shutdown()` waits up to 20s for
  in-flight consolidation (line 716-722). If the abort fires before that
  drain completes, a long-running insight synthesis can be killed mid-
  call — the LLM responds, the response is dropped, partial state is
  retained.
- **Writer close may be incomplete.** The crash happens after the
  reported "Database connection closed" log line, but better-sqlite3's
  finalizers run in the same destruction phase as the abort. Lost WAL
  flushes are plausible.
- **Noisy logs obscure real issues.** Every restart logs an `uncaught
  exception` which is an attention-grabbing string. Future investigators
  will chase it before realising it's expected.
- **PSM signal-vs-exit semantics broken.** PSM observes a crash exit
  rather than a clean SIGTERM exit, so any future "graceful drain on
  shutdown" feature would mis-categorise the obs-api as unhealthy.

## Likely causes

The error originates from native code (libc++abi → std::system_error on
a mutex lock). Two suspects:

1. **better-sqlite3 finalizer** — if a prepared statement (e.g. one of
   the pre-compiled `db.prepare(...)` calls cached at module top) is
   destroyed *after* the DB handle, its mutex is invalid.
2. **fastembed / onnxruntime / Rust tokenizer threadpool** — Rust drop
   handlers running concurrently with the JS exit path can race the
   native runtime's own mutex on shutdown. fastembed initialises a
   shared model + inference threadpool in `EmbeddingService.initialize()`;
   if there is no explicit drop-on-exit, atexit runs them on a non-main
   thread.

The fact that the crash always lands *after* the ObservationWriter
"Database connection closed" log narrows this — it's not a connection-
level race, it's later in the unwind. Probably suspect 2 (Rust threads).

## Proposed investigation

1. Add `console.error('[shutdown] before/after step N')` between every
   step in `shutdown()` to localise which call triggers the abort.
2. Try `process.exit(0)` synchronously after writer close — if the abort
   moves to before/at that line, the culprit is something between writer-
   close and the exit. If the abort still happens during exit-handler
   teardown, the culprit is a Node-runtime / native-addon finalizer.
3. Check fastembed for a documented `dispose` / `destroy` / `close` API.
   If one exists, call it before `process.exit(0)`. If not, file
   upstream.
4. Investigate whether better-sqlite3 prepared statements need explicit
   `.finalize()` before the parent connection close — the
   `host-api-pattern` insight suggests several modules cache statements.

## Proposed fix (post-investigation)

Either an explicit ordered-shutdown sequence (drain → release prepared
statements → close writer → dispose embedding service → exit) or a
deliberate `_exit(0)` bypass of native finalizers if the cleanup work is
verifiably idempotent.

Until then, the SIGKILL fallback in `scripts/restart-obs-api.mjs` is the
operating workaround. Document it there and here so it's not removed.

## Related investigation lead — Qdrant client/server version drift

obs-api startup logs every cycle:

```
Client version 1.15.1 is incompatible with server version 1.17.0. Major
versions should match and minor version difference must not exceed 1.
Set checkCompatibility=false to skip version check.
```

Functionally benign for normal request paths, but the suspect-2 hypothesis
above (Rust / native threadpool teardown racing JS exit) gets stronger if
the client and server are using mismatched ABI-relevant code paths. Worth
testing whether bumping `@qdrant/js-client-rest` to match the running
Qdrant server (1.17.x) eliminates the abort.

How to test: pin the client, restart obs-api, send several SIGTERM cycles
and check whether the libc++abi line still appears. If it does, the
mismatch is unrelated and the suspect remains fastembed/onnxruntime.

## Priority

**Low.** Functional impact is bounded (in-flight consolidation drain is
the only meaningful loss; the LLM call is retryable on the next
consolidation tick). Cleanup work, not a blocker.

EADDRINUSE-on-respawn (the visible flap symptom in the status line) is
addressed separately by the `waitForPortBindable` gate added to
`scripts/start-services-robust.js` — the supervisor now refuses to spawn
until the port is actually bindable, so the abort no longer wastes a
maxRetries slot. The mutex crash itself remains, just no longer cascades
into a visible service flap.

The new `[obs-api] SIGTERM — shutting down (pid=…, ppid=…)` log line in
`observations-api-server.mjs:712` will identify the SIGTERM sender on the
next occurrence — was previously a guess between PSM, health-remediation,
and ETM-driven cleanups.

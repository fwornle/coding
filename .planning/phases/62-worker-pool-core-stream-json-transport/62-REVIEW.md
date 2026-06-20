---
phase: 62-worker-pool-core-stream-json-transport
reviewed: 2026-06-20T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/helpers/mock-claude-stdio.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/worker-pool-live.test.mjs
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
critical_resolved: 2
status: issues_resolved
resolution:
  commit: 3c68f54
  note: "CR-01 (per-request timeout) and CR-02 (empty-pool-array LRU corruption) fixed with 8 regression tests; unit suite 21/21 pass. WR-06 (busy-worker eviction) closed as a side effect. WR-01..05 + info items deferred to Phase 63/64 follow-up."
---

# Phase 62: Code Review Report

**Reviewed:** 2026-06-20
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 62 adds `proxy-bridge/worker-pool.mjs` (679 new lines: `ClaudeWorker` +
`WorkerPool`) and wires it into `server.mjs` (44-line diff) as the warm
CLI-fallback fast path. The implementation is well-structured, JSON-Lines
partial-line buffering is correct, the per-model keying invariant holds, and
the env/boot/token-mapping logic faithfully mirrors `completeClaudeCodeViaCLI`.

However, two correctness regressions versus the execFile path it replaces are
serious: the worker request path has **no timeout** (a silent/hung worker
hangs the caller forever — the execFile path enforced `body.timeout ||
120_000`), and the `complete()` router **leaks empty per-key pool arrays** that
both count against the LRU cap and can trigger eviction of live pools. Several
robustness gaps (unguarded `stdin.write` EPIPE, recycle-ceiling token
mismatch, abort-before-dispatch race) round out the warnings.

This is the FORCE stance assessment — the code looks careful, but the missing
timeout is a real production hang risk that the test suite does not cover.

## Critical Issues

### CR-01: Worker request path has no timeout — a silent/hung worker hangs the caller forever

**File:** `proxy-bridge/worker-pool.mjs:255-276, 297-323`
**Issue:** `ClaudeWorker.write()` returns a promise that settles ONLY on a
`{type:"result"}` stdout event or on process `exit`/`close`. There is no
timeout. The execFile path it replaces enforced `timeout: body.timeout ||
120_000` (`server.mjs:1075,1127`) and mapped expiry to
`Claude CLI timed out after ${timeoutMs}ms` (`server.mjs:1191-1192`). A
persistent worker that hangs mid-turn (network stall, CLI deadlock, lost
result event, model never emits `result`) leaves `_pending` unsettled and
`_busy=true` permanently. Every subsequent request to that worker queues
behind it and also hangs. Because the worker never exits, the reap-on-exit
settle path (`_onExit`) never fires. The `abortSignal` only wires
`worker.cancel()` (a best-effort interrupt that itself depends on the CLI
responding), so an unresponsive worker cannot be force-settled. This is a
behavioral regression and a production hang risk that the live suite does not
exercise (no timeout test).
**Fix:** Arm a per-request timer in `_dispatch` and clear it when the result
settles (or the worker exits). On expiry, reject the pending promise with a
retryable timeout error and `dispose()` the worker so the pool evicts it:
```javascript
_dispatch(job) {
  this._pending = { resolve: job.resolve, reject: job.reject };
  this._busy = true;
  const timeoutMs = job.timeoutMs ?? this._requestTimeoutMs ?? 120_000;
  this._pending._timer = setTimeout(() => {
    const p = this._pending;
    this._pending = null;
    this._busy = false;
    if (p) p.reject(makeRetryableError(`worker request timed out after ${timeoutMs}ms`));
    this.dispose(); // hung worker is non-recoverable; force reap
  }, timeoutMs);
  if (this._pending._timer.unref) this._pending._timer.unref();
  const msg = { type: 'user', message: { role: 'user', content: job.content } };
  this._proc.stdin.write(JSON.stringify(msg) + '\n');
}
```
Clear `this._pending._timer` in `_onEvent` and `_onExit` before settling.
Thread `body.timeout` from `WorkerPool.complete()` into `worker.write()`.

### CR-02: `complete()` leaks empty per-key pool arrays that corrupt the LRU cap

**File:** `proxy-bridge/worker-pool.mjs:601-606, 619-625, 651`
**Issue:** Every call to `complete()` for a not-yet-seen key unconditionally
creates and registers an empty array:
```javascript
let workers = this.workersByKey.get(key);
if (!workers) {
  workers = [];
  this.workersByKey.set(key, workers); // lazy pool (D-07)
}
this._touch(key, workers);
```
If the request then overflows (all-busy at cap) or `overflowFn` is missing, no
worker is ever pushed, but the empty array stays in `workersByKey`. Empty
pools (a) count toward `this.workersByKey.size`, which drives
`_enforcePromptCap` (line 570: `while (this.workersByKey.size > this.promptCap)`),
so accumulating empty arrays can evict and `dispose()` workers of a *live*
prompt-pool; and (b) are never cleaned up, growing unbounded under
churning-key traffic. The post-request recycle block (line 646-650) also drops
the worker but leaves the now-empty array registered. This defeats D-02's
intent (cap on *active* prompt-pools) and risks draining warm workers the proxy
is actively using.
**Fix:** Only register the key once a worker actually joins it, and prune empty
arrays after `_dropWorker`/overflow:
```javascript
let workers = this.workersByKey.get(key);
if (!workers) workers = []; // do NOT set() yet
...
if (!worker && workers.length < this.size) {
  worker = this._spawnWorker(key, model, systemPrompt);
  workers.push(worker);
  this.workersByKey.set(key, workers); // register only now
  this._touch(key, workers);
}
```
And in `_dropWorker` / the recycle finally-block, delete the key when its array
empties: `if (workers.length === 0) this.workersByKey.delete(key);`

## Warnings

### WR-01: `stdin.write` is unguarded — a dead pipe throws out of the stdout handler / cancel()

**File:** `proxy-bridge/worker-pool.mjs:275, 354`
**Issue:** `_dispatch` and `cancel` call `this._proc.stdin.write(...)` with no
try/catch and no `stdin.on('error')` listener. If the subprocess died between
the `_exited` guard and the write (race), or `_onExit` hasn't fired yet, the
write can throw synchronously (`EPIPE`/`write after end`). In `_dispatch`
called from the queue-drain inside `_onEvent` (line 321), that throw escapes
the stdout `'data'` handler and surfaces as an unhandled exception, and the
queued job's reject is never called (silent hang of that job). `cancel()` is
invoked from the abort handler (line 631-633) — a throw there is swallowed by
the surrounding try/catch, but the pending request is then never settled.
**Fix:** Wrap both writes in try/catch and on failure settle the pending/queued
job via `makeRetryableError`; also attach `this._proc.stdin.on('error', ...)`
in the constructor to prevent process-level unhandled-error crashes.

### WR-02: Recycle ceiling compares raw `usage.input_tokens`, not the cache-inclusive sum

**File:** `proxy-bridge/worker-pool.mjs:305, 328-336`
**Issue:** `_onEvent` sets `this._lastInputTokens = ev.usage?.input_tokens || 0`
(raw top-level usage), but the actual context size the worker carries is the
summed `modelUsage` value (`input + cacheRead + cacheCreation`) that
`toCompletion` computes (line 140-143) — the same sum the module docstring and
`server.mjs:1166` treat as authoritative. The context-leak recycle ceiling
(`_lastInputTokens >= this._maxInputTokens`, line 331) therefore measures a
*smaller* number than the real accumulated context, so a worker can blow well
past `LLM_PROXY_WORKER_MAX_INPUT_TOKENS` of real cross-call context before
recycling — weakening the Pitfall-1/Security-V3 isolation bound this flag
exists to enforce.
**Fix:** Compute `_lastInputTokens` from the same summed source:
```javascript
const mu = ev.modelUsage && Object.values(ev.modelUsage)[0];
this._lastInputTokens = mu
  ? (mu.inputTokens + (mu.cacheReadInputTokens || 0) + (mu.cacheCreationInputTokens || 0))
  : (ev.usage?.input_tokens || 0);
```

### WR-03: abort-before-dispatch only cancels, never aborts the queued/in-flight write reliably

**File:** `proxy-bridge/worker-pool.mjs:628-636`
**Issue:** `complete()` wires `abortSignal` -> `worker.cancel()`. But
`worker.cancel()` is a best-effort protocol interrupt that requires the CLI to
respond with an `error_during_execution` result. If the request is still
*queued* (not yet dispatched — another job is in flight on this worker),
`cancel()` interrupts the *wrong* (currently-running) request, while the
aborted caller's queued job keeps waiting and will eventually run to completion
despite the client having gone. Combined with CR-01 (no timeout), an aborted
caller can hang. The abort contract is weaker than the execFile path, where
`signal: clientAbortSignal` killed the exact subprocess for that call.
**Fix:** On abort, if the job is still in `_queue`, remove it and reject with the
client-disconnect error directly rather than (or in addition to) issuing a
worker-wide `cancel()`. Track job->worker->queued-state so abort targets the
correct request.

### WR-04: `dispose()` does not remove the worker from its pool array

**File:** `proxy-bridge/worker-pool.mjs:384-397, 646-650`
**Issue:** `dispose()` ends stdin and SIGTERMs the process but does not splice
the worker out of `workersByKey`. The pool relies on the async `'exit'` event
(`_spawnWorker` -> `_dropWorker`, line 538) to remove it. Between `dispose()`
and the eventual `exit`/`close`, the worker is still in the array with
`busy=false` (or stale state), so `complete()`'s `workers.find(w => !w.busy)`
(line 612) can hand out a disposing/SIGTERMed worker, whose next `write()` may
race the exit. `_reapStale` only removes workers flagged `needsRecycle`/`isStale`
— a `dispose()`d-but-not-yet-flagged worker (e.g. via direct `disposeAll` race)
slips through. `_onExit` does set the flags, but only once the signal lands.
**Fix:** Have callers that `dispose()` a worker also `_dropWorker` it
synchronously (the recycle block at 646-650 already does; `_reapStale` and
`_enforcePromptCap` splice/delete; but verify every dispose site removes from
the array immediately rather than waiting for `exit`).

### WR-05: `cancel()` interrupt can settle the NEXT request after a late result

**File:** `proxy-bridge/worker-pool.mjs:297-323, 347-356`
**Issue:** Concurrency-1 correlation is positional (any `result` settles the
current `_pending`). After `cancel()`, the CLI emits an
`error_during_execution` result that settles `_pending`; the queue then
dispatches the next job (line 320-321). If the *original* interrupted turn
later emits a trailing/duplicate `result` (CLI flushing buffered output after
the interrupt ack), that stray result settles the NEWLY-dispatched job with the
wrong/old payload. The worker has no request-id correlation to reject the
mismatch. Low probability under the documented protocol, but the cancel seam is
specifically the path most likely to produce out-of-band events.
**Fix:** Tag each dispatched job with a monotonically increasing turn id and
ignore `result` events that arrive while `_pending === null` (no in-flight
request), or correlate via the control_response/interrupt request_id before
accepting the post-interrupt result.

### WR-06: `_enforcePromptCap` can evict a busy (in-flight) prompt-pool

**File:** `proxy-bridge/worker-pool.mjs:569-583`
**Issue:** LRU eviction only skips `activeKey`; it `dispose()`s all workers of
the victim key regardless of whether those workers are mid-request
(`w.busy === true`). Disposing a busy worker SIGTERMs the subprocess, whose
in-flight `write()` then rejects via `_onExit` as retryable — an LRU eviction
on key X can therefore kill a concurrently-running request on key Y. Under
multi-key concurrent load this turns a capacity-management action into spurious
request failures.
**Fix:** Skip victims that have any busy worker (defer their eviction), or only
dispose idle workers and leave the key registered until its in-flight requests
drain.

## Info

### IN-01: Dead/unused export `extractSystemPrompt` vs `extractSystemPromptPublic` duplication

**File:** `proxy-bridge/worker-pool.mjs:427-434, 672-679`
**Issue:** `extractSystemPrompt` (private, returns `null` when absent) and
`extractSystemPromptPublic` (exported, returns the default string) are
near-identical copies differing only in the empty-case return. `workerKeyFor`
uses the private one (then applies the default), `complete()` uses the public
one. This duplication is a maintenance hazard: a future edit to the system/user
split must touch two functions to stay consistent with `server.mjs:1076-1091`.
**Fix:** Implement one `extractSystemParts(body)` returning the joined parts or
`null`, and derive both the key default and the pool default from it.

### IN-02: `drain()` is an undocumented alias that diverges from pool's drain semantics

**File:** `proxy-bridge/worker-pool.mjs:399-402`
**Issue:** `ClaudeWorker.drain()` simply calls `dispose()` (SIGTERM), but the
word "drain" elsewhere in the file (`_reapStale`, `disposeAll` comments) implies
graceful end-stdin-and-let-exit. The alias conflates forceful kill with
graceful drain and is never called by the pool (the pool uses `dispose()`).
**Fix:** Remove the unused alias, or make it truly graceful (end stdin, no
SIGTERM) to match the vocabulary.

### IN-03: Magic default model string repeated in three places

**File:** `proxy-bridge/worker-pool.mjs:181, 418, 597`
**Issue:** `'sonnet'` is hard-coded as the fallback model in the `ClaudeWorker`
constructor, `workerKeyFor`, and `complete()`. `'You are a helpful assistant.'`
similarly repeats at lines 94, 182, 419, 678. Drift between these defaults would
silently split the worker key from the booted worker.
**Fix:** Hoist `DEFAULT_MODEL = 'sonnet'` and `DEFAULT_SYSTEM_PROMPT` constants
and reference them everywhere.

### IN-04: `isStale` and `needsRecycle` are redundant flags always set together

**File:** `proxy-bridge/worker-pool.mjs:206-207, 333-334, 363-364**
**Issue:** Every site that sets one sets the other to the same value, and
`_reapStale`/`complete` check `needsRecycle || isStale` (always equivalent).
The "alias the pool may check" comment confirms `isStale` carries no distinct
meaning. Two booleans that are provably always equal invite a future bug where
one is set without the other.
**Fix:** Collapse to a single `needsRecycle` flag, or give `isStale` a distinct
meaning (e.g. exited-vs-threshold) if one is intended.

---

_Reviewed: 2026-06-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

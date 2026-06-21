# Phase 63: Worker Lifecycle — Lazy Spawn, Idle Eviction, Crash Recovery & Cancellation - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 4 (2 source modifications, 2 test extensions; all in the standalone `rapid-llm-proxy` repo)
**Analogs found:** 9 / 9 (every D-01..D-09 behavior has an in-file Phase-62 analog — this is a "production-correct the existing lifecycle" phase, not greenfield)

> **CROSS-REPO:** All code under change lives in `/Users/Q284340/Agentic/_work/rapid-llm-proxy/` (a separate git repo). Planning artifacts stay in the coding repo. Commit code with `git -C /Users/Q284340/Agentic/_work/rapid-llm-proxy`.

> **No new files.** Every lifecycle behavior lands *inside* the existing `worker-pool.mjs` (mostly on `ClaudeWorker`, some on `WorkerPool`), with one wiring change in `server.mjs` and new cases appended to the two existing test files. There is no "no analog found" case — the whole point of Phase 63 is to extend Phase-62 machinery, so each decision maps to a concrete existing function to copy/extend.

## File Classification

| Modified File | Role | Data Flow | Closest Analog (same file) | Match Quality |
|---------------|------|-----------|----------------------------|---------------|
| `proxy-bridge/worker-pool.mjs` → `ClaudeWorker` idle timer (D-04) | timer/lifecycle | event-driven | `ClaudeWorker._dispatch` per-request `setTimeout(...).unref()` (lines 302-317) | exact (same unref timer idiom) |
| `proxy-bridge/worker-pool.mjs` → `ClaudeWorker` request-generation guard (D-02) | dispose-synchrony / correctness | event-driven | `ClaudeWorker._onEvent` settle path + `_pending` slot (lines 342-370) | exact |
| `proxy-bridge/worker-pool.mjs` → EPIPE `stdin.write` guard (D-07) | crash-detection | request-response | `ClaudeWorker._onExit` reap-as-RETRYABLE (lines 407-427); raw writes at 320, 401 | role-match (reuses `_onExit` path) |
| `proxy-bridge/worker-pool.mjs` → `WorkerPool` crash-cooldown → execFile overflow (D-06) | crash-cooldown | request-response | `WorkerPool.complete` overflow branch (lines 712-723) + `_spawnWorker` exit handler (line 588) | exact (same `overflowFn` route) |
| `proxy-bridge/worker-pool.mjs` → `ClaudeWorker.dispose()` synchronous pool-removal (D-08) | dispose-synchrony | — | `WorkerPool._dropWorker` (lines 594-602) + post-request recycle in `complete`'s `finally` (lines 747-751) | exact |
| `proxy-bridge/worker-pool.mjs` → abort = SIGTERM+respawn (D-01) | abort-propagation | event-driven | `WorkerPool.complete` `onAbort` → `worker.cancel()` seam (lines 725-734) | role-match (replace `cancel()` seam with `dispose+_dropWorker`) |
| `proxy-bridge/worker-pool.mjs` → abort targets in-flight-vs-queued (D-03) | abort-propagation | event-driven | `ClaudeWorker._queue` FIFO + `_pending` slot (lines 211, 280-287, 422-425) | exact |
| `proxy-bridge/server.mjs` → client-disconnect propagation (D-01/D-03 wiring) | abort-propagation | request-response | `reqAbort` AbortController + `req/res 'close'` (lines 1534-1542); `disposeAll()` shutdown (line 1866) | exact (signal already threaded to `complete`) |
| `tests/unit/worker-pool.test.mjs` + `tests/integration/worker-pool-live.test.mjs` (+ mock helper) | test | — | existing CR-01 timeout unit cases (lines 175-236) + live `--live` gate (lines 39-49) | exact |

## Pattern Assignments

### D-04 — Per-worker `unref()`'d idle timer → `ClaudeWorker` (timer/lifecycle, event-driven)

**Analog:** `ClaudeWorker._dispatch` per-request timeout — the SAME `setTimeout` + `.unref()` + `clearTimeout`-on-settle idiom, just armed on idle instead of per-request.

**Timer-arm + unref pattern to copy** (worker-pool.mjs:301-317):
```javascript
const timeoutMs = job.timeoutMs ?? this._requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
const timer = setTimeout(() => {
  // ... settle + dispose ...
  this.dispose();
}, timeoutMs);
if (timer.unref) timer.unref(); // never keep the event loop alive on a timer
this._pending.timer = timer;
```

**Clear-on-settle pattern** (worker-pool.mjs:357, 416-418): the per-request timer is `clearTimeout`'d in `_onEvent` and `_onExit`. The idle timer must mirror this — **reset on every request settle** (arm in constructor / after each settle, clear on dispatch). The Context (D-04) says "reset on every request settle".

**On-fire path** (D-04 requires): `dispose()` + the existing `'exit'` emission. The pool's `_spawnWorker` already wires `worker.once('exit', () => this._dropWorker(key, worker))` (worker-pool.mjs:588), so an idle-fired `dispose()` → `'exit'` → `_dropWorker` reaps it for free. Next request lazily respawns. **No central sweep loop** (D-04 explicit).

**Env knob** (follow the established naming, code_context "Established Patterns"): mirror `DEFAULT_REQUEST_TIMEOUT_MS` (worker-pool.mjs:80-81):
```javascript
const DEFAULT_IDLE_MS = Number(process.env.LLM_PROXY_WORKER_IDLE_MS) || 30 * 60_000; // 30 min default (D-04)
```
Thread through the `deps`/constructor seam exactly like `requestTimeoutMs` (constructor lines 202-203) so the unit suite can inject a 50ms idle timeout (matching the CR-01 `requestTimeoutMs: 50` test pattern at unit test line 179).

---

### D-02 — Monotonic request-generation guard (stray-result safety) → `ClaudeWorker` (correctness, event-driven)

**Analog:** `ClaudeWorker._onEvent` end-of-response settle (worker-pool.mjs:342-370) and the single `_pending` slot.

**Settle path to guard** (worker-pool.mjs:352-364):
```javascript
const pending = this._pending;
this._pending = null;
this._busy = false;
if (pending) {
  if (pending.timer) clearTimeout(pending.timer);
  if (ev.is_error) pending.reject(mapResultError(ev));
  else pending.resolve(toCompletion(ev, this._model));
}
```

**Pattern to add (D-02 belt-and-suspenders):** bump a monotonic `this._generation` (or `_requestSeq`) counter each `_dispatch`, stamp it on `_pending`, and in `_onEvent` drop any `result` whose generation does not match the live `_pending.generation`. This mirrors how `_pending` is already nulled before resolving (worker-pool.mjs:353-355) — a late event arriving after settle finds `_pending === null` and is ignored; the generation counter closes the narrower window where a NEW request is already in-flight. Primary defense is still dispose-on-cancel (D-01) — a disposed worker is dropped from the pool so it can't be handed the next caller (closes WR-05).

**Discretion** (Context D-discretion): the generation-counter representation is planner/executor choice — a plain incrementing integer on the worker, stamped onto `_pending` and each queued `job`, is the minimal form.

---

### D-07 — EPIPE on `stdin.write` treated as a crash (WR-01 fold-in) → `ClaudeWorker` (crash-detection, request-response)

**Analog:** `ClaudeWorker._onExit` (worker-pool.mjs:407-427) — the existing "settle in-flight RETRYABLE + drain queue RETRYABLE + emit exit" reap path. An EPIPE write must funnel into THIS exact path.

**Unguarded writes to wrap** — there are two raw `this._proc.stdin.write(...)` calls today:
- `_dispatch` (worker-pool.mjs:319-320): the request envelope write.
- `cancel` (worker-pool.mjs:401): the control_request write (becomes moot under D-01 SIGTERM, but still raw).

**Reap path to reuse** (worker-pool.mjs:407-427):
```javascript
_onExit(code, signal) {
  if (this._exited) return;
  this._exited = true;
  this.needsRecycle = true;
  this.isStale = true;
  const pending = this._pending;
  this._pending = null;
  this._busy = false;
  if (pending) {
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(makeRetryableError(`worker exited (code=${code}, signal=${signal})`));
  }
  const queued = this._queue.splice(0);
  for (const job of queued) {
    job.reject(makeRetryableError(`worker exited (code=${code}, signal=${signal})`));
  }
  this.emit('exit', { code, signal });
}
```

**Pattern to add:** wrap the `stdin.write` in try/catch (or use the write callback's `err` arg); on EPIPE / write error, call `this._onExit(null, 'EPIPE')` (or a dedicated `_onWriteError` that delegates to the same body). The Context (D-07) is explicit: "An unguarded write currently throws out of the stdout handler and loses the queued-job rejection" — routing through `_onExit` guarantees the queued-job RETRYABLE rejection that the raw throw skips. `makeRetryableError` (worker-pool.mjs:455-460) is the shared RETRYABLE shape.

---

### D-06 — Crash cooldown → execFile overflow (WLIFE-03) → `WorkerPool` (crash-cooldown, request-response)

**Analog:** `WorkerPool.complete` all-busy overflow branch (worker-pool.mjs:712-723) — the exact `overflowFn` route the cooldown degrades to — plus the `_spawnWorker` exit handler (worker-pool.mjs:577-591) where early-exit/boot failures are observable.

**Overflow route to reuse** (worker-pool.mjs:713-722):
```javascript
if (!worker) {
  if (workers.length === 0) this.workersByKey.delete(key);
  if (typeof overflowFn === 'function') {
    this._log(`worker-pool: all ${workers.length} workers busy for key=${key}; overflow -> execFile (D-06)`);
    return overflowFn(body, abortSignal);
  }
  throw new Error('no free worker and no overflow function provided');
}
```

**Crash-tracking hook** (worker-pool.mjs:588):
```javascript
worker.once?.('exit', () => this._dropWorker(key, worker));
```
Extend this handler to record a crash timestamp per key when the exit is an *early/boot* failure (short-lived worker). The Context (code_context "Reusable Assets") names `_dropWorker` + the `'exit'` event as the funnel.

**Pattern to add (D-06):** a per-key crash-frequency structure (Context D-discretion: "the crash-frequency data structure" is planner choice — e.g. `Map<key, number[]>` of recent crash timestamps, or a count+windowStart). At the TOP of `complete()` — *before* the lazy-spawn at lines 702-710 — check if `key` is in cooldown (≥ threshold crashes within window); if so, route straight to `overflowFn(body, abortSignal)` using the SAME branch shape as lines 718-721. After cooldown elapses, fall through to normal lazy-spawn (Context: "the key is allowed to lazily spawn again"). This degrades a persistently-broken key to today's pre-milestone execFile behavior (`completeClaudeCodeViaCLI`, server.mjs:1072) instead of spawn→crash→RETRYABLE per request — the structural answer to ROADMAP SC-3.

**Env knobs** (follow `DEFAULT_*` + `process.env.LLM_PROXY_WORKER_*` convention, worker-pool.mjs:69-81, 500-501): threshold + window, e.g. `LLM_PROXY_WORKER_CRASH_THRESHOLD` / `LLM_PROXY_WORKER_CRASH_WINDOW_MS`.

---

### D-08 — `dispose()` removes worker from pool array synchronously (WR-04 fold-in) → `ClaudeWorker.dispose()` + `WorkerPool` (dispose-synchrony)

**Analog:** `WorkerPool._dropWorker` (worker-pool.mjs:594-602) — the synchronous splice+prune already exists; today it is only reached via the async `'exit'` event (line 588) or the post-request recycle finally (lines 747-751).

**Synchronous splice+prune to invoke eagerly** (worker-pool.mjs:594-602):
```javascript
_dropWorker(key, worker) {
  const workers = this.workersByKey.get(key);
  if (!workers) return;
  const idx = workers.indexOf(worker);
  if (idx !== -1) workers.splice(idx, 1);
  if (workers.length === 0) this.workersByKey.delete(key); // CR-02 invariant
}
```

**Current dispose (does NOT touch the pool array)** (worker-pool.mjs:434-447):
```javascript
dispose() {
  try { this._proc.stdin?.end(); } catch { /* already closed */ }
  try {
    if (!this._exited && typeof this._proc.kill === 'function') {
      this._proc.kill('SIGTERM');
    }
  } catch { /* best-effort */ }
}
```

**Pattern to add (D-08):** when the pool disposes a worker for *lifecycle* reasons (cancel/idle/cooldown), it must call `_dropWorker(key, worker)` **synchronously alongside** `worker.dispose()` — not wait for the async `'exit'`. The post-request recycle block already does exactly this ordering (worker-pool.mjs:747-750):
```javascript
if (worker.needsRecycle || worker.isStale) {
  try { worker.dispose(); } catch { /* best-effort */ }
  this._dropWorker(key, worker); // CR-02: deletes the key if now empty
}
```
Copy that `dispose()` + immediate `_dropWorker()` pairing to the abort (D-01) and idle (D-04) paths so a concurrent `acquire` (worker-pool.mjs:703 `workers.find((w) => !w.busy)`) can never hand out an already-SIGTERMed worker. Keep the `'exit'`→`_dropWorker` handler too (line 588) — it is idempotent (`indexOf === -1` guard at line 597) and still reaps unexpected crashes.

---

### D-01 + D-03 — Cancel = SIGTERM+respawn, targeting in-flight vs queued → `WorkerPool.complete` abort wiring (abort-propagation)

**Analog:** `WorkerPool.complete` `onAbort` seam (worker-pool.mjs:725-734) — currently calls the non-destructive `worker.cancel()`; D-01 replaces that body with dispose+drop.

**Current seam to replace** (worker-pool.mjs:725-734):
```javascript
let onAbort;
if (abortSignal) {
  if (abortSignal.aborted) {
    try { worker.cancel(); } catch { /* seam best-effort */ }
  } else {
    onAbort = () => { try { worker.cancel(); } catch { /* seam best-effort */ } };
    abortSignal.addEventListener?.('abort', onAbort, { once: true });
  }
}
```

**Pattern to change (D-01):** swap `worker.cancel()` for `worker.dispose()` + `this._dropWorker(key, worker)` (the D-08 pairing) and reject the in-flight request RETRYABLE via the existing `_onExit` drain (the SIGTERM'd proc's `'exit'` fires `_onExit` → `makeRetryableError`, worker-pool.mjs:419). Context D-01: "SIGTERM the worker, reject its in-flight request as RETRYABLE, and synchronously drop it." The Phase-62 `cancel()` method (worker-pool.mjs:394-403) is now dead for the disconnect path (Context: live-proved the protocol interrupt hangs — 62-HUMAN-UAT.md test 6); leave it or remove it (executor discretion), but the disconnect path must NOT use it.

**D-03 in-flight-vs-queued discrimination:** the worker already separates these — `_pending` is the in-flight request (worker-pool.mjs:291) and `_queue` holds queued jobs (worker-pool.mjs:211, 283). The abort handler must check which the aborted request is:
- **In-flight** (the request currently mapped to `_pending`) → SIGTERM+dispose+drop per D-01.
- **Queued** (still in `_queue`, concurrency-1 FIFO) → splice it out of `_queue` and reject it RETRYABLE only; leave the worker + its different in-flight request untouched.

The `_onExit` queue-drain loop (worker-pool.mjs:422-425) is the model for "reject a queued job RETRYABLE"; copy that `job.reject(makeRetryableError(...))` shape for the single targeted queued job.

---

### D-01/D-03 wiring — client-disconnect propagation → `server.mjs` (abort-propagation, request-response)

**Analog:** the request handler already builds the AbortController and threads its signal all the way to `workerPool.complete` — no new plumbing, the signal just needs the D-01 dispose behavior on the pool side (above).

**Existing abort source** (server.mjs:1534-1542):
```javascript
const reqAbort = new AbortController();
const triggerAbort = (reason) => {
  if (!reqAbort.signal.aborted && !res.writableEnded) {
    log(`request aborted: ${reason}`);
    reqAbort.abort(new Error(`client disconnected (${reason})`));
  }
};
req.on('close', () => triggerAbort('req close'));
res.on('close', () => triggerAbort('res close'));
```

**Existing signal thread** (server.mjs:1236-1238): `viaCliPath` passes the signal into `workerPool.complete(b, sig, completeClaudeCodeViaCLI)`; the handler calls `completeClaudeCode(callBody, reqAbort.signal)` (server.mjs:1639). So the abort signal *already reaches* `WorkerPool.complete`'s `abortSignal` param (worker-pool.mjs:668) — Phase 63 only changes what the pool *does* with it (D-01).

**Shutdown consistency** (server.mjs:1864-1871): the SIGTERM/SIGINT `shutdown` already calls `workerPool.disposeAll()`. The new idle/cancel/cooldown dispose paths must use the SAME `dispose()` (worker-pool.mjs:434) so shutdown and lifecycle eviction reap identically (Context "Integration Points"). No change needed here unless `disposeAll` should also clear idle timers (it iterates `dispose()` per worker at worker-pool.mjs:763 — ensure each worker's `dispose()` clears its idle timer so shutdown leaves no dangling timer).

---

### Tests — extend the two existing files (test)

**Unit analog:** the CR-01 timeout cases (tests/unit/worker-pool.test.mjs:175-236) are the template for the new lifecycle unit cases — they inject a tiny timeout via `deps` (`{ requestTimeoutMs: 50 }`, line 179), drive the mock, and assert `needsRecycle`/`busy`/RETRYABLE shape.

**Injection seam** (`workerWithMock`, unit test lines 34-46) and **`makeFakeWorker`** (unit test lines 247-277) are the two drivers — use `makeFakeWorker` for pool-level lifecycle (idle/cooldown/dispose-drop), `workerWithMock` for worker-level (EPIPE, generation-guard).

**New unit cases to add (one per decision):**
- **D-04 idle:** inject `{ idleMs: 50 }`, no request, assert the worker `dispose()`s + emits `'exit'` + is dropped from `workersByKey` (mirror the CR-01 timeout assertions at lines 188-194).
- **D-04 reset-on-settle:** drive a request before the idle window, assert the timer reset (worker NOT disposed).
- **D-02 generation-guard:** make a worker settle a request, then push a stray late `result` line onto `mock.stdout` (the technique at unit test lines 141-145), assert it does NOT resolve a subsequent pending promise.
- **D-07 EPIPE:** make the injected `stdin.write` throw `EPIPE`, assert the in-flight write rejects RETRYABLE AND a queued job rejects RETRYABLE (mirror lines 197-221).
- **D-08 dispose-synchrony:** after `pool` disposes a worker on abort, assert `workersByKey.get(key)` no longer contains it *synchronously* (before any `'exit'` tick), and a concurrent `complete` does not pick it.
- **D-06 cooldown:** with a `workerFactory` whose workers exit-early on spawn, drive N completes, assert after threshold the (N+1)th routes to `overflowFn` (count overflow calls like lines 164-172) and after the window a fresh spawn is allowed.
- **D-01/D-03 abort:** abort an in-flight request → assert `dispose()`+drop+RETRYABLE; abort a queued request → assert only that queued job rejects and the worker survives (use `makeFakeWorker` gated `write` like lines 302-315).

**Live analog (`--live`):** tests/integration/worker-pool-live.test.mjs. **MUST use the runner-robust gate** (lines 39-41):
```javascript
const LIVE = process.argv.includes('--live') || process.env.LLM_PROXY_LIVE === '1';
```
plus the `if (MODE !== 'live') { describe(skipped) } else { describe(live) }` envelope (lines 43-50). Context D-discretion + the Phase-62 follow-up: `node --test <file> --live` does NOT forward argv to the per-file child — gate on the env var (`LLM_PROXY_LIVE=1`) OR a direct run (`node <file> --live`). Run live with: `LLM_PROXY_LIVE=1 node --test tests/integration/worker-pool-live.test.mjs`.

**New live cases (D-09 + lifecycle):**
- **D-09 cold-start** (closes Phase-62 SC-2 PARTIAL): assert **zero** `claude -p` workers immediately after proxy start (a `ps`/`pgrep`-based count), then **exactly one** after the first sonnet fallback. This is the dedicated `ps`-based assertion Context D-09 says was missing.
- **idle-evict live:** with a short `LLM_PROXY_WORKER_IDLE_MS`, spawn a worker, wait past the window, assert the subprocess is gone (`ps` count drops to 0).
- **crash live:** kill a worker subprocess externally, assert the next request RETRYABLEs then a fresh worker spawns (no tight respawn loop).
- **cancel live:** abort an in-flight request, assert the worker subprocess is SIGTERM'd (gone) and the next same-key request spawns a NEW pid (the inverse of the Phase-62 "same .pid survives" cancel test at lines 107-124 — D-01 flips that expectation).

**Mock helper:** `tests/helpers/mock-claude-stdio.mjs` may need a `makeMockEarlyExitStdio` (immediately `end()`s stdout to simulate boot crash — extend the existing `end: () => stdout.end()` seam at line 151) for the D-06 cooldown unit case; `makeMockErrorWorkerStdio` (lines 164-183) already covers the error-result path.

## Shared Patterns

### RETRYABLE rejection shape
**Source:** `makeRetryableError` (worker-pool.mjs:455-460)
**Apply to:** every new rejection — idle (no, idle has no caller), EPIPE (D-07), cancel in-flight (D-01), cancel queued (D-03), cooldown (D-06 routes to overflow, no reject).
```javascript
function makeRetryableError(message) {
  const err = new Error(message);
  err.retryable = true;
  err.code = 'WORKER_RETRYABLE';
  return err;
}
```

### `unref()`'d background timer
**Source:** `_dispatch` (worker-pool.mjs:316) `if (timer.unref) timer.unref();`
**Apply to:** the D-04 idle timer (Context: "so it never keeps the proxy process alive").

### env-knob config convention
**Source:** worker-pool.mjs:69-81, 500-501 (`const DEFAULT_X = Number(process.env.LLM_PROXY_WORKER_X) || <fallback>`)
**Apply to:** `LLM_PROXY_WORKER_IDLE_MS` (D-04), crash threshold/window (D-06). Names are planner discretion but MUST follow the `LLM_PROXY_WORKER_*` prefix.

### dispose()+_dropWorker() synchronous pairing (CR-02 invariant)
**Source:** post-request recycle finally (worker-pool.mjs:747-750)
**Apply to:** all D-01/D-04/D-06 pool-side disposals — splice the worker AND delete the key when its array empties, synchronously, before returning.

### `'exit'` → `_dropWorker` reap (idempotent backstop)
**Source:** `_spawnWorker` (worker-pool.mjs:588) `worker.once?.('exit', () => this._dropWorker(key, worker));`
**Apply to:** keep as the async backstop behind every synchronous drop; `_dropWorker`'s `indexOf === -1` guard (line 597) makes double-drop safe.

### `--live` runner-robust gate
**Source:** worker-pool-live.test.mjs:39-50
**Apply to:** all new `--live` lifecycle cases. Gate on `process.argv.includes('--live') || process.env.LLM_PROXY_LIVE === '1'`. NEVER rely on `node --test <file> --live` forwarding argv.

## No Analog Found

None. Every Phase-63 behavior extends an existing Phase-62 function in `worker-pool.mjs` / `server.mjs`. This phase is explicitly "make the existing lifecycle production-correct," so there is no greenfield file requiring RESEARCH.md fallback patterns.

## Metadata

**Analog search scope:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/{worker-pool.mjs, server.mjs}`, `tests/{unit/worker-pool.test.mjs, integration/worker-pool-live.test.mjs, helpers/mock-claude-stdio.mjs}`
**Files scanned:** 5 (all read in full or in targeted ranges)
**Pattern extraction date:** 2026-06-21

// lib/repro/fixtures/clock.mjs
//
// Phase 67, Plan 67-02 (Wave 2) — D-08 deterministic clock shim (Claude's
// discretion mechanism = freeze-at-snapshot base + monotonic offset).
//
// Mechanism: at span open the recorder captures `clock_base = Date.now()` into
// the run snapshot. On replay, `installClock(clockBase)` overrides `Date.now`
// and the no-arg `new Date()` to return
//     clockBase + Math.round(performance.now() - replayStart)
// where `replayStart = performance.now()` is captured at install time. Because
// performance.now() is monotonic non-decreasing and Math.round preserves order,
// successive `Date.now()` values are strictly non-decreasing and the first
// value is >= clockBase — giving a deterministic, monotonic replay clock.
//
// ⚠️ DAEMON WARNING (per 67-RESEARCH / 67-PATTERNS): this shim mutates the
// process-global `Date`. It MUST be imported ONLY by the replay run's OWN node
// entrypoints (the short-lived replay process). It MUST NOT be imported into or
// installed inside long-running daemons (obs-api, the rapid-llm-proxy, the
// health coordinator) — freezing their wall clock would corrupt every
// timestamp they emit. Replayed LLM proxy fixtures already carry their own
// recorded `latencyMs`/`timestamp`, so daemons never need this shim.
//
// The `Date` override is fully reversible via the returned `uninstall()` handle
// (restores the native `Date` constructor + its static `now`), so a replay
// entrypoint can scope the freeze to exactly the window it controls.
//
// Convention: pure ESM (no build step). No console.* (no-console-log) — this
// module performs no logging.

/** The native Date constructor captured at module load (restore target). */
const NativeDate = Date;

/**
 * The most-recently-installed clock base, exported for inspection/debugging.
 * ESM live-binding: importers see this update after each `installClock` call.
 * @type {number|null}
 */
export let clockBase = null;

/**
 * Whether a shim is currently installed (guards against double-install leaking
 * a stacked override that a single uninstall could not fully unwind).
 * @type {boolean}
 */
let installed = false;

/**
 * Install a deterministic, monotonic clock shim frozen at `base`.
 *
 * Overrides the global `Date.now()` and no-arg `new Date()` to return
 * `base + Math.round(now() - replayStart)`. Parametrized construction
 * (`new Date(x)`, `new Date(y, m, d, …)`) and the other Date statics
 * (`Date.parse`, `Date.UTC`) remain native.
 *
 * @param {number} base   The frozen snapshot base in epoch-ms (`clock_base`).
 * @param {{ now?: () => number }} [opts]
 *        `now` is an injectable monotonic time source (defaults to
 *        `performance.now`). Tests inject a stubbed sequence to prove
 *        determinism without real sleeps.
 * @returns {{ uninstall: () => void }} handle whose `uninstall()` restores the
 *        native `Date` (idempotent).
 */
export function installClock(base, opts = {}) {
  const nowFn = (opts && typeof opts.now === 'function')
    ? opts.now
    : () => performance.now();

  // Capture the replay origin so the very first shimmed reading has offset ~0
  // (>= base, within a small rounding epsilon).
  const replayStart = nowFn();

  const shimNow = () => base + Math.round(nowFn() - replayStart);

  // Subclass the native Date so `instanceof Date` and all inherited statics
  // keep working; only the no-arg constructor path and `.now` are shimmed.
  class ShimDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) {
        super(shimNow());
      } else {
        super(...args);
      }
    }
  }
  // Static `now` returns the shimmed reading; `parse`/`UTC` stay inherited.
  ShimDate.now = shimNow;

  const prevDate = globalThis.Date;
  const wasInstalled = installed;

  clockBase = base;
  installed = true;
  globalThis.Date = ShimDate;

  let uninstalled = false;
  return {
    uninstall() {
      if (uninstalled) return;
      uninstalled = true;
      // Restore whatever Date was live before this install; if this was the
      // outermost install, that is the native Date.
      globalThis.Date = wasInstalled ? prevDate : NativeDate;
      installed = wasInstalled;
    },
  };
}

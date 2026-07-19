#!/usr/bin/env node

/**
 * Copilot CLI per-turn injection channel resolver.
 *
 * WHY THIS EXISTS — the churn problem
 * -----------------------------------
 * On a filesystem command hook, Copilot CLI only lets us inject context the model
 * actually reads via an `additionalContext` field, and WHICH event's additionalContext
 * is honored changes version to version (verified with scripts/verify-copilot-hook-injection.sh):
 *
 *   v1.0.71   : postToolUse → additionalContext DELIVERS.
 *               userPromptSubmitted → additionalContext is IGNORED (the hook runs and
 *               prints it, but Copilot drops it before the model sees it).
 *   v1.0.72-1 : userPromptSubmitted → additionalContext DELIVERS (newly honored).
 *               postToolUse still delivers but became flaky in practice.
 *
 * A single fixed channel is therefore never safe across an upgrade. But naively
 * "emit on every channel and suppress after the first" REGRESSES on 1.0.71: the
 * userPromptSubmitted hook process runs first and emits, so it would mark the turn
 * consumed — yet Copilot drops that output, and the postToolUse channel that WOULD
 * have worked is now suppressed. Net: nothing reaches the model.
 *
 * THE DESIGN — the emit set *is* the dedup
 * ----------------------------------------
 * We map the installed Copilot version to the set of per-turn channels whose
 * additionalContext is actually honored, and emit ONLY on that set:
 *
 *   - Known version, one honored channel   → emit on that channel only.
 *       ⇒ injected exactly once, no duplication, no risk of suppressing the live channel.
 *   - Known version, multiple honored       → pick the single most-reliable, earliest one.
 *       ⇒ still injected exactly once.
 *   - Unknown / newer version                → FAIL-SAFE: emit on postToolUse AND
 *       userPromptSubmitted. May duplicate on a version that honors both, but GUARANTEES
 *       delivery on a version that only honors one. A logged warning flags "update the map".
 *
 * So dedup is not a runtime suppression race (which can't tell "honored" from "dropped");
 * it is the plan itself. Per-channel once-per-turn tracking (in the stash) then handles
 * postToolUse firing on every tool call.
 *
 * Only PER-TURN channels are modelled here: userPromptSubmitted (fires once per prompt,
 * before any tool) and postToolUse (fires after each tool). sessionStart is deliberately
 * excluded — it fires once per session, so it cannot carry task-relevant per-turn KB;
 * the session-start baseline is handled separately by knowledge-injection-copilot.js
 * (writes .github/copilot-instructions.md).
 *
 * KEEPING THE MAP HONEST: this map WILL rot as Copilot churns. Two guards:
 *   1. Known ranges are capped (e.g. the 1.0.x entry does not silently claim 1.1+),
 *      so a minor bump drops back to the dup-tolerant fail-safe rather than trusting an
 *      untested channel.
 *   2. When a version is unknown we emit a stderr NOTE so it surfaces in hook logs.
 * Re-run scripts/verify-copilot-hook-injection.sh after an upgrade and extend KNOWN_RANGES.
 *
 * OVERRIDES (for the diagnostic, testing, and emergencies):
 *   COPILOT_VERSION      — force the version string the resolver reasons about
 *                          (so the resolver is testable without Copilot installed).
 *   COPILOT_KB_CHANNELS  — comma list of channels to force, bypassing the map entirely,
 *                          e.g. "postToolUse" or "postToolUse,userPromptSubmitted".
 *                          "none" / "off" disables per-turn injection.
 *
 * @module copilot-channel-capabilities
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// File cache so we don't spawn `copilot --version` on every prompt. The version changes
// rarely; a stale read at worst costs one turn of dup-tolerant fail-safe after an upgrade.
const VERSION_CACHE_FILE = path.join(os.tmpdir(), 'coding-copilot-kb', '.copilot-version');
const VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** The two per-turn channels we can inject through. */
export const PER_TURN_CHANNELS = Object.freeze(['userPromptSubmitted', 'postToolUse']);

/**
 * Version→honored-channel map. Each entry is a half-open range [atLeast, below).
 * `below: null` is intentionally avoided for forward-safety — cap ranges so unknown
 * future versions fall through to the fail-safe.
 *
 * `channels` lists per-turn channels whose additionalContext is honored, in PREFERENCE
 * order (earliest / most reliable first). The resolver picks channels[0] as the single
 * emit channel for a known version.
 */
export const KNOWN_RANGES = Object.freeze([
  {
    // 1.0.0 .. 1.0.71 inclusive: only postToolUse is honored; userPromptSubmitted is dropped.
    atLeast: [1, 0, 0],
    below: [1, 0, 72],
    channels: ['postToolUse'],
    note: 'pre-1.0.72: only postToolUse additionalContext honored',
  },
  {
    // 1.0.72 .. 1.0.x: userPromptSubmitted additionalContext is honored and reliable, and
    // fires once per prompt before any tool → single clean per-turn injection. (postToolUse
    // also delivers here but is flaky, so we do not rely on it and do not double-inject.)
    atLeast: [1, 0, 72],
    below: [1, 1, 0],
    channels: ['userPromptSubmitted'],
    note: '1.0.72+: userPromptSubmitted additionalContext honored (reliable); postToolUse flaky',
  },
]);

/**
 * Fail-safe emit set for versions not covered by KNOWN_RANGES. Emitting on both
 * guarantees delivery on any version that honors at least one; the cost is a possible
 * single duplicate on versions that honor both.
 */
export const FAILSAFE_CHANNELS = Object.freeze(['postToolUse', 'userPromptSubmitted']);

let _versionCache; // memoize the (possibly expensive) copilot --version call

/**
 * Parse a Copilot version string into a comparable [major, minor, patch] tuple.
 * Accepts forms like "1.0.72", "1.0.72-1", "GitHub Copilot CLI 1.0.72-1." — we scan
 * for the first x.y.z. Build/pre-release suffixes (the "-1") are ignored for ranging.
 * @param {string} raw
 * @returns {[number,number,number]|null}
 */
export function parseVersion(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compare two [maj,min,patch] tuples. Returns <0, 0, >0. */
export function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Resolve the installed Copilot version, memoized. Honors COPILOT_VERSION override.
 * Never throws — returns the raw string, or null if it cannot be determined.
 * @returns {string|null}
 */
export function getCopilotVersion() {
  if (process.env.COPILOT_VERSION) return process.env.COPILOT_VERSION;
  if (_versionCache !== undefined) return _versionCache;

  // Fast path: a fresh on-disk cache avoids the subprocess spawn on the prompt latency path.
  try {
    const st = fs.statSync(VERSION_CACHE_FILE);
    if (Date.now() - st.mtimeMs < VERSION_CACHE_TTL_MS) {
      const cached = fs.readFileSync(VERSION_CACHE_FILE, 'utf8').trim();
      if (cached) { _versionCache = cached; return _versionCache; }
    }
  } catch { /* no cache yet */ }

  try {
    _versionCache = execFileSync('copilot', ['--version'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    _versionCache = null;
  }

  if (_versionCache) {
    try {
      fs.mkdirSync(path.dirname(VERSION_CACHE_FILE), { recursive: true });
      fs.writeFileSync(VERSION_CACHE_FILE, _versionCache, 'utf8');
    } catch { /* fail-open: cache is best-effort */ }
  }
  return _versionCache;
}

/** Reset the memoized version (test hook). */
export function _resetVersionCache() { _versionCache = undefined; }

/**
 * Resolve the per-turn injection plan for a given Copilot version.
 *
 * @param {string|null} [versionStr] - version string; defaults to the installed copilot.
 * @returns {{
 *   channels: string[],   // channels to emit on this turn (the dedup set)
 *   known: boolean,       // matched a KNOWN_RANGES entry
 *   version: string|null, // the version string reasoned about
 *   source: 'override'|'map'|'failsafe'|'failsafe-no-version',
 *   note: string,         // human-readable rationale (for logs)
 * }}
 */
export function resolvePlan(versionStr) {
  // 1. Hard override — bypasses the map entirely.
  const override = process.env.COPILOT_KB_CHANNELS;
  if (override != null && override.trim() !== '') {
    const raw = override.trim().toLowerCase();
    if (raw === 'none' || raw === 'off' || raw === '0' || raw === 'false') {
      return { channels: [], known: true, version: versionStr ?? getCopilotVersion(), source: 'override', note: 'per-turn injection disabled via COPILOT_KB_CHANNELS' };
    }
    const channels = override.split(',')
      .map((s) => s.trim())
      .filter((s) => PER_TURN_CHANNELS.includes(s));
    return { channels, known: true, version: versionStr ?? getCopilotVersion(), source: 'override', note: `channels forced via COPILOT_KB_CHANNELS=${override}` };
  }

  const version = versionStr ?? getCopilotVersion();
  const parsed = parseVersion(version);

  // 2. No version → fail-safe (guarantee delivery).
  if (!parsed) {
    return {
      channels: [...FAILSAFE_CHANNELS],
      known: false,
      version,
      source: 'failsafe-no-version',
      note: 'copilot version undeterminable → emitting on all per-turn channels (dup-tolerant)',
    };
  }

  // 3. Match a known range.
  for (const range of KNOWN_RANGES) {
    const geLow = compareVersion(parsed, range.atLeast) >= 0;
    const ltHigh = range.below == null || compareVersion(parsed, range.below) < 0;
    if (geLow && ltHigh) {
      return { channels: [...range.channels], known: true, version, source: 'map', note: range.note };
    }
  }

  // 4. Unknown version → fail-safe with a warning to update the map.
  return {
    channels: [...FAILSAFE_CHANNELS],
    known: false,
    version,
    source: 'failsafe',
    note: `copilot ${version} not in channel-capability map → emitting on all per-turn channels (dup-tolerant); re-run verify-copilot-hook-injection.sh and extend KNOWN_RANGES`,
  };
}

// CLI: `node copilot-channel-capabilities.js` prints the resolved plan (diagnostic aid).
if (import.meta.url === `file://${process.argv[1]}`) {
  const plan = resolvePlan();
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
}

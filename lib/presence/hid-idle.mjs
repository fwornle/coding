// lib/presence/hid-idle.mjs — is a person at this machine?
//
// macOS HID idle time is the authentic "a person touched this machine" clock:
// independent of agent and daemon activity, and of the machine being kept
// awake. The health coordinator gates deferrable background LLM work on it
// (userActiveNow), and the coordinator and glass's daemon slow their network
// probes with it (networkProbeIntervalMs): nobody reads a status line at 3 am.
//
// Off darwin there is no such clock here: the answer is null ("unknown"), and
// callers keep their present-person behaviour rather than over-suppressing.
import { execSync } from 'node:child_process';

/** Idle longer than this = away. */
export const HUMAN_HID_IDLE_MAX_MS =
  parseInt(process.env.HUMAN_HID_IDLE_MAX_MS || '', 10) || 10 * 60_000;

let cache = { at: 0, ms: null };

/**
 * macOS HID idle time in ms (time since last real keyboard/mouse input), or
 * null when it cannot be determined (non-darwin, or ioreg failure). Cached for
 * 3 s so several callers in one tick don't each spawn ioreg.
 */
export function hidIdleMs() {
  const now = Date.now();
  if (now - cache.at < 3000) return cache.ms;
  let ms = null;
  if (process.platform === 'darwin') {
    try {
      const out = execSync('ioreg -c IOHIDSystem -r -d 1 -k HIDIdleTime', {
        encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024,
      });
      const m = out.match(/"HIDIdleTime"\s*=\s*(\d+)/);
      if (m) ms = Number(m[1]) / 1e6; // nanoseconds → ms
    } catch { ms = null; }
  }
  cache = { at: now, ms };
  return ms;
}

/**
 * Tri-state human-presence signal from HID idle time:
 *   true  — a person used input within HUMAN_HID_IDLE_MAX_MS
 *   false — demonstrably idle longer than that (away / asleep / lid closed)
 *   null  — unknown (non-darwin or ioreg unavailable) → callers must fall back
 *           rather than over-suppress.
 */
export function humanPresentByHid() {
  const idle = hidIdleMs();
  if (idle === null) return null;
  return idle < HUMAN_HID_IDLE_MAX_MS;
}

/**
 * Regression contract for the AFK full-suspend of synthetic LLM proxy probes
 * in scripts/health-coordinator.js (restored 2026-07-10).
 *
 * Background: the coordinator fires a cheap ("say OK") and a strong synthetic
 * probe against the LLM proxy to keep `semantic_ok` / `semantic_strong_ok`
 * fresh for the dashboard. The ORIGINAL design suppressed BOTH probes entirely
 * while the operator is away from keyboard (AFK) — nobody watches the dashboard
 * then, so a liveness ping has no consumer. Commit 2129be37b silently
 * downgraded that full-suspend into a THROTTLE (10-min / 30-min idle floor),
 * so the coordinator kept pinging the proxy ~every 10 min through multi-day
 * AFK periods, burning tokens for no benefit.
 *
 * The daemon's tick loop is not unit-testable without spawning the whole
 * coordinator, so this is a SOURCE-CONTRACT guard: it asserts the invariants
 * that distinguish "suspend" from "throttle", derived from the design intent
 * (not from an author's literal regex). If a future edit reintroduces an idle
 * floor, or drops the presence guard from either probe gate, this test fails.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const COORD = path.join(REPO_ROOT, 'scripts', 'health-coordinator.js');

const src = fs.readFileSync(COORD, 'utf-8');
// Collapse runs of whitespace so the assertions are robust to reformatting.
const flat = src.replace(/\s+/g, ' ');

describe('health-coordinator — AFK full-suspend contract', () => {
  test('coordinator source still parses cleanly', () => {
    const res = spawnSync(process.execPath, ['--check', COORD], { encoding: 'utf-8' });
    expect(res.status).toBe(0);
  });

  test('NO idle-throttle floor constants exist (the 2129be37b regression marker)', () => {
    // A throttle keeps a non-zero idle interval; a suspend has none. The mere
    // presence of these constants means someone re-introduced a floor.
    expect(src).not.toMatch(/PROXY_PROBE_INTERVAL_IDLE_MS/);
    expect(src).not.toMatch(/PROXY_STRONG_PROBE_INTERVAL_IDLE_MS/);
  });

  test('the CHEAP synthetic probe gate is conjoined with the presence check', () => {
    // Suppress-when-AFK: the gate must require _userActive, not merely pick a
    // slower interval when AFK.
    expect(flat).toMatch(/if \( ?_userActive && _proxyProbeAge >= PROXY_PROBE_INTERVAL_MS ?\)/);
    // And it must NOT use a ternary that swaps in an idle interval.
    expect(flat).not.toMatch(/userActiveNow\(\) \? PROXY_PROBE_INTERVAL_MS :/);
  });

  test('the STRONG synthetic probe gate is conjoined with the presence check', () => {
    expect(flat).toMatch(/if \( ?_userActive && _strongAge >= PROXY_STRONG_PROBE_INTERVAL_MS ?\)/);
    expect(flat).not.toMatch(/userActiveNow\(\) \? PROXY_STRONG_PROBE_INTERVAL_MS :/);
  });

  test('presence is derived from transcript mtime, not the always-fresh ETM lastBeat (protects a40052b7a)', () => {
    // userActiveNow() must read the transcript file's mtime as the activity
    // clock. lastBeat tracks daemon liveness and made the gate always-true.
    const fn = src.slice(src.indexOf('function userActiveNow()'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    // Strip `//` line comments — the body intentionally NAMES lastBeat in a
    // warning comment ("do NOT key idle-detection off entry.lastBeat"); we only
    // care that no live code reads it.
    const code = body.replace(/\/\/[^\n]*/g, '');
    expect(code).toMatch(/statSync\([^)]*transcriptPath[^)]*\)\.mtimeMs/);
    expect(code).not.toMatch(/entry\.lastBeat/);
  });
});

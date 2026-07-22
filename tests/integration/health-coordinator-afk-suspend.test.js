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

  test('auto-consolidation is AFK-gated (deferrable background LLM work — no burn while away)', () => {
    // The consolidation auto-trigger must require presence, else it drives
    // thousands of overnight consolidator LLM calls draining the backlog while
    // no one is watching. The gate must be the FIRST condition in the if.
    expect(flat).toMatch(/if \( ?userActiveNow\(\) && body\.undigested >= CONSOLIDATION_THRESHOLD/);
  });

  test('presence is exposed on /health/state as user_active (the signal external jobs read)', () => {
    // The sub-agent-sweep job (and any other AFK-gated background daemon) reads
    // currentState.user_active over HTTP; it must be stamped from the same
    // _userActive the probe gates use.
    expect(flat).toMatch(/currentState\.user_active = _userActive/);
  });

  test('presence is derived from real activity clocks, not the always-fresh ETM lastBeat (protects a40052b7a)', () => {
    // The activity clock lives in codingSessionFresh() (called by userActiveNow()).
    // It must read (a) the transcript file mtime and (b) the ETM content-activity ts
    // — both genuine "work happened" signals. The always-fresh daemon heartbeat
    // (entry.lastBeat) may appear ONLY as the narrow URI-transcript fallback (guarded
    // by mt === 0), never as the primary clock — that was the always-true bug.
    const fn = src.slice(src.indexOf('function codingSessionFresh()'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    // Strip `//` line comments — the body NAMES lastBeat in prose; only live code counts.
    const code = body.replace(/\/\/[^\n]*/g, '');
    // (a) transcript file mtime is still a governing activity clock (reads the
    //     transcript path and stats its mtime)
    expect(code).toMatch(/entry\.transcriptPath/);
    expect(code).toMatch(/statSync\([^)]*\)\.mtimeMs/);
    // (b) the non-flapping ETM content-activity ts is the primary signal (probe-cadence fix)
    expect(code).toMatch(/lastContentActivityTs/);
    // lastBeat only in the guarded mt===0 URI fallback — not the primary always-fresh clock
    expect(code).toMatch(/mt === 0 && typeof entry\.lastBeat/);
  });
});

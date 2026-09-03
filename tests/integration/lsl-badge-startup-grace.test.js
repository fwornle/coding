/**
 * Contract for the fix to the red [LSL] badge that greeted every newly opened
 * coding session for ~30 seconds.
 *
 * The mechanism, for whoever reads this next:
 *   1. Closing a session makes reapEtmsForClosedSessions() kill that project's
 *      ETM within one 5s tick.
 *   2. Reopening creates a NEW tmux session, so the coordinator holds no lsl
 *      entry for the project and getLSLHealthStatus() fell through to 'down'.
 *   3. The respawn only came from ensureEtmForActiveProjects(), rate-limited by
 *      ETM_SPAWN_INTERVAL_MS = 30_000. That constant WAS the "~30 seconds".
 *
 * The fix has two halves and this guards both:
 *   • the launcher POSTs an `etm_ensure` signal so the ETM starts at once;
 *   • the badge distinguishes a seconds-old session ('starting', grey) from a
 *     genuinely dead ETM ('down', red).
 *
 * Source-contract style, matching health-coordinator-afk-suspend.test.js: the
 * daemon's tick loop and the async status line are not reachable without
 * spawning both, but the invariants that make this correct are all structural.
 * The end-to-end timing check (close a session, reopen, measure) is a manual
 * verification step, not something to run in CI against a live coordinator.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const COORD_PATH = path.join(REPO_ROOT, 'scripts', 'health-coordinator.js');
const CSL_PATH = path.join(REPO_ROOT, 'scripts', 'combined-status-line.js');
const WRAPPER_PATH = path.join(REPO_ROOT, 'scripts', 'tmux-session-wrapper.sh');

const COORD = fs.readFileSync(COORD_PATH, 'utf-8');
const CSL = fs.readFileSync(CSL_PATH, 'utf-8');
const WRAPPER = fs.readFileSync(WRAPPER_PATH, 'utf-8');

/** Collapse whitespace so assertions survive reformatting. */
const flat = (s) => s.replace(/\s+/g, ' ');

describe('sources still parse', () => {
  test('health-coordinator.js', () => {
    expect(spawnSync(process.execPath, ['--check', COORD_PATH], { encoding: 'utf-8' }).status).toBe(0);
  });
  test('combined-status-line.js', () => {
    expect(spawnSync(process.execPath, ['--check', CSL_PATH], { encoding: 'utf-8' }).status).toBe(0);
  });
  test('tmux-session-wrapper.sh', () => {
    expect(spawnSync('bash', ['-n', WRAPPER_PATH], { encoding: 'utf-8' }).status).toBe(0);
  });
});

describe('coordinator — targeted etm_ensure bypasses the 30s sweep gate', () => {
  test('the signal handler exists and requires a project path', () => {
    expect(COORD).toMatch(/case 'etm_ensure'/);
    expect(flat(COORD)).toMatch(/etm_ensure requires payload\.projectPath/);
  });

  test('it calls the spawner in TARGETED mode, not as a full sweep', () => {
    // `force` without `only` would let any caller drive an unbounded ~/Agentic
    // tree walk at arbitrary frequency.
    expect(flat(COORD)).toMatch(
      /ensureEtmForActiveProjects\(\s*\{\s*only:\s*projectPath,\s*force:\s*true\s*\}\s*\)/
    );
  });

  test('a targeted request skips BOTH the startup grace and the rate limit', () => {
    const f = flat(COORD);
    expect(f).toMatch(/const targeted = force && only/);
    expect(f).toMatch(/if \(!targeted && now - STARTED_AT < HEARTBEAT_STALENESS_MS/);
    expect(f).toMatch(/if \(!targeted && now - _lastEtmSpawnCheck < ETM_SPAWN_INTERVAL_MS\) return/);
  });

  test('a targeted request does NOT advance the shared rate-limit clock', () => {
    // Otherwise a burst of launches would postpone the sweep that covers every
    // OTHER project — trading one project's red badge for everyone else's.
    expect(flat(COORD)).toMatch(/if \(!targeted\) _lastEtmSpawnCheck = now/);
  });

  test('the untargeted periodic sweep is still rate-limited', () => {
    // The whole point is a targeted exemption, not the removal of the limit.
    expect(COORD).toMatch(/const ETM_SPAWN_INTERVAL_MS = 30_000/);
  });

  test('a targeted path is still qualified before an ETM is spawned for it', () => {
    // The path arrives over HTTP. Without this guard the signal would be an
    // "spawn a monitor pointed at any directory you like" primitive.
    expect(flat(COORD)).toMatch(
      /if \(only\) \{ if \(!looksLikeProjectDir\(only\) && !only\.startsWith\(agenticDir \+ '\/'\)\) return;/
    );
  });

  test('a targeted request clears the reaper block for that project', () => {
    // Close-then-reopen is the COMMON case, and the reaper block exists to stop
    // a just-closed session flickering back. A relaunch supersedes it.
    expect(flat(COORD)).toMatch(/if \(targeted \|\| tmuxAlive \|\| hasOpenCode \|\| latestMtime > reapedAt\)/);
  });

  test('a targeted request qualifies on its own, without waiting for tmux to list the session', () => {
    // A two-second-old session has no fresh Claude transcript and may not be in
    // `tmux list-sessions` yet; requiring one of those would reinstate the delay.
    expect(flat(COORD)).toMatch(/if \(!targeted && !transcriptFresh && !tmuxAlive && !hasOpenCode\) continue/);
  });
});

describe('launcher — asks for the ETM at session start', () => {
  test('posts an etm_ensure signal to the coordinator', () => {
    expect(WRAPPER).toMatch(/kind.*etm_ensure/);
    expect(WRAPPER).toMatch(/HEALTH_COORDINATOR_URL:-http:\/\/localhost:3034/);
    // The route is /signals (plural) — the same one the ETM posts heartbeats to.
    // /signal 404s, which curl would swallow silently, leaving the 30s sweep as
    // the only path and the bug apparently unfixed.
    expect(WRAPPER).toMatch(/\$\{url\}\/signals/);
  });

  test('the request can never block or fail a launch', () => {
    // A coordinator that is down must cost the user nothing: the 30s sweep is
    // still there as the fallback.
    const fn = WRAPPER.slice(WRAPPER.indexOf('_request_etm() {'));
    expect(fn).toMatch(/--max-time 2/);
    expect(fn).toMatch(/\|\| true/);
  });

  test('both launch paths record the session and request the ETM', () => {
    // Two call sites: "already inside tmux" (exec directly) and "create a new
    // session". Missing either one leaves that path with the original bug.
    expect(WRAPPER.match(/_request_etm$/gm) || []).toHaveLength(2);
    expect(WRAPPER.match(/_record_agent_session "/g) || []).toHaveLength(2);
  });

  test('the session record carries the start time the badge needs', () => {
    expect(WRAPPER).toMatch(/"startedAt":%s/);
    expect(WRAPPER).toMatch(/agent-sessions/);
  });
});

describe('fast path — a borrowed cache never carries a foreign context gauge', () => {
  const FAST = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'status-line-fast.cjs'), 'utf-8');

  test('the sibling-borrow path blanks the gauge before adopting the line', () => {
    // Observed before this guard: a pi pane rendered a Claude pane's 41%. The
    // borrowed line is also written back to our own cache key, so an un-blanked
    // gauge would persist as ours until the next full render.
    expect(FAST).toMatch(/blankContextGauge\(reunderline\(content, getAbbrev\(projectName\)\)\)/);
  });

  test('no reading blanks the gauge rather than leaving the previous value', () => {
    const fn = FAST.slice(FAST.indexOf('function patchContextGauge('));
    expect(fn.slice(0, 1200)).toMatch(/usage \? contextGauge\.renderGauge\(usage\.usedPct\) : contextGauge\.GAUGE_BLANK/);
  });
});

describe('status line — "starting" is not an alarm', () => {
  test('getLSLHealthStatus can return the distinct starting verdict', () => {
    expect(flat(CSL)).toMatch(/if \(CombinedStatusLine\._sessionAgeMs\(\) < LSL_STARTUP_GRACE_MS\) return 'starting'/);
  });

  test('an unknown session age falls back to Infinity, so real faults stay red', () => {
    // Failing open here would suppress a genuine alarm on any pane whose session
    // record is missing — the opposite of the intent.
    const fn = CSL.slice(CSL.indexOf('static _sessionAgeMs()'));
    expect(fn.slice(0, 600)).toMatch(/return Infinity/);
  });

  test('starting renders an idle dot and does NOT turn the line red', () => {
    const branch = CSL.slice(CSL.indexOf("} else if (lslStatus === 'starting')"));
    expect(branch.slice(0, 400)).toMatch(/STATE_DOTS\.IDLE/);
    // The critical distinction: no overallColor assignment in this branch.
    expect(branch.slice(0, branch.indexOf('}\n', 10))).not.toMatch(/overallColor\s*=/);
  });

  test("'down' and 'stale' keep their original severity", () => {
    const f = flat(CSL);
    expect(f).toMatch(/if \(lslStatus === 'down'\) \{ parts\.push\(`\[LSL\$\{ALARM_DOTS\.CRIT\}\]`\); overallColor = 'red'/);
    expect(f).toMatch(/else if \(lslStatus === 'stale'\) \{ parts\.push\(`\[LSL\$\{ALARM_DOTS\.WARN\}\]`\)/);
  });

  test('the grace window is bounded — a session cannot stay quiet forever', () => {
    const m = CSL.match(/const LSL_STARTUP_GRACE_MS = ([\d_]+)/);
    expect(m).toBeTruthy();
    const ms = Number(m[1].replace(/_/g, ''));
    // Long enough to cover launcher → coordinator → ETM → first heartbeat,
    // short enough that a broken launch still raises an alarm promptly.
    expect(ms).toBeGreaterThanOrEqual(10_000);
    expect(ms).toBeLessThanOrEqual(120_000);
  });
});

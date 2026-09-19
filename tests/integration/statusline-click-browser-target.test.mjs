/**
 * bin/statusline-click must drive the browser the USER is looking at.
 *
 * Apple Events are addressed by bundle id. An automation browser (gsd-browser,
 * Playwright, Puppeteer) is the SAME bundle as the user's Chrome, separated only
 * by its own --user-data-dir — so while one runs it answers
 * `tell application "Google Chrome"` first. The tab-reuse script then finds a
 * tab, navigates it, and reports success against a profile that is not on
 * screen. The click looks dead, nothing errors, and nothing is logged.
 *
 * Worse, it defeats its own verification: asking AppleScript what happened asks
 * the wrong browser too, so the feature measures as working while being broken.
 * Raising the user's Chrome first does not redirect the events (measured);
 * LaunchServices `open` does reach the default-profile instance.
 *
 * This pins the discriminator against real command lines, because that regex is
 * the whole fix — too loose and every click loses tab reuse, too tight and the
 * clicks vanish again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLICK = path.join(REPO, 'bin/statusline-click');
const src = fs.readFileSync(CLICK, 'utf-8');

/** The pattern the script hands pgrep, lifted from the source so the two cannot drift. */
function detectionPattern() {
  const m = src.match(/pgrep -f '([^']+)'/);
  assert.ok(m, 'automation-browser detection pattern not found in bin/statusline-click');
  return m[1];
}

const USER_CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --site-per-process --restart';
const GSD_BROWSER =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --enable-features=NetworkService'
  + ',NetworkServiceInProcess --metrics-recording-only'
  + ' --user-data-dir=/Users/someone/.gsd-browser/browser-profile --disable-sync';
const PLAYWRIGHT =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=0'
  + ' --user-data-dir=/var/folders/xy/T/playwright_chromiumdev_profile-abc';
const RENDERER =
  '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework'
  + '/Versions/1.0/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=renderer';

const matches = (pattern, line) =>
  spawnSync('grep', ['-qE', pattern], { input: line, encoding: 'utf-8' }).status === 0;

test("the user's own Chrome is NOT mistaken for an automation browser", () => {
  // A false positive here costs the tab reuse the feature exists for.
  assert.equal(matches(detectionPattern(), USER_CHROME), false);
});

test('gsd-browser and Playwright profiles ARE detected', () => {
  // A false negative here is the original bug: clicks driving an invisible browser.
  const p = detectionPattern();
  assert.equal(matches(p, GSD_BROWSER), true, 'gsd-browser profile not detected');
  assert.equal(matches(p, PLAYWRIGHT), true, 'playwright profile not detected');
});

test('a Chrome helper/renderer process is not mistaken for a browser instance', () => {
  assert.equal(matches(detectionPattern(), RENDERER), false);
});

test('when an automation browser is up the click goes through LaunchServices, not AppleScript', () => {
  const guard = src.indexOf('if automation_chrome_running; then');
  const osa = src.indexOf('osascript - "$url"');
  assert.ok(guard > 0, 'automation guard missing');
  assert.ok(osa > guard, 'osascript reuse runs before the automation guard — wrong browser again');
  const branch = src.slice(guard, osa);
  assert.match(branch, /open "\$url"/, 'the guarded branch must fall back to LaunchServices open');
  assert.match(branch, /return/, 'the guarded branch must return before reaching the AppleScript');
});

// ---- platform reach -------------------------------------------------------
// The tmux binding is NOT platform-gated, so this script runs wherever the
// status line does. It used to call `open` on every platform: on Linux that is
// not a command, stderr was discarded, and a dashboard click was a silent
// no-op — the same failure shape as the automation-browser bug, from the same
// cause (a browser-opening path that cannot report its own failure).

// ALWAYS through `bash <script>`, never by executing the script directly.
// Windows cannot exec a shebang, so spawnSync(CLICK) there returns a failed
// child whose stdout is undefined — which surfaced as
// "Cannot read properties of undefined (reading 'trim')" on the windows runner
// rather than as anything resembling the real assertion.
const IS_WINDOWS = process.platform === 'win32';
const runClick = (args, env) => spawnSync('bash', [CLICK, ...args], {
  env: { ...process.env, CODING_REPO: REPO, ...env }, encoding: 'utf-8',
});

const dryRun = (platform) => runClick(['health', ''], {
  STATUSLINE_CLICK_DRYRUN: '1', STATUSLINE_CLICK_PLATFORM: platform,
}).stdout.trim();

for (const platform of ['macos', 'linux', 'wsl', 'windows']) {
  test(`the ${platform} branch resolves a url and names its platform`, () => {
    assert.match(dryRun(platform), new RegExp(`^would open: http://localhost:3032/ .*\\[${platform}\\]$`));
  });
}

// Contract tier, in the sense scripts/test-daemon-backend.mjs uses: the opener
// is SUBSTITUTED by a stub on PATH that records how it was called, so the exact
// command line for Linux, WSL and Windows is asserted from any machine. Checking
// only that `command -v` found something would have passed while passing the
// wrong arguments — which is the one mistake this dispatch is prone to.
// Utilities the script itself shells out to. They are symlinked into the stub
// directory so PATH can be JUST that directory — see the note on hermeticity
// below. `bash` is needed because the shebang is `/usr/bin/env bash`, and env
// resolves bash through PATH.
const NEEDED = ['bash', 'date', 'mkdir', 'uname', 'grep', 'wc', 'tail', 'mv', 'cat'];

function whichTool(name) {
  const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function runWithStubs(platform, stubs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clickstub-'));
  for (const t of NEEDED) {
    const real = whichTool(t);
    if (real) { try { fs.symlinkSync(real, path.join(dir, t)); } catch { /* already there */ } }
  }
  const rec = path.join(dir, 'called.txt');
  for (const name of stubs) {
    const f = path.join(dir, name);
    // The stub records its own name LITERALLY rather than via basename "$0":
    // PATH is hermetic, so basename would have to be symlinked in purely to let
    // a stub say who it is.
    fs.writeFileSync(f, `#!/bin/sh\nprintf '%s|%s\\n' ${JSON.stringify(name)} "$*" >> ${JSON.stringify(rec)}\n`);
    fs.chmodSync(f, 0o755);
  }
  const logPath = path.join(dir, 'click.log');
  const r = spawnSync('bash', [CLICK, 'health', ''], {
    env: {
      ...process.env,
      // HERMETIC: this directory and nothing else. The host PATH must not leak,
      // and keeping /usr/bin was not enough — a real `gio` silently won the
      // fallback race on macOS (homebrew) and again on Debian (/usr/bin/gio),
      // so the ordering test asserted nothing on either. The utilities the
      // script needs are symlinked in above, so the ONLY openers reachable are
      // the stubs this case declares.
      PATH: dir,
      STATUSLINE_CLICK_PLATFORM: platform,
      CODING_REPO: REPO,
      STATUSLINE_CLICK_LOG: logPath,
    },
    encoding: 'utf-8',
  });
  const called = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8').trim() : '';
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { called, log, status: r.status };
}

const URL_RE = /http:\/\/localhost:3032\//;

// A hermetic PATH cannot be built under Git Bash: its utilities are .exe with
// DLL dependencies and symlinks need privilege, so the directory would be
// missing the tools the script shells out to. Skipped LOUDLY rather than
// quietly weakened — every assertion below still runs on ubuntu and macOS,
// which is where the Linux and WSL dispatch they cover actually matters.
const HERMETIC = IS_WINDOWS
  ? { skip: 'hermetic PATH is not constructible under Git Bash; covered on ubuntu + macOS' }
  : {};

test('linux hands the url to xdg-open', HERMETIC, () => {
  const { called } = runWithStubs('linux', ['xdg-open']);
  assert.match(called, /^xdg-open\|/);
  assert.match(called, URL_RE);
});

test('linux falls through xdg-open → gio → firefox, in order', HERMETIC, () => {
  // `gio` takes a subcommand, so this also checks the multi-word entry expands
  // to `gio open <url>` rather than `gio <url>`.
  const gio = runWithStubs('linux', ['gio', 'firefox']);
  assert.match(gio.called, /^gio\|open http:\/\/localhost:3032\//);
  const ff = runWithStubs('linux', ['firefox']);
  assert.match(ff.called, /^firefox\|http:\/\/localhost:3032\//);
});

test('xdg-open wins when several openers are installed', HERMETIC, () => {
  const { called } = runWithStubs('linux', ['xdg-open', 'gio', 'firefox']);
  assert.equal(called.split('\n').length, 1, 'more than one opener ran');
  assert.match(called, /^xdg-open\|/);
});

test('wsl prefers wslview, and its cmd.exe fallback keeps the empty title argument', HERMETIC, () => {
  const v = runWithStubs('wsl', ['wslview']);
  assert.match(v.called, /^wslview\|http:\/\/localhost:3032\//);

  // `start` consumes its FIRST quoted argument as the window title. Without the
  // empty "" the URL becomes the title and no browser opens — a silent no-op,
  // which is the whole failure class this dispatch exists to end.
  const c = runWithStubs('wsl', ['cmd.exe']);
  assert.match(c.called, /^cmd\.exe\|\/c start\s+http:\/\/localhost:3032\//,
    'cmd.exe fallback lost the empty title argument');
});

test('windows uses start with the same empty title argument', HERMETIC, () => {
  const { called } = runWithStubs('windows', ['cmd']);
  assert.match(called, /^cmd\|\/c start\s+http:\/\/localhost:3032\//);
});

test('a platform with no usable opener SAYS so rather than doing nothing', HERMETIC, () => {
  // Hermetic, with ZERO stubs declared — the only way to be certain nothing is
  // reachable. Asserting this by driving the windows branch on a non-Windows
  // box was wrong: GitHub's macOS runner ships `powershell`, so it selected
  // that and the no-opener path was never exercised there.
  const { log, status } = runWithStubs('windows', []);
  assert.equal(status, 0, 'a missing opener must not fail the click handler');
  assert.match(log, /NO OPENER \(tried: /);
});

test('an unwritable log leaks nothing to stderr', () => {
  // Found by running this script against a read-only bind mount in a container:
  // `printf ... >>"$log" 2>/dev/null` applies redirections left to right, so the
  // failing append was reported on a stderr that was still the terminal, and
  // every click printed `bash: ...: Read-only file system`. tmux renders any
  // run-shell output in a view the user must dismiss — so the debugging aid
  // became the interruption it exists to prevent.
  // /dev/null/... can never be created, on any platform and as any user.
  const r = runClick(['health', ''], {
    STATUSLINE_CLICK_DRYRUN: '1',
    STATUSLINE_CLICK_PLATFORM: 'linux',
    STATUSLINE_CLICK_LOG: '/dev/null/nope/click.log',
  });
  assert.equal(r.stderr, '', `leaked to stderr: ${r.stderr}`);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /would open: /);
});

test('every platform branch is covered — an unknown one is reported, not ignored', () => {
  assert.match(src, /note "statusline: unknown platform/);
});

test('the script still parses', () => {
  assert.equal(spawnSync('bash', ['-n', CLICK]).status, 0);
});

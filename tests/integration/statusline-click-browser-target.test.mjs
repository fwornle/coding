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

const dryRun = (platform) => spawnSync(CLICK, ['health', ''], {
  env: { ...process.env, STATUSLINE_CLICK_DRYRUN: '1', STATUSLINE_CLICK_PLATFORM: platform, CODING_REPO: REPO },
  encoding: 'utf-8',
}).stdout.trim();

for (const platform of ['macos', 'linux', 'wsl', 'windows']) {
  test(`the ${platform} branch resolves a url and names its platform`, () => {
    assert.match(dryRun(platform), new RegExp(`^would open: http://localhost:3032/ .*\\[${platform}\\]$`));
  });
}

test('a platform with no usable opener SAYS so rather than doing nothing', () => {
  // Driven through the windows branch on any non-Windows CI box: none of
  // cmd/powershell/start exist, which is precisely the "no opener" case.
  const log = path.join(REPO, '.logs', `statusline-click-test-${process.pid}.log`);
  try {
    const r = spawnSync(CLICK, ['health', ''], {
      env: { ...process.env, STATUSLINE_CLICK_PLATFORM: 'windows', CODING_REPO: REPO, STATUSLINE_CLICK_LOG: log },
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, 'a missing opener must not fail the click handler');
    assert.match(fs.readFileSync(log, 'utf8'), /NO OPENER \(tried: /);
  } finally {
    fs.rmSync(log, { force: true });
  }
});

test('every platform branch is covered — an unknown one is reported, not ignored', () => {
  assert.match(src, /note "statusline: unknown platform/);
});

test('the script still parses', () => {
  assert.equal(spawnSync('bash', ['-n', CLICK]).status, 0);
});

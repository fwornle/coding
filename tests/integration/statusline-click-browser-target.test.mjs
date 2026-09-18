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

test('the script still parses', () => {
  assert.equal(spawnSync('bash', ['-n', CLICK]).status, 0);
});

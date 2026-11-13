#!/usr/bin/env node
/**
 * lib/statusline/browser-tab.mjs — open a status-line click's page in the
 * user's Chrome (or Edge, see BROWSER below) on macOS, REUSING an existing tab.
 *
 * Shared by coding's bin/statusline-click (its macOS branch calls this file)
 * and glass's status line, so a click behaves the same in both.
 *
 *   node lib/statusline/browser-tab.mjs <url> [prefix]
 *
 * prints one verdict line ("reused idx=…", "new-tab", "new-window",
 * "launchservices (automation Google Chrome up)", "open (no Microsoft Edge)",
 * "osascript failed: …") for the caller's log — never for tmux, whose
 * run-shell renders any output in a view the user must dismiss.
 *
 * REUSES AN EXISTING TAB. A status line is clicked often, and `open` would
 * leave a fresh duplicate tab behind every single time. The AppleScript looks
 * for a tab whose URL starts with `prefix` — the ORIGIN for a dashboard, so any
 * tab already showing one is re-used and merely navigated to the route being
 * asked for (that is what selects the sub-tab), and the full repo URL for a
 * project bubble, so two different repos still get a tab each. A tab already
 * sitting on the exact target is focused WITHOUT being reloaded, which keeps
 * its scroll position and any filter the user had set.
 *
 * Chrome by name rather than `open <url>`: the dashboards keep per-origin
 * state (auth, tab position) that only lines up if they always land in the
 * same browser, whatever the OS default happens to be that week.
 *
 * BROWSER=edge picks Microsoft Edge instead. Edge is Chromium and answers the
 * same AppleScript suite (windows, tabs, URL, active tab index), so the reuse
 * script, the automation guard and the raise work unchanged under its name.
 */
import fs from 'node:fs';
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The browsers a click can be sent to. `win` is the name Windows' `start`
 * resolves (App Paths), `linux` the launchers a distribution installs.
 */
export const BROWSERS = {
  chrome: { app: 'Google Chrome', win: 'chrome', linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'] },
  edge: { app: 'Microsoft Edge', win: 'msedge', linux: ['microsoft-edge', 'microsoft-edge-stable'] },
};

/**
 * Which of BROWSERS $BROWSER names, or null when it names none of them (unset,
 * or another browser's command). The first `:` entry counts, matched on its
 * basename without `.app`/`.exe`, so `edge`, `Microsoft Edge`, `msedge.exe` and
 * `/Applications/Microsoft Edge.app` all mean Edge.
 */
export function chosenBrowser(env = process.env) {
  const first = String(env.BROWSER || '').split(':')[0].trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\\ /g, ' ');
  const base = first.split(/[\\/]/).filter(Boolean).pop() || '';
  const name = base.toLowerCase().replace(/\.(app|exe)$/, '').replace(/[\s_]+/g, '-');
  if (/^(ms|microsoft-)?edge(-stable)?$/.test(name)) return 'edge';
  if (/^(google-)?chrome(-stable)?$/.test(name)) return 'chrome';
  return null;
}

/** The macOS browser: $BROWSER's when it names one, otherwise Chrome. */
export function macBrowser(env = process.env) {
  const { app } = BROWSERS[chosenBrowser(env) || 'chrome'];
  return { app, path: `/Applications/${app}.app` };
}

// Is an AUTOMATION copy of the browser running — gsd-browser, Playwright, Puppeteer?
//
// This decides whether the tab-reuse script can be trusted at all. Apple
// Events are addressed by BUNDLE ID, and an automation browser is the same
// bundle as the user's, distinguished only by its own --user-data-dir. When
// one is running it answers `tell application "Google Chrome"` FIRST, so the
// reuse script drives the automation profile instead of the browser on the
// user's screen — it finds a tab, navigates it, reports success, and the user
// sees nothing change. Raising the user's Chrome first does not help — Apple
// Events do not follow frontmost-ness (measured). LaunchServices `open` does
// route to the user's default-profile instance, so that is the safe path
// whenever an automation browser is up.
//
// The test is "any Chrome with an explicit --user-data-dir": every automation
// runner sets one and the user's own never does. Erring toward "automation is
// running" costs only a duplicate tab; erring the other way loses the click.
// Playwright drives Edge the same way (channel msedge), so the test is per app.
export function automationPattern(app) {
  const esc = app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `${esc}\\.app/Contents/MacOS/${esc}.*--user-data-dir=`;
}

// A first run prompts for permission to control Chrome; a refusal (or a
// scripting error of any kind) must still get the user their page, so every
// failure path falls through to a plain open.
export const reuseScript = (app) => `on run argv
  set targetURL to item 1 of argv
  set matchPrefix to item 2 of argv
  tell application "${app}"
    if (count of windows) is 0 then
      make new window
      set URL of active tab of front window to targetURL
      activate
      return "new-window"
    end if
    repeat with w in windows
      set idx to 0
      repeat with t in tabs of w
        set idx to idx + 1
        if (URL of t as string) starts with matchPrefix then
          if (URL of t as string) is not targetURL then set URL of t to targetURL
          set active tab index of w to idx
          set index of w to 1
          activate
          return "reused idx=" & idx & " active=" & (active tab index of w) & " wins=" & (count of windows)
        end if
      end repeat
    end repeat
    tell front window to make new tab with properties {URL:targetURL}
    activate
    return "new-tab"
  end tell
end run
`;

export function automationBrowserRunning(app, { spawnSync = nodeSpawnSync } = {}) {
  return spawnSync('pgrep', ['-f', automationPattern(app)], { stdio: 'ignore' }).status === 0;
}

/**
 * @param {string} url
 * @param {string} [prefix]  a tab whose URL starts with this is re-used (default: url)
 * @returns {string} the verdict, for a log
 */
export function openOrFocusTab(url, prefix = url, { spawnSync = nodeSpawnSync, exists = fs.existsSync, env = process.env } = {}) {
  const quiet = { stdio: 'ignore' };
  const { app, path } = macBrowser(env);
  if (!exists(path)) {
    spawnSync('open', [url], quiet);
    return `open (no ${app})`;
  }
  if (automationBrowserRunning(app, { spawnSync })) {
    // Correctness over tidiness: a new tab in the RIGHT browser beats a reused
    // tab in one the user cannot see. `open` both routes and raises.
    spawnSync('open', [url], quiet);
    return `launchservices (automation ${app} up)`;
  }
  const r = spawnSync('osascript', ['-', url, prefix], { input: reuseScript(app), encoding: 'utf8', timeout: 15_000 });
  const ok = r.status === 0;
  // RAISING THE BROWSER IS A SEPARATE STEP, and it is not optional. `activate`
  // inside the AppleScript, issued from the tmux SERVER process, routinely
  // loses macOS's focus-stealing check: the tab really is re-used and
  // navigated, but the window stays behind the terminal and the click reads as
  // a dead no-op. `open -a` with NO url is the LaunchServices activation on its
  // own: it wins focus where `activate` does not, and opens no tab. On the
  // AppleScript failure path the url comes with it, since there is then no tab
  // to raise.
  spawnSync('open', ok ? ['-a', app] : ['-a', app, url], quiet);
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().replace(/\s*\n\s*/g, ' ');
  return ok ? out : `osascript failed: ${out || r.error?.message || `status ${r.status}`}`;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [url, prefix] = process.argv.slice(2);
  if (!url) {
    process.stderr.write('usage: browser-tab.mjs <url> [prefix]\n');
    process.exit(2);
  }
  process.stdout.write(`${openOrFocusTab(url, prefix || url)}\n`);
}

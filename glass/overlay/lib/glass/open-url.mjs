// lib/glass/open-url.mjs — open a URL in the user's browser, per platform.
//
// The opener chain of coding's bin/statusline-click, without a shell. macOS:
// coding's own tab reuse (lib/statusline/browser-tab.mjs) — an open tab of the
// same origin is focused, and navigated only when it shows another page; a new
// tab opens only when there is none. Linux the xdg family, WSL the Windows
// browser ($BROWSER, wslview, then cmd.exe — by its absolute path too, since
// `appendWindowsPath=false` takes it off PATH), Windows `cmd /c start`: no
// scripting bridge there, so a new tab. The first opener that starts wins;
// none → false.
//
// BROWSER=edge or BROWSER=chrome (chosenBrowser) names the browser on every
// platform: macOS reuses tabs in it, the others start it by name ahead of the
// system default. `glass browser edge` stores the same choice in config.json,
// which wins: a click runs in tmux's environment, not the shell's, so a file
// read at click time is the setting that cannot go stale.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

import { BROWSERS, chosenBrowser, openOrFocusTab } from '../statusline/browser-tab.mjs';
import { glassHome, glassPaths } from './home.mjs';

export function isWsl(env = process.env) {
  if (process.platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME) return true;
  try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
}

const WIN_CMD = '/mnt/c/Windows/System32/cmd.exe';

/** The `browser` key of config.json (`glass browser`), or undefined. */
export function configuredBrowser(file = glassPaths(glassHome()).config) {
  try {
    const { browser } = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof browser === 'string' && browser.trim() ? browser.trim() : undefined;
  } catch { return undefined; }
}

/** The environment a URL is opened with: config.json's browser as BROWSER, if set. */
export function browserEnv(env = process.env, browser = configuredBrowser()) {
  return browser ? { ...env, BROWSER: browser } : env;
}

/**
 * The first entry of $BROWSER as [cmd, args] (`%s` = the URL, else appended), or
 * null. Profiles often write it shell-escaped (`/mnt/c/Program\ Files/…`) inside
 * quotes, which keeps the backslash: it is undone here.
 */
export function browserFromEnv(url, env = process.env) {
  const first = String(env.BROWSER || '').split(':')[0].trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\\ /g, ' ');
  if (!first) return null;
  return first.includes('%s') ? [first.split(' %s')[0], [url]] : [first, [url]];
}

/** The opener commands to try for `url`, in order. */
export function openers(url, platform = process.platform, wsl = isWsl(), env = process.env) {
  if (platform === 'darwin') return [['open', [url]]];
  const named = BROWSERS[chosenBrowser(env)];
  const start = (...app) => ['/c', 'start', '""', ...app, url.replace(/&/g, '^&')];
  if (platform === 'win32') return [named && ['cmd', start(named.win)], ['cmd', start()]].filter(Boolean);
  if (wsl) {
    // A path in $BROWSER is run as it stands; a bare name is the Windows browser.
    const own = named && !/[\\/]/.test(env.BROWSER) ? [['cmd.exe', start(named.win)], [WIN_CMD, start(named.win)]] : [browserFromEnv(url, env)];
    return [...own, ['wslview', [url]], ['cmd.exe', start()], [WIN_CMD, start()]].filter(Boolean);
  }
  return [...(named ? named.linux.map((cmd) => [cmd, [url]]) : []),
    ['xdg-open', [url]], ['gio', ['open', url]], ['sensible-browser', [url]], ['x-www-browser', [url]]];
}

function tryOne(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try {
      // A Windows program started from a Linux directory warns "UNC paths are not supported".
      const cwd = /\.exe$/i.test(cmd) && fs.existsSync('/mnt/c') ? '/mnt/c' : undefined;
      child = spawn(cmd, args, { stdio: 'ignore', detached: true, cwd, windowsVerbatimArguments: cmd === 'cmd' });
    } catch { resolve(false); return; }
    child.once('error', () => resolve(false));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

/**
 * @param {string} url
 * @param {string} [prefix]  macOS: a tab whose URL starts with this is re-used
 * @returns {Promise<boolean>} whether an opener started
 */
export async function openUrl(url, prefix = url, { platform = process.platform, focusTab = openOrFocusTab, env = browserEnv() } = {}) {
  if (platform === 'darwin') {
    const verdict = focusTab(url, prefix, { env });
    if (process.env.GLASS_VERBOSE) process.stderr.write(`glass: open ${url} — ${verdict}\n`);
    return true; // every path ends in the page: a failed AppleScript falls back to open
  }
  for (const [cmd, args] of openers(url, platform, isWsl(env), env)) {
    if (await tryOne(cmd, args)) return true;
  }
  return false;
}

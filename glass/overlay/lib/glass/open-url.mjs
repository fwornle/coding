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
import fs from 'node:fs';
import { spawn } from 'node:child_process';

import { openOrFocusTab } from '../statusline/browser-tab.mjs';

export function isWsl(env = process.env) {
  if (process.platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME) return true;
  try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
}

const WIN_CMD = '/mnt/c/Windows/System32/cmd.exe';

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
  if (platform === 'win32') return [['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]];
  if (wsl) {
    const start = ['/c', 'start', '""', url.replace(/&/g, '^&')];
    return [browserFromEnv(url, env), ['wslview', [url]], ['cmd.exe', start], [WIN_CMD, start]].filter(Boolean);
  }
  return [['xdg-open', [url]], ['gio', ['open', url]], ['sensible-browser', [url]], ['x-www-browser', [url]]];
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
export async function openUrl(url, prefix = url, { platform = process.platform, focusTab = openOrFocusTab } = {}) {
  if (platform === 'darwin') {
    const verdict = focusTab(url, prefix);
    if (process.env.GLASS_VERBOSE) process.stderr.write(`glass: open ${url} — ${verdict}\n`);
    return true; // every path ends in the page: a failed AppleScript falls back to open
  }
  for (const [cmd, args] of openers(url, platform)) {
    if (await tryOne(cmd, args)) return true;
  }
  return false;
}

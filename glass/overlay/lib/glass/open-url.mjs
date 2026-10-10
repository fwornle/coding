// lib/glass/open-url.mjs — open a URL in the user's browser, per platform.
//
// The opener chain of coding's bin/statusline-click, without a shell. macOS:
// coding's own tab reuse (lib/statusline/browser-tab.mjs) — an open tab of the
// same origin is focused, and navigated only when it shows another page; a new
// tab opens only when there is none. Linux the xdg family, WSL the Windows
// browser (wslview, then cmd.exe), Windows `cmd /c start`: no scripting bridge
// there, so a new tab. The first opener that starts wins; none → false.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

import { openOrFocusTab } from '../statusline/browser-tab.mjs';

export function isWsl(env = process.env) {
  if (process.platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME) return true;
  try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
}

/** The opener commands to try for `url`, in order. */
export function openers(url, platform = process.platform, wsl = isWsl()) {
  if (platform === 'darwin') return [['open', [url]]];
  if (platform === 'win32') return [['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]];
  if (wsl) return [['wslview', [url]], ['cmd.exe', ['/c', 'start', '""', url.replace(/&/g, '^&')]]];
  return [['xdg-open', [url]], ['gio', ['open', url]], ['sensible-browser', [url]], ['x-www-browser', [url]]];
}

function tryOne(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: cmd === 'cmd' });
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

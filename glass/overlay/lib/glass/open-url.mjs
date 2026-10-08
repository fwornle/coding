// lib/glass/open-url.mjs — open a URL in the user's browser, per platform.
//
// The opener chain of coding's bin/statusline-click, without a shell: macOS
// `open`, Linux the xdg family, WSL the Windows browser (wslview, then cmd.exe),
// Windows `cmd /c start`. The first opener that starts wins; none → false.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

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

/** @returns {Promise<boolean>} whether an opener started */
export async function openUrl(url) {
  for (const [cmd, args] of openers(url)) {
    if (await tryOne(cmd, args)) return true;
  }
  return false;
}

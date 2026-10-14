// lib/network/proxydetox-restart.mjs
//
// Restart the local proxydetox, the way the platform's service manager runs it.
// proxydetox-heal-decision.mjs decides WHETHER; this is the HOW.
//
// ── Why per platform ─────────────────────────────────────────────────────────
// The coordinator's heal used to be one `launchctl kickstart` line. On Linux and
// WSL — where the coordinator runs as a systemd user unit — that command does
// not exist, so every heal there failed with "proxydetox kickstart error" and
// changed nothing.
//
//   macOS        the .pkg installs the launchd agent cc.colorto.proxydetox,
//                socket-activated on 127.0.0.1:3128
//   Linux / WSL  the .deb installs the systemd USER unit proxydetox.service
//                (kiron1/proxydetox pkg/deb). A proxy that is not that unit —
//                cntlm, a hand-started binary — is the user's, and is left
//                alone: 'unmanaged'.
//   Windows      proxydetox starts from the HKCU Run key, not a service; the
//                coordinator does not run there (coding runs in WSL) and glass
//                never heals.
//
// A failing restart command throws, as execFile does: the caller tells a
// restart still landing after its timeout (err.killed) from a real failure.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const LAUNCHD_LABEL = 'cc.colorto.proxydetox';
export const LAUNCHD_PLIST = `/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
export const SYSTEMD_UNIT = 'proxydetox.service';

// kickstart only works if the job is loaded; when the job was unloaded (old
// px-off behavior did launchctl unload) fall back to bootstrap so the
// socket-activated daemon comes back regardless.
const DARWIN_RESTART = `launchctl kickstart -k gui/$(id -u)/${LAUNCHD_LABEL} 2>/dev/null`
  + ` || launchctl bootstrap gui/$(id -u) ${LAUNCHD_PLIST} 2>/dev/null`
  + ` || launchctl load ${LAUNCHD_PLIST} 2>/dev/null`;

/**
 * @param {object} [o]
 * @param {string} [o.platform]  defaults to process.platform
 * @param {Function} [o.run]     promisified execFile, injectable for tests
 * @param {number} [o.timeoutMs] budget for the restart command itself
 * @returns {Promise<{action: 'restarted'|'unmanaged', how?: string, detail?: string}>}
 */
export async function restartProxydetox({ platform = process.platform, run = promisify(execFile), timeoutMs = 5000 } = {}) {
  switch (platform) {
    case 'darwin':
      await run('bash', ['-c', DARWIN_RESTART], { timeout: timeoutMs });
      return { action: 'restarted', how: `launchctl kickstart ${LAUNCHD_LABEL}` };
    case 'linux': {
      try {
        await run('systemctl', ['--user', 'cat', SYSTEMD_UNIT], { timeout: 3000 });
      } catch {
        return {
          action: 'unmanaged',
          detail: `no systemd user unit ${SYSTEMD_UNIT} — whatever listens on :3128 is not a proxydetox coding can restart`,
        };
      }
      await run('systemctl', ['--user', 'restart', SYSTEMD_UNIT], { timeout: timeoutMs });
      return { action: 'restarted', how: `systemctl --user restart ${SYSTEMD_UNIT}` };
    }
    default:
      return { action: 'unmanaged', detail: `no proxydetox restart on ${platform}` };
  }
}

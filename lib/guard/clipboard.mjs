/**
 * Reads an IMAGE from the host user's clipboard, for the agent box's clipboard
 * bridge (docker/agent-box/clipboard/clipboard-shim.mjs → GET /clipboard on the
 * guard daemon).
 *
 * Why this exists: inside the box the agent is the Linux build. To paste an
 * image it runs `xclip`/`wl-paste`, and the container has no display and no
 * route to the host's clipboard, so image paste silently did nothing. The shim
 * stands in for those two tools and asks the host for the image when the
 * agent pastes — nothing is copied into the box ahead of time.
 *
 * Images only, deliberately. Text never crosses: the clipboard is where
 * passwords pass through, and text paste already works through the terminal.
 *
 *   peekClipboardImage()  → true when the clipboard holds an image (cheap, no data)
 *   readClipboardImage()  → PNG Buffer, or null when there is no image
 *
 * Both take { platform, run } so tests can drive them without a clipboard.
 * Supported hosts: macOS (osascript), Linux (wl-paste on Wayland, else xclip),
 * Windows (PowerShell). Anything else reports "no image".
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Large screenshots on a 5K display are ~15MB as PNG; refuse beyond this. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Run a program; resolves { code, stdout (Buffer), stderr } and never rejects. */
export function runProgram(file, args, { timeout = 10_000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'buffer', timeout, maxBuffer: MAX_IMAGE_BYTES * 2 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? Buffer.alloc(0), stderr: String(stderr ?? '') });
    });
  });
}

const IMAGE_TYPE = /image\/(png|jpeg|jpg|gif|webp|bmp|tiff)/;

/** macOS: write «class PNGf» to a file; AppleScript coerces TIFF/JPEG copies to PNG. */
function macScript(file) {
  return [
    'try',
    '  set png_data to (the clipboard as «class PNGf»)',
    'on error',
    '  return "none"',
    'end try',
    `set fp to open for access (POSIX file "${file}") with write permission`,
    'write png_data to fp',
    'close access fp',
    'return "ok"',
  ].join('\n');
}

const WINDOWS_READ = [
  'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;',
  '$i = [System.Windows.Forms.Clipboard]::GetImage(); if (-not $i) { exit 1 }',
  '$ms = New-Object System.IO.MemoryStream; $i.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);',
  '[Convert]::ToBase64String($ms.ToArray())',
].join(' ');
const WINDOWS_PEEK = 'Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Clipboard]::ContainsImage()) { exit 0 } else { exit 1 }';

const wayland = (env) => Boolean(env.WAYLAND_DISPLAY);

export async function peekClipboardImage({ platform = process.platform, run = runProgram, env = process.env } = {}) {
  if (platform === 'darwin') {
    const r = await run('osascript', ['-e', 'clipboard info']);
    return r.code === 0 && /«class PNGf»|TIFF picture|«class TIFF»|JPEG picture/.test(String(r.stdout));
  }
  if (platform === 'linux') {
    const r = wayland(env)
      ? await run('wl-paste', ['--list-types'])
      : await run('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']);
    return r.code === 0 && IMAGE_TYPE.test(String(r.stdout));
  }
  if (platform === 'win32') {
    return (await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PEEK])).code === 0;
  }
  return false;
}

export async function readClipboardImage({ platform = process.platform, run = runProgram, env = process.env } = {}) {
  let png = null;
  if (platform === 'darwin') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-clip-'));
    const file = path.join(dir, 'clip.png');
    try {
      const r = await run('osascript', ['-e', macScript(file)]);
      if (r.code === 0 && String(r.stdout).trim() === 'ok' && fs.existsSync(file)) png = fs.readFileSync(file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } else if (platform === 'linux') {
    const r = wayland(env)
      ? await run('wl-paste', ['--no-newline', '--type', 'image/png'])
      : await run('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
    if (r.code === 0 && r.stdout.length) png = r.stdout;
  } else if (platform === 'win32') {
    const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ]);
    if (r.code === 0) png = Buffer.from(String(r.stdout).trim(), 'base64');
  }
  if (!png || png.length === 0) return null;
  if (png.length > MAX_IMAGE_BYTES) throw new Error(`clipboard image is ${png.length} bytes (limit ${MAX_IMAGE_BYTES})`);
  // A PNG starts with \x89PNG; anything else is not what the box asked for.
  if (png.subarray(0, 4).toString('latin1') !== '\x89PNG') return null;
  return png;
}

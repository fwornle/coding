// lib/glass/spawn.mjs — run an agent CLI with inherited stdio, on every platform.
//
// On Windows the npm-installed agents are .cmd shims, which Node only runs through
// a shell (CVE-2024-27980), so the command line is escaped for cmd.exe there (glass
// G0/S6: an unquoted multi-word prompt splits). Elsewhere: no shell.
//
// The escaping is cross-spawn's (https://qntm.org/cmd): quote each argument for the
// program's own parser, then put ^ before every cmd.exe metacharacter, quotes
// included, so cmd.exe never enters quote mode and passes everything literally.
// Escaping only with quotes is not enough: cmd.exe does not read \" as an escaped
// quote, so in `"a \"&calc&\" b"` the &calc& is outside quotes and runs.
// A .cmd/.bat target parses its %* once more, so it gets a second level of ^.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** One argument escaped for cmd.exe; `batch` when the target is a .cmd/.bat file. */
export function cmdArg(arg, { batch = false } = {}) {
  let a = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`.replace(CMD_META, '^$1');
  if (batch) a = a.replace(CMD_META, '^$1');
  return a;
}

/** Whether `bin` resolves, through PATH and PATHEXT as cmd.exe would, to a .cmd/.bat file. */
export function isBatchFile(bin, env = process.env) {
  const ext = path.win32.extname(bin);
  if (ext) return /^\.(cmd|bat)$/i.test(ext);
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of [process.cwd(), ...dirs]) {
    for (const e of exts) {
      if (fs.existsSync(path.join(dir, bin + e))) return /^\.(cmd|bat)$/i.test(e);
    }
  }
  return true; // not found: npm shims are the usual case, and the spawn fails either way
}

/** The full command line for spawn(…, { shell: true }) on Windows. */
export function cmdLine(bin, args = [], env = process.env) {
  const batch = isBatchFile(bin, env);
  return [bin.replace(CMD_META, '^$1'), ...args.map((a) => cmdArg(a, { batch }))].join(' ');
}

/**
 * @returns {Promise<number>} the agent's exit code (128 + signal number style for signals)
 */
export function runAgent(bin, args, env, { platform = process.platform } = {}) {
  return new Promise((resolve) => {
    const win = platform === 'win32';
    const child = win
      ? spawn(cmdLine(bin, args, env), { stdio: 'inherit', env, shell: true, windowsHide: false })
      : spawn(bin, args, { stdio: 'inherit', env });
    // Ctrl-C reaches the agent through the terminal; the wrapper waits for it to exit.
    const ignore = () => {};
    process.on('SIGINT', ignore);
    process.on('SIGTERM', ignore);
    const done = (code) => {
      process.off('SIGINT', ignore);
      process.off('SIGTERM', ignore);
      resolve(code);
    };
    child.on('error', (err) => {
      process.stderr.write(`glass: could not start ${bin}: ${err.message}\n`);
      done(127);
    });
    child.on('exit', (code, signal) => done(code ?? (signal ? 130 : 1)));
  });
}

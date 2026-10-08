// lib/glass/spawn.mjs — run an agent CLI with inherited stdio, on every platform.
//
// On Windows the npm-installed agents are .cmd shims, which Node only runs through
// a shell (CVE-2024-27980), so the arguments are quoted for cmd.exe there (glass
// G0/S6: an unquoted multi-word prompt splits). Elsewhere: no shell.
import { spawn } from 'node:child_process';

/** One argument quoted for cmd.exe. */
export function cmdQuote(arg) {
  if (arg === '') return '""';
  if (!/[\s"&|<>^%()!]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1').replace(/%/g, '"^%"')}"`;
}

/**
 * @returns {Promise<number>} the agent's exit code (128 + signal number style for signals)
 */
export function runAgent(bin, args, env, { platform = process.platform } = {}) {
  return new Promise((resolve) => {
    const win = platform === 'win32';
    const child = win
      ? spawn([cmdQuote(bin), ...args.map(cmdQuote)].join(' '), { stdio: 'inherit', env, shell: true, windowsHide: false })
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

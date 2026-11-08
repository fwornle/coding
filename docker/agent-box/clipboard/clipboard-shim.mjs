#!/usr/bin/env node
/**
 * `xclip` / `wl-paste` stand-in for the agent box: image paste from the HOST
 * clipboard.
 *
 * Inside the box the agents are Linux builds. Claude Code pastes an image by
 * running
 *   xclip -selection clipboard -t TARGETS -o | grep -E "image/(png|…)"   (is there one?)
 *   xclip -selection clipboard -t image/png -o > file                    (read it)
 * with wl-paste (`-l`, `--type image/png`) as the fallback. The container has
 * no display and no route to the host clipboard, so this answers both from the
 * host guard daemon's GET /clipboard (lib/guard/clipboard.mjs), authenticated
 * with this box's token. The host reads its clipboard at that moment only.
 *
 * Images only. Copying (xclip -i, wl-copy) and text reads are refused: text
 * paste already works through the terminal, and the clipboard is where
 * passwords pass through.
 *
 * Installed by the Dockerfile as /usr/local/bin/xclip and /usr/local/bin/wl-paste,
 * each `exec node <this> <tool> "$@"`.
 */
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** What a command line asks for: { action: 'peek' | 'read' | 'unsupported', type?, why? }. */
export function parseArgs(tool, args) {
  if (tool === 'xclip') {
    let type = null;
    let out = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-t' || a === '-target') type = args[++i];
      else if (a === '-o' || a === '-out') out = true;
      else if (a === '-selection' || a === '-sel') i++;
    }
    if (!out) return { action: 'unsupported', why: 'copying to the clipboard' };
    if (type === 'TARGETS') return { action: 'peek' };
    if (type && type.startsWith('image/')) return { action: 'read', type };
    return { action: 'unsupported', why: `reading ${type ?? 'text'}` };
  }
  if (tool === 'wl-paste') {
    let type = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-l' || a === '--list-types') return { action: 'peek' };
      if (a === '-t' || a === '--type') type = args[++i];
      else if (a.startsWith('--type=')) type = a.slice('--type='.length);
    }
    if (type && type.startsWith('image/')) return { action: 'read', type };
    return { action: 'unsupported', why: `reading ${type ?? 'text'}` };
  }
  return { action: 'unsupported', why: `unknown tool ${tool}` };
}

async function ask(peek, env) {
  const base = env.CODING_GUARD_URL;
  const token = env.CODING_GUARD_BOX_TOKEN;
  if (!base || !token) throw new Error('not in a registered agent box (CODING_GUARD_URL / CODING_GUARD_BOX_TOKEN unset)');
  const res = await fetch(`${base}/clipboard${peek ? '?peek=1' : ''}`, {
    headers: { 'x-coding-box-token': token },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `guard answered ${res.status}`);
  return body;
}

const fail = (tool, message) => {
  process.stderr.write(`${tool} (coding box): ${message}\n`);
  return 1;
};

export async function main(tool, args, env = process.env) {
  const want = parseArgs(tool, args);
  if (want.action === 'unsupported') {
    return fail(tool, `${want.why} is not supported in the box — only pasting an image from the host clipboard is`);
  }
  let body;
  try {
    body = await ask(want.action === 'peek', env);
  } catch (err) {
    return fail(tool, `host clipboard unavailable: ${err.message}`);
  }
  if (want.action === 'peek') {
    if (body.image) process.stdout.write(`${tool === 'xclip' ? 'TARGETS\n' : ''}${body.image}\n`);
    return 0;
  }
  // The host always hands over PNG; any other type the caller asks for is absent.
  if (!body.image || want.type !== 'image/png') return fail(tool, `no ${want.type} on the host clipboard`);
  const png = Buffer.from(body.data, 'base64');
  await new Promise((resolve) => process.stdout.write(png, resolve));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [tool, ...args] = process.argv.slice(2);
  process.exitCode = await main(tool, args);
}

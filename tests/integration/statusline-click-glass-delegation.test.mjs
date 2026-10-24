/**
 * A glass status-line field clicked while coding's MouseDown1Status binding is
 * current must still reach glass.
 *
 * Key tables are server-wide: glass's binding claims `g:*` clicks in a glass
 * session and chains everything else to the binding it replaced, but every
 * coding launch rebinds MouseDown1Status (tmux-session-wrapper.sh
 * _bind_status_clicks) without chaining back. A coding session started after a
 * glass session therefore received glass's clicks and answered
 * "statusline: unmapped field 'g:health'" — the glass UI never opened.
 *
 * bin/statusline-click now hands `g:*` to the glass that owns the session,
 * using the node + glass.mjs paths glass wrote into the session's status-right
 * (tmux's run-shell PATH need not contain either). Driven here against a stub
 * tmux and a stub node that records its argv — no tmux server, no browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLICK = path.join(REPO, 'bin/statusline-click');

function sandbox({ statusRight }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slc-glass-'));
  const record = path.join(dir, 'glass-argv');
  const notes = path.join(dir, 'notes');
  const node = path.join(dir, 'node');
  fs.writeFileSync(node, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\n`, { mode: 0o755 });
  const right = statusRight.replace('<NODE>', node);
  // A tmux that answers the handler's reads for one glass session.
  fs.writeFileSync(path.join(dir, 'tmux'), `#!/bin/sh
case "$*" in
  *"#{session_name}"*) echo glass-claude-ab12 ;;
  *"#{client_name}"*) echo /dev/ttys009 ;;
  *"@glass_task"*) echo glass-claude-20261024-000000-abcdef ;;
  *"@glass_port"*) echo 12447 ;;
  *status-right*) cat <<'EOF'
${right}
EOF
  ;;
  display-message*) shift; printf '%s\\n' "$*" >> '${notes}' ;;
esac
exit 0
`, { mode: 0o755 });
  return { dir, record, notes };
}

function click(tag, box) {
  return spawnSync('bash', [CLICK, tag, '%49'], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${box.dir}:/usr/bin:/bin`,
      CODING_REPO: REPO,
      STATUSLINE_CLICK_LOG: path.join(box.dir, 'click.log'),
    },
  });
}

test("a g:* click is handed to the session's own glass with its task, port, client and pane", () => {
  const box = sandbox({
    statusRight: "#('<NODE>' '/opt/glass/bin/glass.mjs' statusline --format tmux --port 12447 --task '#{@glass_task}' 2>/dev/null || echo '[glass ?]')",
  });
  const r = click('g:health', box);
  assert.equal(r.status, 0, 'a click handler always exits 0');
  assert.ok(fs.existsSync(box.record), 'glass was not invoked');
  assert.deepEqual(fs.readFileSync(box.record, 'utf-8').trim().split('\n'), [
    '/opt/glass/bin/glass.mjs', 'click', 'g:health',
    '--task', 'glass-claude-20261024-000000-abcdef',
    '--port', '12447',
    '--client', '/dev/ttys009',
    '--pane', '%49',
  ]);
  assert.equal(fs.existsSync(box.notes) && /unmapped field/.test(fs.readFileSync(box.notes, 'utf-8')), false,
    "the old 'unmapped field' message must not appear");
});

test('without a glass command anywhere, the click says so instead of failing silently', () => {
  const box = sandbox({ statusRight: '' });
  const r = click('g:ctx', box);
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(box.notes, 'utf-8'), /glass field, and glass could not be found/);
});

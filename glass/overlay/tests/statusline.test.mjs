// tests/statusline.test.mjs — the status line: renders, claude's statusLine
// settings, the tmux click binding, and configureStatus on a real tmux server
// (a private socket; skipped without tmux).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const { renderStatusline, renderReport, uiLinks, TAGS } = await import('../lib/glass/statusline.mjs');
const { clickBinding, tmuxWanted, innerEnv, configureStatus } = await import('../lib/glass/tmux.mjs');
const { claudeStatusSettings } = await import('../lib/glass/cli.mjs');

const D = {
  glass: '0.0.0', task_id: 'glass-claude-1', agent: 'claude', intercept: true, last_at: '2026-10-09T08:00:00Z',
  ctx: { used: 51_000, window: 1_000_000, pct: 5.1, model: 'claude-opus-5-5', turns: 2 },
  tokens: { calls: 2, prompt: 51_300, input: 300, output: 1_200, cache_read: 25_000, cache_write: 26_000, cache_pct: 49 },
  egress: 'proxy', egress_url: 'http://127.0.0.1:3128',
  network: { location: 'corporate', proxy_running: true, proxy_functional: true, proxy_enabled_by_user: true },
};
const strip = (s) => s.replace(/#\[[^\]]*\]/g, '').replace(/\x1b\][^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;]*m/g, '');

test('plain, tmux and ansi carry the same fields', () => {
  const plain = renderStatusline(D, { format: 'plain', port: 12445 });
  assert.match(plain, /^\[glass ●\] \[ctx .*5%\] \[↑51\.3K ↓1\.2K ⚡49%\] \[N:CN P:ON\]$/);
  const tmux = renderStatusline(D, { format: 'tmux', port: 12445 });
  for (const tag of Object.values(TAGS)) assert.ok(tmux.includes(`#[range=user|${tag}]`), tag);
  assert.equal(strip(tmux), plain);
  const ansi = renderStatusline(D, { format: 'ansi', port: 12445 });
  assert.ok(ansi.includes(`\x1b]8;;${uiLinks(12445, D.task_id).explain}\x1b\\`), 'ctx links to the explainer');
  assert.ok(ansi.includes(`\x1b]8;;${uiLinks(12445, D.task_id).session}\x1b\\`), 'tokens link to the session');
  assert.equal(strip(ansi), plain);
});

test('the gauge follows the conversation, not side calls', async () => {
  const { conversationTurn } = await import('../lib/glass/statusline.mjs');
  const main = { model: 'opus', categories: [{ key: 'tools', bytes: 177_607 }] };
  const title = { model: 'opus', categories: [{ key: 'tools', bytes: 0 }, { key: 'user', bytes: 263 }] };
  assert.equal(conversationTurn([main, title]), main);
  assert.equal(conversationTurn([title]), title, 'no tool-carrying turn: the latest');
  assert.equal(conversationTurn([]), undefined);
});

test('no turn yet, --no-intercept, daemon down', () => {
  assert.match(renderStatusline({ ...D, ctx: null, intercept: false }, { port: 1 }), /\[ctx —\].*\[N:CN P:ON ¬tap\]/);
  assert.match(renderStatusline({ ...D, network: { location: 'unknown' } }, { port: 1 }), /\[N:\?\? P:OFF\]$/, 'not probed yet: coding\'s unknown');
  const { network, ...older } = D;
  assert.match(renderStatusline(older, { port: 1 }), /\[N:proxy\]$/, 'a daemon from before the badge: its egress, not a false P:OFF');
  assert.equal(renderStatusline(null, { port: 1 }), '[glass ✗ down]');
});

test('reports: context make-up of the last turn; network', () => {
  const turns = [{ model: 'm', usage: { input: 1, output: 2, cache_read: 0, cache_write: 10 }, categories: [] },
    { model: 'm', usage: { input: 3, output: 4, cache_read: 10, cache_write: 0 },
      categories: [{ key: 'sys', label: 'System Instructions', bytes: 3000 }, { key: 'tools', label: 'Tool Descriptions', bytes: 1000 }, { key: 'kb', label: 'Retrieved Knowledge', bytes: 0 }] },
    { model: 'm', usage: { input: 50, output: 5, cache_read: 0, cache_write: 0 }, categories: [{ key: 'user', label: 'User Input', bytes: 200 }] }];
  const ctx = renderReport(TAGS.ctx, { d: D, turns, port: 12445 });
  assert.match(ctx, /System Instructions\s+2\.9 KB .* 75%/);
  assert.doesNotMatch(ctx, /Retrieved Knowledge/, 'empty categories are left out');
  assert.match(ctx, /  2  m\s+13 prompt/);
  const net = renderReport(TAGS.net, { d: D, port: 12445, caPath: '/h/ca.pem' });
  assert.match(net, /network: N:CN — corporate network \(on-site\)\nlocal proxy :3128: forwarding · px toggle on → P:ON/);
  assert.match(net, /egress \(glass daemon\): via http:\/\/127\.0\.0\.1:3128[\s\S]*CA: \/h\/ca\.pem/);
  const broken = renderReport(TAGS.net, { d: { ...D, network: { location: 'vpn', proxy_running: true, proxy_functional: false } }, port: 1 });
  assert.match(broken, /listening, not forwarding · px toggle off → P:OFF\n  ! on the corporate network without a working local proxy/);
});

test('claude without tmux: a --settings file with glass as statusLine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-sl-'));
  const f = claudeStatusSettings(path.join(dir, 'run', 's.json'), { port: 12445, taskId: 'glass-claude-1' });
  const { statusLine } = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(statusLine.type, 'command');
  assert.match(statusLine.command, /^".+" ".+glass\.mjs" statusline --format ansi --port 12445 --task glass-claude-1$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tmux: when, the inner env, the chained click binding', () => {
  const which = () => '/usr/bin/tmux';
  assert.equal(tmuxWanted({ argv: [], env: {}, platform: 'darwin', tty: true, which }), true);
  assert.equal(tmuxWanted({ argv: ['--no-tmux'], env: {}, platform: 'darwin', tty: true, which }), false);
  assert.equal(tmuxWanted({ argv: [], env: { GLASS_NO_TMUX: '1' }, platform: 'linux', tty: true, which }), false);
  assert.equal(tmuxWanted({ argv: [], env: {}, platform: 'win32', tty: true, which }), false);
  assert.equal(tmuxWanted({ argv: [], env: {}, platform: 'linux', tty: false, which }), false);
  assert.equal(tmuxWanted({ argv: [], env: {}, platform: 'linux', tty: true, which: () => null }), false);
  assert.deepEqual(innerEnv({ A: 'x y', TMUX: '/s,1,0', TMUX_PANE: '%1' }), ['-e', 'A=x y']);
  const prev = 'if-shell -F "#{==:#{mouse_status_range},window}" "switch-client -t =" "run-shell -b \\"x/bin/statusline-click\\""';
  const b = clickBinding(prev);
  assert.match(b, /^bind-key -T root MouseDown1Status if-shell -F "#\{&&:#\{@glass_task\},#\{m:g:\*,#\{mouse_status_range\}\}\}" \{ run-shell -b .* click '#\{mouse_status_range\}' .*--src glass-tmux" \} \{ if-shell .*statusline-click.* \}\n$/);
  assert.match(clickBinding(''), /\{ switch-client -t = \}\n$/, 'tmux default when nothing was bound');
});

const hasTmux = spawnSync('tmux', ['-V']).status === 0;

test('tmux: configureStatus on a real server — options set, clicks bound, user session restored', { skip: !hasTmux && 'no tmux' }, () => {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glass-tmux-')), 's');
  const t = (...a) => spawnSync('tmux', ['-S', sock, ...a], { encoding: 'utf8' });
  t('new-session', '-d', '-s', 'mine', '-x', '120', '-y', '20');
  t('set-option', '-t', 'mine', 'status-right', 'MINE');
  t('set-option', '-t', 'mine', 'status-style', 'bg=green,fg=black');
  const pid = t('display-message', '-p', '-t', 'mine', '#{pid}').stdout.trim();
  const saved = { TMUX: process.env.TMUX, TMUX_PANE: process.env.TMUX_PANE };
  process.env.TMUX = `${sock},${pid},0`;
  process.env.TMUX_PANE = t('display-message', '-p', '-t', 'mine', '#{pane_id}').stdout.trim();
  // tmux's own default differs by version (3.4: select-window, 3.6: switch-client).
  const before = t('list-keys', '-T', 'root', 'MouseDown1Status').stdout.replace(/^bind-key\s+(?:-r\s+)?-T\s+root\s+MouseDown1Status\s+/, '').trim();
  try {
    const restore = configureStatus({ taskId: 'glass-claude-x', port: 12999, env: {}, tmpDir: path.dirname(sock) });
    const opt = (o) => t('show-options', '-v', '-t', 'mine', o).stdout.trim();
    assert.equal(opt('@glass_task'), 'glass-claude-x');
    assert.equal(opt('@glass_port'), '12999');
    assert.match(opt('status-right'), /statusline --format tmux --port 12999 --task '#\{@glass_task\}'/);
    assert.equal(opt('mouse'), 'on');
    assert.equal(opt('status-style'), 'bg=default,fg=default', 'the terminal\'s colours, as in coding');
    const keys = t('list-keys', '-T', 'root', 'MouseDown1Status').stdout;
    assert.match(keys, /--src glass-tmux/);
    assert.ok(keys.includes(`{ ${before} }`), `the previous binding (${before}) is the fallback`);
    configureStatus({ taskId: 'glass-claude-y', port: 12999, env: {}, tmpDir: path.dirname(sock) })();
    assert.equal(t('list-keys', '-T', 'root', 'MouseDown1Status').stdout.match(/--src glass-tmux/g).length, 1, 'bound once');
    restore();
    assert.equal(opt('status-right'), 'MINE', 'the user\'s session gets its own options back');
    assert.equal(opt('status-style'), 'bg=green,fg=black');
    assert.equal(t('show-options', '-q', '-v', '-t', 'mine', '@glass_task').stdout.trim(), '');
  } finally {
    Object.assign(process.env, saved);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    t('kill-server');
    fs.rmSync(path.dirname(sock), { recursive: true, force: true });
  }
});

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
const { claudeStatusSettings, isTerminalReport, watchHint, clickTarget } = await import('../lib/glass/cli.mjs');

const D = {
  glass: '0.0.0', task_id: 'glass-claude-1', agent: 'claude', intercept: true, last_at: '2026-10-09T08:00:00Z',
  ctx: { used: 51_000, window: 1_000_000, pct: 5.1, model: 'claude-opus-5-5', turns: 2 },
  tokens: { calls: 2, prompt: 51_300, input: 300, output: 1_200, cache_read: 25_000, cache_write: 26_000, cache_pct: 49 },
  egress: 'proxy', egress_url: 'http://127.0.0.1:3128',
  cost: { month: '2026-10', usd: 14.56, eur: 12.34, calls: 3, unpricedCalls: 0 },
  network: { location: 'corporate', proxy_running: true, proxy_functional: true, proxy_enabled_by_user: true },
};
const strip = (s) => s.replace(/#\[[^\]]*\]/g, '').replace(/\x1b\][^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;]*m/g, '');

test('plain, tmux and ansi carry the same fields', () => {
  const plain = renderStatusline(D, { format: 'plain', port: 12445 });
  assert.match(plain, /^\[glass ●\] \[ctx .*5%\] \[↑51\.3K ↓1\.2K ⚡49%\] \[GH €12\.34\] \[N:CN P:ON\]$/);
  const tmux = renderStatusline(D, { format: 'tmux', port: 12445 });
  // g:off appears only with offload on for the agent (tested below).
  for (const tag of Object.values(TAGS).filter((t) => t !== TAGS.off)) assert.ok(tmux.includes(`#[range=user|${tag}]`), tag);
  assert.equal(strip(tmux), plain);
  const ansi = renderStatusline(D, { format: 'ansi', port: 12445 });
  assert.ok(ansi.includes(`\x1b]8;;${uiLinks(12445, D.task_id).explain}\x1b\\`), 'ctx links to the explainer');
  assert.ok(ansi.includes(`\x1b]8;;${uiLinks(12445, D.task_id).session}\x1b\\`), 'tokens link to the session');
  assert.ok(ansi.includes(`\x1b]8;;${uiLinks(12445, D.task_id).network}\x1b\\`), 'network links to the report page: no popup outside tmux');
  assert.equal(strip(ansi), plain);
});

test('offload: [D:n] [L:n] only while it is on for the agent, hidden at 0; the network report says where calls go', async () => {
  const { offloadFacts } = await import('../lib/glass/statusline.mjs');
  const on = { ...D, agent: 'opencode', offload: { name: 'Team Box', reachable: true, demoted: 2, local: 5 } };
  assert.match(renderStatusline(on, { port: 1 }), /\[↑51\.3K ↓1\.2K ⚡49%\] \[GH €12\.34\] \[D:2\] \[L:5\] \[N:CN P:ON\]$/);
  const tmux = renderStatusline(on, { format: 'tmux', port: 1 });
  assert.ok(tmux.includes(`#[range=user|${TAGS.off}]`));
  assert.deepEqual(clickTarget(TAGS.off, uiLinks(1, on.task_id)), { open: uiLinks(1, on.task_id).models });
  assert.doesNotMatch(renderStatusline({ ...on, offload: { ...on.offload, demoted: 0, local: 0 } }, { port: 1 }), /\[[DL]:/);
  assert.match(renderReport(TAGS.net, { d: on, port: 1 }), /offload: on for opencode → Team Box \(reachable\)\n {2}this session: 5 answered by Team Box \[L\] · 2 demoted/);
  assert.match(renderReport(TAGS.net, { d: D, port: 1 }), /offload: off for claude/);
  // Off, or on for other agents only: no facts at all, so the line is as before.
  const cfg = { enabled: true, agents: { opencode: true }, target: { name: 'Team Box' } };
  assert.equal(offloadFacts(null, 't', 'claude', { config: cfg }), null);
  assert.equal(offloadFacts(null, 't', 'opencode', { config: { ...cfg, enabled: false } }), null);
  assert.deepEqual(offloadFacts(null, 't', 'opencode', { config: cfg, reachable: true }), { name: 'Team Box', reachable: true, demoted: 0, local: 0 });
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
  const noTicket = renderReport(TAGS.net, {
    d: { ...D, network: { location: 'corporate', proxy_running: true, proxy_functional: true, kerberos_ticket: false },
      egress_refused: { host: 'copilot-api.example.ghe.com', status: 502, at: '2026-10-13T13:47:08.000Z' } },
    port: 1,
  });
  assert.match(noTicket, /Kerberos ticket: MISSING/);
  assert.match(noTicket, /last refused tunnel: copilot-api\.example\.ghe\.com \(HTTP 502\) at 2026-10-13T13:47:08/);
  assert.doesNotMatch(noTicket, /without a working local proxy/, 'the proxy forwards; the ticket is what is missing');
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

test('tmux clicks: ctx and network → a popup, falling back to the page the field links to', () => {
  const links = uiLinks(12445, D.task_id);
  assert.deepEqual(clickTarget(TAGS.ctx, links), { popup: 'ctx', title: 'glass · context window', fallback: links.explain });
  assert.deepEqual(clickTarget(TAGS.tok, links), { open: links.session });
  assert.deepEqual(clickTarget(TAGS.cost, links), { open: 'http://127.0.0.1:12445/#/token-usage?tab=cost' });
  assert.deepEqual(clickTarget(TAGS.health, links), { open: links.root });
  assert.deepEqual(clickTarget(TAGS.net, links), { popup: 'net', title: 'glass · network', fallback: links.network });
  assert.equal(clickTarget('nope', links), null);
});

test('no tmux bar: every agent but Claude Code is pointed at glass watch', () => {
  assert.equal(watchHint('claude', 'win32'), null);
  assert.match(watchHint('copilot', 'win32'), /glass watch.*wt split-pane/);
  assert.doesNotMatch(watchHint('opencode', 'linux'), /wt split-pane/);
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

test('report popup: terminal reports are not a key press', () => {
  assert.equal(isTerminalReport('\x1b[?997;1n'), true, 'colour-scheme report (xterm.js via tmux, on popup open)');
  assert.equal(isTerminalReport('\x1b[?997;2n\x1b[I'), true, 'report + focus in');
  assert.equal(isTerminalReport('\x1b[?1;2c'), true, 'device attributes');
  assert.equal(isTerminalReport('\x1b[<0;120;40m'), true, 'SGR mouse release');
  assert.equal(isTerminalReport(Buffer.from([0x1b, 0x5b, 0x4d, 0x20, 0x30, 0x30])), true, 'X10 mouse');
  assert.equal(isTerminalReport('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\'), true, 'OSC 11 reply');
  assert.equal(isTerminalReport('q'), false, 'a key');
  assert.equal(isTerminalReport('\r'), false, 'Enter');
  assert.equal(isTerminalReport('\x1b'), false, 'Escape');
  assert.equal(isTerminalReport('\x1b[A'), false, 'an arrow key');
  assert.equal(isTerminalReport('\x1b[?997;1nq'), false, 'a key after a report');
});

test('report popup on a real pty: held open through a colour-scheme report, closed by a key', { skip: (!hasTmux || process.platform === 'win32') && 'no tmux' }, async () => {
  // The popup is `display-popup -E … glass report … --hold`: it closes when the
  // report exits. In VS Code's terminal the first input it got was \e[?997;1n,
  // so it flashed and closed. A pane is the same pty input path, without a client.
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glass-hold-')), 's');
  const t = (...a) => spawnSync('tmux', ['-S', sock, '-f', '/dev/null', ...a], { encoding: 'utf8' });
  const bin = path.join(import.meta.dirname, '..', 'bin', 'glass.mjs');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pane = () => t('list-panes', '-t', 'h', '-F', '#{pane_dead}').stdout.trim();
  const until = async (ok, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end && !ok(); ) await sleep(50); return ok(); };
  try {
    t('new-session', '-d', '-s', 'h', '-x', '80', '-y', '20', '--', process.execPath, bin, 'report', 'net', '--port', '9', '--hold');
    t('set-option', '-t', 'h', 'remain-on-exit', 'on');
    assert.ok(await until(() => t('capture-pane', '-p', '-t', 'h').stdout.includes('[press any key]')), 'the report waits for a key');
    const hex = (s) => [...Buffer.from(s, 'latin1')].map((b) => b.toString(16).padStart(2, '0'));
    t('send-keys', '-t', 'h', '-H', ...hex('\x1b[?997;1n\x1b[I\x1b[<0;10;5m'));
    await sleep(700);
    assert.equal(pane(), '0', 'still open after the terminal reports');
    t('send-keys', '-t', 'h', 'q');
    assert.ok(await until(() => pane() === '1'), 'a key closes it');
  } finally {
    t('kill-server');
    fs.rmSync(path.dirname(sock), { recursive: true, force: true });
  }
});

test('cost field: hidden without a Copilot call this month, a floor (≥) when a model has no known rate', () => {
  const none = renderStatusline({ ...D, cost: { ...D.cost, calls: 0 } }, { format: 'plain', port: 1 });
  assert.doesNotMatch(none, /GH /);
  assert.doesNotMatch(renderStatusline({ ...D, cost: null }, { format: 'plain', port: 1 }), /GH /);
  assert.match(renderStatusline({ ...D, cost: { ...D.cost, unpricedCalls: 1 } }, { format: 'plain', port: 1 }), /\[GH ≥€12\.34\]/);
});

test("copilotMonthCost prices this month's Copilot rows at GitHub's rates × discount ÷ FX", async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { copilotMonthCost } = await import('../lib/glass/cost.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE token_usage (timestamp TEXT, provider TEXT, model TEXT, input_tokens INT,
    output_tokens INT, cache_read_tokens INT, cache_write_tokens INT)`);
  const ins = db.prepare('INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)');
  // 1M fresh input on the rate card's gpt-5-mini ($0.25) under two provider aliases …
  ins.run('2026-10-02T10:00:00Z', 'gh-copilot', 'gpt-5-mini', 500_000, 0, 0, 0);
  ins.run('2026-10-03T10:00:00Z', 'github-copilot', 'gpt-5-mini', 500_000, 0, 0, 0);
  // … last month's row, another account's row, and a model with no known GitHub rate.
  ins.run('2026-09-30T23:59:59Z', 'gh-copilot', 'gpt-5-mini', 9_000_000, 0, 0, 0);
  ins.run('2026-10-04T10:00:00Z', 'claude-code-max', 'claude-opus-5', 9_000_000, 0, 0, 0);
  ins.run('2026-10-05T10:00:00Z', 'gh-copilot', 'some-future-model', 1, 0, 0, 0);
  const c = copilotMonthCost(db, { discount: { copilot: 0.8 }, currency: { usdPerEur: 1.25 } }, new Date('2026-10-20T00:00:00Z'));
  assert.equal(c.month, '2026-10');
  assert.equal(c.calls, 3);
  assert.equal(c.unpricedCalls, 1);
  assert.ok(Math.abs(c.usd - 0.25 * 0.8) < 1e-9, `usd ${c.usd}`);
  assert.ok(Math.abs(c.eur - (0.25 * 0.8) / 1.25) < 1e-9, `eur ${c.eur}`);
});

test('copilotMonthCost: each day at the rules in force that day — a discount from mid-month, a family promotion, a dated FX', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { copilotMonthCost } = await import('../lib/glass/cost.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE token_usage (timestamp TEXT, provider TEXT, model TEXT, input_tokens INT,
    output_tokens INT, cache_read_tokens INT, cache_write_tokens INT)`);
  const ins = db.prepare('INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)');
  // $0.25 of gpt-5-mini each on the 2nd and the 20th, and $1 of measured "claude-x-1" on the 20th.
  ins.run('2026-10-02T10:00:00Z', 'gh-copilot', 'gpt-5-mini', 1_000_000, 0, 0, 0);
  ins.run('2026-10-20T10:00:00Z', 'gh-copilot', 'gpt-5-mini', 1_000_000, 0, 0, 0);
  ins.run('2026-10-20T11:00:00Z', 'gh-copilot', 'claude-x-1', 1_000_000, 0, 0, 0);
  const cfg = {
    discount: { copilot: 0.9 },
    currency: { usdPerEur: 1.25 },
    copilotPrices: { 'claude-x-1': { in: 1, out: 0, cacheRead: 0, cacheWrite: 0 } },
    periods: [
      { from: '2026-10-15', discount: 0.8 },
      { from: '2026-10-15', families: { claude: 0.5 } },
      { from: '2026-10-15', usdPerEur: 1 },
    ],
  };
  const c = copilotMonthCost(db, cfg, new Date('2026-10-21T00:00:00Z'));
  const usd = 0.25 * 0.9 + 0.25 * 0.8 + 1 * 0.5;
  const eur = (0.25 * 0.9) / 1.25 + 0.25 * 0.8 + 1 * 0.5;
  assert.ok(Math.abs(c.usd - usd) < 1e-9, `usd ${c.usd}`);
  assert.ok(Math.abs(c.eur - eur) < 1e-9, `eur ${c.eur}`);
  assert.equal(c.unpricedCalls, 0, 'the cost file\'s measured rate prices a model the card lacks');
});

test("loadCostDefaults: the build's cost file, then the user's on top; nothing when neither exists", async () => {
  const { loadCostDefaults } = await import('../lib/glass/cost.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cost-home-'));
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cost-pkg-'));
  assert.deepEqual(loadCostDefaults(home, pkg), {});
  fs.mkdirSync(path.join(pkg, 'config'));
  fs.writeFileSync(path.join(pkg, 'config', 'cost-defaults.json'), JSON.stringify({ discount: { copilot: 0.7 }, currency: { usdPerEur: 1.2 } }));
  fs.writeFileSync(path.join(home, 'cost.json'), JSON.stringify({ discount: { copilot: 0.9 } }));
  assert.deepEqual(loadCostDefaults(home, pkg), { discount: { copilot: 0.9 }, currency: { usdPerEur: 1.2 } });
  // Measured rates merge per model; dated rules add up, the user's after the build's.
  const rate = (k) => ({ in: k, out: k, cacheRead: k, cacheWrite: k });
  fs.writeFileSync(path.join(pkg, 'config', 'cost-defaults.json'), JSON.stringify({
    copilotPrices: { a: rate(1), b: rate(2) }, periods: [{ to: '2026-06', discount: 0.5 }],
  }));
  fs.writeFileSync(path.join(home, 'cost.json'), JSON.stringify({ copilotPrices: { b: rate(3) }, periods: [{ from: '2026-07', discount: 0.6 }] }));
  assert.deepEqual(loadCostDefaults(home, pkg), {
    copilotPrices: { a: rate(1), b: rate(3) },
    periods: [{ to: '2026-06', discount: 0.5 }, { from: '2026-07', discount: 0.6 }],
  });
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(pkg, { recursive: true, force: true });
});

test('account selection: saved into cost.json beside its other keys; an excluded Copilot hides the cost field', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { loadCostDefaults, saveExcludedAccounts, copilotMonthCost } = await import('../lib/glass/cost.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cost-home-'));
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cost-pkg-'));
  fs.writeFileSync(path.join(home, 'cost.json'), JSON.stringify({ discount: { copilot: 0.9 } }));
  saveExcludedAccounts(home, ['gh-copilot', 'gh-copilot']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'cost.json'), 'utf8')),
    { discount: { copilot: 0.9 }, excludeAccounts: ['gh-copilot'] });
  const cfg = loadCostDefaults(home, pkg);
  assert.deepEqual(cfg.excludeAccounts, ['gh-copilot']);
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE token_usage (timestamp TEXT, provider TEXT, model TEXT, input_tokens INT,
    output_tokens INT, cache_read_tokens INT, cache_write_tokens INT)`);
  db.prepare('INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)').run('2026-10-02T10:00:00Z', 'gh-copilot', 'gpt-5-mini', 1, 0, 0, 0);
  assert.equal(copilotMonthCost(db, cfg, new Date('2026-10-20T00:00:00Z')), null);
  // Switching every account back on removes the key rather than leaving [].
  saveExcludedAccounts(home, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'cost.json'), 'utf8')), { discount: { copilot: 0.9 } });
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(pkg, { recursive: true, force: true });
});

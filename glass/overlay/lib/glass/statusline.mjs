// lib/glass/statusline.mjs — the status line: what the daemon knows about one
// session, and how that renders.
//
//   [glass ●] [ctx ██▌░░░  34%] [↑51.3K ↓1.2K ⚡50%] [N:CN P:ON]
//
// Fields (glass decision 5, the "Status line" table in .planning/glass.md):
//   g:health  daemon up                      click → the UI
//   g:ctx     last measured turn / window    click → context report (tmux popup)
//   g:tok     session tokens, cache share    click → the session in the UI
//   g:net     network location, local proxy  click → network report (tmux popup)
//             — coding's [N:… P:…], from the same probes (network.mjs)
//
// The context gauge is the proxy's own measurement of the conversation's latest
// turn (fresh + cache read + cache write = the prompt that went out), so it reads
// the same for every agent; the window comes from coding's model table.
//
// Formats: 'tmux' (clickable #[range=user|…] fields, coding's gauge styling),
// 'ansi' (colours + OSC 8 links — Claude Code's statusLine, `glass watch`),
// 'plain'.
import clickable from '../statusline/clickable.cjs';
import gauge from '../statusline/context-gauge.cjs';

import { networkBadge } from '../network/location-probe.mjs';
import { totalsByTask } from './ui-api.mjs';

export const TAGS = Object.freeze({ health: 'g:health', ctx: 'g:ctx', tok: 'g:tok', net: 'g:net' });

/** Prompt tokens of one context turn: fresh input + cache read + cache write. */
export function promptTokens(turn) {
  const u = turn?.usage || {};
  return (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0);
}

/**
 * The turn the gauge shows: the latest one of the agent's main loop, which always
 * sends its tool definitions. Side calls — Claude Code's title / summary request
 * on the same model, opencode's title call — carry no tools and a fraction of the
 * context; taking them would drop the gauge to ~0 after every turn.
 */
export function conversationTurn(turns) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if ((turns[i].categories || []).some((c) => c.key === 'tools' && c.bytes > 0)) return turns[i];
  }
  return turns.at(-1);
}

/**
 * The status-line facts for one session (daemon side).
 *
 * @param {object} o
 * @param {object} o.session        live session ({ taskId, agent, intercept, started_at })
 * @param {object|null} o.db        token DB handle (.db of initTokenDb)
 * @param {{ readContextTurns: Function }} o.measurement
 * @param {string} o.egress         upstream proxy URL, '' when direct
 * @param {object} [o.network]      network facts (network.mjs facts())
 */
export function statuslineData({ session, db, measurement, egress, network = null, glass }) {
  const taskId = session.taskId;
  const t = totalsByTask(db, [taskId]).get(taskId);
  let turns = [];
  try { turns = measurement.readContextTurns(taskId) || []; } catch { turns = []; }
  const last = conversationTurn(turns);
  let ctx = null;
  if (last) {
    const used = promptTokens(last);
    const window = gauge.contextWindowFor(last.model);
    ctx = { used, window, pct: window ? Math.min(100, (used / window) * 100) : null, model: last.model, turns: turns.length };
  }
  const prompt = t ? t.input + t.cache_read + t.cache_write : 0;
  return {
    glass,
    task_id: taskId,
    agent: session.agent,
    intercept: session.intercept,
    started_at: session.started_at,
    last_at: turns.at(-1)?.ts || null,
    ctx,
    tokens: {
      calls: t?.calls ?? 0, prompt, input: t?.input ?? 0, output: t?.output ?? 0,
      cache_read: t?.cache_read ?? 0, cache_write: t?.cache_write ?? 0,
      cache_pct: prompt ? Math.round(((t?.cache_read ?? 0) / prompt) * 100) : null,
    },
    egress: egress ? 'proxy' : 'direct',
    egress_url: egress ? egress.replace(/\/\/[^@/]*@/, '//') : '',
    network: network && {
      location: network.location, proxy_running: network.proxy_running,
      proxy_functional: network.proxy_functional, proxy_enabled_by_user: network.proxy_enabled_by_user,
      last_probe_end: network.last_probe_end,
    },
  };
}

export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

/**
 * UI links for the ANSI form and for `glass click`. `network` is the network
 * report as a page of the daemon's: a terminal hyperlink can only open a URL,
 * so outside tmux that page stands in for the popup.
 */
export function uiLinks(port, taskId) {
  const root = `http://127.0.0.1:${port}/`;
  const q = taskId ? `?task=${encodeURIComponent(taskId)}` : '';
  return {
    root, session: `${root}#/sessions${q}`, explain: `${root}#/sessions${q}${q ? '&' : '?'}explain=1`, network: `${root}report/net${q}`,
  };
}

const ESC = '\x1b';
const osc8 = (url, text) => `${ESC}]8;;${url}${ESC}\\${text}${ESC}]8;;${ESC}\\`;
const ansi = (code, text) => `${ESC}[${code}m${text}${ESC}[0m`;
const stripTmux = (s) => s.replace(/#\[[^\]]*\]/g, '');
const GAUGE_ANSI = [[50, '38;5;46'], [65, '38;5;226'], [80, '38;5;208'], [Infinity, '1;38;5;196']];

/**
 * One rendered status line.
 *
 * @param {object|null} d   statuslineData(), or null when the daemon is down
 * @param {{ format?: 'tmux'|'ansi'|'plain', port: number }} o
 */
export function renderStatusline(d, { format = 'plain', port }) {
  const links = uiLinks(port, d?.task_id);
  const field = (tag, text, url) => {
    if (format === 'tmux') return clickable.markClickable(tag, `[${text}]`);
    if (format === 'ansi' && url) return osc8(url, `[${text}]`);
    return `[${text}]`;
  };
  const color = (tmuxFg, ansiCode, text) => {
    if (format === 'tmux') return `#[fg=${tmuxFg}]${text}#[fg=default]`;
    if (format === 'ansi') return ansi(ansiCode, text);
    return text;
  };

  if (!d) return field(TAGS.health, `glass ${color('colour196', '31', '✗')} down`, links.root);

  const parts = [field(TAGS.health, `glass ${color('colour46', '32', '●')}`, links.root)];

  let ctxText = 'ctx —';
  if (d.ctx?.pct != null) {
    const g = gauge.renderGauge(d.ctx.pct);
    if (format === 'tmux') ctxText = `ctx ${g}`;
    else {
      const bare = stripTmux(g);
      ctxText = `ctx ${format === 'ansi' ? ansi(GAUGE_ANSI.find(([max]) => d.ctx.pct < max)[1], bare) : bare}`;
    }
  }
  parts.push(field(TAGS.ctx, ctxText, links.explain));

  const t = d.tokens;
  const cache = t.cache_pct == null ? '' : ` ⚡${t.cache_pct}%`;
  parts.push(field(TAGS.tok, `↑${fmtTokens(t.prompt)} ↓${fmtTokens(t.output)}${cache}`, links.session));

  // A daemon from before the badge (left running across an update) sends no
  // network facts: show what it does know, never a made-up ?? / OFF.
  const net = d.network ? networkBadge(d.network).text : `N:${d.egress}`;
  parts.push(field(TAGS.net, `${net}${d.intercept === false ? ' ¬tap' : ''}`, links.network));
  return parts.join(' ');
}

/** The text behind a ctx / net click: what filled the window, where traffic goes. */
export function renderReport(tag, { d, turns = [], port, caPath = '' }) {
  const lines = [];
  if (!d) return 'glass daemon is not running.';
  if (tag === TAGS.net || tag === 'net') {
    lines.push(`glass ${d.glass} · daemon 127.0.0.1:${port}`);
    lines.push(`session ${d.task_id} (${d.agent})`);
    lines.push(`capture: ${d.agent === 'claude' ? 'ANTHROPIC_BASE_URL → daemon' : d.intercept ? 'HTTPS_PROXY → daemon, model hosts decrypted' : '--no-intercept: not measured by the proxy'}`);
    const n = d.network || {};
    const b = networkBadge(d.network);
    const where = { CN: 'corporate network (on-site)', VPN: 'corporate VPN', OPEN: 'open internet', '??': 'not probed yet' }[b.n] || n.location;
    lines.push(`network: N:${b.n} — ${where}`);
    lines.push(`local proxy :3128: ${!n.proxy_running ? 'not listening' : n.proxy_functional ? 'forwarding' : 'listening, not forwarding'} · px toggle ${n.proxy_enabled_by_user ? 'on' : 'off'} → P:${b.p}`);
    if (b.warn) lines.push('  ! on the corporate network without a working local proxy: external hosts are unreachable');
    lines.push(`egress (glass daemon): ${d.egress === 'proxy' ? `via ${d.egress_url}` : 'direct'}`);
    if (caPath) lines.push(`interception CA: ${caPath}`);
    lines.push(`last measured call: ${d.last_at || '—'}`);
    return lines.join('\n');
  }
  lines.push(`Context window — ${d.agent} · ${d.task_id}`);
  if (!d.ctx) {
    lines.push('', 'No measured turn yet.');
    return lines.join('\n');
  }
  lines.push(`model ${d.ctx.model} · window ${fmtTokens(d.ctx.window)} · latest turn ${fmtTokens(d.ctx.used)} (${d.ctx.pct.toFixed(1)}%)`);
  const last = conversationTurn(turns);
  const cats = (last?.categories || []).filter((c) => c.bytes > 0);
  const total = cats.reduce((a, c) => a + c.bytes, 0);
  if (cats.length) {
    lines.push('', 'What the latest turn sent (bytes on the wire):');
    for (const c of cats) {
      const pct = total ? (c.bytes / total) * 100 : 0;
      lines.push(`  ${c.label.padEnd(22)} ${fmtBytes(c.bytes).padStart(9)}  ${'█'.repeat(Math.round(pct / 4)).padEnd(25)} ${pct.toFixed(0).padStart(3)}%`);
    }
  }
  if (turns.length) {
    lines.push('', 'Turns (prompt = fresh + cache read + cache write):');
    for (const [i, tr] of turns.slice(-12).entries()) {
      const p = promptTokens(tr);
      const hit = p ? Math.round(((tr.usage?.cache_read || 0) / p) * 100) : 0;
      lines.push(`  ${String(turns.length - Math.min(12, turns.length) + i + 1).padStart(3)}  ${String(tr.model).padEnd(22)} ${fmtTokens(p).padStart(7)} prompt  ${fmtTokens(tr.usage?.output || 0).padStart(6)} out  ${String(hit).padStart(3)}% cached`);
    }
  }
  lines.push('', `Full view: ${uiLinks(port, d.task_id).explain}`);
  return lines.join('\n');
}

function fmtBytes(b) {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

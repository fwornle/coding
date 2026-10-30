/**
 * The human prompts of the last days, from the agents' own transcripts: the
 * corpus `glass job-classes measure` labels, on a machine with no session logs.
 * coding's measurement reads its session logs instead (they hold the same
 * prompts, already redacted); this reads what each agent itself keeps:
 *
 *   claude     ~/.claude/projects/<project>/<session>.jsonl  user lines typed by a
 *              person (no tool results, no meta lines, no sidechains), from an
 *              interactive session (`entrypoint: cli`; `claude -p` is scripted)
 *   copilot    ~/.copilot/session-state/<session>/events.jsonl  user.message,
 *              unless the session ran non-interactively
 *   vscode     VS Code's Copilot Chat sessions (workspaceStorage/…/chatSessions)
 *
 * Harness text (lib/job-classes/noise.mjs) and prompts too short to be a job are
 * dropped; a prompt repeated in one session counts once.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { cleanPrompt } from './measure.mjs'
import { isHarnessNoise } from './noise.mjs'
import { findVscodeChatSessions, readChatSessionState, vscodeUserDirs } from '../lsl/token/vscode-token-rows.mjs'

const idOf = (...parts) => createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 12)
const recentFiles = (dir, match, sinceMs) => {
  const out = []
  const walk = (d, depth) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory() && depth > 0 && e.name !== 'subagents') walk(p, depth - 1)
      else if (e.isFile() && match(e.name)) {
        try { if (fs.statSync(p).mtimeMs >= sinceMs) out.push(p) } catch { /* gone */ }
      }
    }
  }
  walk(dir, 2)
  return out
}
const lines = function* (file) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return }
  for (const l of text.split('\n')) {
    if (!l.trim()) continue
    try { yield JSON.parse(l) } catch { /* a partial last line */ }
  }
}

function claudePrompts(dir, sinceMs) {
  const out = []
  for (const file of recentFiles(dir, (n) => n.endsWith('.jsonl'), sinceMs)) {
    for (const r of lines(file)) {
      if (r.type !== 'user' || r.isMeta || r.isSidechain || r.entrypoint !== 'cli' || r.toolUseResult) continue
      const c = r.message?.content
      const raw = typeof c === 'string' ? c
        : Array.isArray(c) && !c.some((b) => b?.type === 'tool_result') ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : ''
      if (!raw) continue
      out.push({ agent: 'claude', session: r.sessionId || path.basename(file), ts: r.timestamp, repo: r.cwd ? path.basename(r.cwd) : '', raw })
    }
  }
  return out
}

function copilotPrompts(dir, sinceMs) {
  const out = []
  for (const file of recentFiles(dir, (n) => n === 'events.jsonl', sinceMs)) {
    const rows = []
    let scripted = false
    let cwd = ''
    for (const r of lines(file)) {
      if (r.type === 'session.start') cwd = r.data?.context?.cwd || ''
      if (r.type === 'system.message' && /non-interactive mode/.test(String(r.data?.content || ''))) scripted = true
      if (r.type === 'user.message' && typeof r.data?.content === 'string') {
        rows.push({ agent: 'copilot', session: path.basename(path.dirname(file)), ts: r.timestamp, repo: cwd ? path.basename(cwd) : '', raw: r.data.content })
      }
    }
    if (!scripted) out.push(...rows)
  }
  return out
}

function vscodePrompts(userDirs, sinceMs) {
  const out = []
  for (const f of findVscodeChatSessions(userDirs, { sinceMs })) {
    const file = typeof f === 'string' ? f : f.file
    const state = readChatSessionState(file)
    for (const q of state?.requests || []) {
      const raw = q?.message?.text
      if (typeof raw !== 'string' || !raw) continue
      out.push({ agent: 'vscode', session: path.basename(file), ts: q.timestamp ? new Date(q.timestamp).toISOString() : '', repo: '', raw })
    }
  }
  return out
}

/**
 * @param {object} [o]
 * @param {number} [o.days=28]
 * @param {number} [o.minChars=25]  shorter prompts ("yes", "merged") are turns of a job, not jobs
 * @returns {{ rows: {id: string, ts: string, agent: string, repo: string, text: string}[], counts: Record<string, number> }}
 */
export function collectPrompts({
  days = 28, minChars = 25, now = Date.now(),
  claudeDir = process.env.LSL_CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects'),
  copilotDir = process.env.LSL_COPILOT_SESSIONS_DIR || path.join(os.homedir(), '.copilot', 'session-state'),
  vscodeDirs = vscodeUserDirs(),
} = {}) {
  const sinceMs = now - days * 86_400_000
  const counts = { claude: 0, copilot: 0, vscode: 0, noise: 0, short: 0, duplicate: 0, old: 0 }
  const seen = new Set()
  const rows = []
  for (const p of [...claudePrompts(claudeDir, sinceMs), ...copilotPrompts(copilotDir, sinceMs), ...vscodePrompts(vscodeDirs, sinceMs)]) {
    if (p.ts && Date.parse(p.ts) < sinceMs) { counts.old++; continue }
    if (isHarnessNoise(p.raw)) { counts.noise++; continue }
    const text = cleanPrompt(p.raw)
    if (text.length < minChars) { counts.short++; continue }
    const key = `${p.agent}\0${p.session}\0${text}`
    if (seen.has(key)) { counts.duplicate++; continue }
    seen.add(key)
    counts[p.agent]++
    rows.push({ id: idOf(p.agent, p.session, text), ts: p.ts || '', agent: p.agent, repo: p.repo, text })
  }
  rows.sort((a, b) => (a.ts < b.ts ? 1 : -1))
  return { rows, counts }
}

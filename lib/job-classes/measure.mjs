/**
 * The measurement's shared parts: what coding's scripts/measure-job-classes.mjs
 * and glass's `glass job-classes measure` both do with a set of prompts and a
 * committed taxonomy. The corpus (coding's session logs, or the agents' own
 * transcripts in glass) and the model calls (the proxy, or the user's Copilot
 * account) are the callers'.
 */

/** A prompt as a classifier sees it: reminders out, pastes and images reduced to a marker. */
export function cleanPrompt(raw) {
  let t = String(raw || '')
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
  t = t.replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content>/g, (_, body) => ` [pasted ${body.length} chars] `)
  t = t.replace(/\[Image[^\]]*\]/g, ' [image] ')
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function cohenKappa(a, b) {
  const n = a.length
  if (!n) return NaN
  let agree = 0
  const pa = new Map(), pb = new Map()
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++
    pa.set(a[i], (pa.get(a[i]) || 0) + 1)
    pb.set(b[i], (pb.get(b[i]) || 0) + 1)
  }
  const po = agree / n
  let pe = 0
  for (const [k, v] of pa) pe += (v / n) * ((pb.get(k) || 0) / n)
  return pe === 1 ? 1 : (po - pe) / (1 - pe)
}

export function distribution(labels) {
  const m = new Map()
  for (const l of labels) m.set(l, (m.get(l) || 0) + 1)
  return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([cls, n]) => ({ cls, n, share: n / labels.length }))
}

/**
 * A reference set's lines after adding `rows` labelled twice by the teacher: one
 * per prompt, `class` set where the two passes agree. Existing lines (`existing`,
 * the file's text) are kept and a prompt labelled again replaces its line. An
 * invalid answer leaves the prompt out.
 */
export function mergeReference(existing, { set, rows, t1, t2 }) {
  const byId = new Map(String(existing || '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]))
  rows.forEach((r, i) => {
    if (t1[i] === 'invalid' || t2[i] === 'invalid') return
    byId.set(r.id, { id: r.id, ts: r.ts, agent: r.agent, repo: r.repo, set, text: r.text, teacher: [t1[i], t2[i]], class: t1[i] === t2[i] ? t1[i] : null })
  })
  const lines = [...byId.values()]
  return { text: lines.map((r) => JSON.stringify(r)).join('\n') + '\n', size: lines.length, agreed: lines.filter((r) => r.class).length }
}

/** Run `fn` over `items`, at most `n` at a time, keeping the order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}

// lib/glass/job-classes-cli.mjs — `glass job-classes`: labelling on this machine,
// from the terminal (the Classes tab has the same switches).
//
//   status            on or off, the Copilot account, the taxonomy, what was labelled
//   on | off          switch labelling (it applies to the next turn)
//   join <git-url>    use a team's taxonomy, from its learning repo's job-classes/
//   pull | leave      update the team's taxonomy | go back to the shipped default
//   measure           label your recent prompts (from the agents' own transcripts)
//                     with the teacher twice and the student once: how well the
//                     student agrees, and the reference set the coverage map reads
//
// Settings go through the daemon, which owns them; `measure` runs here, on the
// account and taxonomy the daemon reports, and writes into glass's data dir.
import fs from 'node:fs';
import path from 'node:path';

import { ensureDaemon } from './client.mjs';
import { glassHome, glassPaths, glassPort, PKG_ROOT } from './home.mjs';
import { loadRawBodyRedactionPatterns, makeRedactRawBody } from '../../proxy/proxy-bridge/raw-bodies.mjs';
import { createCopilotCompleter, STUDENT_PROCESS, TEACHER_PROCESS } from './job-classes.mjs';
import { loadTaxonomy, renderRequest, parseLabel } from '../../proxy/proxy-bridge/job-class.mjs';
import { collectPrompts } from '../job-classes/prompts.mjs';
import { cohenKappa, distribution, mergeReference, pool } from '../job-classes/measure.mjs';

const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : 'n/a');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const opt = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

async function api(port, method, route, body) {
  const r = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-glass-ui': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

function printView(out, v, counters) {
  const c = v.config;
  out(`labelling: ${c.enabled ? 'on' : 'off'}${c.enabled ? '' : ' (glass job-classes on)'}`);
  out(`  Copilot account  ${v.copilotApi || `none — gh is not logged in to a host with Copilot${v.host ? ` (${v.host})` : ''}`}`);
  out(`  student          ${c.studentModel}, every turn`);
  out(`  teacher          ${c.teacherModel}, ${pct(c.teacherSamplePct)} of turns`);
  out(`  taxonomy         ${c.team ? `team, from ${c.team.url}` : 'the shipped default'} (${v.taxonomy})`);
  if (counters) out(`  since the daemon started: ${counters.labelled} labelled, ${counters.teacherSampled} checked by the teacher${counters.failed ? `, ${counters.failed} failed` : ''}`);
}

/**
 * Label up to `max` recent prompts with the teacher twice and the student once,
 * checkpointed per pass in `dir` (a rerun resumes), and write the reference set.
 */
export async function measure({ rows: given, tax, complete, dir, redact = (t) => t, concurrency = 4, out = () => {}, onError = null }) {
  fs.mkdirSync(dir, { recursive: true });
  // Redacted before anything leaves the machine, as the live tagger does; a prompt
  // whose redaction fails is left out rather than sent.
  const rows = given.map((r) => ({ ...r, text: redact(r.text) })).filter((r) => typeof r.text === 'string' && !r.text.includes('[REDACTION_ERROR_CONTENT_BLOCKED]'));
  const passes = [['teacher1', TEACHER_PROCESS], ['teacher2', TEACHER_PROCESS], ['student', STUDENT_PROCESS]];
  const labels = {};
  for (const [name, proc] of passes) {
    const file = path.join(dir, `labels-${tax.tag}-${name}.json`);
    let ck = {};
    try { ck = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    let done = 0; let failed = null;
    const got = await pool(rows, concurrency, async (r) => {
      if (ck[r.id]) return ck[r.id];
      if (failed) return 'invalid';
      try {
        const res = await complete({ process: proc, messages: renderRequest(tax, r.text) });
        const l = parseLabel(tax, res?.content);
        ck[r.id] = l;
        if (++done % 25 === 0) out(`  ${name}: ${done} labelled`);
        return l;
      } catch (err) {
        failed = failed || err;
        return 'invalid';
      }
    });
    fs.writeFileSync(file, `${JSON.stringify(ck)}\n`);
    if (failed) { if (onError) onError(failed); throw failed; }
    labels[name] = got;
  }
  const { teacher1: t1, teacher2: t2, student: s } = labels;
  const sure = t1.map((x, i) => (x === t2[i] ? i : -1)).filter((i) => i >= 0);
  const refFile = path.join(dir, `reference-${tax.tag}.jsonl`);
  const ref = mergeReference(fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf8') : '', { set: 'glass', rows, t1, t2 });
  fs.writeFileSync(refFile, ref.text);
  const report = {
    generatedAt: new Date().toISOString(), taxonomy: tax.tag, n: rows.length,
    teacherSelfKappa: cohenKappa(t1, t2),
    studentKappa: cohenKappa(t1, s), studentAgree: s.filter((x, i) => x === t1[i]).length / s.length,
    studentAgreeSure: sure.length ? sure.filter((i) => s[i] === t1[i]).length / sure.length : NaN,
    distribution: distribution(t1), reference: { file: refFile, prompts: ref.size, agreed: ref.agreed },
  };
  fs.writeFileSync(path.join(dir, `report-${tax.tag}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function jobClassesCmd(argv, { out, err }) {
  const [sub = 'status', ...rest] = argv;
  const home = glassHome();
  const port = Number(opt(rest, '--port')) || glassPort();
  try {
    await ensureDaemon({ home, port, env: process.env });
    if (sub === 'status') {
      printView(out, await api(port, 'GET', '/api/job-classes/settings'), await api(port, 'GET', '/api/job-classes'));
      return 0;
    }
    if (sub === 'on' || sub === 'off') {
      const v = await api(port, 'PATCH', '/api/job-classes/settings', { enabled: sub === 'on' });
      printView(out, v);
      if (sub === 'on') out('Each prompt is sent, after redaction, to your Copilot account; this uses a little of its quota per turn.');
      return 0;
    }
    if (sub === 'join') {
      if (!rest[0] || rest[0].startsWith('--')) { err('usage: glass job-classes join <git URL of the team\'s learning repo>'); return 2; }
      const v = await api(port, 'PUT', '/api/job-classes/team', { url: rest[0] });
      out(`taxonomy ${v.tag} from ${rest[0]}`);
      return 0;
    }
    if (sub === 'pull') { const v = await api(port, 'POST', '/api/job-classes/team/pull', {}); out(`taxonomy ${v.tag}`); return 0; }
    if (sub === 'leave') { await api(port, 'DELETE', '/api/job-classes/team', {}); out('taxonomy: the shipped default'); return 0; }
    if (sub === 'measure') {
      const days = Number(opt(rest, '--days')) || 28;
      const max = Number(opt(rest, '--max')) || 200;
      const v = await api(port, 'GET', '/api/job-classes/settings');
      if (!v.copilotApi) { err(`no Copilot account to measure with: gh is not logged in to a host with Copilot${v.host ? ` (${v.host})` : ''}`); return 1; }
      const tax = loadTaxonomy(v.taxonomy);
      const { rows: all, counts } = collectPrompts({ days });
      const rows = all.slice(0, max);
      out(`taxonomy ${tax.tag}; ${all.length} prompts in the last ${days} days (claude ${counts.claude}, copilot ${counts.copilot}, VS Code ${counts.vscode}); labelling the newest ${rows.length}`);
      if (!rows.length) { out('nothing to measure yet'); return 0; }
      out(`${rows.length * 3} calls on ${v.copilotApi} (${v.config.teacherModel} twice, ${v.config.studentModel} once), each prompt redacted first`);
      const version = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;
      const complete = createCopilotCompleter({
        host: async () => v.host, version, models: () => ({ student: v.config.studentModel, teacher: v.config.teacherModel }),
      });
      const redact = makeRedactRawBody(loadRawBodyRedactionPatterns(PKG_ROOT, process.env.LLM_PROXY_REDACTION_CONFIG));
      const dir = path.join(glassPaths(home).data, 'job-classes', 'glass');
      const r = await measure({ rows, tax, complete, dir, redact, out });
      out('');
      out(`teacher vs itself      kappa ${f2(r.teacherSelfKappa)}`);
      out(`student vs teacher     ${pct(r.studentAgree)} agree, kappa ${f2(r.studentKappa)} (${pct(r.studentAgreeSure)} where the teacher was sure)`);
      out(`largest class          ${r.distribution[0]?.cls} ${pct(r.distribution[0]?.share)}`);
      out(`reference set          ${r.reference.prompts} prompts, ${r.reference.agreed} with an agreed class → the Classes tab's coverage map`);
      return 0;
    }
    err(`unknown: glass job-classes ${sub} (status | on | off | join <url> | pull | leave | measure [--days N] [--max N])`);
    return 2;
  } catch (e) {
    err(`glass job-classes ${sub}: ${e?.message || e}`);
    return 1;
  }
}

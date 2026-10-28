#!/usr/bin/env node
/**
 * `coding job-classes …` — a team's shared job-class taxonomy
 * (lib/job-classes/package.mjs, .planning/shared-job-classes.md P2).
 *
 *   coding job-classes [status]                       bindings on this machine (and
 *                                                      rewrites the index, like `index`)
 *   coding job-classes init --team <id> [--repo <url>] create the team's package in
 *                                                      your learning checkout, commit
 *                                                      it locally, bind the team
 *   coding job-classes join --team <id> --repo <url>   use a teammate's package
 *   coding job-classes validate [<file or package dir>]
 *   coding job-classes index                           rewrite the proxy's bindings index
 *   --json  machine-readable output
 *
 * Nothing here pushes: `coding sync --push` does, after asking.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloneInto } from '../history/repo-link.mjs';
import { commit } from '../history/sync.mjs';
import {
  CODING_ROOT, DEFAULT_TAXONOMY, PACKAGE_DIR, TAXONOMY_FILE,
  bindingsFile, initPackage, joinTeam, validateTaxonomy, writeBindingsIndex,
} from './package.mjs';

const out = (s) => process.stdout.write(`${s}\n`);

function statusLines(doc) {
  const lines = [`job classes — default taxonomy: ${doc.default}`];
  const teams = Object.entries(doc.teams);
  if (!teams.length) lines.push('  no team is bound to a job-class repo (coding job-classes init --team <id>)');
  for (const [id, t] of teams) {
    lines.push(`  ${id.padEnd(16)} ${t.usable ? t.tag : 'NOT USED'}  ${t.repo}  (${t.state})`);
    if (t.usable) lines.push(`  ${''.padEnd(16)} projects: ${(t.projects || []).join(', ') || 'none found'}`);
    for (const e of t.errors) lines.push(`  ${''.padEnd(16)} ${e}`);
  }
  for (const c of doc.conflicts) lines.push(`  CONFLICT ${c.project}: in ${c.teams.join(' and ')}, bound to different repos — not labelled`);
  lines.push(`  index: ${bindingsFile()}`);
  return lines;
}

async function main(argv) {
  const args = argv.slice(2);
  const flag = (n) => args.includes(n);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const action = args.find((a) => ['status', 'init', 'join', 'validate', 'index'].includes(a)) || 'status';
  const json = flag('--json');
  const print = (doc, lines) => out(json ? JSON.stringify(doc, null, 2) : lines.join('\n'));

  if (action === 'validate') {
    const target = args[args.indexOf('validate') + 1];
    let file = target && !target.startsWith('--') ? path.resolve(target) : path.join(CODING_ROOT, DEFAULT_TAXONOMY);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = fs.existsSync(path.join(file, TAXONOMY_FILE)) ? path.join(file, TAXONOMY_FILE) : path.join(file, PACKAGE_DIR, TAXONOMY_FILE);
    }
    const shared = path.basename(file) === TAXONOMY_FILE;
    const v = validateTaxonomy(file, { requireName: shared });
    print({ file, ...v }, [v.errors.length ? `✗ ${file}` : `✓ ${file}: ${v.tag}, ${v.classes} classes`, ...v.errors.map((e) => `  ${e}`)]);
    return v.errors.length ? 1 : 0;
  }

  const clone = (dir, url) => cloneInto(dir, url, { log: (m) => process.stderr.write(`${m}\n`), legacy: 'restructure' });

  if (action === 'init') {
    const r = initPackage({ team: val('--team'), repo: val('--repo'), cwd: process.cwd(), commit: (dir, message) => commit(dir, { message }), clone });
    print(r, [
      r.created ? `✓ created ${r.file} (${r.tag})` : `✓ ${r.file} already exists (${r.tag}) — bound the team to it`,
      ...(r.commit ? [r.commit.committed ? '  committed locally in your learning checkout' : `  not committed${r.commit.error ? `: ${r.commit.error}` : ' (nothing changed)'}`] : []),
      '',
      ...statusLines(r.index),
      '',
      'Next:',
      '  coding sync --push                               share it (asks first)',
      `  coding job-classes join --team ${r.team} --repo ${r.repo}   what each teammate runs`,
      `  node scripts/measure-job-classes.mjs --team=${r.team} --taxonomy=${r.file} --students=<model>   measure it on the team's prompts`,
    ]);
    return 0;
  }

  if (action === 'join') {
    const r = joinTeam({ team: val('--team'), repo: val('--repo'), clone });
    print(r, [`✓ team ${r.team} uses the job classes in ${r.repo}${r.cloned ? ' (cloned)' : ''}`, '', ...statusLines(r.index)]);
    return Object.values(r.index.teams).some((t) => !t.usable) ? 1 : 0;
  }

  const doc = writeBindingsIndex();
  print(doc, statusLines(doc));
  return doc.conflicts.length || Object.values(doc.teams).some((t) => !t.usable) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((code) => process.exit(code), (err) => {
    process.stderr.write(`coding job-classes: ${err.message}\n`);
    process.exit(1);
  });
}

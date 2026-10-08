// scripts/glass/import-graph.mjs
//
// The import scanner glass's extractor verifies with (and the portable-seams test
// walks with): every module specifier a JS file names, from
//   import … from '…' / import '…' / export … from '…'
//   import('…')
//   require('…')  and  createRequire(…)('…')
// with comments stripped first, so commented-out code and JSDoc
// `import('better-sqlite3')` type references are not edges.
//
// A dynamic import / require whose argument is not a single string literal is a
// COMPUTED site — reported, never followed. The extractor's manifest has to account
// for each one.
import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';

// A `/` after one of these (or at the start) begins a regex literal, not a division.
const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/**
 * Blank out comments, keeping strings, template literals, regex literals and every
 * newline (so line numbers survive). With `blankLiterals`, the insides of strings,
 * templates and regex literals are blanked too — a mask of where code is.
 * @param {string} src
 * @param {{blankLiterals?: boolean}} [opts]
 * @returns {string}
 */
export function stripComments(src, { blankLiterals = false } = {}) {
  let out = '';
  let i = 0;
  const n = src.length;
  let lastSig = ''; // last significant (non-space) character emitted as code
  let tail = '';    // recent code, for keyword checks before a `/`
  const emitCode = (s) => {
    out += s;
    tail = (tail + s).slice(-16);
    const t = s.trimEnd();
    if (t) lastSig = t[t.length - 1];
  };
  const blank = (s) => { out += s.replace(/[^\n]/g, ' '); };
  const emitLiteral = (s) => {
    if (!blankLiterals) { emitCode(s); return; }
    emitCode(s[0] + s.slice(1, -1).replace(/[^\n]/g, ' ') + s.slice(-1));
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      emitLiteral(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === '/' && (REGEX_PRECEDERS.has(lastSig) || REGEX_KEYWORDS.test(tail.trimEnd()))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      if (src[j] === '/') {
        let k = j + 1;
        while (k < n && /[a-z]/i.test(src[k])) k++;
        emitLiteral(src.slice(i, j + 1));
        emitCode(src.slice(j + 1, k));
        i = k;
        continue;
      }
    }
    emitCode(c);
    i++;
  }
  return out;
}

const STRING_LITERAL = /^(?:'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`$\\]*)`)$/;

function literalValue(expr) {
  const m = STRING_LITERAL.exec(expr.trim());
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Every module reference in a JS source.
 * @param {string} src
 * @returns {Array<{kind: 'static'|'dynamic'|'require', spec?: string, expr?: string, computed: boolean, line: number}>}
 */
export function scanSource(src) {
  const code = stripComments(src);
  // A keyword inside a string ('llm-proxy-export') is not an import.
  const mask = stripComments(src, { blankLiterals: true });
  const isCode = (index) => mask[index] === code[index];
  const refs = [];
  const staticRe = /(?<![\w$.])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?(['"])([^'"\n]+)\1/g;
  for (const m of code.matchAll(staticRe)) {
    if (!isCode(m.index)) continue;
    refs.push({ kind: 'static', spec: m[2], computed: false, line: lineAt(code, m.index) });
  }
  const callRes = [
    ['dynamic', /(?<![\w$.])import\s*\(\s*([^)]*?)\s*\)/g],
    ['require', /(?<![\w$.])require\s*\(\s*([^)]*?)\s*\)/g],
    ['require', /(?<![\w$.])createRequire\s*\([^)]*\)\s*\(\s*([^)]*?)\s*\)/g],
  ];
  for (const [kind, re] of callRes) {
    for (const m of code.matchAll(re)) {
      if (!isCode(m.index)) continue;
      const spec = literalValue(m[1]);
      const line = lineAt(code, m.index);
      refs.push(spec === null
        ? { kind, expr: m[1].trim(), computed: true, line }
        : { kind, spec, computed: false, line });
    }
  }
  return refs.sort((a, b) => a.line - b.line);
}

/**
 * Resolve a relative specifier the way Node would for ESM (exact) or CJS
 * (extension / index probing). Returns null when nothing exists.
 * @param {string} fromFile
 * @param {string} spec
 * @returns {string|null}
 */
export function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}.json`, path.join(base, 'index.js')]) {
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch { /* next */ }
  }
  return null;
}

const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';

/**
 * Walk the import closure of `roots`. Relative edges are followed; bare
 * specifiers (builtins excluded), unresolvable relative edges and computed sites
 * are collected.
 * @param {string[]} roots absolute file paths
 * @returns {{files: string[], missing: Array<{from: string, spec: string, line: number}>,
 *            bare: Array<{from: string, spec: string, line: number}>,
 *            computed: Array<{from: string, expr: string, line: number}>}}
 */
export function importClosure(roots) {
  const seen = new Set();
  const missing = [];
  const bare = [];
  const computed = [];
  const queue = [...roots];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(?:mjs|cjs|js)$/.test(file)) continue;
    for (const ref of scanSource(fs.readFileSync(file, 'utf8'))) {
      if (ref.computed) { computed.push({ from: file, expr: ref.expr, line: ref.line }); continue; }
      if (isRelative(ref.spec)) {
        const target = resolveRelative(file, ref.spec);
        if (target) queue.push(target);
        else missing.push({ from: file, spec: ref.spec, line: ref.line });
      } else if (!isBuiltin(ref.spec)) {
        bare.push({ from: file, spec: ref.spec, line: ref.line });
      }
    }
  }
  return { files: [...seen].sort(), missing, bare, computed };
}

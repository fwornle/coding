// tests/provenance.test.mjs — this repository is generated: the tree must be
// exactly what EXTRACTED.json records. A hand edit, a deleted file or an added
// one fails here; the change belongs in coding (or rapid-llm-proxy), followed by
// a new extraction (scripts/glass/extract.mjs --publish).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Not part of the generated tree: the record itself, git, and what CI / npm add.
const SKIP = new Set(['EXTRACTED.json', '.git', 'node_modules', 'package-lock.json']);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function listTree(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && SKIP.has(e.name)) continue;
    if (e.isDirectory()) out.push(...listTree(dir, r));
    else out.push(r);
  }
  return out;
}

test('the tree is exactly what EXTRACTED.json records', () => {
  const { files } = JSON.parse(fs.readFileSync(path.join(ROOT, 'EXTRACTED.json'), 'utf8'));
  const onDisk = listTree(ROOT).sort();
  const recorded = Object.keys(files).sort();
  assert.deepEqual(onDisk.filter((f) => !files[f]), [], 'files not produced by the extractor');
  assert.deepEqual(recorded.filter((f) => !onDisk.includes(f)), [], 'extracted files missing from the tree');
  const changed = recorded.filter((f) => {
    const buf = fs.readFileSync(path.join(ROOT, f));
    // A Windows checkout may have turned LF into CRLF; that is not an edit.
    return sha256(buf) !== files[f] && sha256(Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')) !== files[f];
  });
  assert.deepEqual(changed, [], 'files edited after extraction');
});

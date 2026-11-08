/**
 * The password / recovery-code KDF (lib/guard/factors.mjs): argon2id where
 * Node has it, scrypt on the Node 22 floor, the kdf recorded with each hash.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FactorStore, DEFAULT_KDF, HAS_ARGON2, hash } from '../../lib/guard/factors.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'factors-kdf-'));
const PW = 'correct horse battery staple';

test('new hashes record the kdf this Node uses, and verify', () => {
  assert.strictEqual(DEFAULT_KDF, HAS_ARGON2 ? 'argon2id' : 'scrypt');
  const f = new FactorStore(dir());
  f.setPassword(PW);
  assert.strictEqual(f.data.password.kdf, DEFAULT_KDF);
  assert.strictEqual(f.checkPassword('wrong password!!'), false);
  assert.strictEqual(f.checkPassword(PW), true);
  const [code] = f.newRecoveryCodes();
  assert.ok(f.data.recovery.every((r) => r.kdf === DEFAULT_KDF));
  assert.strictEqual(f.useRecoveryCode(code), true);
});

test('a scrypt hash verifies on any Node (written on the floor, read after an upgrade)', () => {
  const d = dir();
  const salt = Buffer.alloc(16, 7).toString('base64url');
  fs.writeFileSync(path.join(d, 'factors.json'), JSON.stringify({
    userId: 'u', credentials: [], recovery: [], lockout: { failures: 0, until: 0 },
    password: { salt, kdf: 'scrypt', hash: hash(PW, salt, 'scrypt') },
  }));
  assert.strictEqual(new FactorStore(d).checkPassword(PW), true);
});

test('a hash without a kdf tag is argon2id (written before the tag existed)', () => {
  const d = dir();
  const salt = Buffer.alloc(16, 9).toString('base64url');
  const legacy = HAS_ARGON2 ? hash(PW, salt, 'argon2id') : 'x';
  fs.writeFileSync(path.join(d, 'factors.json'), JSON.stringify({
    userId: 'u', credentials: [], recovery: [], lockout: { failures: 0, until: 0 },
    password: { salt, hash: legacy },
  }));
  const f = new FactorStore(d);
  if (HAS_ARGON2) assert.strictEqual(f.checkPassword(PW), true);
  else assert.throws(() => f.checkPassword(PW), /argon2id.*Node 24\.7/);
});

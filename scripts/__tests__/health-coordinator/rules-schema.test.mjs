import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(__dirname, '../../../config/health-verification-rules.json');

const schema = {
  type: 'object',
  required: ['version', 'description', 'verification', 'rules', 'severity_definitions', 'auto_healing', 'reporting'],
  properties: {
    version: { type: 'string' },
    rules: {
      type: 'object',
      required: ['databases', 'services', 'processes', 'files'],
      additionalProperties: { type: 'object' }
    }
  },
  additionalProperties: true
};

test('rules schema preserves SPEC R8 top-level structure', () => {
  const rules = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  const validate = new Ajv().compile(schema);
  const ok = validate(rules);
  assert.equal(ok, true, `rules.json must validate. errors=${JSON.stringify(validate.errors)}`);
});

test('D-06: bind_mount_freshness rule is deleted', () => {
  const rules = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  assert.equal(rules.rules?.services?.bind_mount_freshness, undefined,
    'D-06: bind_mount_freshness must be deleted from config/health-verification-rules.json');
});

test('D-08: supervisord_status rule is deleted', () => {
  const rules = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  assert.equal(rules.rules?.processes?.supervisord_status, undefined,
    'D-08: supervisord_status must be deleted from config/health-verification-rules.json');
});

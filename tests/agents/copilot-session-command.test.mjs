import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'plugins/copilot/plugin.json'), 'utf8'));

test('Copilot exposes /sl through the coding plugin', async () => {
  const command = manifest.commands.find(({ name }) => name === 'sl');
  assert.equal(command?.description, 'Load recent session logs for continuity');
  assert.equal(command?.handler, './commands/sl.js');

  const { sl } = await import('../../plugins/copilot/commands/sl.js');
  const result = await sl({ count: '2' });
  assert.equal(result.status, 'success');
  assert.equal(result.handled, true);
  assert.match(result.output, /# Session Logs \(\/sl\)/);
  assert.match(result.output, /User arguments: 2/);
});

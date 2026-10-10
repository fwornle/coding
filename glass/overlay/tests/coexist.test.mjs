// tests/coexist.test.mjs — glass doctor's warnings when another local proxy or a
// tmux session shares the machine (fake home directories, no real config read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { coexistWarnings, opencodeDefault, piDefault, parseLoose } = await import('../lib/glass/coexist.mjs');

const PORT = 12445;

function fakeHome(files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-coexist-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return home;
}

const RAPID_OPENCODE = {
  model: 'rapid-proxy/claude-sonnet-5',
  provider: { 'rapid-proxy': { options: { baseURL: 'http://localhost:12435/v1' } } },
};

test('a clean machine: nothing to warn about', () => {
  assert.deepEqual(coexistWarnings({ env: {}, home: fakeHome({}), port: PORT }), []);
});

test('claude: a loopback base URL that is not glass is flagged; glass itself and a remote gateway are not', () => {
  const home = fakeHome({});
  const [w] = coexistWarnings({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:12435' }, home, port: PORT });
  assert.match(w, /^claude: ANTHROPIC_BASE_URL=http:\/\/127\.0\.0\.1:12435 is another local proxy/);
  assert.deepEqual(coexistWarnings({ env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}` }, home, port: PORT }), []);
  assert.deepEqual(coexistWarnings({ env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com' }, home, port: PORT }), []);
});

test('opencode: a plain-HTTP default provider is flagged, an HTTPS or built-in one is not', () => {
  const [w] = coexistWarnings({ env: {}, home: fakeHome({ '.config/opencode/opencode.json': RAPID_OPENCODE }), port: PORT });
  assert.match(w, /^opencode: default provider rapid-proxy \(rapid-proxy\/claude-sonnet-5\) is plain HTTP at http:\/\/localhost:12435\/v1/);
  assert.match(w, /glass opencode --model <provider>\/<model>/);
  const builtin = fakeHome({ '.config/opencode/opencode.json': { model: 'github-copilot/claude-haiku-4.5' } });
  assert.deepEqual(coexistWarnings({ env: {}, home: builtin, port: PORT }), []);
});

test('opencode: OPENCODE_CONFIG_CONTENT overrides the global model, as opencode merges it', () => {
  const home = fakeHome({ '.config/opencode/opencode.json': RAPID_OPENCODE });
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'github-copilot/gpt-5' }) };
  assert.equal(opencodeDefault(env, home).provider, 'github-copilot');
  assert.deepEqual(coexistWarnings({ env, home, port: PORT }), []);
  const back = { OPENCODE_CONFIG_CONTENT: JSON.stringify(RAPID_OPENCODE) };
  assert.equal(opencodeDefault(back, fakeHome({})).baseURL, 'http://localhost:12435/v1');
});

test('opencode: JSONC config (comments, trailing commas) is read', () => {
  const jsonc = `{\n  // coding's default\n  "model": "rapid-proxy/x", /* inline */\n  "provider": { "rapid-proxy": { "options": { "baseURL": "http://localhost:12435/v1", }, }, },\n}`;
  const home = fakeHome({ '.config/opencode/opencode.jsonc': jsonc });
  assert.equal(opencodeDefault({}, home).baseURL, 'http://localhost:12435/v1');
  assert.equal(parseLoose('{"u": "http://x//y"}').u, 'http://x//y', 'a // inside a string is kept');
});

test('pi: the default provider from settings.json, its base URL from models.json', () => {
  const home = fakeHome({
    '.pi/agent/settings.json': { defaultProvider: 'rapid-proxy-pi', defaultModel: 'claude-sonnet-5' },
    '.pi/agent/models.json': { providers: { 'rapid-proxy-pi': { baseUrl: 'http://127.0.0.1:12435/v1' } } },
  });
  assert.deepEqual(piDefault({}, home), { provider: 'rapid-proxy-pi', model: 'claude-sonnet-5', baseURL: 'http://127.0.0.1:12435/v1' });
  const [w] = coexistWarnings({ env: {}, home, port: PORT });
  assert.match(w, /^pi: default provider rapid-proxy-pi \(claude-sonnet-5\) is plain HTTP/);
  const own = fakeHome({ '.pi/agent/settings.json': { defaultProvider: 'anthropic' } });
  assert.deepEqual(coexistWarnings({ env: {}, home: own, port: PORT }), []);
});

test('pi: PI_CODING_AGENT_DIR replaces ~/.pi/agent', () => {
  const home = fakeHome({ 'elsewhere/settings.json': { defaultProvider: 'p' }, 'elsewhere/models.json': { providers: { p: { baseUrl: 'http://127.0.0.1:1/v1' } } } });
  assert.equal(piDefault({ PI_CODING_AGENT_DIR: path.join(home, 'elsewhere') }, home).baseURL, 'http://127.0.0.1:1/v1');
});

test('tmux: an existing session is flagged, a session glass started is not', () => {
  const home = fakeHome({});
  assert.match(coexistWarnings({ env: { TMUX: '/tmp/tmux-1/default,1,0' }, home, port: PORT })[0], /^tmux: inside an existing tmux session/);
  assert.deepEqual(coexistWarnings({ env: { TMUX: '/tmp/x,1,0', GLASS_TMUX_OWNED: '1' }, home, port: PORT }), []);
});

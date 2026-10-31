// tests/coexist.test.mjs — glass doctor's warnings when another local proxy or a
// tmux session shares the machine (fake home directories, no real config read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { coexistWarnings, opencodeCopilotUpstream, opencodeConfig, opencodeHttpProviders, piHttpProviders, parseLoose } = await import('../lib/glass/coexist.mjs');

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

test('opencode and pi on another local proxy: no warning — glass relays them and they count once', () => {
  const home = fakeHome({
    '.config/opencode/opencode.json': RAPID_OPENCODE,
    '.pi/agent/settings.json': { defaultProvider: 'rapid-proxy-pi', defaultModel: 'claude-sonnet-5' },
    '.pi/agent/models.json': { providers: { 'rapid-proxy-pi': { baseUrl: 'http://127.0.0.1:12435/v1' } } },
  });
  assert.deepEqual(coexistWarnings({ env: {}, home, port: PORT }), []);
});

test('opencode: OPENCODE_CONFIG_CONTENT is merged over the global config, as opencode does', () => {
  const home = fakeHome({ '.config/opencode/opencode.json': RAPID_OPENCODE });
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'github-copilot/gpt-5' }) };
  assert.equal(opencodeConfig(env, home).model, 'github-copilot/gpt-5');
  assert.equal(opencodeConfig(env, home).providers['rapid-proxy'].options.baseURL, 'http://localhost:12435/v1');
});

test('opencode: every plain-HTTP provider is relayed, from every config layer; HTTPS ones are not', () => {
  const home = fakeHome({ '.config/opencode/opencode.json': {
    ...RAPID_OPENCODE,
    provider: { ...RAPID_OPENCODE.provider, qwen: { options: { baseURL: 'http://127.0.0.1:8081/v1' } }, gw: { options: { baseURL: 'https://gw.example.com/v1' } } },
  } });
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { 'github-copilot': { options: { baseURL: 'http://127.0.0.1:12435/v1/opencode' } } } }) };
  assert.deepEqual(opencodeHttpProviders(env, home), {
    'rapid-proxy': 'http://localhost:12435/v1', qwen: 'http://127.0.0.1:8081/v1', 'github-copilot': 'http://127.0.0.1:12435/v1/opencode',
  });
});

test('opencode: github-copilot is relayed to copilot-api.<tenant>, or the public API; only with a login and no baseURL of its own', () => {
  // A placeholder login: the shape opencode writes, no real credential.
  const login = (extra) => ({ 'github-copilot': { type: 'oauth', access: 'placeholder', refresh: 'placeholder', expires: 0, ...extra } });
  const auth = '.local/share/opencode/auth.json';
  assert.equal(opencodeCopilotUpstream({}, fakeHome({ [auth]: login({ enterpriseUrl: 'ghe.example.com' }) })), 'https://copilot-api.ghe.example.com');
  assert.equal(opencodeCopilotUpstream({}, fakeHome({ [auth]: login({ enterpriseUrl: 'https://GHE.example.com/' }) })), 'https://copilot-api.ghe.example.com');
  assert.equal(opencodeCopilotUpstream({}, fakeHome({ [auth]: login({}) })), 'https://api.githubcopilot.com');
  assert.equal(opencodeCopilotUpstream({}, fakeHome({})), null, 'no github-copilot login, nothing to relay');
  const dataHome = fakeHome({ 'opencode/auth.json': login({ enterpriseUrl: 'ghe.example.com' }) });
  assert.equal(opencodeCopilotUpstream({ XDG_DATA_HOME: dataHome }, fakeHome({})), 'https://copilot-api.ghe.example.com', 'XDG_DATA_HOME is honoured');
  const configured = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { 'github-copilot': { options: { baseURL: 'https://gateway.example.com/v1' } } } }) };
  assert.equal(opencodeCopilotUpstream(configured, fakeHome({ [auth]: login({}) })), null, 'a baseURL of the user\'s own is left alone');
});

test('opencode: JSONC config (comments, trailing commas) is read', () => {
  const jsonc = `{\n  // coding's default\n  "model": "rapid-proxy/x", /* inline */\n  "provider": { "rapid-proxy": { "options": { "baseURL": "http://localhost:12435/v1", }, }, },\n}`;
  const home = fakeHome({ '.config/opencode/opencode.jsonc': jsonc });
  assert.equal(opencodeHttpProviders({}, home)['rapid-proxy'], 'http://localhost:12435/v1');
  assert.equal(parseLoose('{"u": "http://x//y"}').u, 'http://x//y', 'a // inside a string is kept');
});

test('pi: every plain-HTTP provider in models.json is relayed; HTTPS ones and built-ins are not', () => {
  const home = fakeHome({ '.pi/agent/models.json': { providers: {
    'rapid-proxy-pi': { baseUrl: 'http://127.0.0.1:12435/v1' }, 'local-model': { baseUrl: 'http://127.0.0.1:8081/v1' },
    gw: { baseUrl: 'https://gw.example.com/v1' }, anthropic: { apiKey: 'x' },
  } } });
  assert.deepEqual(piHttpProviders({}, home), { 'rapid-proxy-pi': 'http://127.0.0.1:12435/v1', 'local-model': 'http://127.0.0.1:8081/v1' });
  assert.deepEqual(piHttpProviders({}, fakeHome({})), {}, 'no models.json, nothing to relay');
});

test('pi: PI_CODING_AGENT_DIR replaces ~/.pi/agent', () => {
  const home = fakeHome({ 'elsewhere/models.json': { providers: { p: { baseUrl: 'http://127.0.0.1:1/v1' } } } });
  assert.deepEqual(piHttpProviders({ PI_CODING_AGENT_DIR: path.join(home, 'elsewhere') }, home), { p: 'http://127.0.0.1:1/v1' });
});

test('tmux: an existing session is flagged, a session glass started is not', () => {
  const home = fakeHome({});
  assert.match(coexistWarnings({ env: { TMUX: '/tmp/tmux-1/default,1,0' }, home, port: PORT })[0], /^tmux: inside an existing tmux session/);
  assert.deepEqual(coexistWarnings({ env: { TMUX: '/tmp/x,1,0', GLASS_TMUX_OWNED: '1' }, home, port: PORT }), []);
});

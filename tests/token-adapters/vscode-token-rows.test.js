/**
 * VS Code Copilot Chat rows, rebuilt from the chat-session files VS Code keeps.
 *
 * The fixtures are synthetic but shaped like VS Code 1.13x's operation log
 * (kind 0 initial state, kind 1 set at path, kind 2 append with optional
 * truncate), including the three ways it names an "auto" request's model.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  buildVscodeTokenRows, chargedCreditsOf, copilotModelOf, findVscodeChatSessions, readChatSessionState,
} = await import('../../lib/lsl/token/vscode-token-rows.mjs');

const req = (id, modelId, extra = {}) => ({ requestId: id, timestamp: Date.parse('2026-10-05T11:51:00Z'), modelId, response: [], ...extra });
const result = (prompt, completion, rounds, extra = {}) => ({
  timings: { totalElapsed: 1200 },
  usage: { promptTokens: prompt, completionTokens: completion },
  metadata: { toolCallRounds: Array.from({ length: rounds }, () => ({})), ...extra.metadata },
  ...(extra.details ? { details: extra.details } : {}),
});

function writeLog(ops, name = 's.jsonl') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-token-rows-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, ops.map((o) => JSON.stringify(o)).join('\n'));
  return { dir, file };
}

describe('replaying the operation log', () => {
  test('set, append and truncate-then-append land where VS Code put them', () => {
    const { dir, file } = writeLog([
      { kind: 0, v: { requests: [], inputState: {} } },
      { kind: 2, k: ['requests'], v: [req('a', 'copilot/x')] },
      { kind: 2, k: ['requests'], v: [req('b', 'copilot/x')] },
      { kind: 2, k: ['requests'], i: 1, v: [req('c', 'copilot/x')] }, // b retracted, c in its place
      { kind: 1, k: ['requests', 1, 'result'], v: { usage: { promptTokens: 5 } } },
    ]);
    try {
      const s = readChatSessionState(file);
      expect(s.requests.map((r) => r.requestId)).toEqual(['a', 'c']);
      expect(s.requests[1].result.usage.promptTokens).toBe(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a malformed line is skipped', () => {
    const { dir, file } = writeLog([{ kind: 0, v: { requests: [] } }]);
    fs.appendFileSync(file, '\n{ not json\n' + JSON.stringify({ kind: 2, k: ['requests'], v: [req('a', 'copilot/x')] }));
    try {
      expect(readChatSessionState(file).requests).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rows', () => {
  test('fresh input is the growth over the previous request; the rest and each extra round are cache reads', () => {
    const { dir, file } = writeLog([
      { kind: 0, v: { requests: [] } },
      { kind: 2, k: ['requests'], v: [req('r1', 'copilot/claude-sonnet-4.5'), req('r2', 'copilot/claude-sonnet-4.5')] },
      { kind: 1, k: ['requests', 0, 'result'], v: result(10_000, 100, 1) },
      { kind: 1, k: ['requests', 1, 'result'], v: result(14_000, 50, 3) },
    ]);
    try {
      const [r1, r2] = buildVscodeTokenRows(file);
      expect(r1).toMatchObject({ input_tokens: 10_000, cache_read_tokens: 0, output_tokens: 100 });
      // 4,000 new; 10,000 re-sent; two more rounds re-read 14,000 each.
      expect(r2).toMatchObject({ input_tokens: 4_000, cache_read_tokens: 10_000 + 2 * 14_000, output_tokens: 50 });
      for (const r of [r1, r2]) {
        expect(r).toMatchObject({
          agent: 'vscode', provider: 'github-copilot', process: 'token-adapter-vscode', user_hash: 'vscadt',
          model: 'claude-sonnet-4.5', tokens_estimated: 1, granularity_tier: 'per-request-estimate',
        });
        expect(r.total_tokens).toBe(r.input_tokens + r.output_tokens);
      }
      expect(r2.tool_call_id).toBe('vscode:r2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a shrunk prompt (history summarised) is fresh again', () => {
    const { dir, file } = writeLog([
      { kind: 0, v: { requests: [req('r1', 'copilot/m', { result: result(50_000, 1, 1) }), req('r2', 'copilot/m', { result: result(8_000, 1, 1) })] } },
    ]);
    try {
      const [, r2] = buildVscodeTokenRows(file);
      expect(r2).toMatchObject({ input_tokens: 8_000, cache_read_tokens: 0 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('"copilot/auto" is priced as the model it resolved to', () => {
    const { dir, file } = writeLog([
      { kind: 0, v: { requests: [
        req('m', 'copilot/auto', { result: result(1, 1, 1, { metadata: { resolvedModel: 'gpt-6-luna' } }) }),
        req('r', 'copilot/auto', { result: { usage: { promptTokens: 1 }, metadata: { toolCallRounds: [{ modelId: 'gpt-6-sol' }] } } }),
        req('p', 'copilot/auto', { response: [{ resolvedModel: 'gpt-5.4-mini' }], result: result(1, 1, 1) }),
        req('u', 'copilot/auto', { result: result(1, 1, 1) }),
      ] } },
    ]);
    try {
      expect(buildVscodeTokenRows(file).map((r) => r.model)).toEqual(['gpt-6-luna', 'gpt-6-sol', 'gpt-5.4-mini', 'auto']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('only Copilot-served, finished requests count', () => {
    const { dir, file } = writeLog([
      { kind: 0, v: { requests: [
        req('own-key', 'anthropic/claude-opus-5', { result: result(9, 9, 1) }),
        req('pending', 'copilot/m'),
        req('empty', 'copilot/m', { result: { metadata: {} } }),
        req('ok', 'copilot/m', { result: result(9, 9, 1) }),
      ] } },
    ]);
    try {
      expect(buildVscodeTokenRows(file).map((r) => r.tool_call_id)).toEqual(['vscode:ok']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the older whole-state .json format is read too', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-token-rows-'));
    const file = path.join(dir, 's.json');
    fs.writeFileSync(file, JSON.stringify({ requests: [req('j', 'copilot/m', { result: result(3, 4, 1) })] }));
    try {
      expect(buildVscodeTokenRows(file)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('helpers', () => {
  expect(copilotModelOf('copilot/Claude-Sonnet-4.5')).toBe('claude-sonnet-4.5');
  expect(copilotModelOf('anthropic/x')).toBeNull();
  expect(chargedCreditsOf({ details: 'GPT-6 Luna • 0.3 credits' })).toBe(0.3);
  expect(chargedCreditsOf({ details: 'Claude Sonnet 4.5 • 1x' })).toBeNull();
});

test('finds workspace and empty-window sessions, with the workspace folder', () => {
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-user-'));
  const ws = path.join(user, 'workspaceStorage', 'abc');
  fs.mkdirSync(path.join(ws, 'chatSessions'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/some%20repo' }));
  fs.writeFileSync(path.join(ws, 'chatSessions', 'a.jsonl'), '');
  fs.mkdirSync(path.join(user, 'globalStorage', 'emptyWindowChatSessions'), { recursive: true });
  fs.writeFileSync(path.join(user, 'globalStorage', 'emptyWindowChatSessions', 'b.json'), '{}');
  try {
    const found = findVscodeChatSessions([user]).map((f) => [path.basename(f.file), f.folder]);
    expect(found).toEqual([['a.jsonl', '/tmp/some repo'], ['b.json', '']]);
  } finally {
    fs.rmSync(user, { recursive: true, force: true });
  }
});

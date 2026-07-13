// tests/experiments/injection-env.test.mjs
//
// Phase 87 Plan 02 Task 2 (AVN-04): prove the per-avenue knowledge-injection toggle is
// wired at the Claude hook seam AND is SCOPED to the process env (Pitfall 4) — i.e. it
// disables injection only for a process whose env carries CODING_KNOWLEDGE_INJECTION=0,
// while the default (unset) path still retrieves + injects (so the operator's interactive
// session, which never sets the var, is never disabled).
//
// Strategy: spawn the real hook (src/hooks/knowledge-injection-hook.js) as a child process
// exactly the way Claude Code does (JSON on stdin), pointed at a LOCAL stub retrieval server
// bound on the hook's default port (3033). The stub records whether it was hit. We assert:
//   (a) CODING_KNOWLEDGE_INJECTION=0  → server NOT hit, stdout has NO additionalContext.
//   (b) env unset                     → server hit, stdout carries the injected markdown.
// Difference between (a) and (b) is ONLY the env var → the guard is per-process, not global.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(__dirname, '..', '..', 'src', 'hooks', 'knowledge-injection-hook.js');
const STUB_PORT = 3033; // the hook's callRetrieval default port

let server;
let hitCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
    hitCount += 1;
    // Drain the request body then answer with a non-empty retrieval result.
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        markdown: '## Insights\n- STUB-INJECTED-KNOWLEDGE',
        meta: { results_count: 1 },
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(STUB_PORT, '127.0.0.1', resolve);
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Run the hook as a child process with the given extra env, feeding a substantive prompt
 * on stdin. Resolves { stdout, stderr, code }.
 */
function runHook(extraEnv) {
  return new Promise((resolve) => {
    // Merge, then DELETE any key whose override value is undefined so the "unset" case truly
    // unsets it (a plain spread of {KEY: undefined} would leave the parent's value in place).
    const env = { ...process.env, ...extraEnv };
    for (const [k, v] of Object.entries(extraEnv)) {
      if (v === undefined) delete env[k];
    }
    const child = spawn(process.execPath, [HOOK_PATH], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
    // A >= MIN_WORDS, non-slash prompt so the hook reaches the retrieval decision.
    child.stdin.end(JSON.stringify({ prompt: 'please retrieve relevant project knowledge now' }));
  });
}

test('CODING_KNOWLEDGE_INJECTION=0 → hook early-returns: NO retrieval call, empty additionalContext (AVN-04)', async () => {
  const before = hitCount;
  const { stdout, code } = await runHook({ CODING_KNOWLEDGE_INJECTION: '0' });
  assert.equal(code, 0, 'hook exits cleanly (fail-open contract preserved)');
  assert.equal(hitCount, before, 'retrieval service was NOT contacted when injection is off');
  assert.equal(stdout.trim(), '', 'no additionalContext emitted when injection is off');
  assert.ok(!stdout.includes('STUB-INJECTED-KNOWLEDGE'), 'no injected knowledge in output');
});

test('CODING_KNOWLEDGE_INJECTION unset → retrieval IS invoked and knowledge is injected (scoping proof, Pitfall 4)', async () => {
  const before = hitCount;
  // Explicitly clear the var so an ambient value from the runner env can never mask the default.
  const { stdout, code } = await runHook({ CODING_KNOWLEDGE_INJECTION: undefined });
  assert.equal(code, 0, 'hook exits cleanly');
  assert.equal(hitCount, before + 1, 'default (unset) path DOES call the retrieval service');
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /STUB-INJECTED-KNOWLEDGE/,
    'injected markdown is present on the default path');
});

test('CODING_KNOWLEDGE_INJECTION=off (word form) also disables (default-ON, only 0/false/off disable)', async () => {
  const before = hitCount;
  const { stdout, code } = await runHook({ CODING_KNOWLEDGE_INJECTION: 'off' });
  assert.equal(code, 0);
  assert.equal(hitCount, before, "'off' disables just like '0'");
  assert.equal(stdout.trim(), '', 'no output when disabled via the word form');
});

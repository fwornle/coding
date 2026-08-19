/**
 * Tool telemetry for the answer-file agents (copilot, opencode).
 *
 * These two CLIs used to report `tools_executed: null` for every cell, so `tool_audit` was
 * always 'unavailable' and their cells were unauditable — which is precisely the axis the
 * grep-vs-graph comparison measures, since that comparison is a comparison of tool COUNTS.
 *
 * The fixtures are REAL streams, trimmed to the events the parsers read and otherwise
 * verbatim (captured 2026-08-19, claude-sonnet-5, a goal that reads one file and writes
 * another). That is deliberate: the whole failure mode this guards against is a plausible
 * but invented event-name mapping, and a hand-written fixture would encode the invention
 * instead of catching it. If a CLI changes its event shape, these break.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _ADAPTERS } from '../../lib/kgbench/agents.mjs';
import { toolViolations } from '../../lib/kgbench/runner.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'kgbench');
const copilotStream = readFileSync(path.join(FIX, 'copilot-tool-stream.jsonl'), 'utf8');
const opencodeStream = readFileSync(path.join(FIX, 'opencode-tool-stream.jsonl'), 'utf8');

describe('copilot tool trace', () => {
  const trace = () => _ADAPTERS.copilot.toolTraceFrom(copilotStream);

  test('extracts every executed tool by its real name', () => {
    expect(trace().tools_executed).toEqual(['view', 'create', 'task_complete']);
  });

  test('counts calls, not start/complete event pairs', () => {
    // Three tools ran and each emits a start AND a complete; counting events would say 6.
    expect(trace().tool_calls).toBe(3);
  });

  test('flags the autopilot sentinel separately so tool COUNTS stay comparable to claude', () => {
    // claude has no task_complete. Left unflagged, every copilot cell reads as one tool
    // busier than an equivalent claude cell, which is an artefact, not a behaviour.
    expect(trace().tool_control_calls).toBe(1);
    expect(trace().tools).toContain('task_complete');
  });

  test('reports no denials when every call succeeded', () => {
    expect(trace().tools_denied).toEqual([]);
  });

  test('a failed tool is recorded as denied, not executed', () => {
    const failed = JSON.stringify({
      type: 'tool.execution_complete',
      data: { toolCallId: 'x1', success: false, result: { content: 'refused' } },
    });
    const started = JSON.stringify({
      type: 'tool.execution_start',
      data: { toolCallId: 'x1', toolName: 'bash', arguments: {} },
    });
    const t = _ADAPTERS.copilot.toolTraceFrom(`${started}\n${failed}`);
    expect(t.tools_executed).toEqual([]);
    expect(t.tools_denied).toEqual(['bash']);
    // Still a call the model was billed for.
    expect(t.tool_calls).toBe(1);
  });
});

describe('opencode tool trace', () => {
  const trace = () => _ADAPTERS.opencode.toolTraceFrom(opencodeStream);

  test('extracts every executed tool by its real name', () => {
    expect(trace().tools_executed).toEqual(['read', 'write']);
  });

  test('counts one call per tool_use — opencode emits terminal state, not a pair', () => {
    expect(trace().tool_calls).toBe(2);
  });

  test('sums tokens across steps rather than taking the last step', () => {
    const t = trace();
    // A cell is many steps; the final step alone would understate the cell's cost.
    expect(t.in_tokens).toBeGreaterThan(0);
    expect(t.total_tokens).toBe(t.in_tokens + t.out_tokens);
  });

  test('a non-completed status is attempted but NOT executed', () => {
    const ev = JSON.stringify({
      type: 'tool_use',
      part: { type: 'tool', tool: 'bash', callID: 'c1', state: { status: 'error', output: 'boom' } },
    });
    const t = _ADAPTERS.opencode.toolTraceFrom(ev);
    expect(t.tools_executed).toEqual([]);
    expect(t.tools_denied).toEqual(['bash']);
  });
});

describe('"not measured" stays distinguishable from "ran zero tools"', () => {
  test.each(['copilot', 'opencode'])('%s returns null for an empty stream', (agent) => {
    expect(_ADAPTERS[agent].toolTraceFrom('')).toBeNull();
  });

  test.each(['copilot', 'opencode'])('%s returns null for non-JSON output', (agent) => {
    expect(_ADAPTERS[agent].toolTraceFrom('> build · claude-sonnet-5\nsome prose')).toBeNull();
  });

  test('pi has no parser, so its cells keep reporting tool_audit unavailable', () => {
    // Claiming an audit that cannot be performed is worse than claiming none.
    expect(_ADAPTERS.pi.toolTraceFrom).toBeUndefined();
  });
});

describe('audit state depends on tool VOCABULARY, not merely on having a trace', () => {
  test('claude names are the arm vocabulary, so conformance is decidable', () => {
    expect(_ADAPTERS.claude.toolVocabulary).toBe('arm');
  });

  test.each(['copilot', 'opencode', 'pi'])('%s reports native names', (agent) => {
    expect(_ADAPTERS[agent].toolVocabulary).toBe('native');
  });

  // THE REGRESSION THIS FILE EXISTS FOR. Feeding native tool names to toolViolations marks
  // every copilot and opencode cell `tool_escape`, because not one of view/create/read/write
  // appears in any arm's allowedTools. That reads as a finding — "non-claude agents escape
  // their arm constantly" — and is an artefact of naming alone.
  test('native names would ALL be false violations against a claude-vocabulary arm', () => {
    const grepArm = { id: 'grep', allowedTools: ['Glob', 'Grep', 'Read'], mcpConfig: { mcpServers: {} } };
    const cop = _ADAPTERS.copilot.toolTraceFrom(copilotStream).tools_executed;
    const oc = _ADAPTERS.opencode.toolTraceFrom(opencodeStream).tools_executed;
    expect(toolViolations(grepArm, cop)).toEqual(['view', 'create', 'task_complete']);
    expect(toolViolations(grepArm, oc)).toEqual(['read', 'write']);
    // ...which is why the runner routes these to 'observed' instead of running that check.
  });

  test('claude tool names still audit correctly — the check is not weakened', () => {
    const grepArm = { id: 'grep', allowedTools: ['Glob', 'Grep', 'Read'], mcpConfig: { mcpServers: {} } };
    expect(toolViolations(grepArm, ['Grep', 'Read'])).toEqual([]);
    expect(toolViolations(grepArm, ['Grep', 'Bash'])).toEqual(['Bash']);
  });
});

describe('copilot argv carries the flag that makes the trace exist at all', () => {
  test('--output-format json is passed', () => {
    const argv = _ADAPTERS.copilot.argv({ prompt: 'q', model: 'm', answerFile: '.a.md' });
    const i = argv.indexOf('--output-format');
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe('json');
  });

  test('the answer-file directive is still appended — elicitation is unchanged', () => {
    const argv = _ADAPTERS.copilot.argv({ prompt: 'q', model: 'm', answerFile: '.a.md' });
    expect(argv[argv.indexOf('-p') + 1]).toContain('.a.md');
  });
});

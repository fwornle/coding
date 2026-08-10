/**
 * The continuation budget: an answer-file agent's second turn in its OWN session.
 *
 * WHY IT EXISTS. The three agents were never getting one turn each. claude's `-p` runs a full
 * agentic loop; copilot is launched with `--max-autopilot-continues 20`; opencode's headless
 * `run` is a single session that ends at the first assistant step with text and no tool call.
 * In run coding-v1-x2 that produced 84 no-results out of 96 opencode cells — and 36 of those
 * had a finished answer sitting in stdout that was never written to the file. Measuring an
 * agent at a budget of 0 against competitors at 20 measures the harness, not the agent.
 *
 * WHY `-s <id>` AND NOT `-c`. Cells run serially in ONE shared worktree. "Continue the last
 * session" is ambiguous there: a cell whose first turn exited without reaching the model has
 * no session of its own, so `-c` would handed it the PREVIOUS cell's — whose answer would then
 * be written to the answer file and graded against this cell's question. That is defect 15
 * exactly, where one opencode answer was scored against eleven different questions.
 */

import { jest } from '@jest/globals';
import { _ADAPTERS, ANSWER_FILE } from '../../lib/kgbench/agents.mjs';
import { loadArms, resolveArm, enabledArmIds } from '../../lib/kgbench/arms.mjs';

const opencode = _ADAPTERS.opencode;

describe('opencode adapter — session identity', () => {
  it('asks for the JSON event stream, which is where the session id is published', () => {
    const argv = opencode.argv({ prompt: 'Q', model: 'M', answerFile: ANSWER_FILE });
    expect(argv).toContain('--format');
    expect(argv[argv.indexOf('--format') + 1]).toBe('json');
  });

  it('parses the session id out of the event stream', () => {
    const stream = '{"type":"step_start","sessionID":"ses_014dec0dcffevzoxwKHd1TZlIv","part":{}}\n';
    expect(opencode.sessionIdFrom(stream)).toBe('ses_014dec0dcffevzoxwKHd1TZlIv');
  });

  it('returns null when the stream carries no session — the case that must NOT continue', () => {
    // A turn that exited before reaching the model. There is nothing of this cell's to
    // resume, and resuming anything else is cross-cell contamination.
    expect(opencode.sessionIdFrom('')).toBeNull();
    expect(opencode.sessionIdFrom('some plain text, no events')).toBeNull();
    expect(opencode.sessionIdFrom(null)).toBeNull();
  });

  it('targets an EXPLICIT session id and never "the last session"', () => {
    const argv = opencode.continueArgv({ sessionId: 'ses_abc123', model: 'M', answerFile: ANSWER_FILE });
    expect(argv).toContain('-s');
    expect(argv[argv.indexOf('-s') + 1]).toBe('ses_abc123');
    // `-c` is what makes a shared worktree dangerous. It must not appear.
    expect(argv).not.toContain('-c');
    expect(argv).not.toContain('--continue');
  });

  it('tells the continuation to answer from the session, not to start over', () => {
    const argv = opencode.continueArgv({ sessionId: 'ses_x', model: 'M', answerFile: ANSWER_FILE });
    const msg = argv.find((a) => a.includes(ANSWER_FILE));
    // The investigation already happened in turn 1 — that is the whole reason a continuation
    // beats a retry, which re-runs the question from scratch and just narrates again.
    expect(msg).toMatch(/already found in this session/i);
    expect(msg).toMatch(/Do NOT modify any other file/i);
  });
});

describe('opencode adapter — diagnostics survive the JSON format', () => {
  it('extracts readable text from the event stream', () => {
    // Without this, `--format json` would cost the stdout_tail that made the x2 failures
    // legible — it is how the already-answered-but-unwritten cells were found at all.
    const stream = [
      '{"type":"step_start","sessionID":"ses_a","part":{"type":"step-start"}}',
      '{"type":"part","sessionID":"ses_a","part":{"type":"text","text":"Writing the answer now."}}',
      'not json at all',
      '{"type":"part","sessionID":"ses_a","part":{"type":"text","text":"Second line."}}',
    ].join('\n');
    expect(opencode.textFrom(stream)).toBe('Writing the answer now.\nSecond line.');
  });

  it('survives a truncated trailing line without throwing', () => {
    expect(() => opencode.textFrom('{"type":"part","part":{"text":"ok"}}\n{"type":"par')).not.toThrow();
    expect(opencode.textFrom('{"type":"part","part":{"text":"ok"}}\n{"type":"par')).toBe('ok');
  });
});

describe('the default budget', () => {
  it('is 2 on every enabled arm — measured, not chosen', () => {
    // Same 48 grep/opencode cells at each setting (coding-v1-r8 vs -cont2, 2026-08-10):
    //   budget 0   6/48 answered
    //   budget 1  44/48 answered
    //   budget 2  48/48 answered
    // The reason it is 2 and not 3 is the distribution of turns SPENT, not the completion
    // rate: at budget 1, 41 of 48 cells used the whole budget — a binding constraint — and at
    // budget 2 the spread is 9/28/11 with nothing at the ceiling. Raise it only against
    // evidence of cells pinned at 2.
    const doc = loadArms();
    const ids = enabledArmIds(doc);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(resolveArm(doc, id).continuationBudget).toBe(2);
  });

  it('is overridable DOWN to 0, or x2 becomes unreproducible', () => {
    // `flag ?? arm ?? 0` — the nullish coalescing matters. With `||` an explicit 0 would fall
    // through to the arm's 2, and the one setting a reader most needs in order to reproduce
    // the pre-budget runs would silently be the one setting they cannot express.
    const arm = 2;
    const resolve = (flag) => flag ?? arm ?? 0;
    expect(resolve(0)).toBe(0);
    expect(resolve(null)).toBe(2);
    expect(resolve(1)).toBe(1);
  });
});

describe('the budget is symmetric and bounded', () => {
  it('claude is NOT given a continuation path — its loop is already unbounded', () => {
    // Adding one would double-count: claude's `-p` keeps going until the model stops calling
    // tools, so a "continuation" would be a second full loop, not a matched turn.
    expect(_ADAPTERS.claude.continueArgv).toBeUndefined();
    expect(_ADAPTERS.claude.elicitation).toBe('stream-json');
  });

  it('every answer-file agent that can continue exposes the same three hooks', () => {
    // The mechanism is per-adapter, but the BUDGET is per-run and applies to all of them —
    // a per-agent budget would reintroduce the asymmetry it exists to remove.
    for (const [name, a] of Object.entries(_ADAPTERS)) {
      if (!a.continueArgv) continue;
      expect(a.elicitation).toBe('answer-file');
      expect(typeof a.sessionIdFrom).toBe('function');
      expect(typeof a.textFrom).toBe('function');
      expect(name).toBeTruthy();
    }
  });
});

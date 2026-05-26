/**
 * lib/lsl/window.mjs — getLSLWindow tests
 *
 * Phase 50 Plan 01 Task 1: the N-prompt LSL window walker.
 *
 * CONTEXT.md "Window specification" — interaction-time, not wall-clock.
 * The primary stop condition is N user prompts; wall-clock is a safety net.
 *
 * Tests cover the 7 behaviors enumerated in 50-01-PLAN.md Task 1:
 *  1. N user→assistant exchanges, oldest-first ordering
 *  2. Stop condition #1 (user-prompt count dominates)
 *  3. Stop condition #2 (wall-clock ceiling)
 *  4. Stop condition #3 (byte ceiling — tool-output blocks trimmed first)
 *  5. Autonomous-task scenario (3 prompts across 6h wall-clock)
 *  6. Project scoping — unknown project returns empty (no throw)
 *  7. Missing-source — created_at older than all LSL files returns empty
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let getLSLWindow;
let tmpDir;

beforeAll(async () => {
  ({ getLSLWindow } = await import('../../lib/lsl/window.mjs'));
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsl-window-'));
});

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Render an LSL file with N prompt-set exchanges.
 * `prompts` is an array of { tsMs, userText, assistantText } objects.
 */
function writeLSLFile(yyyy, mm, basename, prompts) {
  const dir = path.join(tmpDir, yyyy, mm);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, basename);

  const earliestIso = new Date(prompts[0].tsMs).toISOString();
  const latestIso = new Date(prompts[prompts.length - 1].tsMs).toISOString();

  let body = '';
  body += `# Claude Code Session Log\n\n`;
  body += `**Session:** ${basename.replace(/\.md$/, '')}\n`;
  body += `**Type:** Local Project\n`;
  body += `**Time Range:** ${earliestIso} - ${latestIso}\n`;
  body += `**Prompt Sets:** ${prompts.length}\n\n---\n\n`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    body += `<a name="ps_${p.tsMs}"></a>\n`;
    body += `## Prompt Set ${i + 1} (ps_${p.tsMs})\n\n`;
    body += `**Time:** ${new Date(p.tsMs).toISOString()}\n`;
    body += `**Duration:** 1000ms\n`;
    body += `**Tool Calls:** 0\n\n`;
    body += `### User\n\n${p.userText}\n\n`;
    body += `### Assistant\n\n${p.assistantText}\n\n`;
  }

  fs.writeFileSync(filePath, body, 'utf-8');
  return filePath;
}

describe('getLSLWindow', () => {
  test('Test 1: returns N user→assistant exchanges, oldest-first ordering', () => {
    const baseTs = Date.parse('2026-05-23T07:00:00Z');
    const prompts = [];
    for (let i = 0; i < 5; i++) {
      prompts.push({
        tsMs: baseTs + i * 60_000, // 1 minute apart
        userText: `user msg ${i + 1}`,
        assistantText: `assistant reply ${i + 1}`,
      });
    }
    writeLSLFile('2026', '05', '2026-05-23_0700-0800_test1.md', prompts);

    // observation.created_at is after the last prompt
    const obs = { created_at: new Date(baseTs + 6 * 60_000).toISOString() };
    const result = getLSLWindow(obs, { maxPrompts: 3, project: tmpDir });

    expect(result.exchanges).toHaveLength(3);
    // oldest-first: the 3 most recent prompts but in chronological order
    expect(result.exchanges[0].content).toContain('user msg 3');
    expect(result.exchanges[1].content).toContain('user msg 4');
    expect(result.exchanges[2].content).toContain('user msg 5');
    expect(result.sourceFile).toBe('2026-05-23_0700-0800_test1.md');
    expect(result.byteCount).toBeGreaterThan(0);
    expect(typeof result.windowSpanMs).toBe('number');
  });

  test('Test 2: stop condition #1 — user-prompt count dominates', () => {
    const baseTs = Date.parse('2026-05-23T07:00:00Z');
    const prompts = [];
    for (let i = 0; i < 10; i++) {
      prompts.push({
        tsMs: baseTs + i * 60_000, // 1 minute spacing → 10 prompts in 10 min
        userText: `q${i + 1}`,
        assistantText: `a${i + 1}`,
      });
    }
    writeLSLFile('2026', '05', '2026-05-23_0700-0800_test2.md', prompts);

    const obs = { created_at: new Date(baseTs + 11 * 60_000).toISOString() };
    const result = getLSLWindow(obs, { maxPrompts: 3, project: tmpDir });

    expect(result.exchanges).toHaveLength(3);
    expect(result.windowSpanMs).toBeLessThan(3_600_000);
    // byteCount is the sum of content sizes
    const manualSum = result.exchanges.reduce((acc, e) => acc + Buffer.byteLength(e.content, 'utf-8'), 0);
    expect(result.byteCount).toBe(manualSum);
  });

  test('Test 3: stop condition #2 — wall-clock ceiling', () => {
    const baseTs = Date.parse('2026-05-23T07:00:00Z');
    // 2 prompts within 500ms
    const prompts = [
      { tsMs: baseTs, userText: 'q1', assistantText: 'a1' },
      { tsMs: baseTs + 500, userText: 'q2', assistantText: 'a2' },
      // 1 prompt much older — should be excluded by wall-clock ceiling
      { tsMs: baseTs - 10_000, userText: 'q-old', assistantText: 'a-old' },
    ];
    // Note: writer expects prompts in chronological order
    const orderedPrompts = [...prompts].sort((a, b) => a.tsMs - b.tsMs);
    writeLSLFile('2026', '05', '2026-05-23_0700-0800_test3.md', orderedPrompts);

    const obs = { created_at: new Date(baseTs + 600).toISOString() };
    const result = getLSLWindow(obs, {
      maxPrompts: 5,
      maxWallClockMs: 1000,
      project: tmpDir,
    });

    expect(result.exchanges).toHaveLength(2);
    expect(result.windowSpanMs).toBeLessThan(1000);
  });

  test('Test 4: stop condition #3 — byte ceiling trims tool-output blocks first', () => {
    const baseTs = Date.parse('2026-05-23T07:00:00Z');
    // One exchange with a huge tool-output block that exceeds the byte ceiling
    const bigToolOutput = 'X'.repeat(5_000);
    const exchangeWithTool = `Normal user content asking about the feature.

\`\`\`tool_result
${bigToolOutput}
\`\`\`

Trailing narrative.`;
    const prompts = [
      { tsMs: baseTs - 1000, userText: 'earlier short prompt', assistantText: 'short reply' },
      { tsMs: baseTs, userText: exchangeWithTool, assistantText: 'reply with another\n```tool_use\n' + 'Y'.repeat(2000) + '\n```\n' },
    ];
    writeLSLFile('2026', '05', '2026-05-23_0700-0800_test4.md', prompts);

    const obs = { created_at: new Date(baseTs + 1000).toISOString() };
    const result = getLSLWindow(obs, {
      maxPrompts: 3,
      maxBytes: 1024,
      project: tmpDir,
    });

    expect(result.byteCount).toBeLessThanOrEqual(1024);
    // The earlier short prompt must still be present
    const allContent = result.exchanges.map(e => e.content).join('\n');
    expect(allContent).toContain('earlier short prompt');
    // The tool-output payload must have been trimmed (no run of 100+ X chars)
    expect(allContent).not.toMatch(/X{100,}/);
  });

  test('Test 5: autonomous-task scenario — 3 prompts spanning 6h wall-clock', () => {
    const baseTs = Date.parse('2026-05-23T01:00:00Z');
    const prompts = [
      { tsMs: baseTs, userText: 'kick off the wave', assistantText: 'starting agents...' },
      // 3h of agent-only tool output happens here (no user prompts captured between these)
      { tsMs: baseTs + 3 * 3600_000, userText: 'mid-run check-in', assistantText: 'still working...' },
      { tsMs: baseTs + 6 * 3600_000, userText: 'do the same again', assistantText: 'will do' },
    ];
    writeLSLFile('2026', '05', '2026-05-23_0100-0700_test5.md', prompts);

    const obs = { created_at: new Date(baseTs + 6 * 3600_000 + 60_000).toISOString() };
    const result = getLSLWindow(obs, {
      maxPrompts: 3,
      maxWallClockMs: 24 * 3600_000,
      project: tmpDir,
    });

    expect(result.exchanges).toHaveLength(3);
    expect(result.windowSpanMs).toBeGreaterThan(5 * 3600_000);
    expect(result.exchanges[0].content).toContain('kick off the wave');
    expect(result.exchanges[2].content).toContain('do the same again');
  });

  test('Test 6: project scoping — unknown project returns empty (no throw)', () => {
    // tmpDir has no files
    const obs = { created_at: '2026-05-23T07:00:00Z' };
    const result = getLSLWindow(obs, { maxPrompts: 3, project: tmpDir });
    expect(result).toEqual({ exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 });
  });

  test('Test 7: missing-source — created_at older than all LSL files returns empty', () => {
    const baseTs = Date.parse('2026-05-23T07:00:00Z');
    writeLSLFile('2026', '05', '2026-05-23_0700-0800_test7.md', [
      { tsMs: baseTs, userText: 'q', assistantText: 'a' },
    ]);
    const obs = { created_at: '2025-01-01T00:00:00Z' };
    const result = getLSLWindow(obs, { maxPrompts: 3, project: tmpDir });
    expect(result).toEqual({ exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 });
  });

  test('Test 8: parses Format-B labels (**User Message:** / **Assistant Response:**)', () => {
    // Live 2026 LSL files use inline label format, not `### User` headers.
    // The walker must handle both. Hand-craft a file in the dominant format.
    const baseTs = Date.parse('2026-05-23T07:00:00Z');
    const dir = path.join(tmpDir, '2026', '05');
    fs.mkdirSync(dir, { recursive: true });
    const body = [
      '# WORK SESSION (0700-0800)',
      '',
      '**Generated:** 2026-05-23T07:00:00Z',
      '',
      '---',
      '',
      `<a name="ps_${baseTs}"></a>`,
      `## Prompt Set 1 (ps_${baseTs})`,
      '',
      '**User Message:** implement the dedup fix now',
      '',
      '**Assistant Response:** starting work...',
      '',
      `<a name="ps_${baseTs + 60_000}"></a>`,
      `## Prompt Set 2 (ps_${baseTs + 60_000})`,
      '',
      '**User Request:** add tests too',
      '',
      '**Assistant Response:** added.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, '2026-05-23_0700-0800_format-b.md'), body, 'utf-8');

    const obs = { created_at: new Date(baseTs + 5 * 60_000).toISOString() };
    const result = getLSLWindow(obs, { maxPrompts: 3, project: tmpDir });
    expect(result.exchanges).toHaveLength(2);
    expect(result.exchanges[0].content).toContain('implement the dedup fix now');
    expect(result.exchanges[1].content).toContain('add tests too');
  });
});

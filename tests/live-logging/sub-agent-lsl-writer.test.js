/**
 * tests/live-logging/sub-agent-lsl-writer.test.js
 *
 * Phase 51 Plan 06 Task 2 (TDD RED then GREEN).
 *
 * Locks the D-LSL-Filename writer contract:
 *   {YYYY-MM-DD}_{HHHH-HHHH}_S{parent-slot}-{sub-index}-{sub-hash}[-part{N}].md
 *
 * 12 tests:
 *   1.  computeLSLFilename produces the locked example verbatim.
 *   2.  computeLSLFilename appends -part{N} when partNumber given.
 *   3.  computeLSLFilename rejects subHash !== 7 chars.
 *   4.  writeSubAgentLSL writes to .specstory/history/{YYYY}/{MM}/.
 *   5.  Body uses Format B labels + ps_<ms> anchors (Phase 50 parser compat).
 *   6.  Frontmatter carries the locked field set + sub_session_id.
 *   7.  Per-agent sub_hash rule applied (claude/copilot/opencode/mastra).
 *   8.  Backward-compat: parent LSL file byte-identical after sub-agent write.
 *   9.  Idempotency: rerun returns {skipped:true} and writes 0 bytes.
 *   10. --force overrides idempotency and overwrites.
 *   11. Chunking: > 100KB body produces -part{N} files.
 *   12. Dry-run: returns filePath + 0 bytes; nothing written to disk.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  writeSubAgentLSL,
  computeLSLFilename,
} from '../../lib/lsl/sub-agent-lsl-writer.mjs';

function mkTmpDir(prefix = 'sub-agent-writer-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

let tmpDir;
let outputRoot;

beforeEach(() => {
  tmpDir = mkTmpDir();
  outputRoot = path.join(tmpDir, 'history');
  fs.mkdirSync(outputRoot, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeBaseRow(overrides = {}) {
  return {
    agent: 'claude',
    sub_hash: 'a24960e',
    parent_session_id: '5d22e2d5-0fe0-472a-be31-698c48882d0c',
    sub_index: 3,
    transcript_path: '/tmp/agent-a24960e65f317241e.jsonl',
    project: 'coding',
    status: 'discovered',
    detected_via: 'sweep',
    discovered_at: '2026-05-23T13:40:00.000Z',
    agent_metadata: {
      agent_id: 'a24960e65f317241e',
      lsl_incomplete: false,
      lsl_incomplete_reason: null,
    },
    ...overrides,
  };
}

function makeExchanges(count = 2) {
  const base = Date.UTC(2026, 4, 23, 13, 40, 0); // 2026-05-23T13:40:00Z
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      role: 'user',
      content: `user message ${i + 1}`,
      timestamp: new Date(base + i * 60000).toISOString(),
    });
    out.push({
      role: 'assistant',
      content: `assistant response ${i + 1}`,
      timestamp: new Date(base + i * 60000 + 15000).toISOString(),
    });
  }
  return out;
}

describe('computeLSLFilename', () => {
  test('Test 1: produces verbatim D-LSL-Filename example', () => {
    const fn = computeLSLFilename({
      date: '2026-05-23',
      hhhh_hhhh: '1400-1500',
      parentSlot: 1,
      subIndex: 3,
      subHash: 'a7e8c41',
      partNumber: null,
    });
    expect(fn).toBe('2026-05-23_1400-1500_S1-3-a7e8c41.md');
  });

  test('Test 2: appends -part{N} when partNumber is given', () => {
    const fn = computeLSLFilename({
      date: '2026-05-23',
      hhhh_hhhh: '1400-1500',
      parentSlot: 1,
      subIndex: 3,
      subHash: 'a7e8c41',
      partNumber: 2,
    });
    expect(fn).toBe('2026-05-23_1400-1500_S1-3-a7e8c41-part2.md');
  });

  test('Test 3: rejects subHash !== 7 chars', () => {
    expect(() => computeLSLFilename({
      date: '2026-05-23',
      hhhh_hhhh: '1400-1500',
      parentSlot: 1,
      subIndex: 3,
      subHash: 'too-short',
      partNumber: null,
    })).toThrow(/sub.?hash.*7/i);
    expect(() => computeLSLFilename({
      date: '2026-05-23',
      hhhh_hhhh: '1400-1500',
      parentSlot: 1,
      subIndex: 3,
      subHash: 'abcdefgh', // 8 chars
      partNumber: null,
    })).toThrow(/sub.?hash.*7/i);
  });
});

describe('writeSubAgentLSL', () => {
  test('Test 4: writes file under {outputRoot}/{YYYY}/{MM}/', async () => {
    const slotState = {};
    const result = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: makeExchanges(2),
      outputRoot,
      slotAllocator: { state: slotState },
    });
    expect(result.skipped).toBe(false);
    expect(result.bytesWritten).toBeGreaterThan(0);
    const monthDir = path.join(outputRoot, '2026', '05');
    expect(fs.existsSync(monthDir)).toBe(true);
    const files = fs.readdirSync(monthDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    const match = files.find((f) => /_S\d+-\d+-[a-z0-9]{7}\.md$/i.test(f));
    expect(match).toBeTruthy();
  });

  test('Test 5: body uses Format B labels + ps_<ms> anchors', async () => {
    const slotState = {};
    const result = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: makeExchanges(2),
      outputRoot,
      slotAllocator: { state: slotState },
    });
    const content = fs.readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('**User Message:**');
    expect(content).toContain('**Assistant Response:**');
    expect(content).toMatch(/<a name="ps_\d+"><\/a>/);
  });

  test('Test 6: frontmatter contains the locked field set', async () => {
    const slotState = {};
    const result = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: makeExchanges(1),
      outputRoot,
      slotAllocator: { state: slotState },
    });
    const content = fs.readFileSync(result.filePath, 'utf-8');
    // Frontmatter is fenced by --- markers.
    expect(content.startsWith('---\n')).toBe(true);
    const endFence = content.indexOf('\n---', 4);
    expect(endFence).toBeGreaterThan(0);
    const fm = content.slice(4, endFence);
    expect(fm).toMatch(/agent:\s*claude/);
    expect(fm).toMatch(/parent_session_id:\s*5d22e2d5-0fe0-472a-be31-698c48882d0c/);
    expect(fm).toMatch(/sub_index:\s*3/);
    expect(fm).toMatch(/sub_hash:\s*a24960e/);
    expect(fm).toMatch(/project:\s*coding/);
    expect(fm).toMatch(/sub_session_id:\s*a24960e65f317241e/);
    expect(fm).toMatch(/lsl_incomplete:\s*false/);
    expect(fm).toMatch(/captured_via:\s*sub-agent-backfill/);
    expect(fm).toMatch(/captured_at:\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('Test 7: per-agent sub_hash rule applied across all four agents', async () => {
    const cases = [
      {
        row: makeBaseRow({
          agent: 'claude',
          sub_hash: 'a24960e',
          agent_metadata: { agent_id: 'a24960e65f317241e' },
        }),
        expectedSubHash: 'a24960e',
        expectedSubSession: 'a24960e65f317241e',
      },
      {
        row: makeBaseRow({
          agent: 'copilot',
          sub_hash: '01ABCDE',
          agent_metadata: { toolCallId: 'toolu_vrtx_01ABCDEF' },
        }),
        expectedSubHash: '01ABCDE',
        expectedSubSession: 'toolu_vrtx_01ABCDEF',
      },
      {
        row: makeBaseRow({
          agent: 'opencode',
          sub_hash: 'ses_309',
          agent_metadata: { session_id: 'ses_309f0c4f' },
        }),
        expectedSubHash: 'ses_309',
        expectedSubSession: 'ses_309f0c4f',
      },
      {
        row: makeBaseRow({
          agent: 'mastra',
          sub_hash: 'sub_abc',
          agent_metadata: { subAgentSessionId: 'sub_abcd123' },
        }),
        expectedSubHash: 'sub_abc',
        expectedSubSession: 'sub_abcd123',
      },
    ];
    for (const tc of cases) {
      const subOutputRoot = path.join(tmpDir, `out-${tc.row.agent}`);
      fs.mkdirSync(subOutputRoot, { recursive: true });
      const slotState = {};
      const result = await writeSubAgentLSL({
        row: tc.row,
        exchanges: makeExchanges(1),
        outputRoot: subOutputRoot,
        slotAllocator: { state: slotState },
      });
      const content = fs.readFileSync(result.filePath, 'utf-8');
      expect(content).toContain(`sub_hash: ${tc.expectedSubHash}`);
      expect(content).toContain(`sub_session_id: ${tc.expectedSubSession}`);
      expect(content).toContain(`agent: ${tc.row.agent}`);
    }
  });

  test('Test 8: backward-compat — existing parent LSL files untouched', async () => {
    const monthDir = path.join(outputRoot, '2026', '05');
    fs.mkdirSync(monthDir, { recursive: true });
    // Create a synthetic parent LSL file at the canonical filename shape
    // (no S{n}- segment).
    const parentLslPath = path.join(monthDir, '2026-05-23_1400-1500_userhash.md');
    const parentContent = '# Parent LSL\n\nNothing to see here.\n';
    fs.writeFileSync(parentLslPath, parentContent, 'utf-8');
    const beforeStat = fs.statSync(parentLslPath);
    const beforeHash = sha256(parentLslPath);
    // Wait a tick so any accidental mtime touch would be visible.
    await new Promise((r) => setTimeout(r, 10));

    const slotState = {};
    await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: makeExchanges(2),
      outputRoot,
      slotAllocator: { state: slotState },
    });

    const afterStat = fs.statSync(parentLslPath);
    const afterHash = sha256(parentLslPath);
    expect(afterHash).toBe(beforeHash);
    expect(afterStat.size).toBe(beforeStat.size);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  test('Test 9: idempotency — re-run returns {skipped:true} and writes 0 bytes', async () => {
    const slotState = {};
    const first = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: makeExchanges(1),
      outputRoot,
      slotAllocator: { state: slotState },
    });
    expect(first.skipped).toBe(false);
    const second = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: makeExchanges(1),
      outputRoot,
      slotAllocator: { state: slotState },
    });
    expect(second.skipped).toBe(true);
    expect(second.bytesWritten).toBe(0);
    expect(second.filePath).toBe(first.filePath);
  });

  test('Test 10: --force overrides idempotency and overwrites the file', async () => {
    const slotState = {};
    const first = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: makeExchanges(1),
      outputRoot,
      slotAllocator: { state: slotState },
    });
    const originalHash = sha256(first.filePath);
    // Modify exchanges so the force overwrite differs.
    const newExchanges = [
      { role: 'user', content: 'replacement user', timestamp: '2026-05-23T13:40:00.000Z' },
      { role: 'assistant', content: 'replacement assistant', timestamp: '2026-05-23T13:40:15.000Z' },
    ];
    const forced = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: newExchanges,
      outputRoot,
      slotAllocator: { state: slotState },
      force: true,
    });
    expect(forced.skipped).toBe(false);
    expect(forced.bytesWritten).toBeGreaterThan(0);
    const newHash = sha256(forced.filePath);
    expect(newHash).not.toBe(originalHash);
    const newContent = fs.readFileSync(forced.filePath, 'utf-8');
    expect(newContent).toContain('replacement user');
    expect(newContent).toContain('replacement assistant');
  });

  test('Test 11: chunking — > 100KB body produces -part{N} files', async () => {
    // Build a heavy exchange list. Each assistant message ~12KB → 12 pairs ≈ 144KB.
    const base = Date.UTC(2026, 4, 23, 13, 40, 0);
    const filler = 'A'.repeat(12 * 1024);
    const heavyExchanges = [];
    for (let i = 0; i < 12; i++) {
      heavyExchanges.push({
        role: 'user',
        content: `prompt ${i + 1}`,
        timestamp: new Date(base + i * 60000).toISOString(),
      });
      heavyExchanges.push({
        role: 'assistant',
        content: filler,
        timestamp: new Date(base + i * 60000 + 15000).toISOString(),
      });
    }
    const slotState = {};
    const result = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: heavyExchanges,
      outputRoot,
      slotAllocator: { state: slotState },
    });
    expect(result.chunked).toBeGreaterThanOrEqual(2);
    const monthDir = path.join(outputRoot, '2026', '05');
    const partFiles = fs.readdirSync(monthDir).filter((f) => /-part\d+\.md$/.test(f));
    expect(partFiles.length).toBe(result.chunked);
    // First part filename ends with -part1.md.
    expect(partFiles.some((f) => f.endsWith('-part1.md'))).toBe(true);
  });

  test('Test 12: dry-run — returns filePath but writes nothing to disk', async () => {
    const slotState = {};
    const result = await writeSubAgentLSL({
      row: makeBaseRow(),
      exchanges: makeExchanges(2),
      outputRoot,
      slotAllocator: { state: slotState },
      dryRun: true,
    });
    expect(result.skipped).toBe(false);
    expect(result.bytesWritten).toBe(0);
    expect(result.chunked).toBe(0);
    expect(result.filePath).toMatch(/\.md$/);
    expect(fs.existsSync(result.filePath)).toBe(false);
  });
});

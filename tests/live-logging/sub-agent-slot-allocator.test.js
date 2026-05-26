/**
 * tests/live-logging/sub-agent-slot-allocator.test.js
 *
 * Phase 51 Plan 06 Task 1 (TDD RED then GREEN).
 *
 * Locks the slot-allocator contract used by the D-LSL-Filename writer.
 * Per-day, per-parent-session 1-indexed slot assignment with persistent
 * JSON state and atomic `.tmp + rename` writes (Plan 50-03 precedent).
 *
 * Verifies:
 *   1. First-allocation for a (day, parent) returns 1.
 *   2. Second distinct parent on the same day returns 2.
 *   3. Same (day, parent) re-allocation returns the same slot (idempotent).
 *   4. Slot numbering is per-day — same parent on a new day starts at 1.
 *   5. loadSlotState on a missing path returns {}.
 *   6. loadSlotState on an existing path returns the parsed JSON.
 *   7. saveSlotState is atomic — a mid-write crash (renameSync throws) leaves the original intact.
 *   8. saveSlotState JSON is 2-space indented.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  allocateSlot,
  loadSlotState,
  saveSlotState,
} from '../../lib/lsl/sub-agent-slot-allocator.mjs';

function mkTmpDir(prefix = 'slot-state-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

let tmpDir;

beforeEach(() => {
  tmpDir = mkTmpDir();
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('allocateSlot', () => {
  test('Test 1: first-allocation for a (day, parent) returns 1 and mutates state', () => {
    const state = {};
    const slot = allocateSlot(state, 'parent-uuid-1', '2026-05-23');
    expect(slot).toBe(1);
    expect(state).toEqual({ '2026-05-23': { 'parent-uuid-1': 1 } });
  });

  test('Test 2: a second distinct parent on the same day returns 2', () => {
    const state = {};
    allocateSlot(state, 'parent-uuid-1', '2026-05-23');
    const slot2 = allocateSlot(state, 'parent-uuid-2', '2026-05-23');
    expect(slot2).toBe(2);
    expect(state['2026-05-23']['parent-uuid-2']).toBe(2);
    expect(state['2026-05-23']['parent-uuid-1']).toBe(1);
  });

  test('Test 3: same (day, parent) returns the same slot (idempotent)', () => {
    const state = {};
    const slot1 = allocateSlot(state, 'parent-uuid-1', '2026-05-23');
    allocateSlot(state, 'parent-uuid-2', '2026-05-23');
    const slot1b = allocateSlot(state, 'parent-uuid-1', '2026-05-23');
    expect(slot1b).toBe(slot1);
    expect(slot1b).toBe(1);
  });

  test('Test 4: slots are per-day — same parent on a new day starts at 1', () => {
    const state = {};
    allocateSlot(state, 'parent-uuid-1', '2026-05-23');
    const slot = allocateSlot(state, 'parent-uuid-1', '2026-05-24');
    expect(slot).toBe(1);
    expect(state['2026-05-24']['parent-uuid-1']).toBe(1);
    // Prior day untouched.
    expect(state['2026-05-23']['parent-uuid-1']).toBe(1);
  });
});

describe('loadSlotState', () => {
  test('Test 5: loadSlotState on missing path returns {}', () => {
    const missing = path.join(tmpDir, 'does-not-exist.json');
    const state = loadSlotState({ statePath: missing });
    expect(state).toEqual({});
  });

  test('Test 6: loadSlotState on existing path returns parsed JSON', () => {
    const filePath = path.join(tmpDir, 'state.json');
    const expected = { '2026-05-23': { 'parent-A': 1, 'parent-B': 2 } };
    fs.writeFileSync(filePath, JSON.stringify(expected), 'utf-8');
    const state = loadSlotState({ statePath: filePath });
    expect(state).toEqual(expected);
  });
});

describe('saveSlotState', () => {
  test('Test 7: atomic write — renameSync crash leaves original file intact', () => {
    const statePath = path.join(tmpDir, 'state.json');
    const original = { '2026-05-23': { 'parent-A': 1 } };
    fs.writeFileSync(statePath, JSON.stringify(original), 'utf-8');

    // Spy on renameSync to throw, simulating a mid-write crash.
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated crash');
    });

    expect(() => {
      saveSlotState({ statePath, state: { '2026-05-23': { 'parent-A': 99 } } });
    }).toThrow(/simulated crash/);

    // Verify original file still readable + intact.
    const onDisk = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(onDisk).toEqual(original);

    renameSpy.mockRestore();
  });

  test('Test 8: saveSlotState writes JSON with 2-space indentation', () => {
    const statePath = path.join(tmpDir, 'state.json');
    const state = { '2026-05-23': { 'parent-A': 1, 'parent-B': 2 } };
    saveSlotState({ statePath, state });
    const text = fs.readFileSync(statePath, 'utf-8');
    // 2-space indent: "  \"2026-05-23\"" should appear at start of line 2.
    expect(text).toContain('\n  "2026-05-23"');
    // Round-trip equivalence.
    expect(JSON.parse(text)).toEqual(state);
  });
});

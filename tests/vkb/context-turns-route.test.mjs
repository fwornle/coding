// tests/vkb/context-turns-route.test.mjs
//
// Behavior (RESEARCH Test Map): the read API serves the context-turns line(s)
// verbatim (gunzip), returns graceful-empty on ENOENT, and rejects path
// traversal via the `_validTaskId` guard (path stays under .data/measurements/).
//
// Wave 0 stub — implemented in 84-07. Harness-wiring smoke only.
import { test } from 'node:test';
import { loadFixture } from '../context-turns/_helpers.mjs';

const anthropicBody = loadFixture('anthropic-messages-body.json');

test(
  'read API: verbatim gunzip, ENOENT→graceful-empty, traversal rejected',
  { skip: 'Wave 0 stub — implemented in 84-07' },
  () => {
    // 84-07: GET /api/context-turns?task_id=… → assert gunzipped lines match
    // what was written; unknown task_id → empty (not 500); '../' task_id →
    // rejected by _validTaskId.
    void anthropicBody;
  },
);

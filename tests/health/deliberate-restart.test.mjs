/**
 * lib/health/deliberate-restart.mjs — a service the coordinator restarts on
 * purpose is a transition, not an outage. 2026-10-03: leaving VPN restarted the
 * LLM proxy onto the new egress, and the statusline's [🏥] was red until it was back.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { restartingServices, RESTART_GRACE_MS } from '../../lib/health/deliberate-restart.mjs';

const at = 1_791_015_193_034; // the restart_llm_cli_proxy dispatch, 08:13:13Z
const state = { proxy: { last_kickstart_dispatch_at: at } };

describe('restartingServices', () => {
  it('names the LLM proxy for the grace period after its restart', () => {
    assert.deepEqual([...restartingServices(state, at + 12_000)], ['llm_cli_proxy']);
  });

  it('a restart that has not brought it back is an outage again', () => {
    assert.equal(restartingServices(state, at + RESTART_GRACE_MS).size, 0);
  });

  it('nothing without a recorded restart', () => {
    assert.equal(restartingServices({}, at).size, 0);
    assert.equal(restartingServices({ proxy: { last_kickstart_dispatch_at: null } }, at).size, 0);
  });
});

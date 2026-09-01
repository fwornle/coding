/**
 * Grouping recorded calls into the turns that produced them.
 *
 * The By-turn view exists because a single pi turn produced two token_usage
 * rows on two different providers and nothing joined them. The grouping itself
 * is trivial; the two rules that are NOT trivial, and that this suite exists to
 * pin, are:
 *
 *   1. Rows with no recorded turn must NEVER be grouped. Every row written
 *      before the proxy grew the columns carries conversation_key '' and
 *      turn_index 0. Keying on those directly collapses 337,936 unrelated calls
 *      into one enormous fake turn — which renders as a confident, authoritative
 *      and completely fabricated claim.
 *
 *   2. band_source and the classifier note are DIFFERENT records and neither
 *      subsumes the other. 'caller' vs 'defaults.fg-chat' is the difference
 *      between "pi asked for medium" and "pi said nothing usable and this is the
 *      fallback", which band_source alone carries; what the classifier actually
 *      did is only ever in the trail.
 *
 * Everything here is pure — no proxy, no fetch, never skips.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoutingModules } from '../helpers/dashboard-ts.mjs';

// Top-level await rather than a `before` hook — see the note in
// dashboard-ts.mjs: a root-level async `before` does not gate `describe` in
// this node version, and the file would go green while running nothing.
const { groupIntoTurns, hasTurnIdentity, describeBandSource } = await loadRoutingModules({
  names: ['offload-gates', 'recent-call', 'turn-grouping'],
  entry: 'turn-grouping',
  prefix: 'turn-grouping-',
});

/** A row shaped like /api/token-usage/recent returns them. */
const row = (over = {}) => ({
  timestamp: '2026-09-01T13:10:25.175Z',
  process: 'pi',
  agent: 'pi',
  provider: 'gh-copilot',
  model: 'claude-sonnet-4.6',
  total_tokens: 100,
  route_key: 'fg-chat/pi',
  route_band: 'medium',
  route_step: 1,
  offloaded_from: '',
  chain_position: 0,
  attempt_trail: '',
  routing_source: 'live',
  prompt_preview: 'what is this repo about?',
  conversation_key: 'ab12cd34ef56',
  turn_index: 1,
  band_source: 'caller',
  ...over,
});

/** The real pi turn, verbatim from token_usage ids 367/368. */
const PI_TURN = [
  // newest first, as the endpoint returns them
  row({
    timestamp: '2026-09-01T13:10:31.313Z',
    provider: 'gh-copilot', model: 'claude-sonnet-4.6', route_band: 'medium',
    band_source: 'caller', total_tokens: 6293,
    attempt_trail: JSON.stringify({
      offloadSkipped: 'band "medium" is not in offload_bands [small]',
      classifier: 'conversation already contains tool results',
    }),
  }),
  row({
    timestamp: '2026-09-01T13:10:25.175Z',
    provider: 'qwen-local', model: 'qwen3.8-27b-dual', route_band: 'small',
    band_source: 'classifier', offloaded_from: 'gh-copilot', total_tokens: 4358,
    attempt_trail: JSON.stringify({ classifier: 'classified medium -> small' }),
  }),
];

describe('unrecorded rows are never grouped into a turn', () => {
  test('legacy rows land in one bucket that is explicitly NOT a turn', () => {
    const legacy = [
      row({ conversation_key: '', turn_index: 0, provider: 'gh-copilot' }),
      row({ conversation_key: '', turn_index: 0, provider: 'claude-code-max' }),
    ];
    const turns = groupIntoTurns(legacy);
    assert.equal(turns.length, 1);
    // The flag is the whole point: the caller renders this as "no turn
    // recorded" instead of claiming these two calls were one turn.
    assert.equal(turns[0].recorded, false);
    assert.equal(turns[0].calls.length, 2);
  });

  test('a half-recorded row is treated as unrecorded, not as turn zero', () => {
    // A key with no index cannot be placed within its conversation, and an
    // index with no key cannot be placed at all. Either alone is not identity.
    assert.equal(hasTurnIdentity(row({ conversation_key: 'abc', turn_index: 0 })), false);
    assert.equal(hasTurnIdentity(row({ conversation_key: '', turn_index: 3 })), false);
    assert.equal(hasTurnIdentity(row()), true);
  });

  test('the unrecorded bucket sorts last, after every real turn', () => {
    const turns = groupIntoTurns([
      row({ conversation_key: '', turn_index: 0, timestamp: '2026-09-01T23:00:00.000Z' }),
      ...PI_TURN,
    ]);
    // Even though the legacy row is the NEWEST, it must not head the list: the
    // bucket spans the whole window and has no start time of its own.
    assert.equal(turns[turns.length - 1].recorded, false);
    assert.equal(turns[0].recorded, true);
  });
});

describe('the pi turn groups as one turn across two providers', () => {
  test('both calls land in a single turn', () => {
    const turns = groupIntoTurns(PI_TURN);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].calls.length, 2);
    assert.equal(turns[0].recorded, true);
    assert.equal(turns[0].routeKey, 'fg-chat/pi');
  });

  test('calls read forwards even though the endpoint returns them backwards', () => {
    // Call 1 chose the tools, call 2 answered. Reading that backwards is the
    // opposite of the story the view exists to tell.
    const [turn] = groupIntoTurns(PI_TURN);
    assert.equal(turn.calls[0].provider, 'qwen-local');
    assert.equal(turn.calls[1].provider, 'gh-copilot');
    assert.equal(turn.startedAt, '2026-09-01T13:10:25.175Z');
  });

  test('the header summarises where the turn actually ran', () => {
    const [turn] = groupIntoTurns(PI_TURN);
    assert.equal(turn.totalTokens, 4358 + 6293);
    assert.equal(turn.offloaded, true);
    assert.deepEqual(turn.servedBy, [
      { provider: 'qwen-local', calls: 1 },
      { provider: 'gh-copilot', calls: 1 },
    ]);
    assert.equal(turn.prompt, 'what is this repo about?');
  });

  test('a turn is as interesting as its worst call', () => {
    const [turn] = groupIntoTurns(PI_TURN);
    // One offloaded call, one ordinary — the turn reads as offloaded, never
    // averaged down to "routed".
    assert.equal(turn.outcome, 'offloaded');
  });

  test('a later turn of the same conversation is a separate turn', () => {
    const turn2 = row({
      timestamp: '2026-09-01T13:20:00.000Z', turn_index: 2, total_tokens: 500,
    });
    const turns = groupIntoTurns([turn2, ...PI_TURN]);
    assert.equal(turns.length, 2);
    // Newest turn first.
    assert.equal(turns[0].turnIndex, 2);
    assert.equal(turns[1].turnIndex, 1);
  });

  test('the same turn index in a different conversation does not merge', () => {
    const other = row({ conversation_key: 'ffffffffffff', turn_index: 1 });
    assert.equal(groupIntoTurns([other, ...PI_TURN]).length, 2);
  });
});

describe('describeBandSource names who decided the band', () => {
  test('a classifier downgrade reports what it did, not just that it acted', () => {
    const [turn] = groupIntoTurns(PI_TURN);
    assert.equal(describeBandSource(turn.calls[0]), 'classified medium -> small');
  });

  test('a caller-declared band also reports why the classifier stood aside', () => {
    // Both halves matter: "pi asked for medium" AND "the classifier was not
    // allowed to look at this one" — that second clause is the actual reason
    // this call could never have been offloaded.
    const [turn] = groupIntoTurns(PI_TURN);
    assert.equal(
      describeBandSource(turn.calls[1]),
      'caller · conversation already contains tool results');
  });

  test('a defaults fallback is distinguished from a caller declaration', () => {
    // The proxy spells this out at length; the cell keeps the head only.
    const r = row({
      band_source: 'defaults.fg-chat (route asked for from-caller, caller supplied nothing)',
      attempt_trail: '',
    });
    assert.equal(describeBandSource(r), 'defaults.fg-chat');
  });

  test('a route with its own fixed band says so', () => {
    assert.equal(
      describeBandSource(row({ band_source: 'route bg-observation-writer', attempt_trail: '' })),
      'route bg-observation-writer');
  });

  test('a row predating both records says nothing rather than guessing', () => {
    // '' lets the caller omit the line entirely. Printing "unknown" would look
    // like a recorded verdict of unknown, which is a different claim.
    assert.equal(describeBandSource(row({ band_source: '', attempt_trail: '' })), '');
  });

  test('a malformed trail degrades to the band_source alone', () => {
    assert.equal(describeBandSource(row({ band_source: 'caller', attempt_trail: '{oops' })), 'caller');
  });
});

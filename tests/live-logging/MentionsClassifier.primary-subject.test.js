/**
 * MentionsClassifier — the primary-subject answer.
 *
 * Until 2026-09-21 the classifier was asked only WHICH entities an insight
 * mentions, and placement in the hierarchy was then inferred from that list by
 * a rarity prior: of the ~10 SubComponents an insight names, take the one
 * mentioned fewest times corpus-wide. That prior fixed the DISTRIBUTION (267
 * parents instead of 93, no 231-child hub) but it never read the insight — the
 * rarest name an insight touches can still be an incidental one.
 *
 * The classifier already reads the text. These tests pin the contract that
 * lets it answer directly, and — just as importantly — pin what happens when
 * it does not: the mentions must survive, because the caller fail-fasts on a
 * classifier error and would otherwise refuse to write the Insight at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMentionsResult,
  buildMentionsPrompt,
} from '../../src/live-logging/MentionsClassifier.js';

const CANDIDATES = [
  { id: 'id-etm', name: 'EtmDaemon', description: 'exchange transcript monitor', entityType: 'SubComponent' },
  { id: 'id-lls', name: 'LiveLoggingSystem', description: 'session logging', entityType: 'Component' },
  { id: 'id-kg', name: 'KnowledgeGraph', description: 'graph store', entityType: 'SubComponent' },
];

test('object form yields both the mentions and the primary', () => {
  const raw = '{"mentions": ["EtmDaemon", "LiveLoggingSystem"], "primary": "EtmDaemon"}';
  const { ids, primaryId } = extractMentionsResult(raw, CANDIDATES);
  assert.deepEqual(ids.sort(), ['id-etm', 'id-lls'].sort());
  assert.equal(primaryId, 'id-etm');
});

test('markdown fences around the object are tolerated', () => {
  const raw = '```json\n{"mentions": ["KnowledgeGraph"], "primary": "KnowledgeGraph"}\n```';
  const { ids, primaryId } = extractMentionsResult(raw, CANDIDATES);
  assert.deepEqual(ids, ['id-kg']);
  assert.equal(primaryId, 'id-kg');
});

test('explicit null primary is honoured, mentions still land', () => {
  const raw = '{"mentions": ["EtmDaemon", "KnowledgeGraph"], "primary": null}';
  const { ids, primaryId } = extractMentionsResult(raw, CANDIDATES);
  assert.equal(ids.length, 2);
  assert.equal(primaryId, null);
});

test('the historical bare array keeps its mentions and loses only the primary', () => {
  // A model under load drops back to this shape. Treating it as a parse
  // failure would discard a usable classification and, through the caller's
  // fail-fast, refuse to write the Insight.
  const raw = '["EtmDaemon", "LiveLoggingSystem"]';
  const { ids, primaryId } = extractMentionsResult(raw, CANDIDATES);
  assert.deepEqual(ids.sort(), ['id-etm', 'id-lls'].sort());
  assert.equal(primaryId, null);
});

test('a hallucinated primary is refused', () => {
  const raw = '{"mentions": ["EtmDaemon"], "primary": "TotallyMadeUpService"}';
  const { primaryId } = extractMentionsResult(raw, CANDIDATES);
  assert.equal(primaryId, null);
});

test('a primary outside the mentions is accepted — it is the OWNER, not a mention', () => {
  // Requiring primary ∈ mentions was measured against the live corpus and
  // rejected nothing (0 of 20), while ruling out the common legitimate shape:
  // an insight that names only Details but is owned by the SubComponent above
  // them. Closed-set membership remains the hallucination guard.
  const raw = '{"mentions": ["EtmDaemon"], "primary": "KnowledgeGraph"}';
  const { ids, primaryId } = extractMentionsResult(raw, CANDIDATES);
  assert.deepEqual(ids, ['id-etm']);
  assert.equal(primaryId, 'id-kg');
});

test('malformed JSON still salvages mentions via the token scan', () => {
  const raw = '{"mentions": ["EtmDaemon", "KnowledgeGraph"], "primary": ';  // truncated
  const { ids } = extractMentionsResult(raw, CANDIDATES);
  assert.ok(ids.includes('id-etm'));
  assert.ok(ids.includes('id-kg'));
});

test('the prompt actually asks for a single primary subject', () => {
  const body = buildMentionsPrompt('an insight about the ETM', CANDIDATES);
  const system = body.messages.find((m) => m.role === 'system').content;
  assert.match(system, /should OWN this Insight/);
  assert.match(system, /"primary"/);
  assert.match(system, /\[Component\] or \[SubComponent\]/);
  assert.match(system, /never own an Insight/);
  // The catalogue must actually carry the class the instruction refers to.
  assert.match(system, /- EtmDaemon \[SubComponent\]:/);
  // The closed-set guard must survive the rewrite.
  assert.match(system, /VERBATIM/);
});

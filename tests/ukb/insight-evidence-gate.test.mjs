/**
 * Contract for the two gates that stop the UKB writing a confident document
 * about an entity its evidence does not describe.
 *
 * THE FAILURE THEY PREVENT. File retrieval (wave-controller getComponentFiles)
 * selects candidates by FILENAME substring against the entity name plus its
 * PARENT's keywords. An entity whose name appears in no path therefore receives
 * its parent's general neighbourhood instead of its own implementation, and
 * retrieval cannot fail — it always returns something, and something was
 * treated as evidence.
 *
 * On 2026-09-20 that produced CodingLowerOntologySource.md: 5469 characters of
 * architecture reasoned from copilot.sh, opencode.sh, pi.sh and
 * batch-provenance.mjs, none of which reference the component. The analyser had
 * ALREADY noticed — the entity description on disk says "none of the provided
 * code files actually implement or reference" it — but the signal existed only
 * as prose inside an observation, so wave 4 consumed it as knowledge.
 *
 * Gate 1 makes that signal structured (`evidenceGap`) and refuses to document.
 * Gate 2 gives the model a sanctioned way to decline instead of flagging the
 * gap in a paragraph and then filling every section with inference anyway.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SA = path.join(REPO, 'integrations/semantic-analysis/src');

const analyser = readFileSync(path.join(SA, 'agents/semantic-analysis-agent.ts'), 'utf8');
const controller = readFileSync(path.join(SA, 'agents/wave-controller.ts'), 'utf8');
const insightGen = readFileSync(path.join(SA, 'agents/insight-generation-agent.ts'), 'utf8');
const types = readFileSync(path.join(SA, 'types/wave-types.ts'), 'utf8');
const wave3 = readFileSync(path.join(SA, 'agents/wave3-detail-agent.ts'), 'utf8');
const wave2 = readFileSync(path.join(SA, 'agents/wave2-component-agent.ts'), 'utf8');

describe('gate 1 — the evidence gap is structured, not prose', () => {
  test('the analysis prompt asks for an evidenceGap boolean', () => {
    assert.match(analyser, /"evidenceGap"/);
    assert.match(analyser, /"evidenceGapReason"/);
  });

  test('the prompt frames declaring a gap as a correct answer, not a failure', () => {
    // A model that reads "gap = failure" will guess rather than report.
    assert.match(analyser, /correct and useful answer, not a failure/);
  });

  test('the flag is parsed and returned, not just requested', () => {
    assert.match(analyser, /evidenceGap: parsed\.evidenceGap === true/);
  });

  test('the result type carries it', () => {
    assert.match(types, /evidenceGap\?: boolean/);
    assert.match(types, /evidenceGapReason\?: string/);
  });

  test('both wave agents propagate it onto the entity metadata', () => {
    // Without this the flag dies in the analyser and wave 4 never sees it.
    for (const [name, src] of [['wave3', wave3], ['wave2', wave2]]) {
      assert.match(src, /analysisResult\.evidenceGap/, `${name} must propagate the flag`);
      assert.match(src, /evidenceGap: true/, `${name} must stamp entity metadata`);
    }
  });

  test('wave 4 refuses to document a flagged entity', () => {
    assert.match(controller, /entityMeta\.evidenceGap === true/);
    assert.match(controller, /Skipping insight for/);
  });

  test('the skip returns from the task rather than using continue', () => {
    // Each entity is its own async task; `continue` does not compile there and
    // silently documenting on would defeat the gate.
    assert.match(controller, /return; \/\/ one async task per entity/);
  });

  test('skips are counted and reported, not silent', () => {
    assert.match(controller, /skippedForEvidence/);
    assert.match(controller, /insight document\(s\) skipped for evidence gaps/);
  });
});

describe('gate 2 — the model may decline', () => {
  test('the insight prompt sanctions INSUFFICIENT_EVIDENCE', () => {
    assert.match(insightGen, /INSUFFICIENT_EVIDENCE/);
    assert.match(insightGen, /complete, correct answer — not a failure/);
  });

  test('a declined insight returns null rather than becoming the document', () => {
    // The bug this guards: writing "INSUFFICIENT_EVIDENCE: …" to disk AS the
    // document, which is worse than the guess it replaced because it is then
    // re-injected as context.
    assert.match(insightGen, /\^INSUFFICIENT_EVIDENCE/);
    assert.match(insightGen, /return null;/);
  });

  test('generateDeepInsight admits null in its signature', () => {
    assert.match(insightGen, /\}\): Promise<string \| null> \{/);
  });

  test('buildDocument still skips the file when there is no LLM content', () => {
    // The pre-existing no-fallback path is what makes returning null safe —
    // it must not regress into writing raw observations instead.
    assert.match(insightGen, /NO FALLBACK: Return null to prevent writing a low-quality insight/);
  });
});

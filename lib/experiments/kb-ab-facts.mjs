// lib/experiments/kb-ab-facts.mjs
//
// The graded facts for the knowledge-injection A/B, as CONJUNCTIONS rather than single strings.
//
// WHY NOT A GREP. The specs originally graded with `grep -q -F <token> <file>`, which forces the
// graded fact to be one literal string that is simultaneously (a) carried verbatim in the KB,
// (b) absent from the restored snapshot, and (c) naturally demanded by the goal. That
// intersection is nearly empty, and for a structural reason: KB insights are prose ABOUT this
// repo, so the concrete identifiers they discuss necessarily also exist in the repo. Measured
// 2026-08-23 by mining what retrieval actually returns and diffing it against the post-strip
// sandbox: of 121 candidate tokens for the ETM goal only 14 were snapshot-absent, and every one
// was prose ("Consulted", "red/yellow") or an absolute host path. Same for the proxy goal (9 of
// 115). `persistOnClose` works only because it landed 2026-08-15, AFTER the snapshot's 2026-07-20
// content lineage — absence there is a property of history, not of the fact.
//
// `test_command` never required a grep. evidence-harness.resolveTestCommand needs a FIXED ARGV
// with no shell metacharacters (SHELL_META_RE), and `node scripts/kb-ab-assert.mjs <topic>`
// satisfies that exactly. So the gate can assert a causal STORY — root cause + how to confirm it
// + the fix — which is much harder to assemble by grepping than any single token.
//
// ONE SOURCE OF TRUTH. These definitions are consumed by BOTH the checker (which grades a cell)
// and scripts/experiment-audit-recoverability.mjs (which measures, per fact, whether a kb-off
// agent could grep its way to it). Recoverability is MEASURED, never hand-annotated here — a
// hand-written claim would rot the moment the snapshot or the repo moved.
//
// TWO SOURCES, ONE TABLE. The curated sets below are hand-written; SAMPLED sets — derived from KB
// insights by scripts/kb-ab-sample-tasks.mjs to measure the discrimination rate — are loaded from
// disk and merged into this same FACT_SETS object at import (loadGeneratedFactSets, bottom of
// file). That is deliberate: it means neither consumer above needs to know a topic was generated,
// so the invariant in the previous paragraph survives the sampler rather than being forked by it.
// Curated wins on an id collision, so a generated set can never silently redefine a published one.
//
// WHY THE GENERATED SETS LIVE IN GITIGNORED .data/ AND NOT IN config/. A fact set spells out the
// answers — that is why the checker is deliberately NOT copied into a sandbox
// (evidence-harness.mjs:333). Snapshot restore is `git clone --local --no-checkout` + `checkout
// --detach <sha>`, so it materialises COMMITTED content; config/experiments/ is tracked, so a
// generated fact file there would be one re-snapshot away from shipping the answers into the very
// sandbox the control arm is meant to search in vain. Gitignored output cannot enter a checkout at
// any SHA.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ id: string, re: RegExp, required: boolean, why: string }} Fact
 * @typedef {{ deliverable: string, goalSummary: string, facts: Fact[] }} FactSet
 */

/** @type {Record<string, FactSet>} */
export const FACT_SETS = {
  'kb-ab-etm-crashloop': {
    deliverable: 'etm-crashloop-runbook.md',
    goalSummary: 'ETM crash-loop from a missing km-core symlink, while the Health API stays green',
    facts: [
      { id: 'symlink-path', required: true, re: /node_modules\/@fwornle\/km-core/,
        why: 'the missing hand-made symlink is the root cause; nothing in the import site hints at it' },
      { id: 'fix-command', required: true, re: /ln\s+-s/,
        why: 'the fix is recreating the symlink — an agent that only diagnoses has not finished the task' },
      { id: 'launchctl-check', required: true, re: /launchctl/,
        why: 'the crash-loop is visible as a non-zero exit in the launchd job, not in any service log' },
      { id: 'health-is-wrong-place', required: true,
        re: /not a service|isn['’]t a service|health (?:api|endpoint)[^.]{0,80}(?:green|wrong place|misleading)|green[^.]{0,80}(?:still|even though|despite)/i,
        why: 'the decisive insight: health stays green BECAUSE the ETM is not a service, so health is the wrong place to look' },
    ],
  },

  'kb-ab-leveldb-amplification': {
    deliverable: 'leveldb-amplification-runbook.md',
    goalSummary: 'a read-only polled route OOM-killing its container via LevelDB write amplification',
    facts: [
      { id: 'persist-option', required: true, re: /persistOnClose/,
        why: 'the option that fixes it. Landed 2026-08-15, after the snapshot, so it cannot be grepped from the sandbox' },
      // REPLACED 2026-08-23 (was `whole-graph-one-key`, matching "the WHOLE graph under ONE
      // key"). That fact scored 0/6 — in BOTH arms — across the first isolated run, which looks
      // like a hard task but was a broken gate: the phrasing exists in this repo's CLAUDE.md,
      // NOT in the KB, so retrieval never injected it and the treatment could not supply what
      // the gate demanded. The KB states the mechanism one level up: "GraphKMStore.close()
      // unconditionally called persistGraph() on every close including read-only opens".
      //
      // The replacement was CHOSEN BY MEASUREMENT, not by taste — graded against the nine
      // leveldb deliverables already on disk (3 kb-on, 3 kb-off, 3 bare-dir coinage runs):
      //   read-open-still-writes   3/3 kb-on   0/3 kb-off   0/3 coinage   <- discriminates
      //   persistGraph (bare name) 3/3         0/3          0/3           (token, not a story)
      //   amplification factor     1/3         0/3          0/3           too rare in kb-on
      //   "default true"           0/3         3/3          2/3           coinable, and kb-on
      //                                                                   never writes it
      // Same causal content, expressed the way the knowledge actually carries it.
      { id: 'read-open-still-writes', required: true,
        re: /read-only[^.]{0,60}(open|store|handle)[^.]{0,80}(persist|write)|persist[^.]{0,60}(on|at)\s+(every\s+)?close|close\(\)[^.]{0,80}persist/i,
        why: 'the mechanism: closing a store PERSISTS even when it was opened only to read, so a pure read path writes the graph back. Reaching this without the KB requires inventing the close-path behaviour — measured 0/3 in kb-off and 0/3 with no knowledge at all' },
      { id: 'cgroup-not-docker-stats', required: true, re: /memory\.events|memory\.peak|oom_kill|cgroup/,
        why: 'pure experience: docker stats under-reports because the spike outruns its 1s sampling, so read the cgroup file' },
      { id: 'cheap-positive-test', required: true, re: /du\s+-sh|\.ldb|SST|sst/,
        why: 'the goal demands a cheap confirmation before any fix — one GET adding ~1 MB of SST is it' },
    ],
  },

  // RETIRED 2026-08-23: kb-ab-llm-routing (replaced kb-ab-proxy-endpoint, and failed for the
  // opposite reason). Its facts WERE out of reach of the snapshot — recoverability was never the
  // problem. It failed because the treatment arm did not use the knowledge at all.
  //
  // Measured, first fully isolated run (n=3 per arm): kb-on 1.00/4 facts vs kb-off 2.00/4 — the
  // treatment scored WORSE than the control. Reproducing the exact cell retrieval showed the
  // injected block (8,986 chars, matching what the cells received) DID contain llm-routing.yaml
  // and available_models, and kb-on scored 0/3 on both while spending 44 tool calls to kb-off's 5.
  // Delivery was not at fault: the same injectCellKnowledge → --append-system-prompt path fed the
  // etm and leveldb kb-on cells in the same run, and those scored 4/4.
  //
  // ROOT CAUSE, and why no choice of facts rescues it. llm-routing.yaml lives in the SEPARATE
  // rapid-llm-proxy repository — not a submodule, not tracked here — so no snapshot of this repo
  // can ever contain the world these facts describe. Meanwhile this repo ships its own
  // config/llm-providers.yaml (last touched 2026-04-12, present in both the snapshot and HEAD)
  // which is a confident, concrete, WRONG answer to the same question. The cells explored, found
  // it, and wrote runbooks about it. Mining every candidate identifier out of the injected block
  // and scoring it across kb-on / kb-off / bare-model coinage returned ZERO usable facts: every
  // term kb-on actually wrote is grep-able from its own sandbox (78–1948 files) and also appears
  // in kb-off. There is nothing to grade, because kb-on produced only tree-derived content.
  //
  // Re-snapshotting at HEAD was considered and rejected on evidence: it does not remove
  // llm-providers.yaml (which predates the snapshot and survives at HEAD), and it ADDS
  // docs/architecture/llm-routing.md — created after the snapshot, carrying llm-routing.yaml (1),
  // available_models (4), llm-fallback.yaml (2) and the fail-at-boot phrasing (4), and NOT covered
  // by neutralizeSandboxKnowledge, which strips .planning/knowledge-management/.specstory/KB dirs
  // but not docs/. That would hand the control arm the whole answer while leaving the
  // contradiction in place — strictly worse than the state being fixed.
  //
  // KEEP THE FINDING, NOT THE SPEC. The result this task produced is worth more than the task:
  // when a repository contains a confident answer that CONTRADICTS injected knowledge, the model
  // believes the repository, and searches harder to confirm it. Any future spec must check that
  // the sandbox holds no competing answer to its goal — snapshot-absence of the graded fact is
  // necessary but, as this shows, not sufficient.
};

/**
 * Grade one produced deliverable against its fact set.
 *
 * @param {string} topic key into FACT_SETS
 * @param {string} text  the produced file's contents
 * @returns {{ ok: boolean, results: Array<{id:string,required:boolean,hit:boolean,why:string}> }}
 */
export function gradeFacts(topic, text) {
  const set = FACT_SETS[topic];
  if (!set) throw new Error(`kb-ab-facts: unknown topic '${topic}'`);
  const body = String(text ?? '');
  const results = set.facts.map((f) => ({ id: f.id, required: f.required, why: f.why, hit: f.re.test(body) }));
  const ok = results.every((r) => !r.required || r.hit);
  return { ok, results };
}


// ---------------------------------------------------------------------------
// Generated (sampled) fact sets
// ---------------------------------------------------------------------------

/** Where scripts/kb-ab-sample-tasks.mjs writes derived fact sets. Gitignored — see header. */
export const GENERATED_FACTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.data', 'kb-ab-sampler', 'facts',
);

/**
 * Rebuild one serialized fact into the live `{ id, re, required, why }` shape.
 *
 * Regexes cross the disk boundary as `{ source, flags }` rather than as a `/…/` string, so no
 * parsing of delimiters is needed and the flags survive intact.
 *
 * THROWS rather than skipping on a bad pattern. A fact that silently vanished would weaken the
 * conjunction without saying so, and the resulting run would report a discrimination rate computed
 * against a gate nobody knows the shape of — the exact class of silent mis-measurement this
 * experiment has already been burned by twice.
 *
 * @param {object} raw    one serialized fact
 * @param {string} topic  owning topic, for the error message
 * @returns {{ id: string, re: RegExp, required: boolean, why: string }}
 */
export function reviveFact(raw, topic) {
  const id = raw?.id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`kb-ab-facts: generated set '${topic}' has a fact with no id`);
  }
  if (typeof raw.source !== 'string' || !raw.source.length) {
    throw new Error(`kb-ab-facts: generated fact '${topic}/${id}' has no regex source`);
  }
  let re;
  try {
    re = new RegExp(raw.source, typeof raw.flags === 'string' ? raw.flags : '');
  } catch (err) {
    throw new Error(`kb-ab-facts: generated fact '${topic}/${id}' has an invalid regex: ${err.message}`);
  }
  // A pattern that matches the empty string matches EVERY deliverable, so it would pass the gate
  // unconditionally and inflate the rate. `.*`, `x?` and friends are the realistic ways an LLM-
  // proposed pattern degenerates; this is the cheap mechanical tell for all of them.
  if (re.test('')) {
    throw new Error(
      `kb-ab-facts: generated fact '${topic}/${id}' matches the empty string (/${raw.source}/), `
      + 'so it would grade every deliverable as passing',
    );
  }
  return {
    id,
    re,
    required: raw.required !== false,
    why: typeof raw.why === 'string' ? raw.why : '',
    // Provenance kept on the fact so a report can split by it. NOT consulted when grading:
    // a grep-able fact is still graded, because "grep-able is not recoverable" (the etm result).
    ...(raw.inSandbox === undefined ? {} : { inSandbox: !!raw.inSandbox }),
    generated: true,
  };
}

/**
 * Load every `<topic>.json` under `dir` and merge it into `target`.
 *
 * Curated sets WIN on collision — a generated topic can never redefine a published one, so a
 * stale file in .data/ cannot quietly change what an already-reported result meant.
 *
 * Fail-soft on an absent directory (the normal state before any sampling run), hard on a malformed
 * file that IS present: an unreadable fact set means the gate is not what the spec says it is.
 *
 * @param {Record<string, object>} [target]  table to merge into (default FACT_SETS)
 * @param {string} [dir]                     directory to read (default GENERATED_FACTS_DIR)
 * @returns {string[]} topics actually merged
 */
export function loadGeneratedFactSets(target = FACT_SETS, dir = GENERATED_FACTS_DIR) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return []; // no sampling run yet — the curated sets are the whole table
  }
  const merged = [];
  for (const name of names) {
    const topic = name.slice(0, -'.json'.length);
    if (Object.prototype.hasOwnProperty.call(target, topic)) continue; // curated wins
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (!Array.isArray(raw?.facts) || raw.facts.length === 0) {
      throw new Error(`kb-ab-facts: generated set '${topic}' has no facts`);
    }
    target[topic] = {
      deliverable: String(raw.deliverable || `${topic}.md`),
      goalSummary: String(raw.goalSummary || ''),
      facts: raw.facts.map((f) => reviveFact(f, topic)),
      generated: true,
      insightId: raw.insightId ?? null,
    };
    merged.push(topic);
  }
  return merged;
}

// Merge at import, so BOTH consumers (kb-ab-assert.mjs, experiment-audit-recoverability.mjs) see
// sampled topics with no change to either.
loadGeneratedFactSets();

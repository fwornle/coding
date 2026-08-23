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
      { id: 'whole-graph-one-key', required: true,
        re: /(whole|entire|full)\s+graph[^.]{0,60}(one|single)\s+(key|value)|one\s+(key|value)[^.]{0,60}(whole|entire)\s+graph/i,
        why: 'the mechanism: close() persists the WHOLE graph under ONE key, so a read rewrites everything' },
      { id: 'cgroup-not-docker-stats', required: true, re: /memory\.events|memory\.peak|oom_kill|cgroup/,
        why: 'pure experience: docker stats under-reports because the spike outruns its 1s sampling, so read the cgroup file' },
      { id: 'cheap-positive-test', required: true, re: /du\s+-sh|\.ldb|SST|sst/,
        why: 'the goal demands a cheap confirmation before any fix — one GET adding ~1 MB of SST is it' },
    ],
  },

  // Replaces kb-ab-proxy-endpoint, which was measurably unable to discriminate: all four of its
  // required facts (12435, /api/complete, 3033, the HTML-200 symptom) are grep-able from the
  // snapshot, because they are long-standing configuration that predates its 2026-07-20 lineage.
  // The routing rework landed 2026-08-16 — AFTER the snapshot — so its identifiers are absent
  // from the tree by construction while the KB carries them ("Rapid-LLM-Proxy Config-Driven
  // Routing Engine"). Verified 2026-08-23: llm-routing.yaml, llm-fallback.yaml, available_models
  // and from-caller all return 0 files against the post-strip sandbox.
  'kb-ab-llm-routing': {
    deliverable: 'llm-routing-runbook.md',
    goalSummary: 'where provider/model routing is declared, how it reloads, and why a bad config now aborts boot',
    facts: [
      { id: 'routing-config-file', required: true, re: /llm-routing\.yaml/,
        why: 'routing is declared in version-controlled YAML, not runtime state — the single most load-bearing fact' },
      { id: 'model-catalogue', required: true, re: /available_models/,
        why: 'each provider declares what its ACCOUNT can serve; a band naming a model outside it fails validation' },
      { id: 'fail-at-boot', required: true,
        re: /abort|refuse|fail(?:s|ed)?\s+(?:to\s+)?(?:start|boot|validat)|will not start|won['’]t start/i,
        why: 'the behavioural change: an unparseable config now ABORTS proxy boot instead of being silently skipped' },
      { id: 'no-startup-script', required: false,
        re: /hot-?reload|mtime|no restart|without a restart|reloaded/i,
        why: 'config is picked up on mtime change with no restart — optional because it is a detail, not the core story' },
    ],
  },
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

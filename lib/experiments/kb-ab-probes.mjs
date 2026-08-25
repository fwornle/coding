/**
 * The probes the kb-ab derivation runs against live services, and the guard that keeps the coinage
 * filter honest.
 *
 * WHY THIS IS A MODULE AND NOT A SECTION OF ONE CLI. Two entry points now derive fact sets:
 * scripts/kb-ab-sample-tasks.mjs (from insights, at sampling time) and scripts/kb-ab-mine-facts.mjs
 * (from what the treatment arm actually wrote). They must apply the SAME coinage filter, measured
 * against the SAME model floor — a fact retired in one path and graded in the other would make the
 * discrimination rate depend on which script last touched the file. The tier-and-family guard below
 * is the piece that must never diverge, so it lives in exactly one place.
 *
 * WHICH MODEL ANSWERS COINAGE, AND WHY THE GUARD IS ONE-SIDED. Report pitfall 3 is a coinage probe
 * that silently ran on a cheaper model and retired a good fact, so the model that answers matters —
 * but NOT in both directions, and it cannot simply be demanded:
 *
 *   - The request-body `model` is ignored by /api/complete, and `processOverrides` no longer route
 *     at all (rapid-llm-proxy proxy-bridge/server.mjs:279 — "still READ for backward compatibility
 *     … nothing routes on them any more; they are ignored by the request path"). Measured: an
 *     override that landed by read-back was still answered by claude-haiku-4-5. Anything claiming
 *     to pin a model that way — scripts/llm-model-probe.mjs included — is reporting the config's
 *     choice, not its own.
 *   - The routing config decides. `kb-ab-coinage` is routed to gh-copilot/claude-sonnet-4.6, the
 *     cells' own model (rapid-llm-proxy config/llm-routing.yaml).
 *
 * The bias is ASYMMETRIC, which is what makes accepting the config's choice safe. Coinage on a
 * peer-or-stronger model drops facts the cells might not have coined — conservative, it can only
 * UNDERSTATE the discrimination rate. Coinage on a WEAKER model misses facts the cells would coin,
 * which survive the filter and INFLATE the rate. So the guard rejects only the weaker case, and
 * records whichever model actually answered.
 *
 * Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
 */
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { canonicalModel } from '../../scripts/llm-model-probe.mjs';

const PROXY_PORT = process.env.LLM_PROXY_PORT || process.env.LLM_CLI_PROXY_PORT || '12435';
const PROXY = `http://127.0.0.1:${PROXY_PORT}`;
const OBS_PORT = process.env.OBS_API_PORT || '12436';

/** The model the CELLS use, in the CELL SPEC's spelling. Coinage on anything else answers a
 *  different question. */
export const CELL_MODEL = 'claude-sonnet-4-6';
/**
 * Capability rank, coarse enough to be stable across renames. Only the ORDER matters: coinage must
 * not be measured BELOW the cells' tier (see the header's asymmetry note). Deliberately not a
 * version comparison — sonnet-5 and sonnet-4.6 are peers for this purpose, and the guard has no
 * business adjudicating which is better.
 */
const MODEL_TIER = [
  [/haiku|mini|8b|instant/i, 1],
  [/sonnet|gpt-4o(?!-mini)|70b/i, 2],
  [/opus/i, 3],
];
export function modelTier(model) {
  const s = String(model ?? '');
  for (const [re, rank] of MODEL_TIER) if (re.test(s)) return rank;
  return 0; // unrecognised — treated as below the floor, so an unknown id fails loudly
}

/**
 * Model FAMILY. Tier alone is not enough: the coinage question is whether THESE weights already
 * carry the fact, and a different vendor's model of similar capability answers a different
 * question entirely. The fallback chain behind the coinage route ends in
 * groq/llama-3.3-70b-versatile and openai/gpt-4o, both of which clear the tier floor while saying
 * nothing about what claude-sonnet-4-6 would write unprompted.
 */
export function modelFamily(model) {
  const s = String(model ?? '').toLowerCase();
  if (/claude|haiku|sonnet|opus/.test(s)) return 'claude';
  if (/gpt|o[0-9]-|davinci/.test(s)) return 'openai';
  if (/llama|mixtral|mistral|gemma|qwen/.test(s)) return 'open-weights';
  return 'unknown';
}

/** The cells' tier. Coinage at or above this is conservative; below it inflates the rate. */
export const CELL_TIER = modelTier(CELL_MODEL);
/** The cells' family. Coinage outside it is not a weaker measurement — it is a different one. */
export const CELL_FAMILY = modelFamily(CELL_MODEL);
/** Dedicated process keys, so an override cannot collide with another probe's. */
// NO `bg-` PREFIX. server.mjs prepends it, so `bg-kb-ab-sampler` here resolved as
// `bg-bg-kb-ab-sampler` — matching no route and silently taking defaults.background. That is why
// adding a `bg-kb-ab-sampler` route to llm-routing.yaml appeared to work (the resolve endpoint,
// queried with the RESOLVED name, reported the new route) while the generator kept going to
// claude-code-max. COINAGE_PROCESS below never had the prefix, which is why coinage alone stayed
// on gh-copilot through the 2026-08-24 session-limit exhaustion.
export const GEN_PROCESS = 'kb-ab-sampler';
export const COINAGE_PROCESS = 'kb-ab-coinage';
/** Bare answers per task. Matches the report's own coinage table (3 runs). */
export const COINAGE_SAMPLES = 3;
/** Attempts before a model downgrade is treated as persistent rather than transient. */
const TIER_RETRIES = 3;
const TIER_RETRY_DELAY_MS = 4000;
const REQUEST_TIMEOUT_MS = 120_000;
const GREP_TIMEOUT_MS = 120_000;


/** Models that answered the candidate generator. Recorded, not pinned — see the complete() note. */
const generatorModels = new Set();
/** Models that answered the coinage probe. Recorded — the routing config chose them, not this
 *  script — and required to stay at or above the cells' tier. */
const coinageModels = new Set();
/** Every downgrade seen and retried past. Recorded so a run served during a degraded window is
 *  visible in the ledger rather than looking like a clean one. */
const coinageDowngrades = [];

// ── proxy plumbing ─────────────────────────────────────────────────────────

/** POST /api/complete. Returns the whole envelope so callers can check which model answered. */
export async function complete(body) {
  const r = await fetch(`${PROXY}/api/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`/api/complete -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  const env = await r.json();
  if (env?.error) throw new Error(`/api/complete error: ${String(env.error).slice(0, 200)}`);

  // PROVENANCE IS RECORDED HERE, NOT AT THE CALL SITES. It used to be an explicit
  // `generatorModels.add(...)` beside each generator call, and extracting the probes into this
  // module dropped the one in scripts/kb-ab-sample-tasks.mjs — leaving a comment there that still
  // promised "Recorded, so the derivation stays auditable" while the ledger wrote an empty list.
  // The whole pilot-3 draw (36 derived tasks) has no record of what generated its fact candidates
  // as a result. Keying off the process means a caller cannot forget.
  if (body?.process === GEN_PROCESS) generatorModels.add(env?.model ?? 'unknown');
  return env;
}

// ── the four probes ────────────────────────────────────────────────────────

/**
 * The block the TREATMENT ARM will actually receive.
 *
 * Every parameter mirrors lib/experiments/cell-injection.mjs — same 500-char query slice, same
 * budget, same threshold, and a task_id shaped like a real cell's (`--` separators) so the
 * experiment gate applies and only insights + kg_entities survive. Probing with anything else
 * measures a block no cell will ever see.
 */
export async function retrieveProbe(goal, topic) {
  const r = await fetch(`http://localhost:${OBS_PORT}/api/retrieve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: String(goal).slice(0, 500),
      budget: 3000,
      threshold: 0.70,
      context: { project: 'coding', agent: 'claude' },
      task_id: `${topic}--claude-${CELL_MODEL}-straight-kb-on--r0`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`/api/retrieve -> ${r.status}`);
  const data = await r.json();
  return (data?.meta?.results_count > 0 && data.markdown) ? String(data.markdown) : '';
}

/**
 * N bare answers to the goal: the cell's model, no repository, no knowledge base, no tools.
 *
 * A fact appearing here is one the model already knew, so injection cannot be credited for it —
 * and grading it would report a KB win the KB did not earn.
 */
export async function coinageProbe(goal) {
  const texts = [];
  for (let i = 0; i < COINAGE_SAMPLES; i += 1) {
    let env = null;
    // RETRY A DOWNGRADE, DO NOT DIE ON ONE. Observed 2026-08-24: while claude-code-max was
    // returning 529s, background calls were served by claude-haiku-4-5 (that account's `small`
    // band) and recovered to claude-sonnet-5 unaided minutes later. Failing fast on the first
    // downgrade would abandon a 30-minute derivation over a transient blip; accepting it would
    // inflate the rate. So: retry, and fail only if the degradation persists.
    for (let attempt = 1; attempt <= TIER_RETRIES; attempt += 1) {
      // The sample ordinal is in the prompt for a REASON, not as decoration. A long request
      // repeated verbatim came back as a replay — content opening "This is an exact repeat of the
      // previous request … here is the same runbook again in full", with a model id and token
      // count that both disagreed with the body returned. Three identical requests would then be
      // one answer counted three times, and a corpus of one sample is not a coinage measurement.
      // Varying the bytes per sample keeps the three draws independent. Deterministic (the index,
      // never a random nonce) so a re-derivation with the same seed issues the same requests.
      env = await complete({
        process: COINAGE_PROCESS,
        messages: [
          {
            role: 'system',
            content: 'Answer from your own knowledge. You have no access to any repository, file or tool.'
              + ` This is independent attempt ${i + 1} of ${COINAGE_SAMPLES}; answer afresh.`,
          },
          { role: 'user', content: goal },
        ],
      });
      // Pitfall 3, one-sided: reject only a WEAKER model, because only that direction inflates the
      // rate. Judged on the model that ANSWERED, never the one requested — the request cannot
      // select one.
      if (modelFamily(env?.model) === CELL_FAMILY && modelTier(env?.model) >= CELL_TIER) break;
      coinageDowngrades.push({ attempt, model: env?.model ?? null, provider: env?.provider ?? null });
      if (attempt === TIER_RETRIES) {
        const wrongFamily = modelFamily(env?.model) !== CELL_FAMILY;
        throw new Error(
          `coinage was answered by '${env?.model}' (family ${modelFamily(env?.model)}, `
          + `tier ${modelTier(env?.model)}) on all ${TIER_RETRIES} attempts; the cells run `
          + `'${CELL_MODEL}' (family ${CELL_FAMILY}, tier ${CELL_TIER}). `
          + (wrongFamily
            ? 'A different model family does not answer the coinage question at all — whether THESE '
              + 'weights already carry the fact. Likely a fallback past gh-copilot; check its quota.'
            : 'A weaker prober misses facts the cells WOULD coin, so those facts survive the filter '
              + 'and inflate the discrimination rate (pitfall 3).')
          + ' Check the proxy before re-running.',
        );
      }
      await new Promise((r) => { setTimeout(r, TIER_RETRY_DELAY_MS * attempt); });
    }
    // Peers may be pooled, tiers may not. The fallback chain legitimately moves a call between
    // claude-code-max/claude-sonnet-5 and gh-copilot/claude-sonnet-4.6, and mixing those two in one
    // corpus is fine — they are the same class of prober. The floor above is what keeps a haiku
    // answer out; demanding one exact model id here would abort on an ordinary provider failover.
    coinageModels.add(canonicalModel(env?.model));
    texts.push(String(env?.content ?? ''));
  }
  return texts;
}

/** Files under the restored sandbox matching a fact regex. Approximate by design — see the audit. */
export function inSandboxProbe(sandbox, candidate) {
  const res = spawnSync(
    '/usr/bin/grep',
    ['-rlE', '--binary-files=without-match', '--exclude-dir=.git', candidate.source, sandbox],
    { encoding: 'utf8', timeout: GREP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  return typeof res.stdout === 'string' && res.stdout.split('\n').filter(Boolean).length > 0;
}

/** Symptom fallback for the ~55% of insights whose Troubleshooting bullets are not `**x**: y`. */
export async function symptomProbe(ins) {
  const env = await complete({
    process: GEN_PROCESS,
    messages: [
      {
        role: 'system',
        content: [
          'You restate the SYMPTOM an operator would observe, from a knowledge-base insight.',
          'One sentence, 12 to 30 words, describing only what is OBSERVED — never the cause, the',
          'diagnosis, the fix, or any identifier from the resolution. Answer with the sentence only.',
        ].join('\n'),
      },
      { role: 'user', content: `TOPIC: ${ins.topic}\n\nINSIGHT:\n${ins.summary}` },
    ],
  });
  const symptom = String(env?.content ?? '').trim().replace(/^["']|["']$/g, '');
  return symptom ? { symptom, resolution: '' } : null;
}


/** Models that answered each probe, and every downgrade retried past — for the ledger. */
export function probeProvenance() {
  return {
    generatorModels: [...generatorModels],
    coinageModels: [...coinageModels],
    coinageDowngrades: [...coinageDowngrades],
  };
}

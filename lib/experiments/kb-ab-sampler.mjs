// lib/experiments/kb-ab-sampler.mjs
//
// Derives kb-ab A/B tasks from knowledge-base insights, so the knowledge-injection experiment can
// report a RATE rather than an existence proof.
//
// WHY THIS EXISTS. The published A/B (docs-content/measurement/knowledge-injection-ab.md) measured
// two hand-written tasks and found injection decisively better and 8-24x cheaper. It cannot say
// how OFTEN that happens, because the tasks were SELECTED, not sampled — written precisely because
// their answers live in the KB and not in the code. The report names the missing number:
//
//   the DISCRIMINATION RATE — what fraction of knowledge-derived tasks the control arm cannot
//   solve, which is a direct measure of how much of the knowledge base is non-redundant.
//
// Getting that number requires a task population you did not choose task-by-task. This module is
// the derivation: KB insight -> runbook goal -> graded fact conjunction -> keep/drop, with every
// decision made from signals that are BLIND to how the arms actually perform.
//
// THREE DESIGN RULES, each the inverse of an instinct, each earned by a measured failure.
//
//   1. THE RECOVERABILITY AUDIT IS A COVARIATE, NEVER A FILTER. The report proposes running only
//      audit survivors. Its own pitfall 2 refutes that: kb-ab-etm-crashloop audits FAIL — all four
//      facts grep-able, 0 of 4 out of reach — and still discriminated 4.00/4 vs 1.33/4, because
//      kb-off searched 123 times across three cells and never found the symlink path or the fix
//      command. Filtering on the audit discards discriminating tasks and biases the rate upward by
//      an unknown amount. Every sampled task runs; the verdict is recorded beside it.
//
//   2. THE SAME LOGIC FORBIDS DROPPING A GREP-ABLE FACT. A fact sitting in the sandbox looks
//      unusable — kb-off can just read it. That is exactly the etm case. "Grep-able is not
//      recoverable" is the finding, so `inSandbox` is RECORDED per fact and never causes a drop.
//      Whether kb-off can actually reach it is the outcome being measured, not an assumption baked
//      into selection. See `selectFacts` — this is the one place the rule could quietly be broken.
//
//   3. ONLY BLIND SIGNALS MAY DROP A FACT. Two of them, both measurable before any cell runs:
//        - not present in the block retrieval actually returns  -> drop (pitfall 4: a gate
//          demanding a fact the KB does not carry scored 0/6 in BOTH arms and read as a hard task)
//        - coined by the bare pinned model, unprompted           -> drop (pitfall 3: a fact the
//          model already knows cannot distinguish the arms)
//      No arm outcome ever feeds selection. That is what keeps the rate an estimate rather than a
//      restatement of the choices made while building it.
//
// PURE BY CONSTRUCTION. Every probe (retrieval, coinage, sandbox grep, LLM completion) arrives as
// an injected function, so the whole derivation is testable with fakes and the I/O lives in
// scripts/kb-ab-sample-tasks.mjs. Nothing here reads the filesystem or the network.

/**
 * @typedef {{ id: string, topic: string, summary: string, confidence: number,
 *             createdAt: string, project: string }} Insight
 * @typedef {{ id: string, source: string, flags: string, why: string }} Candidate
 * @typedef {{ injected: boolean, coined: boolean, inSandbox: boolean }} Signals
 */

/** Facts a task needs before it is worth spending cells on. */
export const KEEP_MIN_FACTS = 3;

/** Population frame. Confidence only — recency is a covariate, not a criterion (see samplePopulation). */
export const POPULATION_DEFAULTS = Object.freeze({ project: 'coding', minConfidence: 0.8 });

/** Cell shape, copied from the two live kb-ab specs so a sampled task is comparable to them. */
export const CELL_VARIANTS = Object.freeze([
  Object.freeze({ agent: 'claude', model: 'claude-sonnet-4-6', framework: 'straight', env: 'kb-on' }),
  Object.freeze({ agent: 'claude', model: 'claude-sonnet-4-6', framework: 'straight', env: 'kb-off' }),
]);

// ---------------------------------------------------------------------------
// Deterministic sampling
// ---------------------------------------------------------------------------

/** FNV-1a over a seed string — turns `--seed pilot-1` into a 32-bit PRNG state. */
export function hashSeed(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32. Small, seedable, and good enough to draw an unbiased sample of a few hundred. */
export function makeRng(seed) {
  let a = hashSeed(seed);
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against an injected rng. Does not mutate the input. */
export function seededShuffle(items, seed) {
  const out = items.slice();
  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Apply the population frame.
 *
 * DELIBERATELY NOT narrowed to post-snapshot insights. Recency is a strong prior about whether a
 * fact is grep-able, but it is a prior, not a criterion — and conditioning the denominator on it
 * would reintroduce exactly the selection bias rule 1 removes. `postSnapshot` is carried as a
 * covariate instead, so the report can split on it without the rate being defined by it.
 *
 * Sorted by id so the frame is order-stable regardless of export order; the sample's randomness
 * comes from the seed, never from however the JSON happened to be written.
 *
 * @param {Insight[]} insights
 * @param {{ project?: string, minConfidence?: number, snapshotDate?: string }} [opts]
 */
export function framePopulation(insights, opts = {}) {
  const { project, minConfidence } = { ...POPULATION_DEFAULTS, ...opts };
  const snapshotDate = opts.snapshotDate ?? null;
  return (Array.isArray(insights) ? insights : [])
    .filter((r) => r && typeof r.summary === 'string' && typeof r.topic === 'string')
    .filter((r) => (project ? r.project === project : true))
    .filter((r) => Number(r.confidence) >= minConfidence)
    .map((r) => ({
      ...r,
      postSnapshot: snapshotDate ? String(r.createdAt || '') > snapshotDate : null,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Draw `n` insights from a framed population, and open a ledger row for EVERY member.
 *
 * The ledger is the denominator's audit trail. A discrimination rate whose denominator cannot be
 * inspected is not worth reporting — the whole objection to the published result is that its
 * denominator was three hand-picked tasks.
 */
export function samplePopulation(population, { n, seed }) {
  const shuffled = seededShuffle(population, seed);
  const sampled = shuffled.slice(0, n);
  const chosen = new Set(sampled.map((r) => r.id));
  const ledger = population.map((r) => ({
    insightId: r.id,
    topic: r.topic,
    confidence: r.confidence,
    createdAt: r.createdAt,
    postSnapshot: r.postSnapshot,
    status: chosen.has(r.id) ? 'sampled' : 'not-drawn',
    reason: chosen.has(r.id) ? null : 'outside the seeded sample',
  }));
  return { sampled, ledger, seed, populationSize: population.length };
}

// ---------------------------------------------------------------------------
// Goal derivation
// ---------------------------------------------------------------------------

/** `- **<symptom>**: <resolution>` — the dominant Troubleshooting bullet form (80 of 176 insights). */
const BOLD_BULLET = /^\s*[-*]\s+\*\*(.+?)\*\*\s*:\s*(.+)$/gm;

/** Some bullets self-label ("**Symptom: report prose contradicts…**"); the label is not the symptom. */
const SYMPTOM_LABEL = /^\s*symptom\s*:\s*/i;

/** Shortest symptom worth building a runbook around. Below this it names a component, not a fault. */
export const MIN_SYMPTOM_CHARS = 25;

/** Read one `## <name>` section out of an insight summary. */
export function section(summary, name) {
  const re = new RegExp(`^##+\\s*${name}\\s*$([\\s\\S]*?)(?=^##+\\s|$(?![\\s\\S]))`, 'im');
  const m = re.exec(String(summary ?? ''));
  return m ? m[1].trim() : '';
}

/**
 * Symptoms from an insight's `## Troubleshooting` section — the SYMPTOM HALF ONLY.
 *
 * The resolution half is the answer. Carrying it into the goal would hand the control arm exactly
 * what the experiment asks whether it can reconstruct, turning the whole comparison into a test of
 * reading comprehension. `goalLeaksFact` is the second line of defence; this is the first.
 *
 * @returns {Array<{ symptom: string, resolution: string }>} longest-symptom first
 */
export function extractSymptoms(summary) {
  const body = section(summary, 'Troubleshooting');
  const out = [];
  BOLD_BULLET.lastIndex = 0;
  for (let m = BOLD_BULLET.exec(body); m; m = BOLD_BULLET.exec(body)) {
    const symptom = m[1].replace(SYMPTOM_LABEL, '').replace(/\s+/g, ' ').trim();
    if (symptom.length >= MIN_SYMPTOM_CHARS) out.push({ symptom, resolution: m[2].trim() });
  }
  return out.sort((a, b) => b.symptom.length - a.symptom.length);
}

/**
 * kebab slug for a deliverable filename and a spec id.
 *
 * Truncates on a WORD boundary, not mid-word: the slug becomes the deliverable filename that the
 * goal sentence names, and `…-bind-mount-dual-consum-runbook.md` reads as a typo the agent may
 * "helpfully" correct — at which point the gate looks for a file that was never written and the
 * cell scores zero for a cosmetic reason.
 */
export function slugFromTopic(topic, maxLen = 48) {
  const full = String(topic)
    .toLowerCase()
    .replace(/[—–]/g, ' ')      // em/en dash — insight topics use these as separators
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= maxLen) return full;
  const cut = full.slice(0, maxLen + 1);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 0 ? cut.slice(0, lastDash) : full.slice(0, maxLen)).replace(/-+$/g, '');
}

/**
 * The goal sentence.
 *
 * EXECUTION-SHAPED ("Create a file named …"), never analysis-shaped, for two documented reasons
 * that both silently destroy a cell rather than failing it:
 *   1. isTrivialRun (consequential-events.mjs, TRIVIAL_THRESHOLD=1) short-circuits a run with no
 *      state-changing tool call BEFORE the judge is paid for, so an "explain X" goal is never
 *      scored at all.
 *   2. Headless agents narrate-then-yield on analysis goals (opencode `run` ends at the first
 *      toolless step).
 *
 * The required-content clause is copied in shape from the two live specs, so a sampled task grades
 * the same THREE things they do: cause, confirmation, fix.
 */
export function buildGoalSentence({ slug, symptom }) {
  return `Create a file named ${slug}-runbook.md at the repository root that diagnoses this symptom `
    + `for an operator: ${symptom.replace(/\s*[.;]\s*$/, '')}. The file must state the root cause, `
    + 'give the exact commands to confirm it, and give the exact command or option that fixes it.';
}

/**
 * Does the goal already contain a graded fact?
 *
 * A goal that states its own answer hands it to kb-off for free, and the task would then report a
 * spurious tie. Mechanical, so it cannot be forgotten the way a review can.
 *
 * @returns {string[]} ids of facts the goal leaks (empty when clean)
 */
export function goalLeaksFact(goal, facts) {
  const text = String(goal ?? '');
  return facts.filter((f) => reOf(f).test(text)).map((f) => f.id);
}

/** A fact carries either a live `re` (curated) or `{source, flags}` (derived). Accept both. */
function reOf(fact) {
  if (fact.re instanceof RegExp) return new RegExp(fact.re.source, fact.re.flags);
  return new RegExp(fact.source, fact.flags || '');
}

// ---------------------------------------------------------------------------
// Fact derivation
// ---------------------------------------------------------------------------

/**
 * Prompt for candidate facts.
 *
 * THE MODEL SEES THE INSIGHT AND NOTHING ELSE — never the repository. A generator with repo access
 * would propose facts it found in the tree, which is the failure that retired kb-ab-proxy-endpoint
 * (every graded token grep-able, so the gate measured nothing).
 *
 * Asking for a REGEX rather than a literal is what lets a fact grade a causal story instead of a
 * token: of 121 candidate tokens mined for the ETM goal only 14 were snapshot-absent, and all of
 * them were prose or host paths. A conjunction of stories is much harder to assemble by grepping.
 */
export function factCandidatePrompt(insight) {
  const system = [
    'You extract GRADED FACTS for a controlled experiment that measures whether injecting',
    'knowledge-base content helps an AI agent write a correct operational runbook.',
    '',
    'You will be given one knowledge-base insight. Propose 4 to 6 checkable facts that a CORRECT',
    'runbook about this insight must contain. Each fact is a JavaScript regular expression tested',
    'against the runbook text.',
    '',
    'WRITE LITERALS, NOT SENTENCE TEMPLATES. This is the rule that matters most, because a pattern',
    'that spans several phrases only matches the one wording you imagined, and a correct runbook',
    'worded differently scores zero. These are real graded facts from this experiment:',
    '',
    '    persistOnClose                                  <- a literal identifier',
    '    launchctl                                       <- a literal command',
    '    node_modules/@fwornle/km-core                   <- a literal path',
    '    memory\\.events|memory\\.peak|oom_kill|cgroup      <- synonyms, NO gaps',
    '    du\\s+-sh|\\.ldb|SST|sst                           <- synonyms, NO gaps',
    '',
    'Six of the eight facts in use are shaped exactly like that. Prefer an identifier, path, flag,',
    'option, command or error string the insight names. When several wordings are equally correct,',
    'give them as an alternation of literals rather than as a pattern with gaps.',
    '',
    'RULES, in priority order:',
    '1. A literal, or an alternation of literal synonyms, whenever one exists.',
    '2. Only when the fact is genuinely a RELATIONSHIP between two things, and no identifier',
    '   captures it, use at most ONE bounded gap:  /close\\(\\)[^.]{0,80}persist/i',
    '   Never chain gaps. Never use an unbounded .* .',
    '3. Spread the facts across CAUSE, CONFIRMATION and FIX. A runbook that only diagnoses is not',
    '   finished, and a conjunction spanning all three is hard to satisfy accidentally.',
    '4. A fact must be something the insight actually STATES. Do not invent plausible detail.',
    '5. Your pattern MUST match the insight text you were given. If it does not, it is malformed —',
    '   it will be rejected, and the task may be dropped for want of gradeable facts.',
    '6. Never write a pattern that can match the empty string.',
    '',
    'Answer with JSON only, no prose, no code fence:',
    '{"facts":[{"id":"kebab-case-id","source":"regex source without delimiters",',
    ' "flags":"i","why":"one sentence on why a correct runbook must contain this"}]}',
  ].join('\n');
  const user = `TOPIC: ${insight.topic}\n\nINSIGHT:\n${insight.summary}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/**
 * Parse the generator's reply into candidates. Tolerant of a code fence and of leading prose,
 * strict about the shape — a malformed candidate is dropped with a reason rather than guessed at.
 *
 * @returns {{ candidates: Candidate[], rejected: Array<{ raw: unknown, reason: string }> }}
 */
/** Reference answers per task. Two independently-worded correct answers; a fact must be in BOTH. */
export const REFERENCE_SAMPLES = 2;

/**
 * Prompt for a REFERENCE answer: the runbook a well-informed operator would write.
 *
 * Open-book on purpose — it is handed the insight, because it is modelling what a CORRECT kb-on
 * deliverable looks like, not what an unaided model can produce (that is the coinage probe, which
 * is deliberately closed-book). The `variant` nudges wording apart between samples so that a fact
 * surviving both is phrasing-robust rather than an echo of one particular turn of phrase; it also
 * changes the request bytes, which keeps two samples from collapsing into one cached reply.
 */
export function referencePrompt(insight, goal, variant = 0) {
  const styles = [
    'Write it as a terse incident runbook: short sections, imperative sentences.',
    'Write it as an explanatory guide: full prose paragraphs, reasoning made explicit.',
    'Write it as a numbered diagnostic checklist with a short rationale under each step.',
  ];
  const system = [
    'You write operational runbooks. You are given a knowledge-base insight and a goal.',
    'Produce the runbook the goal asks for, using the insight as your source of truth.',
    'State the root cause, the exact commands that confirm it, and the exact fix.',
    styles[variant % styles.length],
    'Output the runbook only — no preamble, no commentary about the request.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `GOAL: ${goal}\n\nINSIGHT:\n${insight.summary}` },
  ];
}

// ---------------------------------------------------------------------------
// Mining facts from what the treatment arm actually wrote
// ---------------------------------------------------------------------------
//
// WHY THIS REPLACES THE REFERENCE FILTER AS THE PRIMARY SOURCE. The reference filter asked a model
// to write the ideal runbook from the insight and kept facts appearing in all of them. Measured on
// the first full pilot (8 tasks, 48 cells), that was not enough: the TREATMENT arm scored
// 0/3,1/3,0/3,2/3,0/3,0/3,0/3,1/3 on its own gates — with the answer injected into its prompt.
// Seven of eight tasks landed in `neither-solves`, which is the report's label for a broken gate,
// so the run measured the conjunctions' difficulty rather than the knowledge base's redundancy.
//
// The reason is a condition mismatch. A reference is written by a model handed the insight, with no
// sandbox, no tools, no execution directive and no length pressure; a cell writes under all four.
// A conjunction where every fact appears in two references can still be jointly unsatisfiable by a
// real cell. The curated sets never had this problem because their facts were chosen against THREE
// REAL kb-on DELIVERABLES on disk. This mines from exactly that.
//
// WHAT THIS CONDITIONS, STATED PLAINLY. Mining from kb-on output means the treatment arm passes its
// own gate close to by construction, so the reported quantity is "the fraction of knowledge-derived
// tasks whose answer the CONTROL arm cannot reproduce". That is the report's own definition of the
// discrimination rate — "what fraction of knowledge-derived tasks the control arm cannot solve" —
// but it must be reported as conditional, never as an unconditional probability that injection
// helps. The control arm is never consulted during selection; that line is what keeps the rate a
// measurement rather than a restatement.

/** Backticked spans — the author marked these as code, which is the strongest signal available. */
const BACKTICKED = /`([^`\n]{2,60})`/g;
/** Identifier shapes worth grading: camelCase, snake_case, SCREAMING_SNAKE, filenames, flags. */
const IDENTIFIER_SHAPES = [
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g,          // snake_case  (host_stalled)
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,          // SCREAMING   (RETRYABLE_ERRORS)
  /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g,                // camelCase   (timeoutMs)
  /\b[\w-]+\.(?:mjs|cjs|js|ts|tsx|json|jsonl|ya?ml|md|sh|db|ldb|log)\b/g, // filenames
  /--[a-z][a-z0-9-]{2,}/g,                       // CLI flags
];

/** Words that are identifier-shaped but carry no diagnostic content. */
const MINING_STOPWORDS = new Set([
  'runbook', 'markdown', 'javascript', 'typescript', 'readme', 'github', 'bashrc',
  'tostring', 'tolowercase', 'touppercase', 'foreach', 'settimeout', 'readfilesync',
  // Platform and tooling names. Identifier-shaped, present in almost any operational document,
  // and therefore satisfied by an arm that understood nothing — `macOS` surfaced as a "stable"
  // token on the first calibration run purely because both arms mention the platform.
  'macos', 'nodejs', 'node_modules', 'localhost', 'jsonl', 'stdout', 'stderr',
  'docker-compose', 'package.json', 'package-lock.json', 'tsconfig.json',
]);

/**
 * Candidate tokens from one deliverable.
 *
 * Backticked spans first (an explicit author signal), then identifier shapes over the whole text.
 * Everything is lower-cased for INTERSECTION purposes only — the fact keeps its original spelling,
 * because a gate that ignores case would accept prose that merely mentions the word.
 *
 * @returns {Map<string,string>} lower-cased token -> the spelling as it appeared
 */
export function mineTokens(text) {
  const found = new Map();
  const add = (raw) => {
    const t = String(raw).trim();
    if (t.length < 4 || t.length > 60) return;
    if (MINING_STOPWORDS.has(t.toLowerCase())) return;
    if (!/[A-Za-z]/.test(t)) return;              // pure numbers/punctuation are not facts
    if (!/[_./-]|[a-z][A-Z]/.test(t)) return;     // must look like an identifier, not a plain word
    const key = t.toLowerCase();
    if (!found.has(key)) found.set(key, t);
  };
  const body = String(text ?? '');
  BACKTICKED.lastIndex = 0;
  for (let m = BACKTICKED.exec(body); m; m = BACKTICKED.exec(body)) {
    // A backticked span may be a whole command; mine its identifier-shaped parts too.
    add(m[1]);
    for (const re of IDENTIFIER_SHAPES) for (const t of m[1].match(re) ?? []) add(t);
  }
  for (const re of IDENTIFIER_SHAPES) for (const t of body.match(re) ?? []) add(t);
  return found;
}

/**
 * Tokens present in EVERY deliverable — the treatment arm's stable vocabulary for this task.
 *
 * Intersection, not union, and for the same reason the reference filter demanded all references: a
 * token only one cell wrote is that cell's phrasing, and grading on it would measure luck. A token
 * all three wrote is what injection reliably produces.
 *
 * @param {string[]} texts  one deliverable per repeat of the treatment arm
 * @returns {Array<{ id: string, source: string, flags: string, why: string }>}
 */
export function mineFactsFromDeliverables(texts) {
  const sets = (Array.isArray(texts) ? texts : []).filter((t) => typeof t === 'string' && t.trim()).map(mineTokens);
  if (sets.length < 2) return []; // one deliverable cannot show stability
  const [first, ...rest] = sets;
  const stable = [];
  for (const [key, spelling] of first) {
    if (rest.every((s) => s.has(key))) stable.push(spelling);
  }
  // Longest first: a longer identifier is more specific, and the keep rule takes the top few.
  stable.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return stable.map((spelling) => ({
    id: spelling.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40),
    source: spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), // literal
    flags: '',
    why: `every treatment-arm repeat wrote \`${spelling}\``,
  })).filter((f) => f.id.length >= 3);
}

/** Longest regex source worth trusting. Past this it is transcribing a sentence, not a claim. */
export const MAX_PATTERN_CHARS = 200;
/** Bounded gaps (`[^.]{0,N}`) allowed within ONE alternation branch. */
export const MAX_GAPS_PER_BRANCH = 2;

/**
 * Is this pattern shaped like a checkable claim, or like a transcription?
 *
 * Counted PER ALTERNATION BRANCH, not per pattern. The curated `read-open-still-writes` fact is
 * three alternatives carrying four gaps in total but only two in any one branch - a global cap
 * would reject a known-good published fact, which is the test this guard has to survive.
 *
 * @returns {string|null} rejection reason, or null when the shape is acceptable
 */
export function patternShapeProblem(source) {
  // REDACTION ARTIFACTS. The insight corpus carries placeholders where the redactor removed a
  // name — `<company>`, `<USER_ID_REDACTED>` and friends. A pattern that inherits one passes the
  // self-match test (it matches the insight, placeholder and all) and then matches no deliverable
  // ever written, so the task scores 0 in BOTH arms and reads as a broken gate. Measured: the
  // derived fact `span\.<company>\.cwd`.
  // Strip legal regex uses of `<` first — named groups `(?<name>` and lookbehind `(?<=` / `(?<!`.
  // Without this the guard rejects `(?<name>foo)bar`, which is a perfectly good pattern.
  const withoutGroups = source.replace(/\(\?<[=!]?[A-Za-z_][A-Za-z0-9_]*>?/g, '');
  const placeholder = /<[A-Za-z_]{3,}(?:_[A-Za-z]+)*>/.exec(withoutGroups);
  if (placeholder) {
    return `pattern carries the redaction placeholder ${placeholder[0]} — it can never match a real deliverable`;
  }
  if (source.length > MAX_PATTERN_CHARS) {
    return `pattern is ${source.length} chars (max ${MAX_PATTERN_CHARS}) - transcribing prose, not asserting a fact`;
  }
  // Split on `|`. Approximate (it does not track group nesting), and deliberately so: it
  // over-counts branches, which makes the guard more permissive, never less.
  for (const branch of source.split('|')) {
    const gaps = (branch.match(/\{\s*\d*\s*,\s*\d+\s*\}/g) || []).length;
    if (gaps > MAX_GAPS_PER_BRANCH) {
      return `one alternation branch chains ${gaps} bounded gaps (max ${MAX_GAPS_PER_BRANCH}) - it demands a phrasing, not a fact`;
    }
  }
  return null;
}

export function parseFactCandidates(content, sourceText = null) {
  const text = String(content ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { candidates: [], rejected: [{ raw: text.slice(0, 120), reason: 'no JSON object in reply' }] };
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return { candidates: [], rejected: [{ raw: text.slice(0, 120), reason: `unparseable JSON: ${err.message}` }] };
  }
  const candidates = [];
  const rejected = [];
  for (const raw of Array.isArray(parsed?.facts) ? parsed.facts : []) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    const source = typeof raw?.source === 'string' ? raw.source : '';
    const flags = typeof raw?.flags === 'string' ? raw.flags : '';
    if (!id || !source) { rejected.push({ raw, reason: 'missing id or source' }); continue; }
    let re;
    try {
      re = new RegExp(source, flags);
    } catch (err) {
      rejected.push({ raw, reason: `invalid regex: ${err.message}` }); continue;
    }
    // Matches everything -> would pass the gate unconditionally and inflate the rate.
    if (re.test('')) { rejected.push({ raw, reason: 'matches the empty string' }); continue; }
    const shape = patternShapeProblem(source);
    if (shape) { rejected.push({ raw, reason: shape }); continue; }
    // SELF-MATCH: the pattern must match the text it was derived from. Free, needs no probe, and
    // it is the single most effective filter measured — 5 of 6 candidates in one derivation failed
    // to match even their own source insight, which is a malformed pattern rather than a hard
    // fact. Anything failing here would fail the injection test moments later anyway, having
    // consumed the probes in between.
    if (sourceText && !re.test(sourceText)) {
      rejected.push({ raw, reason: 'does not match the insight it was derived from' });
      continue;
    }
    if (candidates.some((c) => c.id === id)) { rejected.push({ raw, reason: 'duplicate id' }); continue; }
    candidates.push({ id, source, flags, why: typeof raw.why === 'string' ? raw.why : '' });
  }
  return { candidates, rejected };
}

/**
 * Apply the blind signals to candidates.
 *
 * READ THIS BEFORE ADDING A CONDITION. Exactly two signals may drop a fact, and `inSandbox` is not
 * one of them — see rule 2 in the file header. Dropping grep-able facts looks obviously correct and
 * would have removed all four facts of the one task that most clearly demonstrates the effect,
 * quietly rebuilding the selection bias this module exists to avoid. It is recorded, not applied.
 *
 * @param {Candidate[]} candidates
 * @param {Map<string, Signals>} signals  by candidate id
 */
export function selectFacts(candidates, signals) {
  const kept = [];
  const dropped = [];
  for (const c of candidates) {
    const s = signals.get(c.id) ?? { injected: false, referenced: false, coined: false, inSandbox: false };
    if (!s.injected) {
      dropped.push({ ...c, reason: 'not-injected', signals: s });
      continue;
    }
    // Ungradeable: no correct answer contains it, so it scores 0 in BOTH arms and the task looks
    // hard when the gate is simply broken.
    if (!s.referenced) {
      dropped.push({ ...c, reason: 'absent-from-reference', signals: s });
      continue;
    }
    if (s.coined) {
      dropped.push({ ...c, reason: 'model-coins-it', signals: s });
      continue;
    }
    kept.push({ ...c, required: true, inSandbox: !!s.inSandbox });
  }
  return { kept, dropped };
}

/**
 * Assemble one derived task, or explain why there is not one.
 *
 * Every probe is injected:
 *   complete(messages)  -> string            the fact-candidate generator
 *   retrieve(goal)      -> string            the block the treatment arm will actually receive
 *   reference(goal)     -> Promise<string[]>  N runbooks a well-informed author would write
 *   coinage(goal)       -> Promise<string[]> N bare answers to the goal, from the CELL's model,
 *                                            with no repository and no knowledge base
 *   inSandbox(fact)     -> Promise<boolean>  grep over a restored + neutralized sandbox
 *   symptom(insight)    -> Promise<{symptom}> fallback when no bullet parses (optional)
 *
 * COINAGE IS SAMPLED PER TASK, NOT PER FACT. `coinage` is called ONCE and every candidate is
 * tested against the same bare answers, because that is what the question actually is: asked this
 * goal with nothing to look at, does the model write this fact? Probing each fact with its own
 * question would answer a different and easier one ("can the model recognise this fact"), and cost
 * one call per fact instead of per task.
 *
 * @returns {Promise<object>} a ledger row; `spec` and `factSet` present only when kept
 */
export async function deriveTask(insight, probes) {
  const base = {
    insightId: insight.id,
    topic: insight.topic,
    confidence: insight.confidence,
    createdAt: insight.createdAt,
    postSnapshot: insight.postSnapshot ?? null,
  };

  const symptoms = extractSymptoms(insight.summary);
  const picked = symptoms[0] ?? (probes.symptom ? await probes.symptom(insight) : null);
  if (!picked || !picked.symptom || picked.symptom.length < MIN_SYMPTOM_CHARS) {
    return { ...base, status: 'excluded', reason: 'no usable symptom in ## Troubleshooting' };
  }

  const slug = slugFromTopic(insight.topic);
  const goal = buildGoalSentence({ slug, symptom: picked.symptom });

  const { candidates, rejected } = parseFactCandidates(
    await probes.complete(factCandidatePrompt(insight)), insight.summary,
  );
  if (!candidates.length) {
    return { ...base, slug, goal, status: 'excluded', reason: 'generator returned no usable fact candidates', rejected };
  }

  // The block the treatment arm will actually receive, probed ONCE with the real goal. Testing
  // candidates against it is what makes "the KB carries this fact" a measurement rather than an
  // assumption — pitfall 4 was a gate demanding a fact retrieval never injected, which scored 0/6
  // in both arms and read as a hard task.
  const injectedBlock = await probes.retrieve(goal);

  const reFor = (c) => new RegExp(c.source, c.flags || '');
  const injectedIds = new Set(candidates.filter((c) => reFor(c).test(injectedBlock)).map((c) => c.id));

  // Reference corpus BEFORE coinage, and only if anything survived the (cheap, and nearly vacuous)
  // injection test. Ordering matters for cost: references usually eliminate the over-fitted
  // patterns, and coinage is meaningless for a fact no correct answer would contain anyway.
  const references = injectedIds.size ? await probes.reference(goal) : [];
  const referencedIds = new Set(
    [...injectedIds].filter((id) => {
      const c = candidates.find((x) => x.id === id);
      // EVERY reference, not any — see rule 4. references.length is 0 only when the probe failed
      // outright, in which case nothing is referenced and the task is excluded rather than graded.
      return references.length > 0 && references.every((text) => reFor(c).test(text));
    }),
  );

  const coinage = referencedIds.size ? await probes.coinage(goal) : [];

  const signals = new Map();
  for (const c of candidates) {
    const injected = injectedIds.has(c.id);
    const referenced = referencedIds.has(c.id);
    const re = reFor(c);
    signals.set(c.id, {
      injected,
      referenced,
      coined: referenced && coinage.some((text) => re.test(text)),
      inSandbox: referenced ? await probes.inSandbox(c) : false,
    });
  }

  const { kept, dropped } = selectFacts(candidates, signals);

  // Leak guard: the goal must not contain its own answer.
  const leaked = new Set(goalLeaksFact(goal, kept));
  const surviving = kept.filter((f) => !leaked.has(f.id));
  for (const f of kept) if (leaked.has(f.id)) dropped.push({ ...f, reason: 'leaked-by-goal' });

  if (surviving.length < KEEP_MIN_FACTS) {
    return {
      ...base,
      slug,
      goal,
      status: 'excluded',
      reason: `only ${surviving.length} fact(s) survived the blind filters (need ${KEEP_MIN_FACTS})`,
      dropped,
      injectedChars: injectedBlock.length,
      referenceSamples: references.length,
    };
  }

  const topic = `kbs-${slug}`;
  return {
    ...base,
    slug,
    goal,
    status: 'derived',
    reason: null,
    injectedChars: injectedBlock.length,
    referenceSamples: references.length,
    coinageSamples: coinage.length,
    dropped,
    factSet: {
      topic,
      insightId: insight.id,
      deliverable: `${slug}-runbook.md`,
      goalSummary: picked.symptom,
      facts: surviving.map((f) => ({
        id: f.id, source: f.source, flags: f.flags, required: true, why: f.why, inSandbox: f.inSandbox,
      })),
    },
    spec: {
      experimentId: topic,
      goal,
      taskClass: 'docs',
      testCommand: `node scripts/kb-ab-assert.mjs ${topic}`,
      variants: CELL_VARIANTS.map((v) => ({ ...v })),
    },
  };
}

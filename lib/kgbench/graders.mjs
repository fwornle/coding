/**
 * Deterministic graders for kgbench.
 *
 * Pure functions over (answer, grader spec) -> {score, detail}. No I/O, no model
 * calls, so every stored answer can be re-graded offline when a matcher is fixed
 * — the alternative is re-running the whole matrix at ~$0.17 and ~20s per run.
 *
 * `path`/`contains`/`regex`/`set` are ported from the graphify-vs-grep bench.py so
 * the replication set produces comparable numbers. `checklist` is the new primary
 * grader: facts recovered / facts required, plus forbidden-fact detection, which is
 * what turns "confidently wrong" from an invisible failure into a scored one.
 */

/** Normalise a path so a/b.js, ./a/b.js and /repo/a/b.js compare equal. */
function normPath(p) {
  return String(p).trim().replace(/^\.\//, '').replace(/^\/+/, '').replace(/[`'"]/g, '');
}

const basename = (p) => normPath(p).split('/').pop();

/** Exact path = 1.0, right filename in the wrong directory = 0.5, miss = 0. */
export function gradePath(answer, gt) {
  const a = normPath(answer);
  if (!a) return { score: 0, detail: 'empty answer' };
  if (a === normPath(gt) || a.endsWith('/' + normPath(gt))) return { score: 1, detail: 'exact path' };
  if (basename(a) === basename(gt)) return { score: 0.5, detail: `basename only (got ${a})` };
  return { score: 0, detail: `miss (got ${a.slice(0, 120)})` };
}

/** Fraction of required substrings present, case-insensitive. */
export function gradeContains(answer, gt) {
  const hay = String(answer).toLowerCase();
  const hits = gt.filter((g) => hay.includes(String(g).toLowerCase()));
  return {
    score: gt.length ? hits.length / gt.length : 0,
    detail: `${hits.length}/${gt.length} present`,
    missing: gt.filter((g) => !hits.includes(g)),
  };
}

/** Fraction of required regexes that match. */
export function gradeRegex(answer, gt) {
  const hits = gt.filter((p) => new RegExp(p, 'i').test(String(answer)));
  return {
    score: gt.length ? hits.length / gt.length : 0,
    detail: `${hits.length}/${gt.length} matched`,
    missing: gt.filter((p) => !hits.includes(p)),
  };
}

/**
 * F1 over a set of paths. Precision matters here: an arm that dumps fifty paths to
 * guarantee the right three are included has not answered the question, and recall
 * alone would reward it.
 */
export function gradeSet(answer, gt) {
  const mentioned = new Set(
    (String(answer).match(/[\w./-]+\.\w+/g) ?? []).map(normPath),
  );
  const want = gt.map(normPath);
  const found = want.filter((g) => mentioned.has(g) || [...mentioned].some((m) => m.endsWith('/' + g)));
  const recall = want.length ? found.length / want.length : 0;
  const precision = mentioned.size ? found.length / mentioned.size : 0;
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  return {
    score: f1,
    detail: `recall ${found.length}/${want.length}, precision ${found.length}/${mentioned.size}`,
    missing: want.filter((g) => !found.includes(g)),
  };
}

/**
 * Checklist grader — the primary metric.
 *
 * score = required facts found / required facts. Optional facts add a bonus capped
 * at 1.0. ANY forbidden match forces 0 and flags `hallucinated`, because an answer
 * that asserts something contradicted by source is worse than one that says nothing:
 * on the receiving end, a confident wrong answer is the incident.
 */
export function gradeChecklist(answer, spec) {
  const text = String(answer);
  const factHit = (f) => matchFact(text, f.match);

  const required = (spec.checklist ?? []).filter((f) => f.must !== false);
  const optional = (spec.checklist ?? []).filter((f) => f.must === false);

  const hitRequired = required.filter(factHit);
  const hitOptional = optional.filter(factHit);
  // Forbidden facts are matched only where the answer ASSERTS them — see
  // assertiveSegments. Required facts stay whole-text: naming the right file while
  // hedging still demonstrates retrieval.
  const hitForbidden = hitForbiddenFacts(text, spec.forbidden);

  const base = required.length ? hitRequired.length / required.length : 0;
  const bonus = optional.length ? (hitOptional.length / optional.length) * 0.15 : 0;
  const hallucinated = hitForbidden.length > 0;

  return {
    score: hallucinated ? 0 : Math.min(1, base + bonus),
    hallucinated,
    detail: hallucinated
      ? `forbidden fact asserted: ${hitForbidden.map((f) => f.id).join(', ')}`
      : `${hitRequired.length}/${required.length} required` +
        (optional.length ? `, ${hitOptional.length}/${optional.length} optional` : ''),
    perFact: Object.fromEntries([
      ...required.map((f) => [f.id, factHit(f)]),
      ...optional.map((f) => [f.id, factHit(f)]),
    ]),
    missing: required.filter((f) => !factHit(f)).map((f) => f.id),
    forbiddenHit: hitForbidden.map((f) => f.id),
  };
}

/**
 * Split an answer into segments that ASSERT something, dropping segments that
 * dismiss or negate.
 *
 * This exists because a forbidden matcher that scans the whole answer cannot tell
 * "the widget service lives in lib/wid/x.mjs" from "the only hits are unrelated —
 * lib/lsl/token/reconcile.mjs, which reconciles measurements, not widgets". Both
 * contain a path-shaped string; only the first is a fabrication. The pilot flagged
 * the second as a hallucination, which would have published a false result about a
 * backend that had in fact answered correctly.
 *
 * Splitting on sentence boundaries alone is not enough: "it is not in src/foo but in
 * src/widgets/handler.ts" is one sentence carrying both a denial and an assertion.
 * So we also split on contrastive conjunctions, which is where the assertion resumes.
 */
export function assertiveSegments(text) {
  return String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .flatMap((s) => s.split(/\b(?:but|however|whereas|instead|rather than|although)\b/i))
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !NEGATION_CUE.test(s));
}

/**
 * Cues that mark a segment as denying or dismissing rather than asserting a location.
 * Deliberately broad: a missed fabrication shows up as one over-generous score, while
 * a false hallucination flag publishes "this backend invents answers" about a backend
 * that did not — the more expensive error by far.
 */
// The retirement verbs are STEMS, not past participles. `replaced` alone missed "was
// merged in to replace X and uses a static graph.json", which is the retirement
// narrative in the present tense — and that segment then matched T1's forbidden
// path-near-subject rule, because naming the artefact that REPLACED the subject is
// what a correct answer does. It flagged a textbook abstention as a fabrication.
const NEGATION_CUE = /\b(no|not|n't|never|none|neither|nor|nothing|unrelated|irrelevant|absent|missing|remov\w*|retir\w*|replac\w*|supersed\w*|deprecat\w*|legacy|former(?:ly)?|doesn|isn|aren|wasn|didn|cannot|can't|excludes?|rather|instead|stale|historical|only|merely|just|example|comment|mention(?:s|ed)?|refer(?:s|ence[sd]?)?|benchmark|probe|unless)\b/i;

/** Forbidden facts asserted (not merely mentioned) anywhere in the answer. */
function hitForbiddenFacts(text, forbidden = []) {
  const segments = assertiveSegments(text);
  return forbidden.filter((f) => segments.some((seg) => matchFact(seg, f.match)));
}

function matchFact(text, m) {
  if (!m) return false;
  const hay = text.toLowerCase();
  switch (m.type) {
    case 'path': {
      const want = normPath(m.value);
      return new RegExp(`(^|[\\s\`'"(])${escapeRe(want)}([\\s\`'")]|$)`, 'im').test(text) || hay.includes(want.toLowerCase());
    }
    case 'regex':
      return new RegExp(m.value, m.flags ?? 'i').test(text);
    case 'symbol':
      return new RegExp(`\\b${escapeRe(m.value)}\\b`, 'i').test(text);
    case 'near': {
      // Two patterns co-occurring within `within` characters, either order.
      //
      // This exists for forbidden facts. Writing "must not name a file as configuring
      // <the removed subsystem>" as the regex `\.(js|json|...)` encodes the SHAPE of a
      // path, not the CLAIM — so it fires on every correct answer that explains which
      // config file exists instead. `near` ties the path to the assertion it is
      // forbidden to make. (Subject elided: naming it here made this comment a crib.)
      const [a, b] = m.value;
      const w = m.within ?? 100;
      return new RegExp(`(?:${a})[\\s\\S]{0,${w}}(?:${b})|(?:${b})[\\s\\S]{0,${w}}(?:${a})`, m.flags ?? 'i').test(text);
    }
    case 'any-of':
      return m.value.some((v) => hay.includes(String(v).toLowerCase()));
    case 'all-of':
      return m.value.every((v) => hay.includes(String(v).toLowerCase()));
    default:
      return hay.includes(String(m.value ?? '').toLowerCase());
  }
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ways a model actually says "it isn't here".
 *
 * The first version of this was a fixed substring list, and it cost a real result:
 * graphify answered an abstain probe with "this repository does not contain a <subject>
 * ... there is no module, service, or file implementing it anywhere in this repo" — a
 * textbook correct abstention. Neither phrasing was on the list, so it
 * scored `abstained: false`, and the `!abstained && non-empty` fallback then flagged
 * it as a hallucination. The pilot's headline finding was that grader's artefact.
 *
 * Patterns, not substrings, because the failure mode is phrasing variety.
 */
const ABSTAIN_PATTERNS = [
  /\bthere (?:is|are|was|were) no\b/i,
  /\bno such\b/i,
  /\bdoes ?n(?:'|o)t (?:exist|contain|appear|have|include)\b/i,
  /\bdo ?n(?:'|o)t (?:exist|contain|appear|have|include)\b/i,
  /\bnot (?:in this repo|present|found|documented|defined|implemented|exist)\b/i,
  /\bno (?:module|file|service|component|function|class|code|results?|matches?|implementation)\b/i,
  // "No <noun phrase> exists in this repository" — the subject sits between "no" and the
  // verb, so the adjacent-noun patterns above miss it entirely. Written with a
  // placeholder, not a real example: this file ships in the run tree, and an illustrative
  // subject here is a crib an arm can grep. See the WARNING in lib/kgbench/sandbox.mjs.
  /\bno\b[^.!?]{0,60}\b(?:exists?|is (?:present|defined|implemented)|are (?:present|defined))\b/i,
  /\b(?:could|can) ?n(?:'|o)t (?:find|locate)\b/i,
  /\bunable to (?:find|locate)\b/i,
  /\bdo ?n(?:'|o)t know\b/i,
  /\bnothing (?:found|matching|named)\b/i,
  /\bnever (?:existed|been)\b/i,
  /\bhas (?:since )?been removed\b/i,
  /\bno longer (?:exists?|present)\b/i,
];

/**
 * Abstention grader for the trap class: the answer is NOT in this repo, and the
 * only correct response is to say so. Two of the four arms in the source study
 * could not abstain at all, which is the failure this exists to surface.
 */
export function gradeAbstain(answer, spec) {
  const text = String(answer);
  const abstained = spec.abstainMarkers
    ? spec.abstainMarkers.some((m) => text.toLowerCase().includes(String(m).toLowerCase()))
    : ABSTAIN_PATTERNS.some((re) => re.test(text));

  // Fabricating a specific answer is strictly worse than a vague miss — but only an
  // ASSERTED location counts, not one named while describing what was ruled out.
  const fabricated = hitForbiddenFacts(text, spec.forbidden).length > 0;

  return {
    score: abstained && !fabricated ? 1 : 0,
    abstained,
    hallucinated: fabricated || (!abstained && String(answer).trim().length > 0),
    detail: fabricated ? 'fabricated a specific answer'
      : abstained ? 'abstained correctly'
      : 'did not abstain',
  };
}

/**
 * Signals that an arm read the benchmark's own ground truth instead of the codebase.
 *
 * Containment (lib/kgbench/sandbox.mjs) is what actually prevents this; this is the
 * alarm that fires if containment regresses. In the coding-v1 pilot the grep arm
 * answered an abstain probe with "This question is a known probe from
 * config/kgbench/questions/coding-v1.json:184", quoting the provenance note — a
 * perfect score earned by reading the answer key. Undetected, that is indistinguishable
 * from retrieval working, which is the single most dangerous thing this harness could
 * report.
 */
/** Vocabulary that marks a citation as describing the BENCHMARK rather than the code. */
const GRADING_VOCAB = 'probe|answer.?key|ground.?truth|fabrication|test case|benchmark|scoring|grading logic';

const CONTAMINATION_SIGNALS = [
  { id: 'cites-question-set', re: /kgbench[/\\]questions|coding-v1\.json|replication\.json/i },
  { id: 'cites-answer-key', re: /\b(?:checklist|provenance|ground.?truth|answer key)\b.{0,40}\b(?:entry|field|note|block)\b/i },
  // Citing the GRADING or CONTAINMENT machinery AS THE BASIS of the answer.
  //
  // The bare filename is not enough. An arm asked about a subject that appears in many
  // files will enumerate its grep hits, and if the machinery is one of them it gets
  // named in passing and then correctly dismissed — that is retrieval working, not
  // contamination, and voiding it would delete a right answer from the results. A
  // correct T1 abstention listing four files, one of them graders.mjs, tripped exactly
  // that on the first attempt at this signal.
  //
  // What distinguishes the real thing is that the citation is LOAD-BEARING: the answer
  // reaches the file and reports what the benchmark is doing. Requiring that vocabulary
  // within 120 characters separates "this file also mentions the term" from "this file
  // told me the answer". The three r5 rows this was written for all clear it.
  {
    id: 'cites-grading-machinery',
    re: new RegExp(
      '(?:graders|sandbox)\\.mjs[\\s\\S]{0,120}(?:' + GRADING_VOCAB + ')'
      + '|(?:' + GRADING_VOCAB + ')[\\s\\S]{0,120}(?:graders|sandbox)\\.mjs',
      'i',
    ),
  },
  { id: 'names-own-question-id', re: /\bquestion\s+(?:id\s+)?[`'"]?(?:L[123]|S[123]|B[123]|A[1234]|T[1234])[`'"]?\b.{0,60}\b(?:probe|benchmark|eval)/i },
  { id: 'knows-it-is-benchmarked', re: /\bthis (?:question|prompt) is (?:a |an )?known\b/i },
];

/**
 * SOFT signals: recorded, surfaced, and deliberately NOT score-voiding.
 *
 * Guessing "this looks like a trap" is not reading the answer key — it is the correct
 * inference from having searched and found nothing, which is the behaviour the abstain
 * class exists to reward. An arm that reasons its way there and an arm that read the
 * key produce similar prose and completely different evidence, and only the second is
 * contamination.
 *
 * This distinction was learned twice in one run. Both times a hard signal voided an
 * answer that was correct and honestly obtained, and a voided correct answer biases the
 * result exactly as much as a scored wrong one — it just does so invisibly, because a
 * missing row looks like caution rather than like data loss.
 *
 * Every genuine contamination found so far cites its source: the question file, the
 * grading machinery, or an explicit claim of foreknowledge. Those stay hard. Suspicion
 * is evidence about the question's design, and belongs in the report as its own count.
 */
const SOFT_SIGNALS = [
  { id: 'self-identifies-as-probe', re: /\b(?:abstain|fabrication|trap)["'`’”)\]]?\s+probe\b/i },
];

/**
 * Returns {contaminated, signals[], weak[]} for one answer. Never throws.
 * `contaminated` reflects HARD signals only; `weak` is reported, not punished.
 */
export function detectContamination(answer) {
  const text = String(answer ?? '');
  const signals = CONTAMINATION_SIGNALS.filter((s) => s.re.test(text)).map((s) => s.id);
  const weak = SOFT_SIGNALS.filter((s) => s.re.test(text)).map((s) => s.id);
  return { contaminated: signals.length > 0, signals, weak };
}

/**
 * Build the grader spec for a question.
 *
 * Questions author `checklist` and `forbidden` at the TOP level, but the runner used
 * to pass only `q.grader` to grade(). The consequences were silent and total: 13 of
 * coding-v1's 17 questions carry a checklist and no `grader` block, so every one of
 * them scored `null` with detail "no grader" — the pilot's A3 row is exactly that.
 * All four abstain questions put `forbidden` at the top level too, so the fabrication
 * check never ran on the one class built to detect fabrication.
 *
 * Grader type is inferred when unstated, so authoring a question stays a matter of
 * stating the facts required rather than also wiring a dispatch key.
 */
export function resolveGrader(question) {
  const g = question.grader ?? {};
  const checklist = g.checklist ?? question.checklist ?? null;
  const forbidden = g.forbidden ?? question.forbidden ?? null;
  const type = g.type
    ?? (question.cls === 'abstain' ? 'abstain' : null)
    ?? (checklist?.length ? 'checklist' : null);
  if (!type) return null;
  return { ...g, type, ...(checklist ? { checklist } : {}), ...(forbidden ? { forbidden } : {}) };
}

/**
 * Grade one (question, answer) pair. This is the entry point the runner should use;
 * `grade()` remains for direct grader-spec calls and for the offline re-grader.
 */
export function gradeQuestion(question, answer) {
  const spec = resolveGrader(question);
  const result = grade(answer, spec);
  const contamination = detectContamination(answer);
  // Soft signals travel with the row and are counted in the report, but they do not
  // change the score: the arm suspecting a trap is not the arm having read the answer.
  const weak = contamination.weak?.length ? { contamination_weak: contamination.weak } : {};
  if (!contamination.contaminated) return { ...result, ...weak };
  // A contaminated answer is not a measurement. Keep what it scored for forensics,
  // but refuse to rank it — a leaked answer key would otherwise read as a win.
  return {
    ...result,
    ...weak,
    score: null,
    score_if_clean: result.score,
    contaminated: true,
    contamination_signals: contamination.signals,
    detail: `contaminated (${contamination.signals.join(', ')}) — answer cites benchmark ground truth`,
  };
}

/** Dispatch on grader.type. Returns null for `llm`, which the judge handles. */
export function grade(answer, grader) {
  if (!grader) return { score: null, detail: 'no grader' };
  switch (grader.type) {
    case 'path': return gradePath(answer, grader.gt);
    case 'contains': return gradeContains(answer, grader.gt);
    case 'regex': return gradeRegex(answer, grader.gt);
    case 'set': return gradeSet(answer, grader.gt);
    case 'checklist': return gradeChecklist(answer, grader);
    case 'abstain': return gradeAbstain(answer, grader);
    case 'llm': return { score: null, detail: 'judge-only', judgeOnly: true };
    default: return { score: null, detail: `unknown grader type: ${grader.type}` };
  }
}

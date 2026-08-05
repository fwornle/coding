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
  const hitForbidden = (spec.forbidden ?? []).filter(factHit);

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
 * Abstention grader for the trap class: the answer is NOT in this repo, and the
 * only correct response is to say so. Two of the four arms in the source study
 * could not abstain at all, which is the failure this exists to surface.
 */
export function gradeAbstain(answer, spec) {
  const text = String(answer).toLowerCase();
  const abstained = (spec.abstainMarkers ?? [
    'not in this repo', 'not present', 'could not find', "couldn't find", 'no such',
    'does not exist', "doesn't exist", 'not found', 'unable to find', 'i don\'t know',
    'not documented', 'no results',
  ]).some((m) => text.includes(m.toLowerCase()));

  // Fabricating a specific answer is strictly worse than a vague miss.
  const fabricated = (spec.forbidden ?? []).some((f) => matchFact(String(answer), f.match));

  return {
    score: abstained && !fabricated ? 1 : 0,
    abstained,
    hallucinated: fabricated || (!abstained && String(answer).trim().length > 0),
    detail: fabricated ? 'fabricated a specific answer'
      : abstained ? 'abstained correctly'
      : 'did not abstain',
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

/**
 * Containment contract for kgbench.
 *
 * The pilot's grep arm scored 1.00 on an abstain probe by reading that probe's entry
 * in config/kgbench/questions/coding-v1.json. A leaked answer key yields CORRECT
 * answers, so contamination cannot be spotted in the scores — it has to be prevented
 * structurally and then verified. These tests pin the verification, not the worktree
 * mechanics: building a real worktree takes ~50s and does not belong in lite CI.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM: no __dirname. The repo root is two levels up from tests/integration/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  leakNeedles, scanTreeForLeaks, classifyLeaks, DEFAULT_EXCLUDES, indexCoverageProblems,
} from '../../lib/kgbench/sandbox.mjs';
import { loadArms, resolveArms, REPO_ROOT as REPO } from '../../lib/kgbench/arms.mjs';

const QUESTIONS = [
  {
    id: 'T3',
    prompt: 'Which module implements the payment reconciliation service in this repository? '
      + 'Reply with the repo-relative path, or state clearly that it does not exist.',
    provenance: { note: 'Plausible-sounding subsystem that has never existed here. Pure fabrication probe.' },
  },
  { id: 'L1', prompt: 'Which file defines the shell variable MANAGED_MCP_KEYS, and what is its purpose?' },
];

describe('leakNeedles', () => {
  it('drops the shared "Reply with..." boilerplate so questions do not match each other', () => {
    const texts = leakNeedles(QUESTIONS).filter((x) => x.id === 'prompt:T3').map((x) => x.text);
    expect(texts.join(' | ')).toContain('payment reconciliation');
    for (const t of texts) expect(t.toLowerCase()).not.toContain('reply with');
  });

  it('emits overlapping windows, not one prefix — a paraphrase shares the middle, not the opening', () => {
    const texts = leakNeedles(QUESTIONS).filter((x) => x.id === 'prompt:T3').map((x) => x.text);
    expect(texts.length).toBeGreaterThan(1);
    // Verified against the real leak: .data/knowledge-graph/exports/general.json and
    // observations.json contain this window, but not the prompt's opening words.
    expect(texts).toContain('the payment reconciliation service in');
  });

  it('probes provenance notes too — the pilot leak quoted a note, not a prompt', () => {
    expect(leakNeedles(QUESTIONS).map((n) => n.id)).toContain('note:T3');
  });

  it('does not probe for the question-set PATH, which harness source legitimately names', () => {
    // lib/kgbench/arms.mjs builds 'config/kgbench/questions/...' and is itself ground
    // truth for one question. A path reference is not a content leak.
    expect(leakNeedles(QUESTIONS).map((n) => n.text)).not.toContain('kgbench/questions');
  });
});

describe('scanTreeForLeaks', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'kgb-scan-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('passes a tree that contains the ANSWER but not the QUESTION', () => {
    // install.sh genuinely defines MANAGED_MCP_KEYS — containment must not remove the
    // thing the arms are supposed to find.
    writeFileSync(path.join(dir, 'install.sh'), 'MANAGED_MCP_KEYS=(a b c)\n');
    expect(scanTreeForLeaks(dir, QUESTIONS)).toEqual([]);
  });

  it('catches the answer key itself', () => {
    mkdirSync(path.join(dir, 'config'), { recursive: true });
    writeFileSync(path.join(dir, 'config/coding-v1.json'), JSON.stringify(QUESTIONS));
    const hits = scanTreeForLeaks(dir, QUESTIONS);
    expect(hits.map((h) => h.needle)).toContain('prompt:T3');
  });

  it('catches a prompt echoed by telemetry, which is how this actually leaked', () => {
    // .data/observation-export/observations.json recorded the session in which these
    // questions were written. A project that observes itself re-contaminates itself.
    mkdirSync(path.join(dir, '.data'), { recursive: true });
    writeFileSync(
      path.join(dir, '.data/observations.json'),
      JSON.stringify([{ text: 'discussed the payment reconciliation service in this repository probe' }]),
    );
    expect(scanTreeForLeaks(dir, QUESTIONS).length).toBeGreaterThan(0);
  });
});

describe('classifyLeaks — an echo of the question vs the codebase\'s own vocabulary', () => {
  const windows = leakNeedles(QUESTIONS).filter((n) => n.id === 'prompt:T3').length;

  it('treats one or two adjacent windows as vocabulary overlap, not a leak', () => {
    // Real case: B2 asks about "the LLM proxy on port 12435", and CostTab.tsx says the
    // same thing because that is what this project calls it. Blocking on that would
    // make the benchmark unrunnable for any question phrased in the codebase's terms.
    const hits = [{ needle: 'prompt:T3', text: 'a', files: ['src/CostTab.tsx'] }];
    const { leaks, weak } = classifyLeaks(hits, QUESTIONS);
    expect(leaks).toHaveLength(0);
    expect(weak).toHaveLength(1);
  });

  it('flags a file that echoes most of the prompt', () => {
    // How the real leak looked: general.json matched every window of A3, T1 and T3.
    const hits = Array.from({ length: windows }, (_, i) => (
      { needle: 'prompt:T3', text: `w${i}`, files: ['.data/exports/general.json'] }
    ));
    const { leaks } = classifyLeaks(hits, QUESTIONS);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].ratio).toBe(1);
  });
});

describe('DEFAULT_EXCLUDES', () => {
  it('removes the answer key and the telemetry exports', () => {
    expect(DEFAULT_EXCLUDES).toContain('config/kgbench/questions');
    expect(DEFAULT_EXCLUDES).toContain('.data');
  });

  it('does NOT remove config/kgbench wholesale — arms.json is a question\'s ground truth', () => {
    expect(DEFAULT_EXCLUDES).not.toContain('config/kgbench');
    expect(DEFAULT_EXCLUDES).not.toContain('lib/kgbench');
  });

  it('removes agent rule files — abspath escape hatch and per-arm tool bias', () => {
    // CLAUDE.md tells agents to prefer the graphify skill over greps, which is a thumb
    // on the scale for one arm, and carries absolute paths back out of the sandbox.
    expect(DEFAULT_EXCLUDES).toContain('CLAUDE.md');
    expect(DEFAULT_EXCLUDES).toContain('.claude');
  });
});

// ---------------------------------------------------------------------------
// Leak #5: the harness quoting its own questions.
//
// A comment in runner.mjs reproduced L1's prompt verbatim and named the file that is L1's
// answer. runner.mjs is B2's and A2's ground truth, so it CANNOT be excluded — it has to stay
// readable and be clean. The scanner saw it and let it through: two of L1's five windows
// matched, `minWindows` is three, so it was filed as `weak` and the run proceeded. Every arm
// that grepped L1's subject was handed the answer by the harness grading it.
//
// These pin the mechanical control, because prose discipline demonstrably does not hold here:
// the first fix kept the sentence frame and still matched, and the comment written to explain
// THAT put the frame back in the tree.
// ---------------------------------------------------------------------------

describe('a question\'s wording must never appear in harness source that reaches the arms', () => {
  const REPO = path.resolve(__dirname, '..', '..');

  // Every file the arms can read that belongs to the benchmark itself.
  function harnessFilesInTree() {
    const dirs = [['lib', 'kgbench'], ['scripts']];
    const out = [];
    for (const parts of dirs) {
      const abs = path.join(REPO, ...parts);
      let entries = [];
      try { entries = readdirSync(abs); } catch { continue; }
      for (const f of entries) {
        const rel = [...parts, f].join('/');
        if (parts[0] === 'scripts' && !f.startsWith('kgbench-')) continue;
        if (!/\.(mjs|js|sh)$/.test(f)) continue;
        if (DEFAULT_EXCLUDES.includes(rel)) continue;   // never reaches the tree
        out.push(rel);
      }
    }
    return out;
  }

  function liveQuestions() {
    const sets = ['coding-v1', 'replication'];
    return sets.flatMap((s) => {
      const doc = JSON.parse(readFileSync(path.join(REPO, 'config/kgbench/questions', `${s}.json`), 'utf8'));
      return doc.questions ?? doc;
    });
  }

  it('no harness file that reaches the arms quotes any live question prompt', () => {
    const needles = leakNeedles(liveQuestions());
    const offenders = [];
    for (const rel of harnessFilesInTree()) {
      const txt = readFileSync(path.join(REPO, rel), 'utf8');
      const hit = needles.filter((n) => txt.includes(n.text));
      if (hit.length) offenders.push(`${rel} → ${[...new Set(hit.map((h) => h.id))].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('classifies ANY harness-source hit as decisive, however few windows match', () => {
    const qs = liveQuestions().filter((q) => q.id === 'L1');
    // The exact historical hit: 2 of 5 windows, under the 3-window threshold.
    const hits = [
      { needle: 'prompt:L1', text: 'Which file defines the shell', files: ['lib/kgbench/runner.mjs'] },
      { needle: 'prompt:L1', text: 'file defines the shell variable', files: ['lib/kgbench/runner.mjs'] },
    ];
    const { leaks, weak } = classifyLeaks(hits, qs);
    expect(leaks).toHaveLength(1);
    expect(weak).toHaveLength(0);
    expect(leaks[0].reason).toMatch(/harness source/);
    // Below the threshold — it is decisive because of WHERE it is, not how much matched.
    expect(leaks[0].matched).toBeLessThan(3);
  });

  it('still tolerates the same overlap in ordinary repo prose', () => {
    // The thresholds exist for this: a repo's docs share vocabulary with questions about that
    // repo. Making harness hits decisive must not make every coincidence decisive.
    const qs = liveQuestions().filter((q) => q.id === 'L1');
    const hits = [
      { needle: 'prompt:L1', text: 'Which file defines the shell', files: ['docs/some-guide.md'] },
      { needle: 'prompt:L1', text: 'file defines the shell variable', files: ['docs/some-guide.md'] },
    ];
    const { leaks, weak } = classifyLeaks(hits, qs);
    expect(leaks).toHaveLength(0);
    expect(weak).toHaveLength(1);
  });

  it('does not fire on an EXCLUDED harness file — it never reaches the tree', () => {
    // graders.mjs is full of question wording by design. It is excluded, so nothing can read
    // it, and treating it as a leak would fail containment on a file whose point is absence.
    const qs = liveQuestions().filter((q) => q.id === 'L1');
    const hits = [
      { needle: 'prompt:L1', text: 'Which file defines the shell', files: ['lib/kgbench/graders.mjs'] },
    ];
    const { leaks } = classifyLeaks(hits, qs);
    expect(leaks).toHaveLength(0);
  });
});

describe('the agent adapters are withheld from the tree', () => {
  it('excludes agents.mjs — it addresses the model that is searching the tree', () => {
    // It carries the answer-file directive verbatim. opencode found it, called it a
    // prompt-injection attempt, and refused it; copilot complied 96 times; claude never sees
    // it. One agent penalised by an artifact of the harness is a broken comparison.
    expect(DEFAULT_EXCLUDES).toContain('lib/kgbench/agents.mjs');
  });

  it('keeps runner.mjs and arms.mjs IN the tree — they are questions\' ground truth', () => {
    // The tempting fix (exclude everything under lib/kgbench) would make B2, A2 and B1
    // unanswerable and score every arm 0 on them — which reads as a finding about the arms.
    expect(DEFAULT_EXCLUDES).not.toContain('lib/kgbench/runner.mjs');
    expect(DEFAULT_EXCLUDES).not.toContain('lib/kgbench/arms.mjs');
    expect(DEFAULT_EXCLUDES).not.toContain('lib/kgbench/report.mjs');
  });
});

/**
 * THE CODE-GRAPH INDEX MUST DESCRIBE THE TREE UNDER TEST.
 *
 * Every run up to and including r8 served the codegraph arm an index of the MAIN WORKING
 * TREE, because the arms' worktree lives under os.tmpdir() and the container that hosts the
 * index server mounts only ${HOME}/Agentic. The arm therefore either found no index at all
 * (>=30 of 172 cells said so in as many words) or answered about a different corpus than every
 * other arm searched — and the preflight passed throughout, because it only asked whether an
 * index FILE existed on the host.
 *
 * These pin the policy, not the 40-second build.
 */
describe('index coverage is a gate, not an assumption', () => {
  const PROJECT = '/coding/.data/kgbench/trees/demo/index';
  const healthy = { initialized: true, fileCount: 1600, nodeCount: 27000, projectPath: PROJECT };

  it('passes a healthy index of the right project', () => {
    expect(indexCoverageProblems(healthy, { project: PROJECT })).toEqual([]);
  });

  it('catches the exact failure the benchmark shipped: an index of the WRONG project', () => {
    // Initialized, populated, and describing /workspace/coding instead of the run tree.
    // Nothing about this is detectable from the score — the arm just answers about a repo
    // the other arms are not searching, and does it fluently.
    const wrong = { ...healthy, projectPath: '/workspace/coding' };
    const problems = indexCoverageProblems(wrong, { project: PROJECT });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/describes \/workspace\/coding, expected/);
  });

  it('catches an uninitialized project — what `docker exec` cwd /coding actually returns', () => {
    const problems = indexCoverageProblems({ initialized: false, projectPath: '/coding' }, { project: PROJECT });
    expect(problems.some((p) => /not initialized/.test(p))).toBe(true);
  });

  it('catches an index that is initialized but empty', () => {
    const problems = indexCoverageProblems({ ...healthy, fileCount: 0 }, { project: PROJECT });
    expect(problems.some((p) => /covers 0 files/.test(p))).toBe(true);
  });

  it('treats a missing status as a problem rather than a pass', () => {
    // A `codegraph status` that returns nothing must not read as "no problems found".
    expect(indexCoverageProblems(null, { project: PROJECT })).toHaveLength(1);
    expect(indexCoverageProblems(undefined, { project: PROJECT })).toHaveLength(1);
  });
});

describe('the codegraph MCP server is pinned to a project', () => {
  it('defaults to the production project when nothing is set', () => {
    // Unset is the --no-sandbox case and the production case. It must NOT fall back to the
    // container cwd /coding, which holds no index — that was the standing bug.
    const [arm] = resolveArms(loadArms(REPO), ['codegraph'], { repoRoot: REPO, env: { PATH: process.env.PATH } });
    expect(arm.mcpConfig.mcpServers.codegraph.args).toEqual(
      expect.arrayContaining(['-p', '/workspace/coding']),
    );
  });

  it('serves the run tree when kgbench pins one', () => {
    const project = '/coding/.data/kgbench/trees/demo/index';
    const env = { ...process.env, CODEGRAPH_PROJECT_DIR: project };
    const [cg, hy] = resolveArms(loadArms(REPO), ['codegraph', 'hybrid'], { repoRoot: REPO, env });
    // BOTH arms, not just the codegraph one. hybrid grants the same tool, and 14 of the 17
    // graph calls behind the tool-choice result went to it — so a fix that reached only the
    // single-backend arm would leave the headline claim measured against a broken server.
    expect(cg.mcpConfig.mcpServers.codegraph.args).toEqual(expect.arrayContaining(['-p', project]));
    expect(hy.mcpConfig.mcpServers.codegraph.args).toEqual(expect.arrayContaining(['-p', project]));
  });

  it('never leaves the project implicit', () => {
    const [arm] = resolveArms(loadArms(REPO), ['codegraph'], { repoRoot: REPO });
    expect(arm.mcpConfig.mcpServers.codegraph.args).toContain('-p');
  });
});

describe('the index containment check keys on the artefact, not a mention of it', () => {
  // The check that proves the codegraph index is the SANDBOX tree and not the main working
  // tree used to grep the free text of `codegraph explore judgeAnswer` for
  // "lib/kgbench/judge.mjs". That string is in an IMPORT inside scripts/kgbench-run.mjs —
  // a file sandbox.mjs deliberately KEEPS, because it is B2's ground truth. So the probe
  // could not tell "judge.mjs is indexed" from "a corpus file names judge.mjs", and it
  // refused a legitimate run at an older commit whose exclusion set is smaller.
  const runner = readFileSync(path.join(REPO, 'scripts/kgbench-run.mjs'), 'utf8');

  it('the corpus really does contain a file that names the excluded path', () => {
    // If this ever stops being true the regression below is no longer meaningful, and the
    // retired regex would look safe again to whoever reads it next.
    expect(runner).toMatch(/from '\.\.\/lib\/kgbench\/judge\.mjs'/);
    expect(DEFAULT_EXCLUDES).not.toContain('scripts/kgbench-run.mjs');
  });

  it('the retired text probe false-positives on that import', () => {
    const importLine = "import { judgeAnswer } from '../lib/kgbench/judge.mjs';";
    expect(/lib\/kgbench\/judge\.mjs/.test(importLine)).toBe(true);
  });

  it('the check now tests the filesystem for every removed path', () => {
    // `test -e` per exclusion cannot be satisfied by a coincidence of text, and it covers
    // the whole exclusion set rather than one symbol — strictly stronger than what it replaced.
    expect(runner).toMatch(/tree\.removed \?\? \[\]/);
    expect(runner).toMatch(/'test', '-e'/);
    expect(runner).not.toMatch(/codegraph', 'explore', 'judgeAnswer'/);
  });
});

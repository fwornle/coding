// lib/experiments/cell-injection.mjs
//
// Live KB injection for EXPERIMENT cells (kb-on axis). The experiment runner launches each agent's
// raw binary directly (agent-headless.argvForAgent), so it never goes through the interactive
// launch-agent-common.sh `_inject_knowledge_context` seam — i.e. cells got NO live injection for
// ANY agent, and the claude UserPromptSubmit hook does not fire under `claude -p`. This module
// closes that gap: for a kb-on cell it fetches the GATED knowledge from the host retrieval endpoint
// (obs-api /api/retrieve — same IDF-floor + LLM-judge + WM-suppression + fail-closed path every
// other seam uses, keyed by the composite task_id so it is treated as an experiment cell) and
// injects it via each agent's native channel:
//
//   • claude   → `--append-system-prompt "<knowledge>"` appended to the launch argv (clean
//                separation of injected context from the task; never touches the neutralized
//                sandbox CLAUDE.md).
//   • opencode → <worktree>/.opencode/knowledge-context.md
//   • copilot  → <worktree>/.github/copilot-instructions.md
//   • pi       → argv (--append-system-prompt), same channel as claude
//
// A trivial task (fizzbuzz) retrieves nothing (the judge rejects the topical-but-useless coding KB
// matches) → empty markdown → nothing injected. FAIL-OPEN: any retrieval error yields '' → the cell
// simply runs without injection (never blocks the cell).

import fs from 'node:fs';
import path from 'node:path';

/** Per-agent context-file destinations (relative to the sandbox worktree). null → argv channel. */
const CONTEXT_FILES = {
  opencode: path.join('.opencode', 'knowledge-context.md'),
  copilot: path.join('.github', 'copilot-instructions.md'),
};

/**
 * Fetch gated knowledge for a cell from the host retrieval endpoint. Returns the injectable
 * markdown, or '' on empty result / any error (fail-open).
 *
 * @param {object} p
 * @param {string} p.goal    the cell goal (used as the retrieval query — the real task signal)
 * @param {string} p.taskId  the composite cell task_id ('<exp>--<variant>--rN') → experiment gate
 * @param {string} p.agent   agent name (for per-agent RRF profile in retrieval)
 * @param {string} p.worktree sandbox cwd (retrieval context only)
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<string>}
 */
export async function retrieveCellKnowledge({ goal, taskId, agent, worktree }, deps = {}) {
  const { fetchImpl = fetch, timeoutMs = 13000 } = deps;
  try {
    const port = process.env.OBS_API_PORT || '12436';
    const resp = await fetchImpl(`http://localhost:${port}/api/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: String(goal || '').slice(0, 500), // obs-api rejects > 500 chars
        // 3000, not 1000. The retrieval service's `defaultBudget` was dead config — every caller
        // passed this literal, so raising the default alone changed nothing. Sized so ~3 COMPLETE
        // insights fit: a p90 insight preview is 3,300 chars (~825 tokens) after the 2026-08-23
        // re-index. Was 1000, of which a hidden `Math.min(..., 700)` clamp made only 700 usable.
        budget: 3000,
        threshold: 0.70,
        context: { project: 'coding', agent, cwd: worktree },
        task_id: taskId,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return '';
    const data = await resp.json();
    const count = data && data.meta ? data.meta.results_count : 0;
    return count > 0 && data.markdown ? String(data.markdown) : '';
  } catch {
    return ''; // fail-open — a retrieval outage must never block the cell
  }
}

/**
 * Retrieve gated knowledge for a kb-on cell and inject it via the agent's native channel.
 * Returns extra launch-argv (claude) and whether/where anything was injected.
 *
 * @param {object} p  { agent, goal, taskId, worktree }
 * @param {object} [deps] { fetchImpl, writeFileImpl, mkdirImpl, timeoutMs }
 * @returns {Promise<{ argvExtra: string[], injectedChars: number, target: string|null }>}
 */
export async function injectCellKnowledge({ agent, goal, taskId, worktree }, deps = {}) {
  const {
    writeFileImpl = fs.writeFileSync,
    mkdirImpl = fs.mkdirSync,
  } = deps;

  const md = await retrieveCellKnowledge({ goal, taskId, agent, worktree }, deps);
  if (!md || !md.trim()) return { argvExtra: [], injectedChars: 0, target: null };

  // claude: inject as an appended system prompt (argv). spawn() takes an argv ARRAY, so the
  // markdown is a single opaque element — no shell-injection surface.
  // pi joins claude on the argv channel. It COULD take a context file — it reads
  // AGENTS.md from the cwd — but writing one into the sandbox worktree would alter
  // the repository the agent is being measured on, which confounds the very thing
  // the experiment compares. --append-system-prompt leaves the tree untouched.
  if (agent === 'claude' || agent === 'pi') {
    return { argvExtra: ['--append-system-prompt', md], injectedChars: md.length, target: 'append-system-prompt' };
  }

  // opencode / copilot: write the agent's context file into the sandbox cwd.
  const rel = CONTEXT_FILES[agent];
  if (!rel) return { argvExtra: [], injectedChars: 0, target: null };
  const abs = path.join(worktree, rel);
  mkdirImpl(path.dirname(abs), { recursive: true });
  writeFileImpl(abs, md, 'utf8');
  return { argvExtra: [], injectedChars: md.length, target: rel };
}

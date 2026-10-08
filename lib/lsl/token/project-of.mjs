/**
 * The project id (token_usage.project) for the working directory a session ran in.
 *
 * The row builders read a cwd from each source's own record — a Claude transcript
 * line's `cwd`, a copilot session's `session.start` context, an opencode message's
 * `path.root` — and map it through the same projectIdFor the ETM stamps
 * observations with (via repo-router.teamForPath, which walks up to the repo root
 * first), so a repo's tokens and its knowledge carry one id.
 *
 * Not from ~/.claude/projects/<encoded-cwd>: that encoding turns `/`, `.` and `_`
 * all into `-` and cannot be decoded.
 *
 * Memoised per process: a transcript repeats one cwd on every line.
 */
import path from 'node:path';
import { teamForPath } from '../../attribution/repo-router.mjs';

const memo = new Map();

/**
 * @param {unknown} cwd an absolute directory
 * @returns {string} the project id, or '' when unknown / outside any repo
 */
export function projectOfCwd(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return '';
  if (memo.has(cwd)) return memo.get(cwd);
  let project = '';
  try { project = teamForPath(cwd) || ''; } catch { project = ''; }
  memo.set(cwd, project);
  return project;
}

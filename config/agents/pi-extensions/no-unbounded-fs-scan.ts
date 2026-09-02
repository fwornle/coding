/**
 * Refuse whole-filesystem scans, and say what to do instead.
 *
 * ── The incident ────────────────────────────────────────────────────────────
 * 2026-09-02: a file had been deliberately deleted. Asked about it, pi ran
 *
 *     find / -name "number_classifier.py" 2>/dev/null
 *
 * which took 343 SECONDS and found the file in ~/.Trash. The turn read as "the
 * agent hung for five minutes"; the LLM itself accounted for 9.2s of it across
 * four calls. Nothing was wrong with routing, the model, or the proxy — one
 * shell command was 97% of the wall clock.
 *
 * The judgement error is small and very repeatable: a file is not where it was
 * expected, so widen the search. Widening from the project to the entire
 * volume is never the right next step. If it is not in the project, the useful
 * answer is "it is not in the project" — which is information the caller wants
 * — not a four-minute walk of every inode on the disk, /System and network
 * mounts included.
 *
 * ── Why an extension and not a line in AGENTS.md ────────────────────────────
 * Both, actually: the AGENTS.md note states the convention, and this enforces
 * it. A prompt-level instruction competes with the model's own reasoning at the
 * moment the model is already improvising, which is exactly when it loses. This
 * is a deterministic gate — the pi equivalent of a PreToolUse hook.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 * It does not rewrite the command to a narrower root. That would silently
 * answer a different question than the one asked, and the model would never
 * learn the search was too broad. Blocking with a reason puts the correction in
 * the transcript where the model reads it and adapts — observed to work: it
 * goes to the project, or to ~/.Trash, on the next call.
 *
 * It does not touch scans with a specific root. `find ~/.config/pi -name '*.json'`
 * is bounded and fine. Only the roots that mean "everything" are refused.
 */

import { isToolCallEventType } from '@earendil-works/pi-coding-agent'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Roots whose traversal is unbounded in practice. `/Users` and `$HOME` are here
 * with `/`: on a developer laptop the home directory holds node_modules, caches
 * and cloud-sync folders, so it is the same walk with a smaller prefix.
 */
function unboundedRoots(): string[] {
  const home = os.homedir()
  return [
    '/', '/Users', '/home', '/System', '/Volumes', '/private', '/var', '/opt', '/Applications',
    home,
  ]
}

/** Strip one layer of quoting so `find "/"` is read the same as `find /`. */
function unquote(tok: string): string {
  if (tok.length >= 2 && ((tok[0] === '"' && tok.endsWith('"')) || (tok[0] === "'" && tok.endsWith("'")))) {
    return tok.slice(1, -1)
  }
  return tok
}

/**
 * The search roots a `find` invocation would walk.
 *
 * `find` takes paths BEFORE its first expression operator, so everything from
 * argv[1] up to the first token starting with `-` (or one of the operator
 * words) is a root. Anything after is a predicate and must not be read as a
 * path — otherwise `-name /foo` would look like a root.
 */
function findRoots(argv: string[]): string[] {
  const roots: string[] = []
  for (const raw of argv.slice(1)) {
    const tok = unquote(raw)
    if (tok.startsWith('-') || tok === '(' || tok === '!' ) break
    roots.push(tok)
  }
  return roots
}

/** Does this command walk a root that means "the whole machine"? */
export function offendingRoot(command: string, cwd: string): string | null {
  // Split on the shell operators that start a new command, so a scan hidden
  // after `&&`, `;`, `|` or inside a subshell is still seen. Deliberately crude:
  // this is a heuristic gate, and the failure direction is to miss an exotic
  // spelling, never to block an innocent one.
  const segments = command.split(/\|\||&&|[;|\n]|\$\(|`/)
  const roots = unboundedRoots()

  for (const seg of segments) {
    const argv = seg.trim().split(/\s+/).filter(Boolean)
    if (argv.length === 0) continue
    // `sudo find …`, `time find …`, `nice find …`
    while (argv.length > 1 && ['sudo', 'time', 'nice', 'nohup', 'command', 'env'].includes(argv[0])) argv.shift()
    const bin = path.basename(unquote(argv[0] ?? ''))
    if (bin !== 'find') continue

    for (const r of findRoots(argv)) {
      // Resolve relative roots against cwd so `find ../..` is judged on where it
      // actually lands, not on how it was spelled.
      const abs = path.resolve(cwd, r.replace(/^~(?=$|\/)/, os.homedir()))
      // A trailing slash and a bare root are the same directory.
      const norm = abs.length > 1 ? abs.replace(/\/+$/, '') : abs
      if (roots.includes(norm)) return norm
    }
  }
  return null
}

export default function extension(pi: ExtensionAPI) {
  // The factory receives ONLY the ExtensionAPI. `ctx` is the handler's second
  // argument — taking it as a second factory parameter yields `undefined`, and
  // then `ctx.cwd` throws inside the handler, which pi surfaces as
  // "Cannot read properties of undefined (reading 'cwd')" on EVERY bash call.
  // That is not a broken guard, it is a broken bash tool; found by running the
  // incident command against a real pi rather than trusting the install.
  pi.on('tool_call', async (event, ctx) => {
    // Fail OPEN, always. This is a latency guard, not a security boundary: the
    // worst case it prevents is a slow command, and the worst case it could
    // CAUSE — if it threw — is an agent that cannot run any command at all.
    // Those are not comparable, so every error here lets the call through.
    try {
      if (!isToolCallEventType('bash', event)) return
      const command = String(event.input?.command ?? '')
      const cwd = ctx?.cwd ?? process.cwd()
      const root = offendingRoot(command, cwd)
      if (!root) return

      return {
        block: true,
        // Written to be READ BY THE MODEL: name the rule, then the next action.
        // A bare "denied" leaves it to guess, and it usually guesses "retry".
        reason:
          `Refused: \`find\` rooted at ${root} walks the entire filesystem and typically takes `
          + `minutes (measured: 343s on this machine). It is almost never the right next step.\n\n`
          + `Do this instead:\n`
          + `  - Search the project: \`find . -name '<pattern>'\` or \`git ls-files\`.\n`
          + `  - Deleted recently? Look in ~/.Trash specifically.\n`
          + `  - Installed elsewhere? Ask the package manager (\`which\`, \`npm ls\`, \`brew list\`).\n`
          + `  - If it is not in the project, say so and stop. "Not found here" is a useful `
          + `answer; a four-minute scan of every mounted volume is not.\n\n`
          + `A narrower root is still allowed — only the whole-machine roots are refused.`,
        // NOT terminating: the agent should adapt and carry on, not abandon the
        // turn.
        terminate: false,
      }
    } catch {
      return
    }
  })
}

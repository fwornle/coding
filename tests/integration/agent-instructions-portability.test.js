/**
 * Agent instructions must not ship one developer's absolute paths.
 *
 * scripts/generate-agent-instructions.sh copies .claude/commands/*.md into the user's
 * GLOBAL ~/.claude/commands, where they become slash commands in every project on the
 * machine. Its header has always promised that machine-specific paths are replaced with
 * portable placeholders, and sanitize_paths() has always existed — but it was wired into
 * the copilot output only. The Claude copy path was a plain `cp`, so three skills shipped
 * a hardcoded /Users/<someone>/Agentic/coding globally, and on any other machine those
 * commands told the agent to read paths that do not exist.
 *
 * Two guards, because the two halves fail independently: a source file can reintroduce the
 * path, and the generator can stop sanitising. Either alone puts a dead path in front of
 * an agent.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const GENERATOR = path.join(REPO, 'scripts', 'generate-agent-instructions.sh');
const COMMANDS_DIR = path.join(REPO, '.claude', 'commands');

const commands = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));

/** Any absolute path into a real user's home — the thing that must never ship. */
const HOME_PATH = /\/(Users|home)\/[A-Za-z0-9._-]+\//;

describe('agent instruction sources are machine-portable', () => {
  test.each(commands)('.claude/commands/%s carries no absolute home path', (name) => {
    const body = fs.readFileSync(path.join(COMMANDS_DIR, name), 'utf8');
    const hit = body.split('\n').find((l) => HOME_PATH.test(l));
    // Reported with the offending line, because "somewhere in a 400-line skill" is not
    // an actionable failure message.
    expect(hit ?? '').toBe('');
  });

  test('CLAUDE.md carries no absolute home path', () => {
    const body = fs.readFileSync(path.join(REPO, 'CLAUDE.md'), 'utf8');
    const hit = body.split('\n').find((l) => HOME_PATH.test(l));
    expect(hit ?? '').toBe('');
  });

  test('the generated copilot instructions carry none either', () => {
    const p = path.join(REPO, '.github', 'copilot-instructions.md');
    if (!fs.existsSync(p)) return;   // generated artifact; absent on a fresh clone
    const hit = fs.readFileSync(p, 'utf8').split('\n').find((l) => HOME_PATH.test(l));
    expect(hit ?? '').toBe('');
  });
});

describe('the generator sanitises what it installs globally', () => {
  /**
   * Run sanitize_paths() on its own, the way each output path invokes it.
   *
   * Anchored on 'sanitize_paths() {' — the DEFINITION. Matching the bare name finds the
   * first mention instead, which is a reference to it in the file header, and silently
   * extracts 30 lines of unrelated preamble.
   */
  function sanitize(input, codingRepo) {
    const src = fs.readFileSync(GENERATOR, 'utf8');
    const at = src.indexOf('sanitize_paths() {');
    const body = src.slice(at, src.indexOf('\n}\n', at) + 3);
    const r = spawnSync('bash', ['-c', `CODING_REPO="${codingRepo}"\n${body}\nsanitize_paths`],
      { input, encoding: 'utf8' });
    return r.stdout ?? '';
  }

  test('a repo path becomes $CODING_REPO and a home path becomes ~', () => {
    const out = sanitize(
      'run /fake/checkout/coding/bin/gsd-browser\nread /fake/checkout/coding/.data/x\n',
      '/fake/checkout/coding');
    expect(out).toContain('$CODING_REPO/bin/gsd-browser');
    expect(out).toContain('$CODING_REPO/.data/x');
    expect(out).not.toContain('/fake/checkout/coding/');
  });

  test('the global slash-command install runs through the sanitiser, not a bare cp', () => {
    // The actual regression. A `cp` here type-checks, passes every other test, and
    // silently publishes absolute paths into ~/.claude/commands for every project.
    const src = fs.readFileSync(GENERATOR, 'utf8');
    const block = src.slice(src.indexOf('local target="$HOME/.claude/commands"'),
                            src.indexOf('_CLAUDE_GLOBAL_INSTALLED=true'));
    expect(block).toMatch(/sanitize_paths\s*<\s*"\$cmd_file"/);
    expect(block).not.toMatch(/^\s*cp "\$cmd_file"/m);
  });
});

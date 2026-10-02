/**
 * The installer asks who owns this machine's knowledge, and discloses it.
 *
 * `~/.coding/scope` was never written by anything, even though lib/scope's own
 * docstring claimed install.sh did it. So every install resolved the inert
 * placeholder, and every knowledge-writing path had to either refuse or invent a
 * tenant. Now that the code refuses (requireScope), the question has to actually
 * get asked — and the file it writes has to be disclosed before it is written,
 * because the mutation manifest's whole stated value is that it is complete.
 *
 * Text assertions, in the style of tests/paths/compose-contract.test.mjs: running
 * the installer inside a unit test is not viable, and the properties that matter
 * here (call ORDER, the absence of an overwrite, the default not being `coding`)
 * are all visible in the source.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;
const INSTALL = readFileSync(join(REPO, 'install.sh'), 'utf8');
const UNINSTALL = readFileSync(join(REPO, 'uninstall.sh'), 'utf8');

/** 1-based line number of the first line containing `needle`. */
function lineOf(src, needle) {
  const i = src.split('\n').findIndex((l) => l.includes(needle));
  assert.notEqual(i, -1, `not found in source: ${needle}`);
  return i + 1;
}

describe('install.sh asks for the install scope', () => {
  test('ask_install_scope exists and is called from main()', () => {
    assert.match(INSTALL, /^ask_install_scope\(\) \{/m, 'the function must exist');
    assert.match(INSTALL, /^\s{4}ask_install_scope$/m, 'main() must call it');
  });

  test('it runs before anything that resolves the data root', () => {
    // configure_team_setup, setup_history_repo and configure_docker_mode all call
    // bin/coding-data-home. If the scope is written AFTER them, they create the
    // data root under the placeholder and the user's knowledge is orphaned at the
    // first launch.
    const call = lineOf(INSTALL, '    ask_install_scope');
    for (const later of ['    configure_team_setup', '    configure_docker_mode']) {
      assert.ok(
        call < lineOf(INSTALL, later),
        `ask_install_scope must be called before ${later.trim()}`,
      );
    }
  });

  test('the prompt default is never `coding`', () => {
    // An installer that defaults to this repo's own tenant is the original bug
    // with extra steps, and worse once the manifest says the user chose it.
    const fn = INSTALL.slice(
      INSTALL.indexOf('ask_install_scope() {'),
      INSTALL.indexOf('\nACTIVE_FEATURES='),
    );
    assert.ok(fn.length > 200, 'failed to slice the function body');
    assert.doesNotMatch(
      fn,
      /read_or_default\s+choice\s+["']coding["']/,
      'the default must be empty, not coding',
    );
    assert.match(fn, /suggestion=""/, 'the placeholder must not be offered as a suggestion');
  });

  test('an existing scope file is never overwritten', () => {
    const fn = INSTALL.slice(
      INSTALL.indexOf('ask_install_scope() {'),
      INSTALL.indexOf('\nACTIVE_FEATURES='),
    );
    // Rewriting it MOVES the data root and orphans the knowledge base, so the
    // existing-file branch must return before any redirect to the file.
    const guard = fn.indexOf('if [[ -s "$scope_file" ]]');
    const write = fn.indexOf('> "$scope_file"');
    assert.ok(guard !== -1, 'there must be an existing-file guard');
    assert.ok(write !== -1, 'there must be a write');
    assert.ok(guard < write, 'the guard must come before the write');
    assert.match(fn.slice(guard, write), /return 0/, 'the guard must return early');
  });

  test('validation runs the resolver instead of a second copy of the rule', () => {
    // A bash regex here would have to know separately that `default` is reserved.
    assert.match(INSTALL, /--require-scope/, 'must validate via bin/coding-data-home');
  });

  test('--scope and CODING_INSTALL_SCOPE are both accepted', () => {
    assert.match(INSTALL, /--scope=\*\)/, 'the --scope= flag must be parsed');
    assert.match(INSTALL, /CODING_INSTALL_SCOPE="\$\{CODING_INSTALL_SCOPE:-\}"/);
  });
});

describe('the mutation manifest discloses both new paths', () => {
  test('the scope file and the data root are declared, and are irreversible', () => {
    const rows = INSTALL.split('\n').filter((l) => l.startsWith('home|~/.coding/'));
    const scope = rows.find((l) => l.startsWith('home|~/.coding/scope|'));
    const data = rows.find((l) => l.startsWith('home|~/.coding/data/'));
    assert.ok(scope, 'no manifest row for ~/.coding/scope');
    assert.ok(data, 'no manifest row for the data root');
    // `reversible|no` is the honest answer: uninstall.sh leaves both, and the
    // manifest is the user's whole basis for consent.
    for (const row of [scope, data]) {
      assert.equal(row.split('|')[3], 'no', `must be reversible|no: ${row}`);
    }
  });

  test('every manifest row still has five fields', () => {
    // Cheap structural guard — uninstall.sh parses this same table.
    for (const l of INSTALL.split('\n')) {
      if (!/^(repo|home|global|system)\|/.test(l)) continue;
      assert.ok(l.split('|').length >= 5, `malformed manifest row: ${l}`);
    }
  });
});

describe('uninstall.sh keeps the knowledge base', () => {
  test('it removes neither the scope nor the data root', () => {
    // Removing the scope while leaving the data would strand the data behind a
    // name nothing can resolve any more.
    const bad = UNINSTALL.split('\n')
      .map((l, i) => [l, i + 1])
      .filter(([l]) => /\brm\b/.test(l) && /\.coding\/(scope|data)\b/.test(l));
    assert.deepEqual(bad.map(([l, n]) => `uninstall.sh:${n}: ${l.trim()}`), []);
  });

  test('it says where the knowledge base was left', () => {
    assert.match(UNINSTALL, /KEPT ~\/\.coding\/scope/, 'the user must be told what was kept');
  });
});

describe('the history repo belongs to the person installing, not the tools author', () => {
  const fnBody = (name) => {
    const start = INSTALL.indexOf(`${name}() {`);
    assert.notEqual(start, -1, `${name} must exist`);
    return INSTALL.slice(start, INSTALL.indexOf('\n}\n', start));
  };

  test('the suggested repo is named after the scope, never this checkout', () => {
    // `$(basename "$CODING_REPO")-history` is `coding-history` on every clone:
    // the author's own private history, offered to every colleague.
    const fn = fnBody('history_default_url');
    assert.doesNotMatch(fn, /basename "\$CODING_REPO"/);
    assert.match(fn, /name="\$\{scope:-YOUR-SCOPE\}-history"/);
  });

  test('the owner never falls back to the owner of this repo\'s origin', () => {
    const fn = fnBody('history_default_url');
    assert.doesNotMatch(fn, /owner="\$\(git_url_slug "\$origin"\)"/);
  });

  test('every history step resolves its directory through history_home', () => {
    for (const name of ['history_default_url', 'history_manual_recipe', 'history_repo_seed', 'setup_history_repo']) {
      assert.match(fnBody(name), /history_home\)/, `${name} must call history_home`);
    }
    // ...and nothing else hard-codes the in-repo location as THE checkout.
    for (const name of ['history_repo_seed', 'setup_history_repo']) {
      assert.doesNotMatch(fnBody(name), /hist_dir="\$CODING_REPO\/\.specstory\/history"/);
    }
  });

  test('a placeholder scope gets no history repo', () => {
    assert.match(fnBody('history_home'), /--require-scope >\/dev\/null 2>&1 \|\| return 0/);
  });

  test('the scope is asked before the history step runs', () => {
    assert.ok(lineOf(INSTALL, '    ask_install_scope') < lineOf(INSTALL, '    setup_history_repo'));
  });

  test('the per-project bootstrap stands down for the tools repo', () => {
    const common = readFileSync(join(REPO, 'scripts', 'agent-common-setup.sh'), 'utf8');
    const fn = common.slice(common.indexOf('ensure_private_history_repo() {'));
    const skip = fn.indexOf('"$(cd "$CODING_REPO" 2>/dev/null && pwd -P)"');
    const derive = fn.indexOf('# 4. Derive default remote URL');
    assert.ok(skip > -1 && skip < derive, 'the tools-repo check must come before any URL is derived');
  });

  test('the symlink is ignored by the tools repo', () => {
    // `.specstory/history/` (trailing slash) matches directories only; git sees
    // a symlink as a file, so `git add -A` would commit the link.
    const ignore = readFileSync(join(REPO, '.gitignore'), 'utf8');
    assert.match(ignore, /^\.specstory\/history$/m);
  });
});

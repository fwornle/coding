/**
 * Feature integration in install.sh and uninstall.sh.
 *
 * install.sh guards its own steps at runtime, so the behavioural half is
 * exercised through `--dry-run`, which the script documents as side-effect
 * free. The rest is asserted against the source, because the alternative —
 * running a real install — would reconfigure whatever machine runs the suite.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const exec = promisify(execFile);
const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const install = readFileSync(join(REPO, 'install.sh'), 'utf8');
const uninstall = readFileSync(join(REPO, 'uninstall.sh'), 'utf8');

/** Run install.sh --dry-run and return its (colour-stripped) output. */
async function dryRun(args = []) {
  const { stdout, stderr } = await exec('bash', [join(REPO, 'install.sh'), '--dry-run', ...args], {
    cwd: REPO,
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    // A stray selection in the environment would silently change the answer.
    env: { ...process.env, CODING_INSTALL_FEATURES: '' },
  });
  // eslint-disable-next-line no-control-regex
  return `${stdout}${stderr}`.replace(/\[[0-9;]*m/g, '');
}

describe('the mutation manifest tells the truth about the chosen profile', () => {
  test('the default lists everything, exactly as before', async () => {
    const out = await dryRun();
    assert.match(out, /\.specstory\/history\//);
    assert.match(out, /com\.coding\.llm-cli-proxy\.plist/);
    assert.match(out, /Dry run — nothing was changed/);
  });

  test('proxy-only drops the rows that will not happen', async () => {
    // The manifest's entire value is being a complete and TRUE account of what
    // the installer will do. A row for a feature the user did not select is a
    // promise the installer will not keep.
    const out = await dryRun(['--features=proxy-only']);
    assert.doesNotMatch(out, /\.specstory\/history\//, 'lsl is off, so no history checkout');
    assert.match(out, /com\.coding\.llm-cli-proxy\.plist/, 'llm-proxy is on, so the plist stays');
  });

  test('minimal drops the proxy service too', async () => {
    const out = await dryRun(['--features=minimal']);
    assert.doesNotMatch(out, /\.specstory\/history\//);
    assert.doesNotMatch(out, /com\.coding\.llm-cli-proxy\.plist/);
  });

  test('the feature selection file is itself declared, in HOME scope', async () => {
    const out = await dryRun(['--features=minimal']);
    assert.match(out, /\.coding\/features\.yaml/);
    // It lives under $HOME and is reverted by uninstall.sh, so it belongs in
    // the "ours alone" section rather than the repo one.
    const homeSection = out.split('In your home directory')[1] ?? ''
    assert.match(homeSection.split('SHARED with your own tools')[0], /features\.yaml/);
  });

  test('--dry-run stays side-effect free with a profile', async () => {
    // The flag documents itself as changing nothing; writing the selection
    // file here would contradict that. The preview path uses the resolver's
    // env layer precisely so it can resolve without writing.
    assert.match(install, /CODING_FEATURE_PROFILE="\$choice"/);
    assert.match(install, /without creating a file --dry-run promised/);
  });
});

describe('install steps are gated', () => {
  const GATED = [
    ['install_semantic_analysis', 'knowledge'],
    ['install_constraint_monitor', 'constraints'],
    ['install_system_health_dashboard', 'health'],
    ['install_graphify', 'codegraph'],
    ['setup_llm_cli_proxy', 'llm-proxy'],
    ['initialize_knowledge_databases', 'knowledge'],
    ['install_memory_visualizer', 'knowledge'],
    ['install_enhanced_lsl', 'lsl'],
  ];

  for (const [fn, feature] of GATED) {
    test(`${fn} skips when '${feature}' is off`, () => {
      const body = install.slice(install.indexOf(`${fn}() {`));
      const firstLine = body.split('\n')[1];
      assert.match(
        firstLine,
        new RegExp(`skip_unless_feature ${feature}\\b`),
        `${fn}'s first statement should be its gate, got: ${firstLine.trim()}`,
      );
    });
  }

  test('Docker setup is skipped when nothing needs a container', () => {
    // The single biggest reason a proxy-only install could not work on a
    // machine without Docker Desktop.
    assert.match(install, /if \[\[ "\$FEATURES_NEED_DOCKER" != "true" \]\]; then\n\s*info "Skipping Docker setup/);
  });

  test('the MCP config is still regenerated when Docker is skipped', () => {
    // With codegraph off it must be written EMPTY rather than left stale from
    // a previous install.
    const block = install.slice(install.indexOf('Skipping Docker setup'), install.indexOf('Skipping Docker setup') + 900);
    assert.match(block, /generate-docker-mcp-config\.sh/);
  });

  test('feature resolution fails OPEN', () => {
    // An installer that silently skipped steps because it could not read a
    // config would be far worse than one that installs too much.
    assert.match(install, /\[\[ -n "\$ACTIVE_FEATURES" \]\] \|\| ACTIVE_FEATURES="lsl observations knowledge/);
    assert.match(install, /\[\[ -n "\$FEATURES_NEED_DOCKER" \]\] \|\| FEATURES_NEED_DOCKER="true"/);
  });
});

describe('an existing selection is never silently reset', () => {
  test('`keep` short-circuits the question', () => {
    // Used by `coding-features repair`. Re-answering would overwrite an
    // explicit per-feature configuration with a profile name.
    assert.match(install, /if \[\[ "\$choice" == "keep" \]\]; then/);
  });

  test('an unattended re-run keeps what is already configured', () => {
    assert.match(install, /Existing feature selection found — keeping it/);
  });

  test('coding-features repair passes `keep`', () => {
    const cli = readFileSync(join(REPO, 'bin/coding-features'), 'utf8');
    assert.match(cli, /CODING_INSTALL_FEATURES: 'keep'/);
    assert.match(cli, /install\.sh/);
  });

  test('an invalid selection falls back to full rather than aborting', () => {
    assert.match(install, /is not a valid feature selection — falling back to full/);
  });

  test('`full` writes no file at all', () => {
    // An absent features.yaml already resolves to all-on, and not creating one
    // keeps `coding-features status` honest about the user never having chosen.
    assert.match(install, /`full` is the default and writes nothing/);
  });
});

describe('uninstall symmetry', () => {
  test('the feature selection is removed with the install', () => {
    assert.match(uninstall, /\$HOME\/\.coding\/features\.yaml/);
    assert.match(uninstall, /rm -f "\$HOME\/\.coding\/features\.yaml"/);
  });

  test('~/.coding is only removed when empty', () => {
    // rmdir, not rm -rf: the directory is ours, but a future version may keep
    // something else there and a blanket delete would take it with us.
    assert.match(uninstall, /rmdir "\$HOME\/\.coding" 2>\/dev\/null/);
  });
});

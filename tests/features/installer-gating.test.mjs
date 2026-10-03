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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const exec = promisify(execFile);
const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const { FEATURE_IDS } = require(join(REPO, 'lib/features/catalogue.cjs'));
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
  /**
   * The autostart unit this platform actually gets.
   *
   * install.sh filters the manifest by platform on purpose — "listing a systemd
   * unit on macOS (or a LaunchAgent on Linux) makes the manifest look careless
   * and undermines its purpose as a consent document". These assertions used to
   * name the LaunchAgent unconditionally, which can only hold on macOS, so the
   * suite was permanently red on CI's ubuntu-latest.
   *
   * That mattered beyond this file: a job that is always failing cannot report
   * a NEW failure, and a genuinely broken suite hid behind these two for weeks.
   * The fix is to assert the same property the installer implements, rather
   * than the answer one developer's laptop happens to give.
   */
  const AUTOSTART_UNIT = process.platform === 'darwin'
    ? /com\.coding\.llm-cli-proxy\.plist/
    : /llm-cli-proxy\.service/;

  test('the default lists everything, exactly as before', async () => {
    const out = await dryRun();
    assert.match(out, /\.specstory\/history\b/);
    assert.match(out, AUTOSTART_UNIT);
    assert.match(out, /Dry run — nothing was changed/);
  });

  test('proxy-only drops the rows that will not happen', async () => {
    // The manifest's entire value is being a complete and TRUE account of what
    // the installer will do. A row for a feature the user did not select is a
    // promise the installer will not keep.
    const out = await dryRun(['--features=proxy-only']);
    assert.doesNotMatch(out, /\.specstory\/history\b/, 'lsl is off, so no history checkout');
    assert.match(out, AUTOSTART_UNIT, 'llm-proxy is on, so the autostart unit stays');
  });

  test('minimal drops the proxy service too', async () => {
    const out = await dryRun(['--features=minimal']);
    assert.doesNotMatch(out, /\.specstory\/history\b/);
    assert.doesNotMatch(out, AUTOSTART_UNIT);
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
    // It used to run on every profile, offering a session-history repo to an
    // install that writes no session history.
    ['setup_history_repo', 'lsl'],
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

  test('feature resolution fails OPEN, naming every feature', () => {
    // An installer that silently skipped steps because it could not read a
    // config would be far worse than one that installs too much.
    //
    // The list is checked against the catalogue rather than against a literal
    // prefix. A prefix match went stale the moment a tenth feature was added, and
    // a stale assertion here is worse than none: the fallback would have silently
    // stopped installing whatever was missing from it, on exactly the machines
    // that could not resolve their own config.
    const m = install.match(/\[\[ -n "\$ACTIVE_FEATURES" \]\] \|\| ACTIVE_FEATURES="([^"]*)"/);
    assert.ok(m, 'the ACTIVE_FEATURES fail-open default must exist');
    assert.deepEqual(m[1].split(/\s+/).filter(Boolean).sort(), [...FEATURE_IDS].sort());
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

describe('host daemons follow DAEMONS', () => {
  // install.sh used to install ONE daemon (the proxy). Everything else a km or
  // km-perf install needs — obs-api, the coordinator, the capture daemons — ran
  // on the developer's machine only because it had been set up by hand there.
  const DAEMONS_MOD = join(REPO, 'lib/features/daemons.mjs');
  const body = install.slice(install.indexOf('install_feature_daemons() {'));
  const fnBody = body.slice(0, body.indexOf('\n}\n'));

  test('the step is called, after every npm step', () => {
    const main = install.slice(install.indexOf('main() {'));
    const step = main.indexOf('run_step install_feature_daemons');
    assert.ok(step > 0, 'main() should run install_feature_daemons');
    assert.ok(step > main.indexOf('run_step verify_host_embeddings'),
      'it must run after the last npm step: the daemons run from node_modules');
  });

  test('it reads the daemon list from DAEMONS rather than restating it', () => {
    assert.match(fnBody, /lib\/features\/daemons\.mjs/);
    assert.match(fnBody, /DAEMONS/);
    // ...and leaves the proxy to setup_llm_cli_proxy, which also writes the Linux unit.
    assert.match(fnBody, /llm-cli-proxy/);
  });

  test('every daemon has a template, except the ones known not to', async () => {
    const { DAEMONS } = await import(DAEMONS_MOD);
    // auto-measure-foreground: nothing runs it on any machine yet, so there is
    // no tested service definition to ship. The installer reports it as not
    // installable rather than skipping it silently.
    const KNOWN_MISSING = new Set(['auto-measure-foreground']);
    for (const id of Object.keys(DAEMONS)) {
      const has = existsSync(join(REPO, 'launchd', `com.coding.${id}.plist`));
      if (KNOWN_MISSING.has(id)) {
        assert.equal(has, false, `${id} now has a template — drop it from KNOWN_MISSING`);
      } else {
        assert.ok(has, `${id} is in DAEMONS but launchd/com.coding.${id}.plist does not exist`);
      }
    }
  });

  test('no daemon restarts only on failure — they all exit 0 on SIGTERM', () => {
    // KeepAlive {SuccessfulExit: false} reads as "restart on crash", but every
    // long-running daemon here traps SIGTERM and exits 0, so any stop launchd did
    // not initiate became permanent: sub-agent daemons 14.5h (2026-09-01), the
    // measurement reconciler five days (2026-09-28). A deliberate stop is
    // `launchctl bootout`, which unloads the job, so <true/> loses nothing.
    for (const f of readdirSync(join(REPO, 'launchd')).filter((n) => n.endsWith('.plist'))) {
      const body = readFileSync(join(REPO, 'launchd', f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      assert.doesNotMatch(body, /<key>SuccessfulExit<\/key>/, `${f}: KeepAlive must be <true/>`);
    }
    // The Linux unit for the proxy, same rule in systemd's spelling.
    assert.match(install, /^Restart=always$/m);
    assert.doesNotMatch(install, /^Restart=on-failure$/m);
  });

  test('uninstall.sh removes every templated daemon, not just the proxy', () => {
    assert.match(uninstall, /launchd\/com\.coding\.\*\.plist/);
    assert.match(uninstall, /launchctl bootout "gui\/\$\(id -u\)\/\$_label"/);
  });
});

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
    assert.match(out, /\.coding\/history\b/);
    assert.match(out, AUTOSTART_UNIT);
    assert.match(out, /Dry run — nothing was changed/);
  });

  test('harness drops the rows that will not happen', async () => {
    // The manifest's entire value is being a complete and TRUE account of what
    // the installer will do. A row for a feature the user did not select is a
    // promise the installer will not keep.
    const out = await dryRun(['--features=harness']);
    assert.doesNotMatch(out, /\.coding\/history\b/, 'lsl is off, so no history checkout');
    assert.match(out, AUTOSTART_UNIT, 'llm-proxy is on, so the autostart unit stays');
  });

  /**
   * T1 acceptance: for each tier, the dry-run manifest prints exactly the
   * feature-tagged rows of that tier — every row whose feature is on, none
   * whose feature is off. Rows are taken from install.sh's own manifest and
   * filtered by platform the same way the installer filters them.
   */
  const PLATFORM = process.platform === 'darwin' ? 'macos' : 'linux';
  const manifest = install.slice(install.indexOf("cat <<'MANIFEST'"), install.indexOf('\nMANIFEST\n'));
  const tagged = manifest.split('\n')
    .map((line) => line.split('|'))
    .filter((f) => f.length >= 5 && /\[feature:[\w-]+\]/.test(f[4]))
    .filter(([, path]) => {
      if (path.includes('LaunchAgents')) return PLATFORM === 'macos';
      if (path.includes('systemd')) return PLATFORM === 'linux';
      return !path.startsWith('Scheduled Task');
    })
    .map((f) => ({
      feature: /\[feature:([\w-]+)\]/.exec(f[4])[1],
      // What the installer prints as "└─ <why>", minus the tag.
      why: f.slice(4).join('|').replace(/ \[feature:[\w-]+\]$/, ''),
    }));

  for (const tier of ['harness', 'learning', 'learning-perf', 'everything']) {
    test(`--features=${tier} prints exactly the tier's manifest rows`, async () => {
      assert.ok(tagged.length > 5, 'manifest rows should parse');
      const { stdout } = await exec('node', [join(REPO, 'bin/coding-features'), 'list'], {
        env: { ...process.env, CODING_FEATURE_PROFILE: tier },
      });
      const on = new Set(stdout.split(/\s+/).filter(Boolean));
      const out = await dryRun([`--features=${tier}`]);
      for (const row of tagged) {
        const shown = out.includes(`└─ ${row.why}`);
        assert.equal(shown, on.has(row.feature),
          `${tier}: row for '${row.feature}' ${shown ? 'shown' : 'missing'}: ${row.why.slice(0, 60)}…`);
      }
    });
  }

  test('minimal drops the proxy service too', async () => {
    const out = await dryRun(['--features=minimal']);
    assert.doesNotMatch(out, /\.coding\/history\b/);
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
    // T1: the steps that used to run on every tier.
    ['install_plantuml', 'knowledge'],
    ['setup_local_llm', 'llm-proxy'],
    ['initialize_shared_memory', 'knowledge'],
    ['install_okb_snapshot_guard', 'knowledge'],
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

  test('an invalid selection falls back to harness rather than aborting', () => {
    assert.match(install, /is not a valid feature selection — falling back to harness/);
  });

  test('every choice is written, `full` included', () => {
    // An absent features.yaml resolves to all-on — the developer profile, with
    // lsl-redirect — so no choice may be recorded by writing nothing.
    assert.match(install, /Always written, `full` included/);
    assert.doesNotMatch(install, /if \[\[ "\$choice" == "full" \]\]; then/);
  });

  test('an unattended install with no selection gets harness, never full', () => {
    assert.match(install, /\[\[ -n "\$choice" \]\] \|\| choice="harness"/);
    assert.match(install, /--features\)\s+shift; CODING_INSTALL_FEATURES="\$\{1:-harness\}"/);
  });

  test('an interactive re-run asks again, offering the current selection', () => {
    const fn = install.slice(install.indexOf('ask_feature_selection() {'), install.indexOf('# Resolve a selection for DISPLAY only'));
    assert.match(fn, /Current selection: \$current \(Enter keeps it\)/);
    // ...while the unattended keep-path is guarded by NON_INTERACTIVE.
    assert.match(fn, /if \[\[ -z "\$choice" && "\$NON_INTERACTIVE" == "true" \]\]; then\n\s*resolve_feature_selection\n\s*info "Existing feature selection found/);
  });

  test('the menu offers the four tiers and never full', () => {
    const fn = install.slice(install.indexOf('ask_feature_selection() {'), install.indexOf('# Resolve a selection for DISPLAY only'));
    for (const [n, tier] of [[1, 'harness'], [2, 'learning'], [3, 'learning-perf'], [4, 'everything']]) {
      assert.match(fn, new RegExp(`${n}\\) choice="${tier}"`));
    }
    assert.doesNotMatch(fn, /\d\) choice="full"/);
  });
});

describe('T1: no step installs a disabled feature', () => {
  test('global Claude hooks go through the feature-aware builder', () => {
    // The old jq merge added the constraint hook unconditionally, so a
    // --global-agents install with constraints off still ran it everywhere.
    const fn = install.slice(install.indexOf('install_constraint_monitor_hooks() {'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /build-claude-runtime-config\.mjs" --install-global/);
    assert.doesNotMatch(body, /pre-tool-hook-wrapper\.js/);
  });

  test('the code-graph MCP entry is dropped when codegraph is off', () => {
    const fn = install.slice(install.indexOf('setup_mcp_config() {'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /feature_on codegraph && codegraph_state=on/);
    assert.match(body, /if \(codegraph !== "on"\)/);
  });

  test('a proxy that cannot be cloned or built aborts the install', () => {
    const helper = install.slice(install.indexOf('llm_proxy_unavailable() {'));
    assert.match(helper.slice(0, helper.indexOf('\n}\n')), /error_exit "The LLM proxy is part of the selected tier/);
    const fn = install.slice(install.indexOf('setup_llm_cli_proxy() {'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /llm_proxy_unavailable "could not clone/);
    assert.match(body, /llm_proxy_unavailable "the build failed/);
    assert.doesNotMatch(body, /clone of \$proxy_repo failed — no proxy installed/);
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

  test('every daemon has a template for both service managers', async () => {
    const { DAEMONS } = await import(DAEMONS_MOD);
    for (const id of Object.keys(DAEMONS)) {
      assert.ok(existsSync(join(REPO, 'launchd', `com.coding.${id}.plist`)),
        `${id} is in DAEMONS but launchd/com.coding.${id}.plist does not exist`);
      assert.ok(existsSync(join(REPO, 'systemd', `${id}.service`)),
        `${id} is in DAEMONS but systemd/${id}.service does not exist`);
    }
  });

  test('Linux and WSL install the same daemons through systemd', () => {
    assert.match(fnBody, /linux\|wsl\)/);
    assert.match(fnBody, /install-systemd-daemons\.sh/);
    // exit 3 = no user manager: a warning with the fix, not one failure per daemon.
    assert.match(fnBody, /rc -eq 3/);
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
    // The Linux units, same rule in systemd's spelling: every long-running one
    // restarts always; interval jobs are oneshots and restart nothing.
    for (const f of readdirSync(join(REPO, 'systemd')).filter((n) => n.endsWith('.service'))) {
      const body = readFileSync(join(REPO, 'systemd', f), 'utf8');
      assert.doesNotMatch(body, /^Restart=on-failure$/m, f);
      if (/^Type=simple$/m.test(body)) assert.match(body, /^Restart=always$/m, `${f}: Restart=always`);
    }
  });

  test('uninstall.sh removes every templated daemon, not just the proxy', () => {
    assert.match(uninstall, /launchd\/com\.coding\.\*\.plist/);
    assert.match(uninstall, /launchctl bootout "gui\/\$\(id -u\)\/\$_label"/);
    assert.match(uninstall, /systemd\/\*\.service/);
    assert.match(uninstall, /systemctl --user disable --now "\$_u"/);
  });
});

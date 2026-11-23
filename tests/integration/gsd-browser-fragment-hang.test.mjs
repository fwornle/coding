/**
 * install.sh must replace the stock gsd-browser pin with the build that fixes
 * the #fragment-navigation hang.
 *
 * The prebuilt gsd-browser 0.2.1 hangs for 30 s on any same-document navigation
 * (page.html#1 -> page.html#2) because its chromiumoxide 0.9.1 never dispatches
 * Page.frameStoppedLoading; scripts/build-gsd-browser.sh builds it with
 * integrations/gsd-browser/chromiumoxide-frame-stopped-loading.patch and marks the
 * version `+frame-stopped-loading`. ensure_gsd_browser_patched decides, from that
 * marker, whether to build.
 *
 * The contract driven here, against a fake binary and a fake build script:
 *   - a binary with the fix is left alone, and so is any version other than the
 *     pin (that came from `gsd-browser update`, the user's call);
 *   - the stock pin without cargo warns and does not build;
 *   - the stock pin with cargo asks first, and a refusal does not build;
 *   - an approved build that does not produce the marker is reported as failed,
 *     never as success.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const install = fs.readFileSync(path.join(REPO, 'install.sh'), 'utf8');

const POSIX_ONLY = process.platform === 'win32'
  ? { skip: 'fake executables are bash scripts; covered on ubuntu + macOS' }
  : {};

function lift(name) {
  const m = install.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(m, `${name} not found in install.sh`);
  return m[0];
}
const FN = lift('ensure_gsd_browser_patched');
const PIN = install.match(/^GSD_BROWSER_VERSION_PIN="([^"]+)"$/m)[1];
const MARK = install.match(/^GSD_BROWSER_PATCH_MARK="([^"]+)"$/m)[1];

/**
 * @param {object} o
 * @param {string} o.version      what the installed binary reports
 * @param {boolean} o.cargo       whether gsd_browser_find_cargo finds one
 * @param {boolean} o.approve     the answer to confirm_system_change
 * @param {'ok'|'fail'|'nomark'} [o.build] what the fake build script does
 */
function run({ version, cargo, approve, build = 'ok' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdfrag-'));
  const bin = path.join(dir, 'gsd-browser');
  fs.writeFileSync(bin, `#!/usr/bin/env bash\necho "gsd-browser ${version}"\n`, { mode: 0o755 });

  // The fake build script records that it ran and rewrites the binary the way
  // the real one installs its output.
  fs.mkdirSync(path.join(dir, 'scripts'));
  const built = build === 'ok' ? `${PIN}+${MARK}` : PIN;
  fs.writeFileSync(path.join(dir, 'scripts/build-gsd-browser.sh'),
    `#!/usr/bin/env bash\ntouch "${dir}/BUILT"\n` +
    (build === 'fail' ? 'exit 1\n'
      : `printf '#!/usr/bin/env bash\\necho "gsd-browser ${built}"\\n' > "${bin}"\n`),
    { mode: 0o755 });

  const script = [
    'warning(){ echo "WARN $*"; }; info(){ :; }; success(){ echo "OK $*"; }',
    `confirm_system_change(){ echo ASKED; return ${approve ? 0 : 1}; }`,
    `gsd_browser_find_cargo(){ ${cargo ? 'echo /fake/cargo' : ':'}; }`,
    'INSTALLATION_WARNINGS=()',
    `GSD_BROWSER_VERSION_PIN="${PIN}"; GSD_BROWSER_PATCH_MARK="${MARK}"; CODING_REPO="${dir}"`,
    FN,
    `ensure_gsd_browser_patched "${bin}"`,
    'printf "WARNCOUNT=%s\\n" "${#INSTALLATION_WARNINGS[@]}"',
  ].join('\n');
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
  return {
    status: res.status,
    out: res.stdout + res.stderr,
    built: fs.existsSync(path.join(dir, 'BUILT')),
    asked: res.stdout.includes('ASKED'),
    warnings: Number((res.stdout.match(/WARNCOUNT=(\d+)/) || [])[1]),
  };
}

test('a binary that already carries the fix is left alone', POSIX_ONLY, () => {
  const r = run({ version: `${PIN}+${MARK}`, cargo: true, approve: true });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.asked, false);
  assert.equal(r.built, false);
  assert.equal(r.warnings, 0);
});

test('a version other than the pin is not rebuilt', POSIX_ONLY, () => {
  const r = run({ version: '9.9.9', cargo: true, approve: true });
  assert.equal(r.asked, false);
  assert.equal(r.built, false);
  assert.equal(r.warnings, 0);
});

test('the stock pin without cargo warns and does not build', POSIX_ONLY, () => {
  const r = run({ version: PIN, cargo: false, approve: true });
  assert.equal(r.asked, false, 'nothing to ask when the build cannot run');
  assert.equal(r.built, false);
  assert.equal(r.warnings, 1);
  assert.match(r.out, /#fragment/);
});

test('the stock pin with cargo asks, and a refusal does not build', POSIX_ONLY, () => {
  const r = run({ version: PIN, cargo: true, approve: false });
  assert.equal(r.asked, true);
  assert.equal(r.built, false);
  assert.equal(r.warnings, 1);
});

test('an approved build replaces the stock pin', POSIX_ONLY, () => {
  const r = run({ version: PIN, cargo: true, approve: true });
  assert.equal(r.asked, true);
  assert.equal(r.built, true);
  assert.equal(r.warnings, 0, r.out);
  assert.match(r.out, new RegExp(`OK .*\\+${MARK}`));
});

test('a failed build is reported, not claimed', POSIX_ONLY, () => {
  for (const build of ['fail', 'nomark']) {
    const r = run({ version: PIN, cargo: true, approve: true, build });
    assert.equal(r.built, true, build);
    assert.equal(r.warnings, 1, `${build}: ${r.out}`);
    assert.doesNotMatch(r.out, /^OK /m, build);
  }
});

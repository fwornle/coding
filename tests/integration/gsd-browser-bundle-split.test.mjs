/**
 * install.sh must not leave gsd-browser sharing a bundle id with the user's Chrome.
 *
 * gsd-browser's own installer REUSES a system Chrome when it finds one. On macOS
 * that puts the automation browser and the user's browser under the same bundle
 * id (com.google.Chrome), and Apple Events are addressed by bundle id — so the
 * automation instance answers `tell application "Google Chrome"` first and every
 * AppleScript on the machine is silently retargeted into the headless profile.
 * That is what broke bin/statusline-click: it found a dashboard tab, navigated it
 * and reported success against a browser nobody could see.
 *
 * Linux and Windows have no Apple Event routing, so two Chrome instances there
 * cannot intercept one another — pinning a second browser would only cost disk.
 * The macOS-only guard is therefore part of the contract, not an optimisation.
 *
 * Run for real against throwaway HOMEs rather than asserted against the source:
 * the failure modes worth guarding (clobbering a user's own path, appending a
 * second one on re-run, writing a symlink to the binary instead of the .app) are
 * all behavioural, and a regex would pass while any of them regressed.
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

/** The function under test, lifted out of install.sh so the rest never runs. */
const FN = (() => {
  const m = install.match(/^pin_gsd_browser_bundle_split\(\) \{[\s\S]*?^\}$/m);
  assert.ok(m, 'pin_gsd_browser_bundle_split not found in install.sh');
  return m[0];
})();

function runPin({ platform, withPlaywright, presetPath }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdsplit-'));
  fs.mkdirSync(path.join(home, '.gsd-browser'), { recursive: true });
  if (withPlaywright) {
    fs.mkdirSync(
      path.join(home, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64',
        'Google Chrome for Testing.app/Contents/MacOS'),
      { recursive: true });
  }
  const cfg = path.join(home, '.gsd-browser/config.toml');
  if (presetPath) fs.writeFileSync(cfg, '[browser]\nheadless = true\npath = "/my/own/browser"\n');

  const script = [
    'warning(){ :; }; info(){ :; }; success(){ :; }',
    'INSTALLATION_WARNINGS=()',
    FN,
    'pin_gsd_browser_bundle_split',
    'printf "WARNCOUNT=%s\\n" "${#INSTALLATION_WARNINGS[@]}"',
  ].join('\n');

  const res = spawnSync('bash', ['-c', script], {
    env: { ...process.env, HOME: home, PLATFORM: platform }, encoding: 'utf-8',
  });
  const link = path.join(home, '.gsd-browser/chromium.app');
  return {
    home, res,
    config: fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : null,
    symlink: fs.existsSync(link) ? fs.readlinkSync(link) : null,
    warnings: Number((res.stdout.match(/WARNCOUNT=(\d+)/) || [])[1] ?? -1),
  };
}

test('on Linux it does nothing at all — there is no Apple Event routing to defend', () => {
  const r = runPin({ platform: 'linux', withPlaywright: true, presetPath: false });
  assert.equal(r.config, null, 'wrote a config on Linux');
  assert.equal(r.symlink, null, 'created a symlink on Linux');
  assert.equal(r.warnings, 0, 'warned on Linux, where there is nothing to warn about');
});

test('on macOS it pins [browser] path to Chrome for Testing', () => {
  const r = runPin({ platform: 'macos', withPlaywright: true, presetPath: false });
  assert.match(r.config ?? '', /^\[browser\]$/m);
  assert.match(r.config ?? '', /^path = ".*chromium\.app\/Contents\/MacOS\/Google Chrome for Testing"$/m);
});

test('the symlink targets the .app, never the binary inside it', () => {
  // Chrome resolves ../Frameworks from argv[0]'s directory: a symlink straight
  // to the executable makes it die with a dlopen error for its own framework.
  const r = runPin({ platform: 'macos', withPlaywright: true, presetPath: false });
  assert.ok(r.symlink, 'no symlink created');
  assert.match(r.symlink, /Google Chrome for Testing\.app$/);
  assert.doesNotMatch(r.symlink, /Contents\/MacOS/);
});

test("a path the user already chose is never overwritten", () => {
  const r = runPin({ platform: 'macos', withPlaywright: true, presetPath: true });
  assert.match(r.config ?? '', /path = "\/my\/own\/browser"/);
  assert.equal((r.config.match(/^path = /gm) || []).length, 1);
  assert.equal(r.symlink, null, 'touched the symlink despite a user-chosen path');
});

test('re-running appends nothing — one path line, always', () => {
  const r = runPin({ platform: 'macos', withPlaywright: true, presetPath: false });
  const again = spawnSync('bash', ['-c',
    ['warning(){ :; }; info(){ :; }; success(){ :; }', 'INSTALLATION_WARNINGS=()', FN,
      'pin_gsd_browser_bundle_split'].join('\n')],
    { env: { ...process.env, HOME: r.home, PLATFORM: 'macos' }, encoding: 'utf-8' });
  assert.equal(again.status, 0);
  const cfg = fs.readFileSync(path.join(r.home, '.gsd-browser/config.toml'), 'utf8');
  assert.equal((cfg.match(/^path = /gm) || []).length, 1);
});

test('with no Chrome for Testing on disk it warns instead of writing a broken pin', () => {
  const r = runPin({ platform: 'macos', withPlaywright: false, presetPath: false });
  assert.equal(r.config, null, 'wrote a config pointing at a browser that does not exist');
  assert.equal(r.symlink, null, 'created a dangling symlink');
  assert.equal(r.warnings, 1, 'left the collision in place silently');
});

test('install.sh declares the extra writes in its mutation manifest', () => {
  // The manifest is the contract --dry-run prints; a silent home-dir write
  // outside it is exactly what that mode exists to rule out.
  const line = install.split('\n').find((l) => l.startsWith('home|~/.gsd-browser/|'));
  assert.ok(line, 'no ~/.gsd-browser manifest entry');
  assert.match(line, /config\.toml/);
  assert.match(line, /symlink/);
});

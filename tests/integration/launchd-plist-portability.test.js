/**
 * The launchd plists and their installers must not carry one developer's checkout path.
 *
 * They did, for a long time, and it was invisible here: every plist under launchd/ named
 * /Users/<someone>/Agentic/coding in its ProgramArguments, WorkingDirectory and both log
 * paths, and each installer repeated the same string in a hardcoded REPO_ROOT. On the
 * machine that wrote them everything worked. On any other machine the installer produced a
 * plist that launchctl accepted and that then failed at every run — `launchctl list` showed
 * the job, so it looked installed.
 *
 * These tests are the thing that notices if it comes back. The first one is a grep, which
 * is unusual for this repo's test style, and deliberate: the failure mode is a literal
 * string, it is trivially reintroduced by copying an existing plist as a template for a new
 * one, and no behavioural test on this machine can see it.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const LAUNCHD_DIR = path.join(REPO, 'launchd');
const LIB = path.join(REPO, 'scripts', 'lib', 'launchd-plist.sh');
const TOKEN = '__CODING_REPO__';

const plists = fs.readdirSync(LAUNCHD_DIR).filter((f) => f.endsWith('.plist'));
const installers = fs.readdirSync(path.join(REPO, 'scripts'))
  .filter((f) => /^install-.*launchd.*\.sh$/.test(f))
  .map((f) => path.join(REPO, 'scripts', f));

/** Render a template through the shared helper, exactly as an installer does. */
function render(plistName, repoRoot) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plist-render-')), 'out.plist');
  const r = spawnSync('bash', ['-c',
    `source "${LIB}"; render_plist "${path.join(LAUNCHD_DIR, plistName)}" "${out}" "${repoRoot}"`,
  ], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, out, read: () => fs.readFileSync(out, 'utf8') };
}

describe('launchd plists are machine-portable', () => {
  test.each(plists)('%s hardcodes no home directory', (name) => {
    const body = fs.readFileSync(path.join(LAUNCHD_DIR, name), 'utf8');
    expect(body).not.toMatch(/\/Users\//);
    expect(body).not.toMatch(/\/home\//);
    // A plist that references the repo must say so with the token, or it is not portable.
    if (/\/(scripts|\.data|\.logs)\//.test(body)) expect(body).toContain(TOKEN);
  });

  test.each(plists)('%s is still a valid plist as a template', (name) => {
    // plutil must accept the template as well as the rendering, so `plutil -lint` stays a
    // usable check on the checked-in file.
    const r = spawnSync('/usr/bin/plutil', ['-lint', path.join(LAUNCHD_DIR, name)], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  test.each(plists)('%s renders for an arbitrary checkout', (name) => {
    const r = render(name, '/opt/somewhere/else/coding');
    expect(r.status).toBe(0);
    const body = r.read();
    expect(body).not.toContain(TOKEN);        // nothing left unsubstituted
    expect(body).not.toMatch(/\/Users\//);     // and no path smuggled back in
    if (/somewhere/.test(body) === false) return;
    expect(body).toContain('/opt/somewhere/else/coding');
  });
});

describe('launchd installers resolve the repo rather than assume it', () => {
  test.each(installers.map((p) => [path.basename(p), p]))('%s hardcodes no home directory', (_n, file) => {
    const body = fs.readFileSync(file, 'utf8');
    // Comments are held to the same rule: a path in a comment is what the next person
    // copies. There is no legitimate absolute /Users path in any of these scripts.
    expect(body).not.toMatch(/\/Users\/[a-zA-Z0-9]/);
  });

  test.each(installers.map((p) => [path.basename(p), p]))('%s is syntax-clean', (_n, file) => {
    expect(spawnSync('bash', ['-n', file], { encoding: 'utf8' }).status).toBe(0);
  });
});

describe('render_plist fails loudly rather than installing something broken', () => {
  test('a MISTYPED placeholder fails the install instead of loading a broken job', () => {
    // The realistic mistake: a new plist copied from an existing one with the placeholder
    // spelled wrong. There is then no occurrence of the real token, so an exact-match
    // check passes and plutil -lint passes too — it is still valid XML. launchd would load
    // a job whose WorkingDirectory is literally "__CODINGREPO__". Hence the guard matches
    // any residual __UPPER_CASE__ placeholder, and this is the test that pins that down.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plist-token-'));
    try {
      const src = path.join(dir, 'mistyped.plist');
      const plist = (token) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>WorkingDirectory</key><string>${token}</string></dict></plist>`;

      fs.writeFileSync(src, plist('__CODINGREPO__'));   // note: missing the underscore
      const bad = spawnSync('bash', ['-c',
        `source "${LIB}"; render_plist "${src}" "${dir}/bad.plist" "/tmp/repo"`,
      ], { encoding: 'utf8' });
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toMatch(/__CODINGREPO__/);

      // ...and the correctly-spelled one still renders.
      fs.writeFileSync(src, plist(TOKEN));
      const good = spawnSync('bash', ['-c',
        `source "${LIB}"; render_plist "${src}" "${dir}/good.plist" "/tmp/repo"`,
      ], { encoding: 'utf8' });
      expect(good.status).toBe(0);
      expect(fs.readFileSync(`${dir}/good.plist`, 'utf8')).toContain('/tmp/repo');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing source plist is an error', () => {
    const r = spawnSync('bash', ['-c',
      `source "${LIB}"; render_plist "/nope/missing.plist" "/tmp/out.plist" "/tmp/repo"`,
    ], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/not found/);
  });

  test('CODING_REPO overrides the derived root', () => {
    // The seam tests and the `coding` wrapper both rely on.
    const r = spawnSync('bash', ['-c',
      `source "${LIB}"; CODING_REPO=/fixture/repo launchd_repo_root`,
    ], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('/fixture/repo');
  });
});

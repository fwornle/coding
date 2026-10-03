/**
 * systemd/<id>.service (+ .timer) must say what launchd/com.coding.<id>.plist says.
 *
 * Two hand-written definitions of the same daemon drift: a flag added to the
 * plist and not the unit is a Linux daemon that runs differently, and nobody on
 * a Mac sees it. Generating one from the other would bury the plists' comments
 * (see scripts/lib/launchd-plist.sh), so both stay checked in and this test is
 * what keeps them equal — field by field, after rendering both for the same repo.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DAEMONS } from '../../lib/features/daemons.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = '/repo';

/** The flat subset of plist syntax launchd/ uses: keys, strings, ints, bools, arrays, one nested dict. */
function parsePlist(file) {
  const xml = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replaceAll('__CODING_REPO__', R);
  const body = xml.slice(xml.indexOf('<dict>') + 6, xml.lastIndexOf('</dict>'));
  const out = {};
  const re = /<key>([^<]+)<\/key>\s*(<string>([^<]*)<\/string>|<integer>(\d+)<\/integer>|<(true|false)\/>|<array>([\s\S]*?)<\/array>|<dict>([\s\S]*?)<\/dict>)/g;
  for (const m of body.matchAll(re)) {
    const [, key, , str, int, bool, arr, dict] = m;
    if (str !== undefined) out[key] = str;
    else if (int !== undefined) out[key] = Number(int);
    else if (bool !== undefined) out[key] = bool === 'true';
    else if (arr !== undefined) out[key] = [...arr.matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]);
    else if (dict !== undefined) {
      out[key] = {};
      for (const d of dict.matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)) out[key][d[1]] = d[2];
    }
  }
  return out;
}

/** `[Section]` → { Key: [values] } (Environment= and friends repeat). */
function parseUnit(file) {
  const out = {};
  let section = null;
  for (const raw of readFileSync(file, 'utf8').replaceAll('__CODING_REPO__', R).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[(\w+)\]$/.exec(line);
    if (sec) { section = out[sec[1]] = {}; continue; }
    const i = line.indexOf('=');
    const k = line.slice(0, i);
    (section[k] ||= []).push(line.slice(i + 1));
  }
  return out;
}

/** systemd's ExecStart word splitting, for the quoting these units use ('…', "…", $$). */
function splitExec(cmd) {
  const words = [];
  for (const m of cmd.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)) words.push(m[1] ?? m[2] ?? m[3]);
  return words.map((w) => w.replaceAll('$$', '$'));
}

const ids = Object.keys(DAEMONS);

describe('systemd units match their launchd plists', () => {
  test('no unit without a daemon, no daemon without a unit', () => {
    const units = readdirSync(join(REPO, 'systemd')).filter((f) => f.endsWith('.service'))
      .map((f) => f.slice(0, -'.service'.length));
    assert.deepEqual(units.sort(), [...ids].sort());
    for (const f of readdirSync(join(REPO, 'systemd')).filter((n) => n.endsWith('.timer'))) {
      assert.ok(existsSync(join(REPO, 'systemd', f.replace(/\.timer$/, '.service'))), `${f} has no service`);
    }
  });

  for (const id of ids) {
    test(id, () => {
      const plist = parsePlist(join(REPO, 'launchd', `com.coding.${id}.plist`));
      const unit = parseUnit(join(REPO, 'systemd', `${id}.service`));
      const svc = unit.Service;
      const timerFile = join(REPO, 'systemd', `${id}.timer`);

      assert.deepEqual(splitExec(svc.ExecStart[0]), plist.ProgramArguments, 'ExecStart = ProgramArguments');
      assert.deepEqual(svc.WorkingDirectory, [plist.WorkingDirectory], 'WorkingDirectory');
      assert.deepEqual(svc.StandardOutput, [`append:${plist.StandardOutPath}`], 'stdout log');
      assert.deepEqual(svc.StandardError, [`append:${plist.StandardErrorPath}`], 'stderr log');

      // Environment, except PATH: the plist's is a fixed Homebrew list, the unit's
      // is rendered around the installing node (__NODE_DIR__).
      const env = Object.fromEntries((svc.Environment || []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
      assert.match(env.PATH, /^__NODE_DIR__:/, 'unit PATH starts with the installing node');
      delete env.PATH;
      const plistEnv = { ...(plist.EnvironmentVariables || {}) };
      delete plistEnv.PATH;
      assert.deepEqual(env, plistEnv, 'Environment (minus PATH)');

      if (plist.StartInterval) {
        // An interval job: oneshot service + timer, no restart policy.
        assert.deepEqual(svc.Type, ['oneshot']);
        assert.equal(svc.Restart, undefined, 'a oneshot does not restart');
        assert.equal(unit.Install, undefined, 'only the timer is enabled');
        assert.ok(existsSync(timerFile), `${id}.timer missing for StartInterval ${plist.StartInterval}`);
        const t = parseUnit(timerFile).Timer;
        assert.deepEqual(t.OnUnitActiveSec, [`${plist.StartInterval}s`], 'interval');
        assert.deepEqual(t.OnActiveSec, [plist.RunAtLoad ? '1s' : `${plist.StartInterval}s`], 'RunAtLoad');
      } else {
        assert.ok(!existsSync(timerFile), `${id} is long-running but has a timer`);
        assert.deepEqual(svc.Type, ['simple']);
        assert.equal(plist.KeepAlive, true);
        assert.deepEqual(svc.Restart, ['always'], 'KeepAlive <true/> = Restart=always');
        // launchd's ThrottleInterval defaults to 10s.
        assert.deepEqual(svc.RestartSec, [String(plist.ThrottleInterval ?? 10)], 'ThrottleInterval = RestartSec');
        assert.deepEqual(unit.Install.WantedBy, ['default.target']);
      }
    });
  }
});

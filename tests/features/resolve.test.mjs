/**
 * Feature resolver — layering, dependency closure and failure modes.
 *
 * Every test drives the resolver through explicit `repoConfigPath` /
 * `homeConfigPath` / `env` options rather than through process.env, so the
 * suite never depends on (or disturbs) the developer's own ~/.coding.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;

const {
  loadFeatures, isEnabled, explain, invalidateFeatures, loadProfiles,
  FeatureConfigError, FEATURE_IDS,
} = require(join(REPO, 'lib/features/resolve.cjs'));
const yaml = require('js-yaml');

let dir;
const PROFILES = join(REPO, 'config', 'feature-profiles.yaml');

/** Build an options object pointing every layer at the sandbox. */
function opts(extra = {}) {
  return {
    repoConfigPath: join(dir, 'repo-features.yaml'),
    homeConfigPath: join(dir, 'home-features.yaml'),
    profilesPath: PROFILES,
    env: {},
    force: true,
    ...extra,
  };
}

function writeRepo(text) { writeFileSync(join(dir, 'repo-features.yaml'), text); }
function writeHome(text) { writeFileSync(join(dir, 'home-features.yaml'), text); }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coding-features-'));
  invalidateFeatures();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  invalidateFeatures();
});

describe('defaults', () => {
  test('no config anywhere resolves every feature on', () => {
    const r = loadFeatures(opts());
    assert.equal(r.disabled.length, 0, `unexpectedly off: ${r.disabled.join(', ')}`);
    assert.deepEqual(r.enabled.sort(), [...FEATURE_IDS].sort());
    assert.equal(r.profile, null);
    assert.deepEqual(r.layers, []);
  });

  test('all-on requires Docker (the historical stack)', () => {
    assert.equal(loadFeatures(opts()).needsDocker, true);
  });
});

describe('layer precedence', () => {
  test('repo file beats built-in defaults', () => {
    writeRepo('features:\n  codegraph: off\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.codegraph.enabled, false);
    assert.equal(r.features.codegraph.source, 'config/features.yaml');
  });

  test('home file beats the repo file', () => {
    writeRepo('features:\n  codegraph: off\n');
    writeHome('features:\n  codegraph: on\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.codegraph.enabled, true);
    assert.equal(r.features.codegraph.source, '~/.coding/features.yaml');
  });

  test('env beats both files', () => {
    writeRepo('features:\n  codegraph: on\n');
    writeHome('features:\n  codegraph: on\n');
    const r = loadFeatures(opts({ env: { CODING_FEATURE_CODEGRAPH: 'off' } }));
    assert.equal(r.features.codegraph.enabled, false);
    assert.equal(r.features.codegraph.source, 'env');
  });

  test('a hyphenated id maps to an underscored env var', () => {
    const r = loadFeatures(opts({ env: { CODING_FEATURE_LLM_PROXY: 'off' } }));
    assert.equal(r.features['llm-proxy'].enabled, false);
  });

  test('an empty env var contributes nothing', () => {
    const r = loadFeatures(opts({ env: { CODING_FEATURE_CODEGRAPH: '' } }));
    assert.equal(r.features.codegraph.enabled, true);
    assert.equal(r.features.codegraph.source, 'default');
  });
});

describe('profiles', () => {
  test('a profile turns off everything it does not name', () => {
    writeHome('profile: proxy-only\n');
    const r = loadFeatures(opts());
    assert.deepEqual(r.enabled.sort(), ['llm-proxy', 'statusline']);
    assert.equal(r.profile, 'proxy-only');
  });

  test('proxy-only and minimal need no Docker — the point of the exercise', () => {
    writeHome('profile: proxy-only\n');
    assert.equal(loadFeatures(opts()).needsDocker, false);
    writeHome('profile: minimal\n');
    assert.equal(loadFeatures(opts()).needsDocker, false);
  });

  test('logging-only keeps health without pulling in Docker', () => {
    writeHome('profile: logging-only\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.health.enabled, true);
    assert.equal(r.needsDocker, false);
  });

  test('explicit features refine the profile in the same layer', () => {
    writeHome('profile: proxy-only\nfeatures:\n  codegraph: on\n');
    const r = loadFeatures(opts());
    assert.deepEqual(r.enabled.sort(), ['codegraph', 'llm-proxy', 'statusline']);
  });

  test("a later layer's profile replaces an earlier layer's wholesale", () => {
    // Otherwise `profile: minimal` in the home file could not undo a repo default.
    writeRepo('profile: full\n');
    writeHome('profile: minimal\n');
    const r = loadFeatures(opts());
    assert.deepEqual(r.enabled, ['statusline']);
    assert.equal(r.profile, 'minimal');
  });

  test('a repo profile still loses to a home per-feature override', () => {
    writeRepo('profile: minimal\n');
    writeHome('features:\n  llm-proxy: on\n');
    const r = loadFeatures(opts());
    assert.deepEqual(r.enabled.sort(), ['llm-proxy', 'statusline']);
  });
});

describe('dependency closure', () => {
  test('observations is auto-disabled when lsl is off', () => {
    writeHome('features:\n  lsl: off\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.observations.enabled, false);
    assert.equal(r.features.observations.source, 'dependency');
    assert.match(r.features.observations.reason, /requires 'lsl'/);
  });

  test('closure is transitive: lsl off also takes out knowledge', () => {
    writeHome('features:\n  lsl: off\n  observations: on\n  knowledge: on\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.knowledge.enabled, false);
    assert.equal(r.features.knowledge.source, 'dependency');
  });

  test('a dependency is never auto-enabled', () => {
    // Turning observations on must not silently switch lsl back on — that would
    // undo the explicit choice the user just made.
    writeHome('features:\n  lsl: off\n  observations: on\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.lsl.enabled, false);
    assert.equal(r.features.lsl.source, '~/.coding/features.yaml');
  });

  test('performance follows llm-proxy', () => {
    writeHome('features:\n  llm-proxy: off\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.performance.enabled, false);
    assert.equal(r.features.performance.source, 'dependency');
  });

  test('each auto-disable produces exactly one warning', () => {
    writeHome('features:\n  lsl: off\n');
    const r = loadFeatures(opts());
    const auto = r.warnings.filter((w) => w.includes('auto-disabled'));
    assert.equal(auto.length, 2); // observations, knowledge
  });

  test('disabling health warns that the editor is gone', () => {
    writeHome('features:\n  health: off\n');
    const r = loadFeatures(opts());
    assert.ok(r.warnings.some((w) => w.includes("'health' is off")));
  });
});

describe('validation', () => {
  const cases = [
    ['unknown feature id', 'features:\n  lsl2: on\n', /unknown feature 'lsl2'/],
    ['non-boolean value', 'features:\n  lsl: maybe\n', /expected on\/off/],
    ['unknown top-level key', 'featurez:\n  lsl: on\n', /unknown top-level key/],
    ['features is a list', 'features:\n  - lsl\n', /must be a mapping/],
    ['profile is not a string', 'profile:\n  a: 1\n', /'profile' must be a string/],
    ['unknown profile', 'profile: turbo\n', /unknown profile 'turbo'/],
    ['malformed YAML', 'features:\n  lsl: [oops\n', /not valid YAML/],
    ['top-level list', '- lsl\n', /must be a YAML mapping/],
  ];

  for (const [name, body, pattern] of cases) {
    test(`${name} throws rather than falling back to defaults`, () => {
      writeHome(body);
      assert.throws(() => loadFeatures(opts()), (err) => {
        assert.ok(err instanceof FeatureConfigError, `got ${err.name}: ${err.message}`);
        assert.match(err.message, pattern);
        return true;
      });
    });
  }

  test('an empty document is legal and changes nothing', () => {
    writeHome('');
    assert.equal(loadFeatures(opts()).disabled.length, 0);
  });

  test('a comment-only document is legal', () => {
    writeHome('# nothing to see here\n');
    assert.equal(loadFeatures(opts()).disabled.length, 0);
  });

  test('a file that states no opinion is not reported as an applied layer', () => {
    // The shipped config/features.yaml is entirely comments. "layers applied"
    // must mean "layers that decided something" — listing a file that changed
    // nothing sends whoever is debugging a feature to read the wrong file.
    writeRepo('# team default: no opinion\n');
    writeHome('');
    assert.deepEqual(loadFeatures(opts()).layers, []);
  });

  test('an inert layer is still VALIDATED', () => {
    // Order matters: skipping the layer before validating it would turn a typo
    // in an otherwise-empty file into silence.
    writeRepo('features:\n  nope: on\n');
    assert.throws(() => loadFeatures(opts()), /unknown feature 'nope'/);
  });

  test('a layer that only sets a profile counts as applied', () => {
    writeRepo('profile: minimal\n');
    assert.deepEqual(loadFeatures(opts()).layers, ['config/features.yaml']);
  });

  test('YAML 1.1 bare on/off are accepted as booleans', () => {
    writeHome('features:\n  lsl: off\n  codegraph: on\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.lsl.enabled, false);
    assert.equal(r.features.codegraph.enabled, true);
  });

  test('quoted on/off strings are accepted too', () => {
    writeHome('features:\n  lsl: "off"\n  codegraph: "on"\n');
    const r = loadFeatures(opts());
    assert.equal(r.features.lsl.enabled, false);
    assert.equal(r.features.codegraph.enabled, true);
  });
});

describe('caching', () => {
  // The cache only engages on the DEFAULT paths — passing explicit path or env
  // options marks a call uncacheable, so a sandbox-path test would exercise
  // nothing. These drive the real code path by pointing CODING_REPO/CODING_HOME
  // at the sandbox and restoring them afterwards.
  let savedRepo; let savedHome;
  const asDefaultPaths = (fn) => {
    savedRepo = process.env.CODING_REPO;
    savedHome = process.env.CODING_HOME;
    process.env.CODING_REPO = join(dir, 'repo');
    process.env.CODING_HOME = join(dir, 'home');
    mkdirSync(join(dir, 'repo', 'config'), { recursive: true });
    mkdirSync(join(dir, 'home', '.coding'), { recursive: true });
    // The sandbox repo has no feature-profiles.yaml; the built-in profiles in
    // resolve.cjs are what answer, which is itself worth asserting.
    invalidateFeatures();
    try {
      fn({
        home: join(dir, 'home', '.coding', 'features.yaml'),
        repo: join(dir, 'repo', 'config', 'features.yaml'),
      });
    } finally {
      if (savedRepo === undefined) delete process.env.CODING_REPO;
      else process.env.CODING_REPO = savedRepo;
      if (savedHome === undefined) delete process.env.CODING_HOME;
      else process.env.CODING_HOME = savedHome;
      invalidateFeatures();
    }
  };

  test('an edited file is picked up without force', () => {
    asDefaultPaths(({ home }) => {
      writeFileSync(home, 'features:\n  codegraph: on\n');
      assert.equal(loadFeatures().features.codegraph.enabled, true);

      writeFileSync(home, 'features:\n  codegraph: off\n');
      // Guarantee a distinct mtime even on a coarse-grained filesystem.
      const future = new Date(Date.now() + 2000);
      utimesSync(home, future, future);

      assert.equal(loadFeatures().features.codegraph.enabled, false);
    });
  });

  test('an unchanged file returns the identical cached object', () => {
    asDefaultPaths(({ home }) => {
      writeFileSync(home, 'features:\n  codegraph: off\n');
      const first = loadFeatures();
      assert.equal(loadFeatures(), first, 'expected the cached instance');
      assert.notEqual(loadFeatures({ force: true }), first, 'force must re-parse');
    });
  });

  test('invalidateFeatures drops the cache', () => {
    asDefaultPaths(({ home }) => {
      writeFileSync(home, 'features:\n  codegraph: off\n');
      const first = loadFeatures();
      invalidateFeatures();
      assert.notEqual(loadFeatures(), first);
    });
  });

  test('built-in profiles answer when feature-profiles.yaml is absent', () => {
    asDefaultPaths(({ home }) => {
      writeFileSync(home, 'profile: proxy-only\n');
      assert.deepEqual(loadFeatures().enabled.sort(), ['llm-proxy', 'statusline']);
    });
  });
});

describe('helpers', () => {
  test('isEnabled resolves closed on a broken config rather than throwing', () => {
    // A malformed config must not take out a status-line render or a shell gate.
    writeHome('features:\n  lsl: [oops\n');
    assert.equal(isEnabled('lsl', opts()), false);
  });

  test('isEnabled agrees with loadFeatures', () => {
    writeHome('profile: proxy-only\n');
    const r = loadFeatures(opts());
    for (const id of FEATURE_IDS) {
      assert.equal(isEnabled(id, opts()), r.features[id].enabled, id);
    }
  });

  test('explain names the layer that decided', () => {
    writeHome('features:\n  codegraph: off\n');
    assert.match(explain('codegraph', opts()), /set explicitly in ~\/\.coding\/features\.yaml/);
  });

  test('explain rejects an unknown id', () => {
    assert.throws(() => explain('nope', opts()), FeatureConfigError);
  });
});

describe('snapshot', () => {
  test('writes a flat JSON the non-Node consumers can read', () => {
    const { writeSnapshot, readSnapshot } = require(join(REPO, 'lib/features/snapshot.cjs'));
    const repoDir = join(dir, 'repo');
    mkdirSync(join(repoDir, 'config'), { recursive: true });
    writeFileSync(join(repoDir, 'config', 'features.yaml'), 'profile: proxy-only\n');

    const { snapshot } = writeSnapshot({
      repoPath: repoDir,
      repoConfigPath: join(repoDir, 'config', 'features.yaml'),
      homeConfigPath: join(dir, 'absent.yaml'),
      profilesPath: PROFILES,
      env: {},
      force: true,
    });

    assert.equal(snapshot.features['llm-proxy'], true);
    assert.equal(snapshot.features.knowledge, false);
    assert.equal(snapshot.needsDocker, false);
    // Flat booleans, so `jq -r '.features.lsl'` and a grep both work.
    for (const v of Object.values(snapshot.features)) assert.equal(typeof v, 'boolean');

    assert.deepEqual(readSnapshot({ repoPath: repoDir }).enabled, snapshot.enabled);
  });
});

describe('the shipped team default', () => {
  // config/features.yaml is layer 2 — committed, shared by everyone who clones.
  const shipped = join(REPO, 'config', 'features.yaml');

  test('exists, so the layer is discoverable rather than folklore', () => {
    assert.ok(readFileSync(shipped, 'utf8').length > 0);
  });

  test('is inert — it states no opinion', () => {
    // Shipping it pre-populated with every feature `on` would silently override
    // any future change to the built-in defaults with a stale answer nobody had
    // revisited, and the override would be invisible precisely because it
    // agreed with what you already expected.
    const doc = yaml.load(readFileSync(shipped, 'utf8'));
    assert.ok(
      doc === null || Object.keys(doc).length === 0,
      `config/features.yaml must ship with everything commented out, got: ${JSON.stringify(doc)}`,
    );
  });

  test('parses, and resolves to the historical stack', () => {
    const r = loadFeatures({
      repoConfigPath: shipped,
      homeConfigPath: join(dir, 'absent.yaml'),
      profilesPath: PROFILES,
      env: {},
      force: true,
    });
    assert.deepEqual(r.disabled, []);
    assert.deepEqual(r.layers, [], 'an inert file must not appear as an applied layer');
  });

  test('documents every feature id, so the template cannot go stale', () => {
    const text = readFileSync(shipped, 'utf8');
    for (const id of FEATURE_IDS) {
      assert.match(text, new RegExp(`\\b${id.replace('-', '\\-')}\\b`), `${id} is not mentioned`);
    }
  });

  test('names only profiles that exist', () => {
    const profiles = Object.keys(loadProfiles(PROFILES));
    const named = [...readFileSync(shipped, 'utf8').matchAll(/^# profile: (\S+)/gm)].map((m) => m[1]);
    for (const name of named) {
      assert.ok(profiles.includes(name), `commented example names unknown profile '${name}'`);
    }
  });
});

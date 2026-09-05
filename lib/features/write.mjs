/**
 * Writing the per-machine feature layer (~/.coding/features.yaml).
 *
 * Shared by `bin/coding-features` and the health coordinator's /features API,
 * which is what the dashboard's editor talks to. Two writers of the same file
 * with two copies of the rules is how a config ends up with a shape only one of
 * them understands, so the rules live here once.
 *
 * The repo's config/features.yaml is deliberately NOT written: it is the
 * committed team/project default, and a local preference must not clobber it.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import yaml from 'js-yaml';

import {
  loadFeatures, invalidateFeatures, configPaths, FeatureConfigError, FEATURES, FEATURE_IDS,
} from './index.mjs';

const HEADER = `# coding — per-machine feature selection.
#
# Written by \`coding-features\` and by the dashboard (Health → Features).
# Overrides <repo>/config/features.yaml; overridden in turn by
# CODING_FEATURE_<ID> environment variables.
#
# See docs/architecture/features.md.
`;

/** Read the current home layer as a plain object ({} when absent). */
export function readHomeConfig(opts = {}) {
  const file = opts.homeConfigPath || configPaths(opts).home;
  if (!existsSync(file)) return {};
  try {
    const doc = yaml.load(readFileSync(file, 'utf8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  } catch (err) {
    throw new FeatureConfigError(`~/.coding/features.yaml is not valid YAML: ${err.message}`);
  }
}

/**
 * Write the home layer and return the feature set it resolves to.
 *
 * Validation happens AFTER the merge, by re-resolving: a change can be legal on
 * its own and still contradict the rest of the file (an unknown profile, a
 * feature id that no longer exists). Re-resolving is the only check that sees
 * the whole picture.
 *
 * @throws {FeatureConfigError} leaving the file as written, so the caller can
 *   report what is wrong rather than silently reverting to something the user
 *   did not ask for.
 */
export function writeHomeConfig(doc, opts = {}) {
  const file = opts.homeConfigPath || configPaths(opts).home;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${HEADER}\n${yaml.dump(doc, { lineWidth: 100, noRefs: true })}`);
  invalidateFeatures();
  return loadFeatures({ ...opts, force: true });
}

/**
 * Apply a partial {id: boolean} change to the home layer.
 *
 * @param {Record<string, boolean>} changes
 * @param {{profile?: string|null}} [patch] `profile: null` clears it.
 */
export function setFeatures(changes, patch = {}, opts = {}) {
  for (const [id, value] of Object.entries(changes)) {
    if (!FEATURES[id]) {
      throw new FeatureConfigError(
        `unknown feature '${id}'. Known features: ${FEATURE_IDS.join(', ')}`,
      );
    }
    if (typeof value !== 'boolean') {
      throw new FeatureConfigError(`feature '${id}' must be true or false, got ${JSON.stringify(value)}`);
    }
  }

  const doc = readHomeConfig(opts);
  if ('profile' in patch) {
    if (patch.profile === null) delete doc.profile;
    else doc.profile = patch.profile;
  }
  const features = { ...(doc.features || {}), ...changes };
  if (Object.keys(features).length) doc.features = features;
  else delete doc.features;

  return writeHomeConfig(doc, opts);
}

/**
 * Switch to a named profile.
 *
 * Explicit per-feature overrides from a previous selection are DROPPED: they
 * would silently survive the switch and make the new profile a lie. Choosing a
 * profile is a deliberate reset, and the dropped ids are returned so the caller
 * can say so.
 */
export function setProfile(name, opts = {}) {
  const doc = readHomeConfig(opts);
  const dropped = Object.keys(doc.features || {});
  delete doc.features;
  doc.profile = name;
  return { resolved: writeHomeConfig(doc, opts), dropped };
}

/**
 * ESM view of the feature resolver.
 *
 * A re-export, not a second implementation. The resolver itself is CommonJS
 * (lib/features/resolve.cjs) because the status line is CJS and renders on every
 * prompt; duplicating the layering logic here is exactly the kind of drift that
 * makes two callers disagree about which features are on.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const impl = require('./resolve.cjs');

export const {
  FeatureConfigError,
  loadFeatures,
  isEnabled,
  explain,
  invalidateFeatures,
  configPaths,
  loadProfiles,
  FEATURES,
  FEATURE_IDS,
  envVarFor,
} = impl;

export default impl;

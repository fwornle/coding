/**
 * ESM view of the scope resolver.
 *
 * A re-export, not a second implementation — same reasoning as
 * lib/features/index.mjs. Two copies of "which tenant am I?" is the bug this
 * module was created to remove, so it must not be reintroduced by the bridge.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const impl = require('./resolve.cjs');

export const {
  ScopeError,
  DEFAULT_SCOPE,
  SCOPE_RE,
  SCOPE_MAX,
  resolveScope,
  requireScope,
  isPlaceholderScope,
  explain,
  normaliseScope,
  scopePaths,
  codingHome,
  toolsRepo,
  isToolsRepo,
  samePath,
} = impl;

export default impl;

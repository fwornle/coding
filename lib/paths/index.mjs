/**
 * ESM view of the data-root helper.
 *
 * A re-export, not a second implementation — same reasoning as
 * lib/features/index.mjs. Most consumers of these paths are ESM
 * (scripts/observations-api-server.mjs, lib/experiments/*.mjs,
 * integrations/semantic-analysis/src/*.ts); the implementation is CJS because the
 * status line is.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const impl = require('./data-home.cjs');

export const {
  dataHome,
  tokenUsageDb,
  proxyExportDir,
  activeMeasurementPath,
  autoMeasureDir,
  historyDir,
  kbDir,
  varDir,
  graphExportsDir,
  insightsDir,
  observationExportDir,
  knowledgeExportDir,
  graphDbDir,
  proxyDataDir,
  experimentsDir,
  kgbenchDir,
  measurementsDir,
  runSnapshotsDir,
  explain,
  ensureDataHome,
} = impl;

export default impl;

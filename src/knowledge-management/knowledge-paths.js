/**
 * Knowledge Management Path Configuration
 *
 * Provides centralized path resolution for knowledge management system.
 * Ensures ALL projects use the SAME central database in coding/.data/
 *
 * Architecture:
 * - ONE central LevelDB at coding/.data/knowledge-graph/
 * - ONE set of JSON exports at coding/.data/knowledge-export/
 * - Team isolation via node ID prefix pattern (team:entityName)
 * - NOT via separate databases per project
 */

import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the coding repository root directory
 *
 * Priority:
 * 1. CODING_TOOLS_PATH environment variable (set by bin/coding)
 * 2. CODING_REPO environment variable (legacy)
 * 3. Relative path from this file's location
 * 4. Fallback to ~/Agentic/coding
 *
 * @returns {string} Absolute path to coding repository
 */
export function getCodingRepoPath() {
  // Priority 1: Environment variable set by bin/coding
  if (process.env.CODING_TOOLS_PATH) {
    return path.resolve(process.env.CODING_TOOLS_PATH);
  }

  // Priority 2: Legacy CODING_REPO environment variable
  if (process.env.CODING_REPO) {
    return path.resolve(process.env.CODING_REPO);
  }

  // Priority 3: Relative path from this file (src/knowledge-management/knowledge-paths.js)
  const repoPath = path.join(__dirname, '..', '..');

  // Priority 4: Fallback to standard location
  const fallbackPath = path.join(os.homedir(), 'Agentic', 'coding');

  // Verify the path exists (prefer repoPath if it looks valid)
  try {
    const fs = await import('fs/promises');
    await fs.access(path.join(repoPath, 'package.json'));
    return repoPath;
  } catch {
    return fallbackPath;
  }
}

/**
 * Get the central knowledge graph database path
 *
 * @returns {string} Absolute path to .data/knowledge-graph/
 */
export function getKnowledgeGraphPath() {
  return path.join(getCodingRepoPath(), '.data', 'knowledge-graph');
}

/**
 * Get the central knowledge export directory path
 *
 * @returns {string} Absolute path to .data/knowledge-export/
 */
export function getKnowledgeExportPath() {
  return path.join(getCodingRepoPath(), '.data', 'knowledge-export');
}

/**
 * Get the knowledge configuration file path
 *
 * @returns {string} Absolute path to .data/knowledge-config.json
 */
export function getKnowledgeConfigPath() {
  return path.join(getCodingRepoPath(), '.data', 'knowledge-config.json');
}

/**
 * Get all knowledge management paths
 *
 * @returns {Object} Object containing all path configurations
 */
export function getKnowledgePaths() {
  const codingRepo = getCodingRepoPath();

  return {
    codingRepo,
    graphDbPath: getKnowledgeGraphPath(),
    exportDir: getKnowledgeExportPath(),
    configPath: getKnowledgeConfigPath(),
    dataDir: path.join(codingRepo, '.data')
  };
}

/**
 * Get diagnostic information about path resolution
 *
 * @returns {Object} Diagnostic information
 */
export function getPathDiagnostics() {
  return {
    codingToolsPath: process.env.CODING_TOOLS_PATH || null,
    codingRepo: process.env.CODING_REPO || null,
    resolvedCodingRepo: getCodingRepoPath(),
    currentWorkingDir: process.cwd(),
    scriptDir: __dirname,
    paths: getKnowledgePaths()
  };
}

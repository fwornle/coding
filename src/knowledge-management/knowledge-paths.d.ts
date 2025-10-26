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
export function getCodingRepoPath(): string;
/**
 * Get the central knowledge graph database path
 *
 * @returns {string} Absolute path to .data/knowledge-graph/
 */
export function getKnowledgeGraphPath(): string;
/**
 * Get the central knowledge export directory path
 *
 * @returns {string} Absolute path to .data/knowledge-export/
 */
export function getKnowledgeExportPath(): string;
/**
 * Get the knowledge configuration file path
 *
 * @returns {string} Absolute path to .data/knowledge-config.json
 */
export function getKnowledgeConfigPath(): string;
/**
 * Get all knowledge management paths
 *
 * @returns {Object} Object containing all path configurations
 */
export function getKnowledgePaths(): Object;
/**
 * Get diagnostic information about path resolution
 *
 * @returns {Object} Diagnostic information
 */
export function getPathDiagnostics(): Object;

/**
 * loggingConfig.ts
 *
 * Configuration for the Logger module - System Health Dashboard.
 * Defines levels, categories, and their associated properties.
 */

// Configure individual level properties
interface LogLevelConfig {
  name: string;
  value: number;
}

interface LogCategoryConfig {
  name: string;
  logColorKey: string;
}

// Define levels with names and values for potential numeric comparison later
const LOG_LEVELS: Record<string, LogLevelConfig> = {
  ERROR: { name: 'ERROR', value: 0 },
  WARN:  { name: 'WARN',  value: 1 },
  INFO:  { name: 'INFO',  value: 2 },
  DEBUG: { name: 'DEBUG', value: 3 },
  TRACE: { name: 'TRACE', value: 4 },
};

// Configure individual category properties for the System Health Dashboard
const LOG_CATEGORIES: Record<string, LogCategoryConfig> = {
  // Core categories
  DEFAULT:     { name: 'DEFAULT',     logColorKey: 'logDefault' },     // General logs

  // UKB Workflow categories
  UKB:         { name: 'UKB',         logColorKey: 'logLifecycle' },   // UKB workflow state
  AGENT:       { name: 'AGENT',       logColorKey: 'logApi' },         // Agent execution
  BATCH:       { name: 'BATCH',       logColorKey: 'logServer' },      // Batch processing
  TRACE:       { name: 'TRACE',       logColorKey: 'logPerformance' }, // Tracer events

  // Redux/Store categories
  STORE:       { name: 'STORE',       logColorKey: 'logStore' },       // Redux state changes
  REFRESH:     { name: 'REFRESH',     logColorKey: 'logCache' },       // Data refresh cycles

  // Health monitoring
  HEALTH:      { name: 'HEALTH',      logColorKey: 'logData' },        // Health checks
  API:         { name: 'API',         logColorKey: 'logApi' },         // API calls

  // UI categories
  UI:          { name: 'UI',          logColorKey: 'logUi' },          // UI components
  MODAL:       { name: 'MODAL',       logColorKey: 'logRouter' },      // Modal state
};

// Export constants for use in the Logger and potentially elsewhere
export const LogLevels = Object.keys(LOG_LEVELS).reduce((acc, key) => {
  acc[key] = LOG_LEVELS[key].name;
  return acc;
}, {} as Record<string, string>);

export const LogCategories = Object.keys(LOG_CATEGORIES).reduce((acc, key) => {
  acc[key] = LOG_CATEGORIES[key].name;
  return acc;
}, {} as Record<string, string>);

// Export the raw configuration objects as well, needed by the Logger for styling/filtering
export const levelsConfig = LOG_LEVELS;
export const categoriesConfig = LOG_CATEGORIES;

// Define initial active state - start with INFO level and all categories
export const initialActiveLevels = [LogLevels.ERROR, LogLevels.WARN, LogLevels.INFO, LogLevels.DEBUG];
export const initialActiveCategories = Object.values(LogCategories);

// Export types for TypeScript
export type LogLevel = keyof typeof LogLevels;
export type LogCategory = keyof typeof LogCategories;
export type { LogLevelConfig, LogCategoryConfig };

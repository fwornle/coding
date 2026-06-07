/**
 * loggingConfig.ts — unified-viewer logging categories and levels.
 *
 * Categories are adapted to THIS app (per feedback_logger_class.md):
 *   Routing, Api, Store, Graph, Filters, Panels, Logger (meta), Default
 *
 * Levels preserved verbatim from VOKB: ERROR / WARN / INFO / DEBUG / TRACE.
 */

interface LogLevelConfig {
  name: string
  value: number
}

interface LogCategoryConfig {
  name: string
  logColorKey: string
}

const LOG_LEVELS: Record<string, LogLevelConfig> = {
  ERROR: { name: 'ERROR', value: 0 },
  WARN:  { name: 'WARN',  value: 1 },
  INFO:  { name: 'INFO',  value: 2 },
  DEBUG: { name: 'DEBUG', value: 3 },
  TRACE: { name: 'TRACE', value: 4 },
}

const LOG_CATEGORIES: Record<string, LogCategoryConfig> = {
  DEFAULT: { name: 'DEFAULT', logColorKey: 'logDefault' },
  ROUTING: { name: 'ROUTING', logColorKey: 'logRouting' },
  API:     { name: 'API',     logColorKey: 'logApi' },
  STORE:   { name: 'STORE',   logColorKey: 'logStore' },
  GRAPH:   { name: 'GRAPH',   logColorKey: 'logGraph' },
  FILTERS: { name: 'FILTERS', logColorKey: 'logFilters' },
  PANELS:  { name: 'PANELS',  logColorKey: 'logPanels' },
  LOGGER:  { name: 'LOGGER',  logColorKey: 'logLogger' },
}

export const LogLevels = Object.keys(LOG_LEVELS).reduce((acc, key) => {
  acc[key] = LOG_LEVELS[key].name
  return acc
}, {} as Record<string, string>)

export const LogCategories = Object.keys(LOG_CATEGORIES).reduce((acc, key) => {
  acc[key] = LOG_CATEGORIES[key].name
  return acc
}, {} as Record<string, string>)

export const levelsConfig = LOG_LEVELS
export const categoriesConfig = LOG_CATEGORIES

/** Defaults: production-noise-floor (ERROR + WARN + INFO). DEBUG / TRACE opt-in. */
export const initialActiveLevels = [LogLevels.ERROR, LogLevels.WARN, LogLevels.INFO]
export const initialActiveCategories = Object.values(LogCategories)

export type LogLevel = keyof typeof LogLevels
export type LogCategory = keyof typeof LogCategories
export type { LogLevelConfig, LogCategoryConfig }

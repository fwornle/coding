/**
 * Public surface for the unified-viewer Logger module.
 * Consumers SHOULD import from here, never from the nested files:
 *
 *   import { Logger } from '@/lib/logging'
 *   Logger.info(Logger.Categories.ROUTING, 'Mounted /viewer/coding')
 */

export { Logger } from './Logger'
export { LogLevels, LogCategories } from './config/loggingConfig'
export { loggingColors } from './config/loggingColors'

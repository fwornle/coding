/**
 * loggingColors.ts — Color configuration for the unified-viewer logging system.
 * Ported verbatim from VOKB
 * (_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/utils/logging/config/loggingColors.ts).
 *
 * No-logic-changes port: hex/rgba palette identical to VOKB so the on-screen
 * colour treatment of the logger stays familiar across projects.
 */

export const baseColors = {
  white: '#ffffff',
  black: '#000000',
  lightGrey: '#cccccc',
  darkGrey: '#666666',
}

export const alertColors = {
  logErrorBg: 'rgba(220, 53, 69, 1)',
  logWarnBg: 'rgba(255, 193, 7, 1)',
}

/**
 * Per-category background palette. Keys match `categoriesConfig[*].logColorKey`
 * in ./loggingConfig.ts; missing keys fall back to `logDefault` inside Logger.log.
 */
export const categoryColors = {
  logDefault: 'rgba(108, 117, 125, 1)',
  logRouting: 'rgba(40, 167, 69, 1)',
  logApi: 'rgba(111, 66, 193, 1)',
  logStore: 'rgba(75, 192, 192, 1)',
  logGraph: 'rgba(255, 159, 64, 1)',
  logFilters: 'rgba(13, 202, 240, 1)',
  logPanels: 'rgba(0, 123, 255, 1)',
  logLogger: 'rgba(214, 51, 132, 1)',
}

export const loggingColors = {
  ...baseColors,
  ...alertColors,
  ...categoryColors,
}

export { baseColors as colors }
export default loggingColors

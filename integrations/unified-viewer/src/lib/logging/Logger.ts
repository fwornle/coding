/**
 * Logger.ts — Categorized, colored logging with configurable verbosity.
 * Ported from VOKB's `viewer/src/utils/logging/Logger.ts` (Phase 45 — Plan 03 Task 0).
 *
 * Why this file uses `console.*` directly:
 *   This file IS the project-wide console abstraction. Every other module in
 *   `integrations/unified-viewer/src/` MUST go through Logger.* (per the
 *   `feedback_logger_class.md` rule and the `no-console-log` constraint).
 *   The audit grep `grep -rn 'console\.' src/` MUST stay at zero matches
 *   outside this file.
 *
 * Persistence:
 *   - Active levels: `unifiedViewer_activeLogLevels`
 *   - Active categories: `unifiedViewer_activeLogCategories`
 *   (Renamed from VOKB's `vokb_*` keys per Task 0 spec.)
 */

import {
  LogLevels,
  LogCategories,
  categoriesConfig,
  initialActiveLevels,
  initialActiveCategories,
} from './config/loggingConfig'
import { loggingColors, colors } from './config/loggingColors'

const STORAGE_KEY_LEVELS = 'unifiedViewer_activeLogLevels'
const STORAGE_KEY_CATEGORIES = 'unifiedViewer_activeLogCategories'

function getLuminance(rgb: number[]): number {
  if (!rgb || rgb.length < 3) return 0
  const [r, g, b] = rgb.map((c) => {
    const srgb = c / 255.0
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function parseColorToRgb(colorString: string): number[] | null {
  if (!colorString) return null
  if (colorString.startsWith('#')) {
    const bigint = parseInt(colorString.slice(1), 16)
    if (isNaN(bigint)) return null
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255]
  } else if (colorString.startsWith('rgba(') || colorString.startsWith('rgb(')) {
    const inner = colorString.substring(colorString.indexOf('(') + 1, colorString.length - 1)
    const parts = inner.split(',').map((s) => parseFloat(s.trim()))
    if (parts.length >= 3 && parts.slice(0, 3).every((p) => !isNaN(p))) {
      return parts.slice(0, 3).map((p) => Math.round(p))
    }
  }
  return null
}

function getAdjustedColorForLevel(baseRgb: number[], level: string): string {
  if (!baseRgb || baseRgb.length < 3) return 'rgba(128, 128, 128, 1)'
  let [r, g, b] = baseRgb
  let lightenFactor = 0
  if (level === LogLevels.DEBUG) lightenFactor = 0.3
  else if (level === LogLevels.TRACE) lightenFactor = 0.55

  if (lightenFactor > 0) {
    const p = lightenFactor
    r = Math.min(255, Math.max(0, Math.round(r * (1 - p) + 255 * p)))
    g = Math.min(255, Math.max(0, Math.round(g * (1 - p) + 255 * p)))
    b = Math.min(255, Math.max(0, Math.round(b * (1 - p) + 255 * p)))
  }
  return `rgba(${r}, ${g}, ${b}, 1)`
}

/* eslint-disable no-console -- Logger IS the console abstraction */

export class Logger {
  private static activeLevels = Logger._loadSetting(STORAGE_KEY_LEVELS, initialActiveLevels)
  private static activeCategories = Logger._loadSetting(
    STORAGE_KEY_CATEGORIES,
    initialActiveCategories,
  )

  static readonly Levels = LogLevels
  static readonly Categories = LogCategories

  private static _loadSetting(key: string, defaultValue: string[]): Set<string> {
    try {
      if (typeof localStorage === 'undefined') return new Set(defaultValue)
      const stored = localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) return new Set(parsed)
      }
    } catch {
      // ignore
    }
    return new Set(defaultValue)
  }

  private static _saveSetting(key: string, valueSet: Set<string>): void {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(key, JSON.stringify(Array.from(valueSet)))
    } catch {
      // ignore
    }
  }

  /**
   * Re-read state from localStorage. Test-only entry point — used by the
   * persistence round-trip test which writes to localStorage outside this
   * class and then needs the cache invalidated.
   */
  static _reloadFromStorage(): void {
    Logger.activeLevels = Logger._loadSetting(STORAGE_KEY_LEVELS, initialActiveLevels)
    Logger.activeCategories = Logger._loadSetting(
      STORAGE_KEY_CATEGORIES,
      initialActiveCategories,
    )
  }

  static log(level: string, category: string, ...messages: unknown[]): void {
    const levelName = level || LogLevels.INFO
    const categoryName = category || LogCategories.DEFAULT

    if (!Logger.activeLevels.has(levelName) || !Logger.activeCategories.has(categoryName)) return

    const categoryConf = categoriesConfig[categoryName] || categoriesConfig.DEFAULT
    let bgColor: string
    let fgColor = colors.white
    let fontWeight = 'normal'

    if (levelName === LogLevels.ERROR) {
      bgColor = loggingColors.logErrorBg
      fgColor = colors.white
      fontWeight = 'bold'
    } else if (levelName === LogLevels.WARN) {
      bgColor = loggingColors.logWarnBg
      fgColor = colors.black
      fontWeight = 'bold'
    } else {
      const baseCategoryColorString =
        loggingColors[categoryConf.logColorKey as keyof typeof loggingColors] ||
        loggingColors.logDefault
      const baseRgb = parseColorToRgb(baseCategoryColorString)
      if (baseRgb) {
        bgColor = getAdjustedColorForLevel(baseRgb, levelName)
        const finalRgb = parseColorToRgb(bgColor)
        if (finalRgb) {
          fgColor = getLuminance(finalRgb) < 0.45 ? colors.white : colors.black
        } else {
          bgColor = baseCategoryColorString
        }
      } else {
        bgColor = loggingColors.logDefault
      }
    }

    const styles = [
      `background-color: ${bgColor}`,
      `color: ${fgColor}`,
      `font-weight: ${fontWeight}`,
      'padding: 1px 4px',
      'border-radius: 3px',
    ].join(';')

    const prefix = `%c[${categoryName}] [${levelName}]`

    switch (levelName) {
      case LogLevels.ERROR:
        console.error(prefix, styles, ...messages)
        break
      case LogLevels.WARN:
        console.warn(prefix, styles, ...messages)
        break
      case LogLevels.INFO:
        console.info(prefix, styles, ...messages)
        break
      case LogLevels.DEBUG:
        console.debug(prefix, styles, ...messages)
        break
      default:
        // TRACE + any unrecognised level → fall back to console.info (matches VOKB).
        console.info(prefix, styles, ...messages)
        break
    }
  }

  static error(category: string, ...messages: unknown[]): void {
    Logger.log(LogLevels.ERROR, category, ...messages)
  }
  static warn(category: string, ...messages: unknown[]): void {
    Logger.log(LogLevels.WARN, category, ...messages)
  }
  static info(category: string, ...messages: unknown[]): void {
    Logger.log(LogLevels.INFO, category, ...messages)
  }
  static debug(category: string, ...messages: unknown[]): void {
    Logger.log(LogLevels.DEBUG, category, ...messages)
  }
  static trace(category: string, ...messages: unknown[]): void {
    Logger.log(LogLevels.TRACE, category, ...messages)
  }

  static setActiveLevels(levelsIterable: Iterable<string>): void {
    const valid = Object.values(LogLevels)
    const newSet = new Set<string>()
    for (const lvl of levelsIterable) {
      if (valid.includes(lvl)) newSet.add(lvl)
    }
    Logger.activeLevels = newSet
    Logger._saveSetting(STORAGE_KEY_LEVELS, Logger.activeLevels)
  }

  static setActiveCategories(categoriesIterable: Iterable<string>): void {
    const valid = Object.values(LogCategories)
    const newSet = new Set<string>()
    for (const cat of categoriesIterable) {
      if (valid.includes(cat)) newSet.add(cat)
    }
    Logger.activeCategories = newSet
    Logger._saveSetting(STORAGE_KEY_CATEGORIES, Logger.activeCategories)
  }

  static getActiveLevels(): Set<string> {
    return new Set(Logger.activeLevels)
  }

  static getActiveCategories(): Set<string> {
    return new Set(Logger.activeCategories)
  }

  static enableCategory(name: string): void {
    if (Object.values(LogCategories).includes(name) && !Logger.activeCategories.has(name)) {
      Logger.activeCategories.add(name)
      Logger._saveSetting(STORAGE_KEY_CATEGORIES, Logger.activeCategories)
    }
  }

  static disableCategory(name: string): void {
    if (Logger.activeCategories.delete(name)) {
      Logger._saveSetting(STORAGE_KEY_CATEGORIES, Logger.activeCategories)
    }
  }
}

/* eslint-enable no-console */

export default Logger

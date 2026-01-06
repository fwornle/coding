/**
 * Logger.ts
 *
 * TypeScript Logger class for the application.
 * Provides categorized, colored logging with configurable verbosity levels.
 */

import {
  LogLevels,
  LogCategories,
  categoriesConfig,
  initialActiveLevels,
  initialActiveCategories
} from './config/loggingConfig';
import { loggingColors, colors } from './config/loggingColors';

// --- Color Helper Functions ---

/**
 * Calculates perceived luminance of an RGB color.
 * Formula from WCAG 2.0
 */
function getLuminance(rgb: number[]): number {
  if (!rgb || rgb.length < 3) return 0;
  const [r, g, b] = rgb.map(c => {
    const srgb = c / 255.0;
    return (srgb <= 0.03928) ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Parses a color string (hex, rgb, rgba) into an [r, g, b] array.
 */
function parseColorToRgb(colorString: string): number[] | null {
  if (!colorString) return null;

  if (colorString.startsWith('#')) {
    const bigint = parseInt(colorString.slice(1), 16);
    if (isNaN(bigint)) return null;
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b];
  } else if (colorString.startsWith('rgb(')) {
    const parts = colorString.substring(4, colorString.length - 1).split(',').map(s => parseInt(s.trim(), 10));
    if (parts.length === 3 && parts.every(p => !isNaN(p))) {
      return parts;
    }
  } else if (colorString.startsWith('rgba(')) {
    const parts = colorString.substring(5, colorString.length - 1).split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 4 && parts.slice(0, 3).every(p => !isNaN(p))) {
      return parts.slice(0, 3).map(p => Math.round(p));
    }
  }
  return null;
}

/**
 * Adjusts the brightness of an RGB color for different log levels.
 */
function getAdjustedColorForLevel(baseRgb: number[], level: string): string {
  if (!baseRgb || baseRgb.length < 3) return 'rgba(128, 128, 128, 1)';

  let [r, g, b] = baseRgb;
  const alpha = 1;

  // Determine lightness adjustment factor
  let lightenFactor = 0;
  if (level === LogLevels.DEBUG) {
    lightenFactor = 0.3; // Lighten DEBUG by 30%
  } else if (level === LogLevels.TRACE) {
    lightenFactor = 0.55; // Lighten TRACE by 55%
  }

  if (lightenFactor > 0) {
    // Mix with white based on the factor
    const p = lightenFactor;
    r = Math.round(r * (1 - p) + 255 * p);
    g = Math.round(g * (1 - p) + 255 * p);
    b = Math.round(b * (1 - p) + 255 * p);
    // Ensure values stay within 0-255 bounds
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class Logger {
  // --- Active State ---
  private static activeLevels = Logger._loadSetting('activeLogLevels', initialActiveLevels);
  private static activeCategories = Logger._loadSetting('activeLogCategories', initialActiveCategories);

  // Expose constants for easier access
  static readonly Levels = LogLevels;
  static readonly Categories = LogCategories;

  /** Helper to load settings from localStorage */
  private static _loadSetting(key: string, defaultValue: string[]): Set<string> {
    try {
      const storedValue = localStorage.getItem(key);
      if (storedValue) {
        const parsedValue = JSON.parse(storedValue);
        if (Array.isArray(parsedValue)) {
          return new Set(parsedValue);
        }
      }
    } catch (e) {
      console.error(`[Logger] Error loading ${key} from localStorage:`, e);
    }
    return new Set(defaultValue);
  }

  /** Helper to save settings to localStorage */
  private static _saveSetting(key: string, valueSet: Set<string>): void {
    try {
      const valueArray = Array.from(valueSet);
      localStorage.setItem(key, JSON.stringify(valueArray));
    } catch (e) {
      console.error(`[Logger] Error saving ${key} to localStorage:`, e);
    }
  }

  /**
   * Main log method with filtering and styling.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static log(level: string, category: string, ...messages: any[]): void {
    const levelName = level || LogLevels.INFO;
    const categoryName = category || LogCategories.DEFAULT;

    if (!Logger.activeLevels.has(levelName) || !Logger.activeCategories.has(categoryName)) {
      return;
    }

    const categoryConf = categoriesConfig[categoryName] || categoriesConfig.DEFAULT;
    let bgColor: string;
    let fgColor = colors.white;
    let fontWeight = 'normal';

    // Color logic with shading
    if (levelName === LogLevels.ERROR) {
      bgColor = loggingColors.logErrorBg;
      fgColor = colors.white;
      fontWeight = 'bold';
    } else if (levelName === LogLevels.WARN) {
      bgColor = loggingColors.logWarnBg;
      fgColor = colors.black;
      fontWeight = 'bold';
    } else {
      // INFO, DEBUG, TRACE use variations of category color
      const baseCategoryColorString = loggingColors[categoryConf.logColorKey as keyof typeof loggingColors] || loggingColors.logDefault;
      const baseRgb = parseColorToRgb(baseCategoryColorString);

      if (baseRgb) {
        bgColor = getAdjustedColorForLevel(baseRgb, levelName);

        // Determine text color based on luminance
        const finalRgb = parseColorToRgb(bgColor);
        if (finalRgb) {
          const lum = getLuminance(finalRgb);
          fgColor = lum < 0.45 ? colors.white : colors.black;
        } else {
          bgColor = baseCategoryColorString;
          fgColor = colors.white;
        }
      } else {
        bgColor = loggingColors.logDefault;
        fgColor = colors.white;
      }
      fontWeight = 'normal';
    }

    const styles = [
      `background-color: ${bgColor}`,
      `color: ${fgColor}`,
      `font-weight: ${fontWeight}`,
      'padding: 1px 4px',
      'border-radius: 3px'
    ].join(';');

    const prefix = `%c[${categoryName}] [${levelName}]`;

    // Use appropriate console method based on level
    switch (levelName) {
      case LogLevels.ERROR:
        console.error(prefix, styles, ...messages);
        break;
      case LogLevels.WARN:
        console.warn(prefix, styles, ...messages);
        break;
      case LogLevels.INFO:
        console.info(prefix, styles, ...messages);
        break;
      case LogLevels.DEBUG:
      case LogLevels.TRACE:
      default:
        if (levelName === LogLevels.DEBUG && typeof console.debug === 'function') {
          console.debug(prefix, styles, ...messages);
        } else {
          console.log(prefix, styles, ...messages);
        }
        break;
    }
  }

  // --- Convenience methods for each level ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static error(category: string, ...messages: any[]): void {
    Logger.log(LogLevels.ERROR, category, ...messages);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static warn(category: string, ...messages: any[]): void {
    Logger.log(LogLevels.WARN, category, ...messages);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static info(category: string, ...messages: any[]): void {
    Logger.log(LogLevels.INFO, category, ...messages);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static debug(category: string, ...messages: any[]): void {
    Logger.log(LogLevels.DEBUG, category, ...messages);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static trace(category: string, ...messages: any[]): void {
    Logger.log(LogLevels.TRACE, category, ...messages);
  }

  // --- Methods to control active state ---

  /**
   * Sets the currently active log levels.
   */
  static setActiveLevels(levelsIterable: Iterable<string>): void {
    const validLevels = Object.values(LogLevels);
    const newActiveSet = new Set<string>();

    try {
      for (const lvl of levelsIterable) {
        if (validLevels.includes(lvl)) {
          newActiveSet.add(lvl);
        }
      }
    } catch (e) {
      console.error('[Logger] setActiveLevels requires an iterable argument.', e);
      return;
    }

    Logger.activeLevels = newActiveSet;
    Logger._saveSetting('activeLogLevels', Logger.activeLevels);
  }

  /**
   * Sets the currently active log categories.
   */
  static setActiveCategories(categoriesIterable: Iterable<string>): void {
    const validCategories = Object.values(LogCategories);
    const newActiveSet = new Set<string>();

    try {
      for (const cat of categoriesIterable) {
        if (validCategories.includes(cat)) {
          newActiveSet.add(cat);
        }
      }
    } catch (e) {
      console.error('[Logger] setActiveCategories requires an iterable argument.', e);
      return;
    }

    Logger.activeCategories = newActiveSet;
    Logger._saveSetting('activeLogCategories', Logger.activeCategories);
  }

  /**
   * Gets the currently active log levels.
   */
  static getActiveLevels(): Set<string> {
    return new Set(Logger.activeLevels);
  }

  /**
   * Gets the currently active log categories.
   */
  static getActiveCategories(): Set<string> {
    return new Set(Logger.activeCategories);
  }

  /**
   * Enables a specific log category.
   */
  static enableCategory(categoryName: string): void {
    if (!Object.values(LogCategories).includes(categoryName)) {
      console.warn(`[Logger] Attempted to enable invalid category: ${categoryName}`);
      return;
    }

    if (!Logger.activeCategories.has(categoryName)) {
      Logger.activeCategories.add(categoryName);
      Logger._saveSetting('activeLogCategories', Logger.activeCategories);
    }
  }

  /**
   * Disables a specific log category.
   */
  static disableCategory(categoryName: string): void {
    if (Logger.activeCategories.delete(categoryName)) {
      Logger._saveSetting('activeLogCategories', Logger.activeCategories);
    }
  }
}

// Export for compatibility
export default Logger;

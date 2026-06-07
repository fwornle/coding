// PATTERN SOURCE: feedback_logger_class.md — Task 0 of Plan 45-03
//
// Logger contract tests. The Logger class is THIS app's only allowed
// console.* site (per the audit grep gate). Behaviour mirrors VOKB's
// production Logger; tests here lock in:
//
//   1. Level filter (INFO suppressed when only ERROR/WARN active)
//   2. Category filter (INFO on disabled category suppressed)
//   3. localStorage persistence round-trip (set → reload → identical)
//   4. TRACE-level falls back to console.info (not a missing-method crash)
//   5. Public surface matches VOKB (`Levels`, `Categories`, get/set/enable/disable)

import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Logger } from './Logger'
import { LogCategories, LogLevels } from './config/loggingConfig'

describe('Logger', () => {
  // Capture console.* calls per-test. Reset between tests. The MockInstance
  // generic stays unparameterised — strict typing here would couple to
  // vitest's internal MockInstance shape, which differs between minor
  // versions; the cast at spy assignment time is good enough.
  let errorSpy: MockInstance
  let warnSpy: MockInstance
  let infoSpy: MockInstance
  let debugSpy: MockInstance

  beforeEach(() => {
    // Clean localStorage between tests so default state is predictable.
    // jsdom's Storage has `removeItem` but the `clear()` polyfill is missing
    // in some versions — strip only our keys.
    try {
      localStorage.removeItem('unifiedViewer_activeLogLevels')
      localStorage.removeItem('unifiedViewer_activeLogCategories')
    } catch {
      // ignore
    }
    Logger._reloadFromStorage()
    // Defaults: ERROR + WARN + INFO active, ALL categories active.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
    infoSpy.mockRestore()
    debugSpy.mockRestore()
  })

  test('public surface — Levels and Categories exposed as static maps', () => {
    expect(Logger.Levels.ERROR).toBe('ERROR')
    expect(Logger.Levels.WARN).toBe('WARN')
    expect(Logger.Levels.INFO).toBe('INFO')
    expect(Logger.Levels.DEBUG).toBe('DEBUG')
    expect(Logger.Levels.TRACE).toBe('TRACE')
    // Categories adapted to unified-viewer
    expect(Logger.Categories.ROUTING).toBe('ROUTING')
    expect(Logger.Categories.API).toBe('API')
    expect(Logger.Categories.STORE).toBe('STORE')
    expect(Logger.Categories.GRAPH).toBe('GRAPH')
    expect(Logger.Categories.FILTERS).toBe('FILTERS')
    expect(Logger.Categories.PANELS).toBe('PANELS')
    expect(Logger.Categories.LOGGER).toBe('LOGGER')
    expect(Logger.Categories.DEFAULT).toBe('DEFAULT')
  })

  test('level filter — INFO NOT logged when only ERROR + WARN active', () => {
    Logger.setActiveLevels([LogLevels.ERROR, LogLevels.WARN])
    Logger.info(Logger.Categories.API, 'should be filtered out')
    Logger.warn(Logger.Categories.API, 'should pass')
    Logger.error(Logger.Categories.API, 'should pass too')
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  test('category filter — INFO on disabled category NOT logged', () => {
    Logger.setActiveCategories([Logger.Categories.ROUTING]) // API disabled
    Logger.info(Logger.Categories.API, 'API disabled — should be suppressed')
    Logger.info(Logger.Categories.ROUTING, 'ROUTING enabled — should pass')
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const call = infoSpy.mock.calls[0]
    // Prefix is the first arg
    expect(call[0]).toContain('[ROUTING]')
    expect(call[0]).toContain('[INFO]')
  })

  test('localStorage persistence — setActiveCategories survives reload', () => {
    Logger.setActiveCategories([Logger.Categories.ROUTING, Logger.Categories.STORE])
    // Inspect what got written
    const raw = localStorage.getItem('unifiedViewer_activeLogCategories')
    expect(raw).toBeTruthy()
    // Force the singleton to forget its in-memory state and re-read from
    // localStorage — simulates a fresh page load.
    Logger._reloadFromStorage()
    const restored = Logger.getActiveCategories()
    expect(restored.has(Logger.Categories.ROUTING)).toBe(true)
    expect(restored.has(Logger.Categories.STORE)).toBe(true)
    expect(restored.has(Logger.Categories.API)).toBe(false)
    expect(restored.has(Logger.Categories.GRAPH)).toBe(false)
  })

  test('localStorage persistence — setActiveLevels survives reload', () => {
    Logger.setActiveLevels([LogLevels.ERROR])
    Logger._reloadFromStorage()
    const restored = Logger.getActiveLevels()
    expect(restored.has(LogLevels.ERROR)).toBe(true)
    expect(restored.has(LogLevels.INFO)).toBe(false)
    expect(restored.has(LogLevels.WARN)).toBe(false)
  })

  test('TRACE level falls back to console.info (no missing-method crash)', () => {
    Logger.setActiveLevels([LogLevels.TRACE]) // only TRACE
    Logger.trace(Logger.Categories.GRAPH, 'trace payload')
    // The switch routes TRACE → console.info per the port (not console.trace,
    // which would print a stack trace).
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const args = infoSpy.mock.calls[0]
    expect(args[0]).toContain('[TRACE]')
    expect(args[0]).toContain('[GRAPH]')
  })

  test('DEBUG level routes to console.debug', () => {
    Logger.setActiveLevels([LogLevels.DEBUG])
    Logger.debug(Logger.Categories.STORE, 'debug payload')
    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy.mock.calls[0][0]).toContain('[DEBUG]')
  })

  test('enableCategory / disableCategory mutate the active set and persist', () => {
    Logger.setActiveCategories([Logger.Categories.ROUTING])
    Logger.enableCategory(Logger.Categories.API)
    expect(Logger.getActiveCategories().has(Logger.Categories.API)).toBe(true)
    Logger.disableCategory(Logger.Categories.ROUTING)
    expect(Logger.getActiveCategories().has(Logger.Categories.ROUTING)).toBe(false)
    // Persistence
    Logger._reloadFromStorage()
    const restored = Logger.getActiveCategories()
    expect(restored.has(Logger.Categories.API)).toBe(true)
    expect(restored.has(Logger.Categories.ROUTING)).toBe(false)
  })

  test('setActive* rejects invalid level/category names', () => {
    Logger.setActiveLevels(['ERROR', 'BOGUS_LEVEL'])
    const levels = Logger.getActiveLevels()
    expect(levels.has('ERROR')).toBe(true)
    expect(levels.has('BOGUS_LEVEL')).toBe(false)

    Logger.setActiveCategories([Logger.Categories.API, 'NOT_A_CATEGORY'])
    const cats = Logger.getActiveCategories()
    expect(cats.has(Logger.Categories.API)).toBe(true)
    expect(cats.has('NOT_A_CATEGORY')).toBe(false)
  })

  test('log() with no messages still emits the styled prefix', () => {
    // Sanity: the styling layer is the load-bearing part of the port; ensure
    // an empty message list does not skip the dispatch.
    Logger.info(Logger.Categories.DEFAULT)
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy.mock.calls[0][0]).toContain('[DEFAULT]')
    expect(infoSpy.mock.calls[0][0]).toContain('[INFO]')
  })

  test('LogCategories has FILTERS and PANELS (unified-viewer-specific)', () => {
    // Negative-assert that VOKB-specific categories that are inappropriate
    // here (MODAL, DATA, UI, SEARCH) are NOT in the unified-viewer's set.
    expect(LogCategories.MODAL).toBeUndefined()
    expect(LogCategories.SEARCH).toBeUndefined()
    expect(LogCategories.UI).toBeUndefined()
    expect(LogCategories.DATA).toBeUndefined()
    // And the unified-viewer set IS present
    expect(LogCategories.FILTERS).toBe('FILTERS')
    expect(LogCategories.PANELS).toBe('PANELS')
  })
})

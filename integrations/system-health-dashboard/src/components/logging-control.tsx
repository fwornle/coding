'use client'

/**
 * LoggingControl.tsx
 *
 * Professional UI component for controlling logging levels and categories.
 * Features color-coded categories and intelligent level activation logic.
 * Settings are persisted to localStorage via the Logger class.
 */

import React, { useState, useEffect } from 'react'
import { X, Terminal, Bug, Info, AlertTriangle, AlertCircle, Search } from 'lucide-react'
import { Logger, LogCategories, LogLevels } from '@/utils/logging'
import { loggingColors } from '@/utils/logging/config/loggingColors'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface LoggingControlProps {
  isOpen: boolean
  onClose: () => void
}

// Category descriptions for tooltip/display
const categoryDescriptions: Record<string, string> = {
  DEFAULT: 'General application logs',
  UKB: 'Knowledge base workflow state',
  AGENT: 'Multi-agent execution flow',
  BATCH: 'Batch processing operations',
  TRACE: 'Detailed tracer events',
  STORE: 'Redux state changes',
  REFRESH: 'Data refresh cycles',
  HEALTH: 'Health check operations',
  API: 'API requests and responses',
  UI: 'UI component lifecycle',
  MODAL: 'Modal state changes',
}

// Level icons
const levelIcons: Record<string, React.ReactNode> = {
  ERROR: <AlertCircle className="h-4 w-4" />,
  WARN: <AlertTriangle className="h-4 w-4" />,
  INFO: <Info className="h-4 w-4" />,
  DEBUG: <Bug className="h-4 w-4" />,
  TRACE: <Search className="h-4 w-4" />,
}

export const LoggingControl: React.FC<LoggingControlProps> = ({ isOpen, onClose }) => {
  // Local state for UI (initialized from Logger)
  const [activeLevels, setActiveLevels] = useState<Set<string>>(() => Logger.getActiveLevels())
  const [activeCategories, setActiveCategories] = useState<Set<string>>(() => Logger.getActiveCategories())

  // Helper function to compare Sets
  const setsEqual = (a: Set<string>, b: Set<string>): boolean => {
    if (a.size !== b.size) return false
    for (const item of a) {
      if (!b.has(item)) return false
    }
    return true
  }

  // Sync local state with Logger when modal opens
  useEffect(() => {
    if (isOpen) {
      const currentLevels = Logger.getActiveLevels()
      const currentCategories = Logger.getActiveCategories()

      setActiveLevels((prev) => (setsEqual(prev, currentLevels) ? prev : currentLevels))
      setActiveCategories((prev) => (setsEqual(prev, currentCategories) ? prev : currentCategories))

      Logger.info(LogCategories.MODAL, 'LoggingControl modal opened')
    }
  }, [isOpen])

  // Helper function to get level colors
  const getLevelColor = (level: string): string => {
    switch (level) {
      case LogLevels.ERROR: return '#dc3545'
      case LogLevels.WARN: return '#fd7e14'
      case LogLevels.INFO: return '#0d6efd'
      case LogLevels.DEBUG: return '#198754'
      case LogLevels.TRACE: return '#6f42c1'
      default: return '#6c757d'
    }
  }

  // Helper function to get level descriptions
  const getLevelDescription = (level: string): string => {
    switch (level) {
      case LogLevels.ERROR: return 'Critical errors and failures'
      case LogLevels.WARN: return 'Warnings and potential issues'
      case LogLevels.INFO: return 'General information messages'
      case LogLevels.DEBUG: return 'Detailed debugging information'
      case LogLevels.TRACE: return 'Very detailed execution traces'
      default: return ''
    }
  }

  // Helper function to get category colors
  const getCategoryColor = (category: string): string => {
    const colorMap: Record<string, string> = {
      'DEFAULT': loggingColors.logDefault,
      'UKB': loggingColors.logLifecycle,
      'AGENT': loggingColors.logApi,
      'BATCH': loggingColors.logServer,
      'TRACE': loggingColors.logPerformance,
      'STORE': loggingColors.logStore,
      'REFRESH': loggingColors.logCache,
      'HEALTH': loggingColors.logData,
      'API': loggingColors.logApi,
      'UI': loggingColors.logUi,
      'MODAL': loggingColors.logRouter,
    }
    return colorMap[category] || loggingColors.logDefault
  }

  const handleLevelChange = (level: string, checked: boolean) => {
    const newLevels = new Set(activeLevels)

    if (checked) {
      newLevels.add(level)
      // TRACE activates DEBUG and INFO
      if (level === LogLevels.TRACE) {
        newLevels.add(LogLevels.DEBUG)
        newLevels.add(LogLevels.INFO)
      }
      // DEBUG activates INFO
      else if (level === LogLevels.DEBUG) {
        newLevels.add(LogLevels.INFO)
      }
    } else {
      newLevels.delete(level)
    }

    setActiveLevels(newLevels)
    Logger.setActiveLevels(newLevels)
    Logger.debug(LogCategories.MODAL, `Level ${level} ${checked ? 'enabled' : 'disabled'}`)
  }

  const handleCategoryChange = (category: string, checked: boolean) => {
    const newCategories = new Set(activeCategories)
    if (checked) {
      newCategories.add(category)
    } else {
      newCategories.delete(category)
    }
    setActiveCategories(newCategories)
    Logger.setActiveCategories(newCategories)
    Logger.debug(LogCategories.MODAL, `Category ${category} ${checked ? 'enabled' : 'disabled'}`)
  }

  const handleSelectAllLevels = () => {
    const allLevels = new Set(Object.values(LogLevels) as string[])
    setActiveLevels(allLevels)
    Logger.setActiveLevels(allLevels)
    Logger.info(LogCategories.MODAL, 'All log levels enabled')
  }

  const handleSelectNoLevels = () => {
    const noLevels = new Set<string>()
    setActiveLevels(noLevels)
    Logger.setActiveLevels(noLevels)
  }

  const handleSelectAllCategories = () => {
    const allCategories = new Set(Object.values(LogCategories) as string[])
    setActiveCategories(allCategories)
    Logger.setActiveCategories(allCategories)
    Logger.info(LogCategories.MODAL, 'All log categories enabled')
  }

  const handleSelectNoCategories = () => {
    const noCategories = new Set<string>()
    setActiveCategories(noCategories)
    Logger.setActiveCategories(noCategories)
  }

  const handleClose = () => {
    Logger.info(LogCategories.MODAL, 'LoggingControl modal closed', {
      activeLevels: activeLevels.size,
      activeCategories: activeCategories.size,
    })
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Logging Configuration
          </DialogTitle>
          <DialogDescription>
            Configure console logging levels and categories. Settings are persisted in your browser.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {/* Log Levels Section */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold">Log Levels</h3>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAllLevels}
                  className="h-6 text-xs px-2"
                >
                  All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectNoLevels}
                  className="h-6 text-xs px-2"
                >
                  None
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {(Object.values(LogLevels) as string[]).map((level) => {
                const levelColor = getLevelColor(level)
                const isActive = activeLevels.has(level)
                return (
                  <div
                    key={level}
                    className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all border-l-4 ${
                      isActive
                        ? 'bg-muted'
                        : 'hover:bg-muted/50'
                    }`}
                    style={{ borderLeftColor: levelColor }}
                    onClick={() => handleLevelChange(level, !isActive)}
                  >
                    <Checkbox
                      checked={isActive}
                      onCheckedChange={(checked: boolean) => handleLevelChange(level, checked)}
                    />
                    <div
                      className="flex items-center gap-2"
                      style={{ color: isActive ? levelColor : undefined }}
                    >
                      {levelIcons[level]}
                      <span className="font-medium text-sm">{level}</span>
                    </div>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {getLevelDescription(level)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Smart Activation Note */}
            <div className="p-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                <strong>Smart Activation:</strong> Enabling TRACE also enables DEBUG + INFO.
                Enabling DEBUG also enables INFO.
              </p>
            </div>
          </div>

          {/* Log Categories Section */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold">Categories</h3>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAllCategories}
                  className="h-6 text-xs px-2"
                >
                  All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectNoCategories}
                  className="h-6 text-xs px-2"
                >
                  None
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[280px] pr-2">
              <div className="space-y-1">
                {(Object.values(LogCategories) as string[]).map((category) => {
                  const categoryColor = getCategoryColor(category)
                  const isActive = activeCategories.has(category)
                  return (
                    <div
                      key={category}
                      className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-all ${
                        isActive
                          ? 'bg-muted'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => handleCategoryChange(category, !isActive)}
                    >
                      <Checkbox
                        checked={isActive}
                        onCheckedChange={(checked: boolean) => handleCategoryChange(category, checked)}
                      />
                      <div
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: categoryColor }}
                      />
                      <span
                        className="text-sm font-medium"
                        style={{ color: isActive ? categoryColor : undefined }}
                      >
                        {category}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto truncate max-w-[120px]">
                        {categoryDescriptions[category] || ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <Separator className="my-4" />

        {/* Footer */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Badge variant="outline">
              {activeLevels.size} levels
            </Badge>
            <Badge variant="outline">
              {activeCategories.size} categories
            </Badge>
          </div>
          <Button onClick={handleClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default LoggingControl

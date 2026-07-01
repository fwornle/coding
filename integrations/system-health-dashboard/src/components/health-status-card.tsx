'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, AlertTriangle, XCircle, Clock, Minus } from 'lucide-react'
import { Logger, LogCategories } from '@/utils/logging'

interface StatusItem {
  name: string
  status: 'operational' | 'warning' | 'error' | 'offline' | 'reference' | 'unknown'
  description: string
  tooltip?: string
  // Optional badge-label override. Lets latency-style tiles render
  // domain-specific words ("Regressed"/"Elevated"/"OK") instead of the
  // generic operational/warning/error labels, while keeping the color.
  badgeLabel?: string
  action?: {
    label: string
    icon?: React.ReactNode
    onClick: (e: React.MouseEvent) => void
    disabled?: boolean
    variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  }
}

interface HealthStatusCardProps {
  title: string
  icon: React.ReactNode
  items: StatusItem[]
  onClick?: () => void
  clickable?: boolean
}

export default function HealthStatusCard({ title, icon, items, onClick, clickable }: HealthStatusCardProps) {
  const handleCardClick = () => {
    if (clickable && onClick) {
      Logger.debug(LogCategories.HEALTH, `HealthStatusCard clicked: ${title}`)
      onClick()
    }
  }

  const handleActionClick = (e: React.MouseEvent, item: StatusItem) => {
    e.stopPropagation()
    Logger.debug(LogCategories.HEALTH, `Action clicked: ${item.name} - ${item.action?.label}`)
    item.action?.onClick(e)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'operational':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'reference':
        // Neutral baseline — no pass/fail semantics (e.g. haiku direct path).
        return <Minus className="h-4 w-4 text-gray-400" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusBadge = (status: string, badgeLabel?: string) => {
    switch (status) {
      case 'operational':
        return <Badge variant="outline" className="bg-status-success-subtle text-status-success border-status-success-line">{badgeLabel || 'OK'}</Badge>
      case 'warning':
        return <Badge variant="outline" className="bg-status-warning-subtle text-status-warning border-status-warning-line">{badgeLabel || 'Warning'}</Badge>
      case 'error':
        return <Badge variant="destructive">{badgeLabel || 'Error'}</Badge>
      case 'reference':
        // Neutral muted label — NOT a pass/fail badge. Reads as a baseline.
        return <span className="text-xs text-muted-foreground italic">{badgeLabel || 'reference'}</span>
      case 'unknown':
        return <Badge variant="outline" className="bg-status-neutral-subtle text-status-neutral border-status-neutral-line">Unknown</Badge>
      default:
        return <Badge variant="outline">Offline</Badge>
    }
  }

  return (
    <Card
      className={clickable ? 'cursor-pointer hover:border-primary/50 transition-colors' : ''}
      onClick={handleCardClick}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-1"
              title={item.tooltip || ''}
            >
              {/* Main row: icon + name/description + badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(item.status)}
                  <div>
                    <div className="font-medium text-sm">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                </div>
                <span title={item.tooltip || ''}>
                  {getStatusBadge(item.status, item.badgeLabel)}
                </span>
              </div>
              {/* Action button row (below, if action exists) */}
              {item.action && (
                <div className="flex justify-start pl-6">
                  <Button
                    size="sm"
                    variant={item.action.variant || 'outline'}
                    onClick={(e) => handleActionClick(e, item)}
                    disabled={item.action.disabled}
                    className="h-6 px-2 text-xs"
                  >
                    {item.action.icon}
                    {item.action.label}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        {clickable && (
          <div className="text-xs text-muted-foreground text-center mt-4 pt-2 border-t">Click to expand</div>
        )}
      </CardContent>
    </Card>
  )
}

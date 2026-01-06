'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react'
import { Logger, LogCategories } from '@/utils/logging'

interface StatusItem {
  name: string
  status: 'operational' | 'warning' | 'error' | 'offline'
  description: string
  tooltip?: string
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
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'operational':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">OK</Badge>
      case 'warning':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Warning</Badge>
      case 'error':
        return <Badge variant="destructive">Error</Badge>
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
              className="flex items-center justify-between"
              title={item.tooltip || ''}
            >
              <div className="flex items-center gap-2">
                {getStatusIcon(item.status)}
                <div>
                  <div className="font-medium text-sm">{item.name}</div>
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {item.action && (
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
                )}
                <span title={item.tooltip || ''}>
                  {getStatusBadge(item.status)}
                </span>
              </div>
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

'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react'

interface StatusItem {
  name: string
  status: 'operational' | 'warning' | 'error' | 'offline'
  description: string
  tooltip?: string
}

interface HealthStatusCardProps {
  title: string
  icon: React.ReactNode
  items: StatusItem[]
  onClick?: () => void
  clickable?: boolean
}

export default function HealthStatusCard({ title, icon, items, onClick, clickable }: HealthStatusCardProps) {
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
      onClick={onClick}
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
              <span title={item.tooltip || ''}>
                {getStatusBadge(item.status)}
              </span>
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

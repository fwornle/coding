'use client'

import React from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, XCircle, Info } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Violation {
  category: string
  check: string
  status: string
  severity: string
  message: string
  timestamp: string
  recommendation?: string
  auto_heal?: boolean
  auto_heal_action?: string
}

interface ViolationsTableProps {
  violations: Violation[]
}

export default function ViolationsTable({ violations }: ViolationsTableProps) {
  const getSeverityBadge = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'critical':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Critical
          </Badge>
        )
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1 bg-red-100 text-red-800 border-red-200">
            <XCircle className="h-3 w-3" />
            Error
          </Badge>
        )
      case 'warning':
        return (
          <Badge variant="outline" className="gap-1 bg-yellow-50 text-yellow-700 border-yellow-200">
            <AlertTriangle className="h-3 w-3" />
            Warning
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <Info className="h-3 w-3" />
            Info
          </Badge>
        )
    }
  }

  const getCategoryBadge = (category: string) => {
    const colors: Record<string, string> = {
      databases: 'bg-blue-50 text-blue-700 border-blue-200',
      services: 'bg-purple-50 text-purple-700 border-purple-200',
      processes: 'bg-green-50 text-green-700 border-green-200',
      files: 'bg-orange-50 text-orange-700 border-orange-200',
    }

    return (
      <Badge variant="outline" className={colors[category] || ''}>
        {category}
      </Badge>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead>Check</TableHead>
            <TableHead>Issue</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Auto-Heal</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {violations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No violations detected
              </TableCell>
            </TableRow>
          ) : (
            violations.map((violation, idx) => (
              <TableRow key={idx}>
                <TableCell>{getCategoryBadge(violation.category)}</TableCell>
                <TableCell className="font-medium">{violation.check}</TableCell>
                <TableCell>
                  <div>
                    <div className="font-medium">{violation.message}</div>
                    {violation.recommendation && (
                      <div className="text-xs text-muted-foreground mt-1">
                        💡 {violation.recommendation}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>{getSeverityBadge(violation.severity)}</TableCell>
                <TableCell>
                  {violation.auto_heal ? (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      Enabled
                    </Badge>
                  ) : (
                    <Badge variant="outline">Manual</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(violation.timestamp), { addSuffix: true })}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

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
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface HealthCheck {
  category: string
  check: string
  status: string
  severity: string
  message: string
  timestamp: string
}

interface SystemChecksTableProps {
  checks: HealthCheck[]
}

export default function SystemChecksTable({ checks }: SystemChecksTableProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return null
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'passed':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Passed</Badge>
      case 'warning':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Warning</Badge>
      case 'error':
        return <Badge variant="destructive">Failed</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
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
            <TableHead>Status</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Check</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {checks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No checks available
              </TableCell>
            </TableRow>
          ) : (
            checks.map((check, idx) => (
              <TableRow key={idx}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(check.status)}
                    {getStatusBadge(check.status)}
                  </div>
                </TableCell>
                <TableCell>{getCategoryBadge(check.category)}</TableCell>
                <TableCell className="font-medium">{check.check}</TableCell>
                <TableCell className="text-sm">{check.message}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(check.timestamp), { addSuffix: true })}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

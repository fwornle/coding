'use client'

import React, { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertTriangle, XCircle, Info, RefreshCw } from 'lucide-react'
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

const API_PORT = process.env.NEXT_PUBLIC_SYSTEM_HEALTH_API_PORT || process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}/api/health-verifier`

export default function ViolationsTable({ violations }: ViolationsTableProps) {
  const [restartingServices, setRestartingServices] = useState<Set<string>>(new Set())
  const [restartResults, setRestartResults] = useState<Map<string, { success: boolean; message: string }>>(new Map())

  const handleRestartService = async (serviceName: string, action: string) => {
    // Mark service as restarting
    setRestartingServices(prev => new Set(prev).add(serviceName))

    try {
      const response = await fetch(`${API_BASE_URL}/restart-service`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ serviceName, action }),
      })

      const data = await response.json()

      if (response.ok && data.status === 'success') {
        setRestartResults(prev => new Map(prev).set(serviceName, {
          success: true,
          message: data.message || 'Service restarted successfully'
        }))

        // Clear success message after 5 seconds
        setTimeout(() => {
          setRestartResults(prev => {
            const newMap = new Map(prev)
            newMap.delete(serviceName)
            return newMap
          })
        }, 5000)
      } else {
        setRestartResults(prev => new Map(prev).set(serviceName, {
          success: false,
          message: data.message || 'Restart failed'
        }))
      }
    } catch (error) {
      console.error('Failed to restart service:', error)
      setRestartResults(prev => new Map(prev).set(serviceName, {
        success: false,
        message: error instanceof Error ? error.message : 'Network error'
      }))
    } finally {
      // Remove from restarting set
      setRestartingServices(prev => {
        const newSet = new Set(prev)
        newSet.delete(serviceName)
        return newSet
      })
    }
  }

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
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {violations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No violations detected
              </TableCell>
            </TableRow>
          ) : (
            violations.map((violation, idx) => {
              const isRestarting = restartingServices.has(violation.check)
              const restartResult = restartResults.get(violation.check)
              const canRestart = violation.category === 'services' && violation.status === 'error'

              return (
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
                      {restartResult && (
                        <div className={`text-xs mt-1 font-medium ${restartResult.success ? 'text-green-600' : 'text-red-600'}`}>
                          {restartResult.success ? '✅' : '❌'} {restartResult.message}
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
                  <TableCell>
                    {canRestart && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestartService(violation.check, violation.auto_heal_action || 'restart')}
                        disabled={isRestarting}
                        className="gap-1"
                        title="Click to restart the service. Health verification will run automatically to confirm status."
                      >
                        <RefreshCw className={`h-3 w-3 ${isRestarting ? 'animate-spin' : ''}`} />
                        {isRestarting ? 'Restarting...' : 'Restart'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}

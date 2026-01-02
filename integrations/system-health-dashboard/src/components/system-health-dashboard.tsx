'use client'

import React, { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '@/store'
import { triggerVerificationStart } from '@/store/slices/autoHealingSlice'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Activity,
  Database,
  Server,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Zap,
  ExternalLink,
  Brain
} from 'lucide-react'
import HealthStatusCard from './health-status-card'
import ViolationsTable from './violations-table'
import SystemChecksTable from './system-checks-table'
import UKBWorkflowModal from './ukb-workflow-modal'

export default function SystemHealthDashboard() {
  const dispatch = useAppDispatch()
  const healthStatus = useAppSelector((state) => state.healthStatus)
  const [ukbModalOpen, setUkbModalOpen] = useState(false)
  const healthReport = useAppSelector((state) => state.healthReport)
  const autoHealing = useAppSelector((state) => state.autoHealing)
  const apiQuota = useAppSelector((state) => state.apiQuota)
  const ukb = useAppSelector((state) => state.ukb)

  // Real-time age calculation - updates every second
  const [currentTime, setCurrentTime] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleTriggerVerification = () => {
    dispatch(triggerVerificationStart())
  }

  const getStatusIcon = () => {
    switch (healthStatus.overallStatus) {
      case 'healthy':
        return <CheckCircle2 className="h-8 w-8 text-green-500" />
      case 'degraded':
        return <AlertTriangle className="h-8 w-8 text-yellow-500" />
      case 'unhealthy':
        return <XCircle className="h-8 w-8 text-red-500" />
      default:
        return <Clock className="h-8 w-8 text-gray-400" />
    }
  }

  const getStatusColor = () => {
    switch (healthStatus.overallStatus) {
      case 'healthy':
        return 'bg-green-50 border-green-200'
      case 'degraded':
        return 'bg-yellow-50 border-yellow-200'
      case 'unhealthy':
        return 'bg-red-50 border-red-200'
      default:
        return 'bg-gray-50 border-gray-200'
    }
  }

  // Refresh happens every 5 seconds - show countdown
  const REFRESH_INTERVAL_MS = 5000

  // Calculate countdown to next refresh (5, 4, 3, 2, 1, 0)
  const calculateCountdown = (): number => {
    if (!healthStatus.lastFetch) return 5
    const lastFetchTime = new Date(healthStatus.lastFetch).getTime()
    const elapsed = currentTime - lastFetchTime
    const remaining = REFRESH_INTERVAL_MS - (elapsed % REFRESH_INTERVAL_MS)
    return Math.ceil(remaining / 1000)
  }

  // Map check status to UI status
  const mapCheckStatus = (check: any): 'operational' | 'warning' | 'error' | 'offline' => {
    if (check.status === 'passed') return 'operational'
    if (check.status === 'warning') return 'warning'
    if (check.status === 'failed' || check.status === 'error') return 'error'
    return 'offline'
  }

  // Get checks by category
  const getChecksByCategory = (category: string) => {
    if (!healthReport.report?.checks) return []
    return healthReport.report.checks.filter((check: any) => check.category === category)
  }

  // Build database items from real data
  const getDatabaseItems = () => {
    const checks = getChecksByCategory('databases')
    const items = []

    // LevelDB check
    const leveldbCheck = checks.find((c: any) => c.check === 'leveldb_lock_check')
    if (leveldbCheck) {
      items.push({
        name: 'LevelDB',
        status: mapCheckStatus(leveldbCheck),
        description: 'Graph database',
        tooltip: leveldbCheck.message + (leveldbCheck.recommendation ? ` - ${leveldbCheck.recommendation}` : '')
      })
    }

    // Qdrant check
    const qdrantCheck = checks.find((c: any) => c.check === 'qdrant_availability')
    if (qdrantCheck) {
      items.push({
        name: 'Qdrant',
        status: mapCheckStatus(qdrantCheck),
        description: 'Vector database',
        tooltip: qdrantCheck.message + (qdrantCheck.recommendation ? ` - ${qdrantCheck.recommendation}` : '')
      })
    }

    // CGR Cache check
    const cgrCheck = checks.find((c: any) => c.check === 'cgr_cache')
    if (cgrCheck) {
      const commitsBehind = cgrCheck.details?.commits_behind
      const cachedCommit = cgrCheck.details?.cached_commit
      items.push({
        name: 'CGR Cache',
        status: mapCheckStatus(cgrCheck),
        description: commitsBehind !== undefined
          ? `${commitsBehind} commits behind`
          : (cachedCommit ? `@ ${cachedCommit}` : 'Code graph'),
        tooltip: cgrCheck.message + (cgrCheck.recommendation ? ` - ${cgrCheck.recommendation}` : '')
      })
    }

    return items
  }

  // Build service items from real data
  const getServiceItems = () => {
    const checks = getChecksByCategory('services')
    const items = []

    // VKB Server
    const vkbCheck = checks.find((c: any) => c.check === 'vkb_server')
    if (vkbCheck) {
      items.push({
        name: 'VKB Server',
        status: mapCheckStatus(vkbCheck),
        description: 'Port 8080',
        tooltip: vkbCheck.message + (vkbCheck.recommendation ? ` - ${vkbCheck.recommendation}` : '')
      })
    }

    // Constraint Monitor
    const constraintCheck = checks.find((c: any) => c.check === 'constraint_monitor')
    if (constraintCheck) {
      items.push({
        name: 'Constraint Monitor',
        status: mapCheckStatus(constraintCheck),
        description: 'Port 3031',
        tooltip: constraintCheck.message + (constraintCheck.recommendation ? ` - ${constraintCheck.recommendation}` : '')
      })
    }

    // Dashboard
    const dashboardCheck = checks.find((c: any) => c.check === 'dashboard_server')
    if (dashboardCheck) {
      items.push({
        name: 'Dashboard',
        status: mapCheckStatus(dashboardCheck),
        description: 'Port 3030',
        tooltip: dashboardCheck.message + (dashboardCheck.recommendation ? ` - ${dashboardCheck.recommendation}` : '')
      })
    }

    return items
  }

  // Build process items from real data
  const getProcessItems = () => {
    const checks = getChecksByCategory('processes')
    const items = []

    // Stale PIDs check
    const stalePidsCheck = checks.find((c: any) => c.check === 'stale_pids')
    if (stalePidsCheck) {
      items.push({
        name: 'Stale PIDs',
        status: mapCheckStatus(stalePidsCheck),
        description: 'Cleaned automatically',
        tooltip: stalePidsCheck.message + (stalePidsCheck.recommendation ? ` - ${stalePidsCheck.recommendation}` : '')
      })
    }

    // Process Registry (infer from presence of process checks)
    if (checks.length > 0) {
      items.unshift({
        name: 'Process Registry',
        status: 'operational' as const,
        description: 'PSM tracking',
        tooltip: 'Process State Manager (PSM) is operational. Process lifecycle tracking and health monitoring are active.'
      })
    }

    return items
  }

  // Build API items from quota data
  const getAPIItems = () => {
    const items = []

    if (apiQuota.providers.length === 0) {
      items.push({
        name: 'No Providers',
        status: 'offline' as const,
        description: 'No API keys configured',
        tooltip: 'No LLM provider API keys found in environment'
      })
      return items
    }

    // Map each provider to an item
    for (const provider of apiQuota.providers) {
      const remainingCredits = typeof provider.quota.remainingCredits === 'number' ? provider.quota.remainingCredits : null
      const remainingPercent = typeof provider.quota.remaining === 'number' ? provider.quota.remaining : null
      const status: 'operational' | 'warning' | 'error' | 'offline' =
        provider.status === 'healthy' || provider.status === 'moderate' ? 'operational' :
        provider.status === 'low' || provider.status === 'degraded' ? 'warning' :
        provider.status === 'critical' ? 'error' : 'offline'

      // Description: show remaining $ if prepaid, or availability status
      let description = ''
      if (remainingCredits !== null) {
        // Has prepaid credits configured - show remaining $
        description = `$${Math.round(remainingCredits)} remaining`
      } else if (provider.cacheStrategy === 'free-tier') {
        // Free tier provider
        description = 'Free tier (available)'
      } else if (provider.quota.remaining === 'N/A') {
        // No admin key configured
        description = 'No admin key'
      } else if (remainingPercent !== null) {
        // Has percentage but no $ amount
        description = `${remainingPercent}% available`
      } else {
        description = 'Available'
      }

      // Build detailed tooltip
      let tooltip = `${provider.name}\n`
      tooltip += `Status: ${provider.status}\n`
      if (remainingCredits !== null) {
        tooltip += `Remaining: $${remainingCredits.toFixed(2)}\n`
      }
      if (provider.cost && typeof provider.cost.total === 'number') {
        tooltip += `Spent: $${provider.cost.total.toFixed(2)}\n`
      }
      if (provider.quota.limit) {
        tooltip += `Limit: ${provider.quota.limit}\n`
      }
      if (provider.rateLimit) {
        if (provider.rateLimit.requestsPerMinute) {
          tooltip += `Rate: ${provider.rateLimit.requestsPerMinute} RPM\n`
        }
        if (provider.rateLimit.tokensPerDay) {
          tooltip += `Tokens: ${(provider.rateLimit.tokensPerDay / 1000000).toFixed(1)}M TPD\n`
        }
      }
      tooltip += `Data: ${provider.cacheStrategy}`

      items.push({
        name: provider.name,
        status,
        description,
        tooltip
      })
    }

    return items
  }

  // Build UKB (Knowledge Base Update) items from UKB state
  const getUKBItems = () => {
    const items = []

    // Show running workflows
    if (ukb.running > 0) {
      items.push({
        name: 'Running Workflows',
        status: 'operational' as const,
        description: `${ukb.running} active`,
        tooltip: `${ukb.running} UKB workflow(s) currently running with 13-agent analysis`
      })
    }

    // Show stale workflows (warning)
    if (ukb.stale > 0) {
      items.push({
        name: 'Stale Workflows',
        status: 'warning' as const,
        description: `${ukb.stale} stale`,
        tooltip: `${ukb.stale} workflow(s) haven't sent heartbeat in ${ukb.config.staleThresholdSeconds}s`
      })
    }

    // Show frozen workflows (error)
    if (ukb.frozen > 0) {
      items.push({
        name: 'Frozen Workflows',
        status: 'error' as const,
        description: `${ukb.frozen} frozen`,
        tooltip: `${ukb.frozen} workflow(s) appear frozen (no activity for ${ukb.config.frozenThresholdSeconds}s)`
      })
    }

    // If no workflows, show idle status
    if (ukb.total === 0) {
      items.push({
        name: 'Status',
        status: 'operational' as const,
        description: 'Idle',
        tooltip: `No UKB workflows running. Max concurrent: ${ukb.config.maxConcurrent}`
      })
    }

    // Show capacity info
    items.push({
      name: 'Capacity',
      status: ukb.total >= ukb.config.maxConcurrent ? 'warning' as const : 'operational' as const,
      description: `${ukb.total}/${ukb.config.maxConcurrent} slots`,
      tooltip: `Using ${ukb.total} of ${ukb.config.maxConcurrent} concurrent workflow slots`
    })

    return items
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Health Dashboard</h1>
          <p className="text-muted-foreground">
            Real-time monitoring of databases, services, and processes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTriggerVerification}
            disabled={autoHealing.triggeringVerification}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${autoHealing.triggeringVerification ? 'animate-spin' : ''}`} />
            Run Verification
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="http://localhost:3030" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Constraint Dashboard
            </a>
          </Button>
        </div>
      </div>

      {/* Overall Status Card */}
      <Card className={`${getStatusColor()} border-2`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {getStatusIcon()}
              <div>
                <CardTitle className="text-2xl">
                  {healthStatus.overallStatus.charAt(0).toUpperCase() + healthStatus.overallStatus.slice(1)}
                </CardTitle>
                <CardDescription>
                  {healthStatus.lastFetch ? (
                    <>Refreshing in {calculateCountdown()}s</>
                  ) : (
                    'Connecting...'
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-4">
              {autoHealing.enabled && (
                <Badge variant="outline" className="h-fit">
                  <Zap className="h-3 w-3 mr-1" />
                  Auto-Healing Active
                </Badge>
              )}
              {healthStatus.status === 'stale' && healthStatus.ageMs > 120000 && (
                <Badge variant="destructive" className="h-fit">
                  <Clock className="h-3 w-3 mr-1" />
                  Verifier Stale ({Math.floor(healthStatus.ageMs / 60000)}m)
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold">{healthStatus.violationCount}</div>
              <div className="text-sm text-muted-foreground">Total Violations</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-red-500">{healthStatus.criticalCount}</div>
              <div className="text-sm text-muted-foreground">Critical Issues</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-500">
                {healthReport.report ? healthReport.report.summary.passed : 0}
              </div>
              <div className="text-sm text-muted-foreground">Checks Passed</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {healthStatus.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{healthStatus.error}</AlertDescription>
        </Alert>
      )}

      {/* Health Status Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <HealthStatusCard
          title="Databases"
          icon={<Database className="h-5 w-5" />}
          items={getDatabaseItems()}
        />
        <HealthStatusCard
          title="Services"
          icon={<Server className="h-5 w-5" />}
          items={getServiceItems()}
        />
        <HealthStatusCard
          title="Processes"
          icon={<Activity className="h-5 w-5" />}
          items={getProcessItems()}
        />
        <HealthStatusCard
          title="API Quota"
          icon={<Zap className="h-5 w-5" />}
          items={getAPIItems()}
        />
        <HealthStatusCard
          title="UKB Workflows"
          icon={<Brain className="h-5 w-5" />}
          items={getUKBItems()}
          clickable={true}
          onClick={() => setUkbModalOpen(true)}
        />
      </div>

      <Separator />

      {/* Violations Table */}
      {healthReport.report && healthReport.report.violations.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">Active Violations</h2>
            <p className="text-muted-foreground">Issues detected during health verification</p>
          </div>
          <ViolationsTable violations={healthReport.report.violations} />
        </div>
      )}

      {/* System Checks Table */}
      {healthReport.report && (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">All Health Checks</h2>
            <p className="text-muted-foreground">
              {healthReport.report.summary.total_checks} checks performed
            </p>
          </div>
          <SystemChecksTable checks={healthReport.report.checks} />
        </div>
      )}

      {/* Recommendations */}
      {healthReport.report && healthReport.report.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
            <CardDescription>Suggested actions to improve system health</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {healthReport.report.recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500" />
                  <span className="text-sm">{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* UKB Workflow Modal */}
      <UKBWorkflowModal
        open={ukbModalOpen}
        onOpenChange={setUkbModalOpen}
        processes={ukb.processes || []}
      />
    </div>
  )
}

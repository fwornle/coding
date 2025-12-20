'use client'

import React, { useEffect, useMemo } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Brain,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Timer,
  Server,
  GitBranch,
  Folder,
  History,
  FileText,
  RefreshCw,
} from 'lucide-react'
import UKBWorkflowGraph, { UKBNodeDetailsSidebar } from './ukb-workflow-graph'
import type { RootState } from '@/store'
import {
  setActiveTab,
  setSelectedProcessIndex,
  setSelectedNode,
  fetchHistoryStart,
  fetchHistorySuccess,
  fetchHistoryFailure,
  selectHistoricalWorkflow,
  fetchDetailStart,
  fetchDetailSuccess,
  fetchDetailFailure,
  selectCurrentProcess,
  selectHistoricalProcessInfo,
  type HistoricalWorkflow,
  type UKBProcess,
} from '@/store/slices/ukbSlice'

interface UKBWorkflowModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  processes: UKBProcess[]
  apiBaseUrl?: string
}

export default function UKBWorkflowModal({ open, onOpenChange, processes, apiBaseUrl = 'http://localhost:3033' }: UKBWorkflowModalProps) {
  const dispatch = useDispatch()

  // Redux state
  const selectedProcessIndex = useSelector((state: RootState) => state.ukb.selectedProcessIndex)
  const selectedNode = useSelector((state: RootState) => state.ukb.selectedNode)
  const activeTab = useSelector((state: RootState) => state.ukb.activeTab)
  const historicalWorkflows = useSelector((state: RootState) => state.ukb.historicalWorkflows)
  const loadingHistory = useSelector((state: RootState) => state.ukb.loadingHistory)
  const selectedHistoricalWorkflowState = useSelector((state: RootState) => state.ukb.selectedHistoricalWorkflow)
  const historicalWorkflowDetail = useSelector((state: RootState) => state.ukb.historicalWorkflowDetail)
  const loadingDetail = useSelector((state: RootState) => state.ukb.loadingDetail)

  // Memoized selectors
  const currentProcess = useSelector(selectCurrentProcess)
  const historicalProcessInfo = useSelector(selectHistoricalProcessInfo)

  // Derived state
  const showSidebar = selectedNode !== null && activeTab === 'active'
  const showHistoricalSidebar = selectedNode !== null && activeTab === 'history'

  // Filter to only include truly active processes (running and alive, or recently completed for context)
  // A process is "active" if: status === 'running' OR (status === 'completed' and isAlive !== false)
  // But for the Active tab count, we only want running processes
  const activeProcesses = useMemo(() => {
    return processes.filter(p => p.status === 'running' || (p.isAlive && p.status !== 'completed' && p.status !== 'failed'))
  }, [processes])

  // Fetch historical workflows when history tab is selected
  useEffect(() => {
    if (open && activeTab === 'history') {
      loadHistoricalWorkflows()
    }
  }, [open, activeTab])

  const loadHistoricalWorkflows = async () => {
    dispatch(fetchHistoryStart())
    try {
      const response = await fetch(`${apiBaseUrl}/api/ukb/history?limit=50`)
      const result = await response.json()
      if (result.status === 'success') {
        dispatch(fetchHistorySuccess(result.data))
      } else {
        dispatch(fetchHistoryFailure('Failed to load workflows'))
      }
    } catch (error) {
      console.error('Failed to fetch historical workflows:', error)
      dispatch(fetchHistoryFailure(String(error)))
    }
  }

  const loadHistoricalWorkflowDetail = async (workflowId: string) => {
    dispatch(fetchDetailStart())
    try {
      const response = await fetch(`${apiBaseUrl}/api/ukb/history/${workflowId}`)
      const result = await response.json()
      if (result.status === 'success') {
        dispatch(fetchDetailSuccess(result.data))
      } else {
        dispatch(fetchDetailFailure('Failed to load workflow detail'))
      }
    } catch (error) {
      console.error('Failed to fetch workflow detail:', error)
      dispatch(fetchDetailFailure(String(error)))
    }
  }

  // Fetch detail when a historical workflow is selected
  useEffect(() => {
    if (selectedHistoricalWorkflowState) {
      loadHistoricalWorkflowDetail(selectedHistoricalWorkflowState.id)
      dispatch(setSelectedNode(null))
    }
  }, [selectedHistoricalWorkflowState])

  const handleNodeClick = (agentId: string) => {
    dispatch(setSelectedNode(agentId))
  }

  const handleCloseSidebar = () => {
    dispatch(setSelectedNode(null))
  }

  // Both active and historical use the same handler now via Redux
  const handleHistoricalNodeClick = handleNodeClick
  const handleCloseHistoricalSidebar = handleCloseSidebar

  const getHealthBadge = (health: string) => {
    switch (health) {
      case 'healthy':
        return <Badge className="bg-green-500">Healthy</Badge>
      case 'stale':
        return <Badge className="bg-yellow-500">Stale</Badge>
      case 'frozen':
        return <Badge variant="destructive">Frozen</Badge>
      case 'dead':
        return <Badge variant="outline" className="text-gray-500">Dead</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const formatElapsed = (startTime: string) => {
    const start = new Date(startTime).getTime()
    const now = Date.now()
    const elapsedSeconds = Math.floor((now - start) / 1000)

    if (elapsedSeconds < 60) return `${elapsedSeconds}s`
    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = elapsedSeconds % 60
    if (minutes < 60) return `${minutes}m ${seconds}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  const getWorkflowDisplayName = (name: string) => {
    switch (name) {
      case 'complete-analysis':
        return 'Complete Analysis'
      case 'incremental-analysis':
        return 'Incremental Analysis'
      default:
        return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return <Badge className="bg-green-500 text-white">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'running':
        return <Badge className="bg-blue-500 text-white">Running</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Render Active Workflows Content
  const renderActiveContent = () => {
    // Only show truly active (running) workflows in the Active tab
    if (activeProcesses.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-center">
          <div className="space-y-4">
            <Clock className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="text-lg font-medium">No Active Workflows</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Start a UKB workflow using the semantic analysis MCP tool to see it here.
              </p>
              {processes.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Recently completed workflows can be found in the History tab.
                </p>
              )}
            </div>
            <div className="text-xs text-muted-foreground bg-muted p-3 rounded-lg font-mono">
              mcp__semantic-analysis__execute_workflow<br />
              workflow_name: "incremental-analysis"
            </div>
          </div>
        </div>
      )
    }

    // Use the active process at the selected index (bounded to valid range)
    const activeIndex = Math.min(selectedProcessIndex, activeProcesses.length - 1)
    const activeCurrentProcess = activeProcesses[activeIndex] || null

    return (
      <>
        {/* Process selector */}
        {activeProcesses.length > 1 && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => dispatch(setSelectedProcessIndex(Math.max(0, activeIndex - 1)))}
              disabled={activeIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Process {activeIndex + 1} / {activeProcesses.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => dispatch(setSelectedProcessIndex(Math.min(activeProcesses.length - 1, activeIndex + 1)))}
              disabled={activeIndex === activeProcesses.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {activeCurrentProcess && (
          <>
            {/* Process Info Header */}
            <Card className="flex-shrink-0">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {/* Workflow Name */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Workflow</div>
                    <div className="font-medium flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {getWorkflowDisplayName(activeCurrentProcess.workflowName)}
                    </div>
                  </div>

                  {/* Team */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Team</div>
                    <div className="font-medium flex items-center gap-1">
                      <Server className="h-3 w-3" />
                      {activeCurrentProcess.team}
                    </div>
                  </div>

                  {/* Repository */}
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground mb-1">Repository</div>
                    <div className="font-medium text-sm truncate flex items-center gap-1" title={activeCurrentProcess.repositoryPath}>
                      <Folder className="h-3 w-3 flex-shrink-0" />
                      {activeCurrentProcess.repositoryPath.split('/').slice(-2).join('/')}
                    </div>
                  </div>

                  {/* Health Status */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Health</div>
                    {getHealthBadge(activeCurrentProcess.health)}
                  </div>

                  {/* Elapsed Time */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Elapsed</div>
                    <div className="font-medium flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {formatElapsed(activeCurrentProcess.startTime)}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">
                      Progress: {activeCurrentProcess.completedSteps} / {activeCurrentProcess.totalSteps} steps
                      {activeCurrentProcess.currentStep && (
                        <span className="ml-2 text-blue-600">
                          (Currently: {activeCurrentProcess.currentStep.replace(/_/g, ' ')})
                        </span>
                      )}
                    </span>
                    <span className="font-medium">{activeCurrentProcess.progressPercent}%</span>
                  </div>
                  <Progress value={activeCurrentProcess.progressPercent} className="h-2" />
                </div>
              </CardContent>
            </Card>

            {/* Main Content Area */}
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
              {/* Workflow Graph */}
              <div className={`flex-1 min-w-0 ${showSidebar ? 'mr-0' : ''}`}>
                <UKBWorkflowGraph
                  process={activeCurrentProcess}
                  onNodeClick={handleNodeClick}
                  selectedNode={selectedNode}
                />
              </div>

              {/* Details Sidebar */}
              {showSidebar && selectedNode && (
                <div className="flex-shrink-0 overflow-auto">
                  <UKBNodeDetailsSidebar
                    agentId={selectedNode}
                    process={activeCurrentProcess}
                    onClose={handleCloseSidebar}
                  />
                </div>
              )}
            </div>

            {/* Footer with PID info */}
            <div className="flex-shrink-0 pt-2 border-t">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span>PID: {activeCurrentProcess.pid}</span>
                  <span>Last heartbeat: {activeCurrentProcess.heartbeatAgeSeconds}s ago</span>
                  {activeCurrentProcess.logFile && (
                    <span className="truncate max-w-xs" title={activeCurrentProcess.logFile}>
                      Log: {activeCurrentProcess.logFile.split('/').pop()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {activeCurrentProcess.health === 'healthy' && activeCurrentProcess.status === 'running' && (
                    <span className="flex items-center gap-1 text-green-600">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Processing
                    </span>
                  )}
                  {activeCurrentProcess.status === 'completed' && (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Completed
                    </span>
                  )}
                  {activeCurrentProcess.status === 'failed' && (
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle className="h-3 w-3" />
                      Failed
                    </span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </>
    )
  }

  // Render History Content
  const renderHistoryContent = () => {
    if (loadingHistory) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading workflow history...</p>
          </div>
        </div>
      )
    }

    if (historicalWorkflows.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-center">
          <div className="space-y-4">
            <History className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="text-lg font-medium">No Workflow History</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Completed workflows will appear here.
              </p>
            </div>
          </div>
        </div>
      )
    }

    // If a workflow is selected, show its details
    if (selectedHistoricalWorkflowState) {
      return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Header Bar - fixed height */}
          <div className="flex-shrink-0 flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                dispatch(selectHistoricalWorkflow(null))
              }}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to list
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <span className="text-sm font-medium truncate">{selectedHistoricalWorkflowState.executionId}</span>
            <div className="ml-auto">{getStatusBadge(selectedHistoricalWorkflowState.status)}</div>
          </div>

          {/* Compact Info Row - fixed height */}
          <div className="flex-shrink-0 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground mb-2 px-1">
            <span><strong>Workflow:</strong> {getWorkflowDisplayName(selectedHistoricalWorkflowState.workflowName)}</span>
            <span><strong>Team:</strong> {selectedHistoricalWorkflowState.team}</span>
            <span><strong>Duration:</strong> {selectedHistoricalWorkflowState.duration || '-'}</span>
            <span><strong>Steps:</strong> {selectedHistoricalWorkflowState.completedSteps}/{selectedHistoricalWorkflowState.totalSteps}</span>
            <span><strong>Started:</strong> {formatDate(selectedHistoricalWorkflowState.startTime)}</span>
          </div>

          {/* Workflow Graph - Main Content - takes remaining space */}
          <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
            {loadingDetail ? (
              <div className="flex-1 flex items-center justify-center border rounded-lg bg-muted/20">
                <div className="text-center space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Loading workflow details...</p>
                </div>
              </div>
            ) : historicalProcessInfo ? (
              <>
                {/* Workflow Graph - scrollable */}
                <div className="flex-1 min-w-0 min-h-0 overflow-auto border rounded-lg bg-gradient-to-br from-slate-50 to-slate-100">
                  <UKBWorkflowGraph
                    process={historicalProcessInfo}
                    onNodeClick={handleHistoricalNodeClick}
                    selectedNode={selectedNode}
                  />
                </div>

                {/* Details Sidebar */}
                {showHistoricalSidebar && selectedNode && (
                  <div className="w-80 flex-shrink-0 overflow-auto border rounded-lg bg-background">
                    <UKBNodeDetailsSidebar
                      agentId={selectedNode}
                      process={historicalProcessInfo}
                      onClose={handleCloseHistoricalSidebar}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center border rounded-lg bg-muted/20">
                <div className="text-center space-y-2">
                  <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Unable to load workflow details</p>
                  <p className="text-xs text-muted-foreground">Report ID: {selectedHistoricalWorkflowState.id}</p>
                </div>
              </div>
            )}
          </div>

          {/* Recommendations (if any) - at bottom, fixed height */}
          {historicalWorkflowDetail?.recommendations && historicalWorkflowDetail.recommendations.length > 0 && (
            <div className="flex-shrink-0 mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg max-h-24 overflow-auto">
              <div className="text-xs font-medium text-yellow-800 mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Recommendations ({historicalWorkflowDetail.recommendations.length})
              </div>
              <ul className="text-xs text-yellow-700 space-y-0.5">
                {historicalWorkflowDetail.recommendations.map((rec, i) => (
                  <li key={i}>• {rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )
    }

    // Show list of historical workflows
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-muted-foreground">
            {historicalWorkflows.length} workflow{historicalWorkflows.length !== 1 ? 's' : ''} found
          </div>
          <Button variant="outline" size="sm" onClick={loadHistoricalWorkflows}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-2 pr-4">
            {historicalWorkflows.map((workflow) => (
              <Card
                key={workflow.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => dispatch(selectHistoricalWorkflow(workflow))}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium text-sm">
                          {getWorkflowDisplayName(workflow.workflowName)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {workflow.team} • {formatDate(workflow.startTime)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs text-muted-foreground">
                        <div>{workflow.completedSteps}/{workflow.totalSteps} steps</div>
                        <div>{workflow.duration || '-'}</div>
                      </div>
                      {getStatusBadge(workflow.status)}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[85vh] grid grid-rows-[auto_auto_1fr] gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            UKB Workflow Monitor
          </DialogTitle>
          <DialogDescription>
            Monitor active and historical UKB semantic analysis workflows
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => dispatch(setActiveTab(v as 'active' | 'history'))} className="contents">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="active" className="flex items-center gap-2">
              <Loader2 className={`h-4 w-4 ${activeProcesses.length > 0 ? 'animate-spin' : ''}`} />
              Active
              {activeProcesses.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                  {activeProcesses.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="min-h-0 overflow-hidden flex flex-col">
          {activeTab === 'active' ? renderActiveContent() : renderHistoryContent()}
        </div>
      </DialogContent>
    </Dialog>
  )
}

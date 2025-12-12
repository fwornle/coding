'use client'

import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

interface ProcessInfo {
  pid: number
  workflowName: string
  team: string
  repositoryPath: string
  startTime: string
  lastHeartbeat: string
  status: string
  completedSteps: number
  totalSteps: number
  currentStep: string | null
  logFile: string | null
  isAlive: boolean
  health: 'healthy' | 'stale' | 'frozen' | 'dead'
  heartbeatAgeSeconds: number
  progressPercent: number
  steps?: Array<{
    name: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
    duration?: number
    tokensUsed?: number
    llmProvider?: string
    error?: string
    outputs?: Record<string, any>
  }>
}

interface HistoricalWorkflow {
  id: string
  filename: string
  workflowName: string
  executionId: string
  status: string
  startTime: string | null
  endTime: string | null
  duration: string | null
  completedSteps: number
  totalSteps: number
  team: string
  repositoryPath: string
}

interface HistoricalStep {
  index: number
  name: string
  agent: string
  action: string
  status: string
  duration: string
}

interface HistoricalWorkflowDetail extends HistoricalWorkflow {
  entitiesCreated: number
  entitiesUpdated: number
  recommendations: string[]
  steps: HistoricalStep[]
}

interface UKBWorkflowModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  processes: ProcessInfo[]
  apiBaseUrl?: string
}

export default function UKBWorkflowModal({ open, onOpenChange, processes, apiBaseUrl = 'http://localhost:3033' }: UKBWorkflowModalProps) {
  const [selectedProcessIndex, setSelectedProcessIndex] = useState(0)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [activeTab, setActiveTab] = useState('active')
  const [historicalWorkflows, setHistoricalWorkflows] = useState<HistoricalWorkflow[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selectedHistoricalWorkflow, setSelectedHistoricalWorkflow] = useState<HistoricalWorkflow | null>(null)
  const [historicalWorkflowDetail, setHistoricalWorkflowDetail] = useState<HistoricalWorkflowDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [historicalSelectedNode, setHistoricalSelectedNode] = useState<string | null>(null)
  const [showHistoricalSidebar, setShowHistoricalSidebar] = useState(false)

  const currentProcess = processes[selectedProcessIndex]

  // Fetch historical workflows when history tab is selected
  useEffect(() => {
    if (open && activeTab === 'history') {
      fetchHistoricalWorkflows()
    }
  }, [open, activeTab])

  const fetchHistoricalWorkflows = async () => {
    setLoadingHistory(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/ukb/history?limit=50`)
      const result = await response.json()
      if (result.status === 'success') {
        setHistoricalWorkflows(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch historical workflows:', error)
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleNodeClick = (agentId: string) => {
    setSelectedNode(agentId)
    setShowSidebar(true)
  }

  const handleCloseSidebar = () => {
    setShowSidebar(false)
    setSelectedNode(null)
  }

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
    if (processes.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-center">
          <div className="space-y-4">
            <Clock className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="text-lg font-medium">No Active Workflows</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Start a UKB workflow using the semantic analysis MCP tool to see it here.
              </p>
            </div>
            <div className="text-xs text-muted-foreground bg-muted p-3 rounded-lg font-mono">
              mcp__semantic-analysis__execute_workflow<br />
              workflow_name: "incremental-analysis"
            </div>
          </div>
        </div>
      )
    }

    return (
      <>
        {/* Process selector */}
        {processes.length > 1 && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSelectedProcessIndex(Math.max(0, selectedProcessIndex - 1))}
              disabled={selectedProcessIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Process {selectedProcessIndex + 1} / {processes.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSelectedProcessIndex(Math.min(processes.length - 1, selectedProcessIndex + 1))}
              disabled={selectedProcessIndex === processes.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {currentProcess && (
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
                      {getWorkflowDisplayName(currentProcess.workflowName)}
                    </div>
                  </div>

                  {/* Team */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Team</div>
                    <div className="font-medium flex items-center gap-1">
                      <Server className="h-3 w-3" />
                      {currentProcess.team}
                    </div>
                  </div>

                  {/* Repository */}
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground mb-1">Repository</div>
                    <div className="font-medium text-sm truncate flex items-center gap-1" title={currentProcess.repositoryPath}>
                      <Folder className="h-3 w-3 flex-shrink-0" />
                      {currentProcess.repositoryPath.split('/').slice(-2).join('/')}
                    </div>
                  </div>

                  {/* Health Status */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Health</div>
                    {getHealthBadge(currentProcess.health)}
                  </div>

                  {/* Elapsed Time */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Elapsed</div>
                    <div className="font-medium flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {formatElapsed(currentProcess.startTime)}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">
                      Progress: {currentProcess.completedSteps} / {currentProcess.totalSteps} steps
                      {currentProcess.currentStep && (
                        <span className="ml-2 text-blue-600">
                          (Currently: {currentProcess.currentStep.replace(/_/g, ' ')})
                        </span>
                      )}
                    </span>
                    <span className="font-medium">{currentProcess.progressPercent}%</span>
                  </div>
                  <Progress value={currentProcess.progressPercent} className="h-2" />
                </div>
              </CardContent>
            </Card>

            {/* Main Content Area */}
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
              {/* Workflow Graph */}
              <div className={`flex-1 min-w-0 ${showSidebar ? 'mr-0' : ''}`}>
                <UKBWorkflowGraph
                  process={currentProcess}
                  onNodeClick={handleNodeClick}
                  selectedNode={selectedNode}
                />
              </div>

              {/* Details Sidebar */}
              {showSidebar && selectedNode && (
                <div className="flex-shrink-0 overflow-auto">
                  <UKBNodeDetailsSidebar
                    agentId={selectedNode}
                    process={currentProcess}
                    onClose={handleCloseSidebar}
                  />
                </div>
              )}
            </div>

            {/* Footer with PID info */}
            <div className="flex-shrink-0 pt-2 border-t">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span>PID: {currentProcess.pid}</span>
                  <span>Last heartbeat: {currentProcess.heartbeatAgeSeconds}s ago</span>
                  {currentProcess.logFile && (
                    <span className="truncate max-w-xs" title={currentProcess.logFile}>
                      Log: {currentProcess.logFile.split('/').pop()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {currentProcess.health === 'healthy' && currentProcess.status === 'running' && (
                    <span className="flex items-center gap-1 text-green-600">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Processing
                    </span>
                  )}
                  {currentProcess.status === 'completed' && (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Completed
                    </span>
                  )}
                  {currentProcess.status === 'failed' && (
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
    if (selectedHistoricalWorkflow) {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedHistoricalWorkflow(null)}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to list
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <span className="text-sm font-medium">{selectedHistoricalWorkflow.executionId}</span>
          </div>

          <Card className="flex-shrink-0 mb-4">
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Workflow</div>
                  <div className="font-medium">{getWorkflowDisplayName(selectedHistoricalWorkflow.workflowName)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Team</div>
                  <div className="font-medium">{selectedHistoricalWorkflow.team}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Status</div>
                  {getStatusBadge(selectedHistoricalWorkflow.status)}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Duration</div>
                  <div className="font-medium">{selectedHistoricalWorkflow.duration || '-'}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground mb-1">Repository</div>
                  <div className="font-medium text-sm truncate" title={selectedHistoricalWorkflow.repositoryPath}>
                    {selectedHistoricalWorkflow.repositoryPath}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Start Time</div>
                  <div className="font-medium text-sm">{formatDate(selectedHistoricalWorkflow.startTime)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">End Time</div>
                  <div className="font-medium text-sm">{formatDate(selectedHistoricalWorkflow.endTime)}</div>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">
                    Steps: {selectedHistoricalWorkflow.completedSteps} / {selectedHistoricalWorkflow.totalSteps}
                  </span>
                  <span className="font-medium">
                    {Math.round((selectedHistoricalWorkflow.completedSteps / selectedHistoricalWorkflow.totalSteps) * 100)}%
                  </span>
                </div>
                <Progress
                  value={(selectedHistoricalWorkflow.completedSteps / selectedHistoricalWorkflow.totalSteps) * 100}
                  className="h-2"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex-1 overflow-auto rounded-lg border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground mb-2">Report ID: {selectedHistoricalWorkflow.id}</div>
            <div className="text-sm">
              <p className="text-muted-foreground">
                Detailed step-by-step execution data is available in the report file.
              </p>
              <p className="text-xs mt-2 font-mono text-muted-foreground">
                .data/workflow-reports/{selectedHistoricalWorkflow.filename}
              </p>
            </div>
          </div>
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
          <Button variant="outline" size="sm" onClick={fetchHistoricalWorkflows}>
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
                onClick={() => setSelectedHistoricalWorkflow(workflow)}
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
      <DialogContent className="max-w-[95vw] w-[1400px] h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            UKB Workflow Monitor
          </DialogTitle>
          <DialogDescription>
            Monitor active and historical UKB semantic analysis workflows
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="active" className="flex items-center gap-2">
              <Loader2 className={`h-4 w-4 ${processes.length > 0 ? 'animate-spin' : ''}`} />
              Active
              {processes.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                  {processes.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="flex-1 flex flex-col min-h-0 mt-4">
            {renderActiveContent()}
          </TabsContent>

          <TabsContent value="history" className="flex-1 flex flex-col min-h-0 mt-4">
            {renderHistoryContent()}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import React, { useState } from 'react'
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

interface UKBWorkflowModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  processes: ProcessInfo[]
}

export default function UKBWorkflowModal({ open, onOpenChange, processes }: UKBWorkflowModalProps) {
  const [selectedProcessIndex, setSelectedProcessIndex] = useState(0)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)

  const currentProcess = processes[selectedProcessIndex]

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

  // If no processes, show empty state
  if (processes.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              UKB Workflow Monitor
            </DialogTitle>
            <DialogDescription>
              No active UKB workflows
            </DialogDescription>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                UKB Workflow Monitor
              </DialogTitle>
              <DialogDescription>
                Real-time visualization of the 13-agent semantic analysis workflow
              </DialogDescription>
            </div>
            {/* Process selector */}
            {processes.length > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedProcessIndex(Math.max(0, selectedProcessIndex - 1))}
                  disabled={selectedProcessIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedProcessIndex + 1} / {processes.length}
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
          </div>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchActiveMeasurement,
  startMeasurement,
  stopMeasurement,
  selectActiveMeasurement,
  selectMeasurementLoading,
  selectMeasurementError,
  selectLastCloseCommand,
} from '@/store/slices/performanceSlice'

// Dashboard-only MVP measurement control (gap a). Start writes the active span the
// proxy reads to attribute tokens; Stop archives the span + records a close-request
// marker and surfaces the host command that runs the heavy close (token-aggregate +
// judge + writeRun/writeScore) — which cannot run in-container. Polls the active
// span so the control reflects spans started from the CLI too.
const TASK_CLASSES = ['refactor', 'bugfix', 'new-feature', 'migration', 'debug', 'docs'] as const

export function MeasurementControl() {
  const dispatch = useAppDispatch()
  const active = useAppSelector(selectActiveMeasurement)
  const loading = useAppSelector(selectMeasurementLoading)
  const error = useAppSelector(selectMeasurementError)
  const closeCommand = useAppSelector(selectLastCloseCommand)

  const [taskId, setTaskId] = useState('')
  const [goal, setGoal] = useState('')
  const [taskClass, setTaskClass] = useState('')

  useEffect(() => {
    dispatch(fetchActiveMeasurement())
    const t = setInterval(() => dispatch(fetchActiveMeasurement()), 5000)
    return () => clearInterval(t)
  }, [dispatch])

  const onStart = async () => {
    const result = await dispatch(startMeasurement({ task_id: taskId.trim(), goal: goal.trim() }))
    if (startMeasurement.fulfilled.match(result)) {
      setTaskId('')
      setGoal('')
    }
  }

  const onStop = async () => {
    await dispatch(stopMeasurement({ task_class: taskClass || undefined }))
    setTaskClass('')
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Measurement
          {active ? (
            <Badge variant="secondary" className="text-sm text-muted-foreground">active</Badge>
          ) : (
            <Badge variant="outline" className="text-sm text-muted-foreground">idle</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {active ? (
          <div className="space-y-3">
            <div className="text-sm">
              <div><span className="text-muted-foreground">task_id:</span> <span className="font-mono">{active.task_id}</span></div>
              {active.goal_sentence && (
                <div><span className="text-muted-foreground">goal:</span> {active.goal_sentence}</div>
              )}
              <div><span className="text-muted-foreground">started:</span> {active.started_at}</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="task class"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={taskClass}
                onChange={(e) => setTaskClass(e.target.value)}
              >
                <option value="">task_class (optional)…</option>
                {TASK_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button onClick={onStop} disabled={loading} data-testid="measurement-stop">
                {loading ? 'Stopping…' : 'Stop measurement'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Stop archives the span and records a close request. Run the surfaced host command to
              finish scoring (token-aggregate + judge + Run write run host-side).
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-72 font-mono"
                placeholder="task_id (e.g. exp-myrun-claude)"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                data-testid="measurement-task-id"
              />
              <Input
                className="min-w-[20rem] flex-1"
                placeholder="goal (one sentence)"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                data-testid="measurement-goal"
              />
              <Button onClick={onStart} disabled={loading || taskId.trim() === ''} data-testid="measurement-start">
                {loading ? 'Starting…' : 'Start measurement'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Start a measurement so token usage, route quality, and the outcome score attribute to this
              task_id. Same goal text → same task_hash, so a re-run with a different model is comparable.
            </p>
          </div>
        )}

        {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
        {closeCommand && (
          <div className="mt-2 rounded-md border bg-muted/40 p-2">
            <p className="text-sm font-semibold">Close requested — finish scoring on the host:</p>
            <code className="mt-1 block font-mono text-sm">{closeCommand}</code>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

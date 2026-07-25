// useCellLogPoll — offset-based polling of a cell's live log for the mini-terminal view.
//
// While `active` (cell restoring/running/scoring, or the zoom overlay is open) the hook
// dispatches fetchCellLog every POLL_MS, resuming from the stored offset so each poll
// transfers only the appended chunk. Every 4th poll also requests live token totals
// (?tokens=1 — a readonly token-usage.db aggregate). When `active` flips false one final
// fetch drains whatever the terminal cell flushed on close.
import { useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '@/store'
import { fetchCellLog, type CellLogState } from '@/store/slices/performanceSlice'

const POLL_MS = 1500
const TOKENS_EVERY_N = 4

export function useCellLogPoll(
  runId: string | null | undefined,
  taskId: string | null | undefined,
  active: boolean
): CellLogState | undefined {
  const dispatch = useAppDispatch()
  const log = useAppSelector((s) => (taskId ? s.performance.cellLogs[taskId] : undefined))
  // The offset lives in a ref so the interval callback reads the latest without re-arming.
  const offsetRef = useRef(0)
  offsetRef.current = log?.offset ?? 0
  const tickRef = useRef(0)

  useEffect(() => {
    if (!runId || !taskId) return
    if (!active) {
      // One final drain on terminal state — the runner closes the fd after its last write.
      dispatch(fetchCellLog({ runId, taskId, offset: offsetRef.current, withTokens: true }))
      return
    }
    let cancelled = false
    const poll = () => {
      if (cancelled) return
      tickRef.current += 1
      dispatch(
        fetchCellLog({
          runId,
          taskId,
          offset: offsetRef.current,
          withTokens: tickRef.current % TOKENS_EVERY_N === 1,
        })
      )
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, taskId, active, dispatch])

  return log
}

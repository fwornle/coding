/**
 * Is anyone looking at this page? Polls run only while the answer is yes.
 *
 * Hidden is not enough. A tab left visible in a window keeps `document.hidden`
 * false with nobody in front of it — on 2026-10-30 the Token Usage page in
 * coding's dashboard and in glass's UI each asked for a month of hourly
 * summaries every 30 s all night (~2 s of server CPU and ~1.9 MB a time), on a
 * laptop that did not sleep, until the battery ran out. So the page also counts
 * as unattended after ATTENDED_IDLE_MS without a pointer, key, wheel or touch
 * event in it. The first input after that, or the tab becoming visible again,
 * makes it attended at once, and pollers refresh immediately on that edge.
 *
 * One set of listeners for the whole page; React code reads it through
 * usePageAttended (hooks/usePageAttended.ts), plain code through
 * isPageAttended / onPageAttendedChange.
 */

export const ATTENDED_IDLE_MS = 10 * 60_000

const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const

let lastInput = Date.now()
let attended = typeof document === 'undefined' ? true : !document.hidden
let installed = false
let idleTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(attended: boolean) => void>()

function set(next: boolean) {
  if (next === attended) return
  attended = next
  for (const cb of [...listeners]) cb(attended)
}

/** Re-arm the idle check for the moment the last input turns ATTENDED_IDLE_MS old. */
function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  const due = Math.max(1_000, lastInput + ATTENDED_IDLE_MS - Date.now())
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (Date.now() - lastInput >= ATTENDED_IDLE_MS) set(false)
    else armIdleTimer()
  }, due)
}

function install() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const onInput = () => {
    const wasIdle = !attended
    lastInput = Date.now()
    if (wasIdle && !document.hidden) set(true)
    // Re-arm only when the timer is not already pending — pointermove fires
    // at frame rate, and the pending timer re-checks lastInput when it fires.
    if (!idleTimer) armIdleTimer()
  }
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { passive: true, capture: true })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { set(false); return }
    // Coming back to the tab is attention in itself.
    lastInput = Date.now()
    set(true)
    armIdleTimer()
  })
  armIdleTimer()
}

/** Whether the page is visible and had input within ATTENDED_IDLE_MS. */
export function isPageAttended(): boolean {
  install()
  return attended
}

/** Call `cb` whenever the answer changes; returns the unsubscribe. */
export function onPageAttendedChange(cb: (attended: boolean) => void): () => void {
  install()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

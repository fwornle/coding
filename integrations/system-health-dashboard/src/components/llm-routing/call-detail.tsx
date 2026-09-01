/**
 * Everything one recorded call says about itself.
 *
 * ── Attempted and skipped are not the same thing, and never share a shape ────
 * `attempts[]` is "this provider was tried and did not answer" — a real event,
 * with an error and a duration. `skipped[]` is "this provider was never tried",
 * which is a property of the config or of the runtime, not of this call. The
 * Routing tab already keeps them apart and this must too: rendering a skip as
 * though it were an attempt invents a request that was never made.
 *
 * So attempts get hop numbers and a verdict; skips get a ⊘ and their kind, and
 * `config` (fix by editing YAML) is distinguished from `runtime` (fix by a login
 * or a VPN), because they are different problems.
 */

import { Badge } from '@/components/ui/badge'
import { localClock } from '@/lib/utils'
import { GATES } from './offload-gates'
import type { GateVerdict } from './offload-gates'
import { parseTrail, rungOfCall } from './recent-call'
import { describeBandSource } from './turn-grouping'
import type { RecentCall } from './recent-call'

const HOPS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

const fmt = (n: number): string => (
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K`
      : String(n)
)

interface Props {
  call: RecentCall | null
  /**
   * What this call WOULD have done on another network, when one is selected.
   *
   * Rendered under its own heading and never merged into the `offload` row
   * above, which stays the proxy's verbatim record of what actually happened.
   * One row saying both would be a paragraph the reader has to disentangle, and
   * the whole reason this panel quotes the reason string is that it is a record.
   */
  replay?: { network: string; verdict: GateVerdict } | null
}

export function CallDetail({ call, replay = null }: Props) {
  if (!call) {
    return (
      <div className="text-[11px] text-muted-foreground border rounded p-3 h-full flex items-center">
        Select a call in the strip to see its decision trail.
      </div>
    )
  }

  const trail = parseTrail(call.attempt_trail)
  const bandWhy = describeBandSource(call)
  const rung = rungOfCall(call)
  const reconstructed = call.routing_source === 'backfill'

  return (
    <div className="text-[11px] border rounded p-3 space-y-2 font-mono">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-foreground">{localClock(call.timestamp)}</span>
        <span className="text-muted-foreground">·</span>
        <span>{call.route_key || '—'}</span>
        {reconstructed && (
          <Badge variant="outline" className="text-[9px] py-0">reconstructed</Badge>
        )}
      </div>

      <Row label="served by">{call.provider}/{call.model}</Row>
      <Row label="band">
        {call.route_band || '—'}
        {call.route_step > 0 && <span className="text-muted-foreground"> · step {call.route_step}</span>}
        {/* WHO decided it. The band alone is what made a two-call pi turn
            unreadable: `small` then `medium` looks like a measurement of the
            work, when in fact the caller declared `medium` both times and only
            the first call was one the classifier was allowed to look at. The
            classifier's note is quoted verbatim for the same reason the offload
            row below is — it is a record, and a prettier restatement here would
            be a second thing to keep in step with the proxy. */}
        {bandWhy && (
          <span className="block text-muted-foreground">{bandWhy}</span>
        )}
      </Row>
      <Row label="tokens">
        {fmt(call.total_tokens + (call.cache_read_tokens || 0) + (call.cache_write_tokens || 0))}
        {!!call.cache_read_tokens && (
          <span className="text-muted-foreground">
            {' '}({fmt(call.total_tokens)} fresh + {fmt((call.cache_read_tokens || 0) + (call.cache_write_tokens || 0))} cache)
          </span>
        )}
      </Row>

      {/* The offload verdict, in the proxy's own words. Never paraphrased — the
          string is what `rungOfReason` matches on, and a prettier restatement
          here would be a second thing to keep in step with the proxy. */}
      <Row label="offload">
        {call.offloaded_from
          ? <span className="text-emerald-600 dark:text-emerald-400">✓ moved off {call.offloaded_from}</span>
          : trail?.offloadSkipped
            ? <span className="text-muted-foreground">✗ {trail.offloadSkipped}</span>
            : <span className="text-muted-foreground">no offload decision recorded for this call</span>}
      </Row>

      {rung !== null && (
        <Row label="rung">
          <span className="text-foreground">{rung}</span>
          <span className="text-muted-foreground"> · {GATES[rung].label}</span>
        </Row>
      )}

      {replay && (
        <div className="border-t pt-1.5 space-y-0.5">
          <div className="text-amber-700 dark:text-amber-400">
            on {replay.network} — not what happened
          </div>
          <div className="pl-2">
            {replay.verdict.offloadedFrom
              ? <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ would move to {replay.verdict.provider}
                </span>
              : <span className="text-muted-foreground">
                  ✗ {replay.verdict.reason ?? `stays on ${replay.verdict.provider}`}
                </span>}
          </div>
          <div className="pl-2 text-muted-foreground">
            rung {replay.verdict.rung} · {GATES[replay.verdict.rung].label}
          </div>
        </div>
      )}

      {!!trail?.attempts?.length && (
        <div className="space-y-0.5">
          <div className="text-muted-foreground">attempts</div>
          {trail.attempts.map((a, i) => (
            <div key={i} className="pl-2 text-amber-600 dark:text-amber-500">
              {HOPS[i] ?? `(${i + 1})`} {a.provider}{a.model ? `/${a.model}` : ''}
              {a.error ? ` — ${a.error}` : ''}{a.ms != null ? ` · ${a.ms}ms` : ''} ✕
            </div>
          ))}
          <div className="pl-2 text-emerald-600 dark:text-emerald-400">
            {HOPS[trail.attempts.length] ?? `(${trail.attempts.length + 1})`} {call.provider}/{call.model} — served ✓
          </div>
        </div>
      )}

      {call.chain_position > 0 && !trail?.attempts?.length && (
        <Row label="fallback">
          <span className="text-amber-600 dark:text-amber-500">
            served at chain position +{call.chain_position} — the earlier hops left no recorded trail
          </span>
        </Row>
      )}

      {!!trail?.skipped?.length && (
        <div className="space-y-0.5">
          <div className="text-muted-foreground">never tried</div>
          {trail.skipped.map((s, i) => (
            <div key={i} className="pl-2 text-muted-foreground">
              ⊘ {s.provider} — {s.reason}{' '}
              <Badge variant="outline" className="text-[9px] py-0">{s.kind}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-[68px] shrink-0">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

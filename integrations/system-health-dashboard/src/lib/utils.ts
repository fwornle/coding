import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Clock time of a `token_usage` timestamp in the VIEWER's timezone.
 *
 * The rows arrive as ISO-8601 UTC (`2026-08-30T13:09:51.725Z`), so slicing the
 * string out of them renders UTC and reads two hours slow in CEST. Parse, then
 * format — `hour12: false` because these tables are monospaced and a 12-hour
 * clock with an am/pm suffix would break the column.
 *
 * Falls back to the raw substring if the value will not parse, so an unexpected
 * shape degrades to the old behaviour rather than rendering `Invalid Date`.
 */
export function localClock(ts: string, opts: { seconds?: boolean } = {}): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(11, opts.seconds === false ? 16 : 19)
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.seconds === false ? {} : { second: '2-digit' }),
    hour12: false,
  })
}

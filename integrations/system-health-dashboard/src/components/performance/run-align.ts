// run-align.ts — pure run-pair sequence alignment (D-07).
//
// Aligns two runs' per-request ContextTurnRow[] sequences (Phase-84 granularity, empirically
// confirmed in 86-01 Task 0: one line per LLM request, no per-reasoning-step sub-lines — so
// the request sequence IS the parent-turn-equivalent stream and needs no pre-flatten).
//
// DEPENDENCY-FREE: declares a local `TurnLike` subset type and imports nothing (no `@/` alias,
// no React) so root Jest can transform+import it directly. Only `messages[].tool.{name,size}`
// and `messages[].bytes` are read.
//
// Two-phase algorithm (86-RESEARCH §2, grounds in Myers 1986 prefix-trim + LCS):
//   Phase 1 — common-prefix walk in lockstep by signature → prefixLen p; firstDivergence = p
//             when either side has more turns, else null (identical).
//   Phase 2 — LCS over the divergent tails sa[p..]/sb[p..] → aligned absolute-index pairs;
//             unaligned turns render one-sided ({ a: idx, b: null } or { a: null, b: idx }).

/** Minimal subset of ContextTurnMessage the signature reads. */
export interface TurnMessageLike {
  bytes: number
  tool: { name: string | null; size: number } | null
}

/** Minimal subset of ContextTurnRow the alignment reads. Keeps the module type-decoupled. */
export interface TurnLike {
  messages: TurnMessageLike[]
}

export interface AlignResult {
  /** identical-prefix length → collapse [0, prefixLen) by default (D-07). */
  prefixLen: number
  /** = prefixLen when the sequences differ; null when the two runs are identical. */
  firstDivergence: number | null
  /** aligned absolute-index pairs for the divergent tail (null = one-sided). */
  pairs: Array<{ a: number | null; b: number | null }>
}

/**
 * Coarse log2 size bucket. Makes the same tool with near-identical args align across two runs
 * whose prompts differ by a token or two: 256B and 300B collide (both bucket 8); 256B and 4KB
 * do not (8 vs 12). Non-positive bytes → 'z'.
 */
export function sizeBucket(bytes: number): string {
  if (bytes <= 0) return 'z'
  return String(Math.floor(Math.log2(bytes)))
}

/**
 * A turn's alignment/loop key. Tool-bearing turn → `T|name:bucket,...` over its tool calls in
 * order; a turn with no tool call keys on `R|bucket` over its summed message bytes (so two
 * pure-reasoning turns of similar size still align).
 */
export function turnSignature(t: TurnLike): string {
  const messages = t.messages ?? []
  const tools = messages
    .map((m) => m.tool)
    .filter((x): x is { name: string | null; size: number } => x != null && !!x.name)
    .map((x) => `${x.name}:${sizeBucket(x.size)}`)
  if (tools.length > 0) return `T|${tools.join(',')}`
  const bytes = messages.reduce((acc, m) => acc + (m.bytes ?? 0), 0)
  return `R|${sizeBucket(bytes)}`
}

/**
 * Longest-common-subsequence pairing of two signature tails via O(n·m) DP. Returns aligned
 * pairs in sequence order; `offset` maps tail-relative indices back to absolute run indices.
 * Matched turns → { a, b }; only-in-A → { a, b: null }; only-in-B → { a: null, b }.
 */
function lcsPairs(sa: string[], sb: string[], offset: number): AlignResult['pairs'] {
  const n = sa.length
  const m = sb.length
  // dp[i][j] = LCS length of sa[i..] and sb[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = sa[i] === sb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs: AlignResult['pairs'] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (sa[i] === sb[j]) {
      pairs.push({ a: offset + i, b: offset + j })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pairs.push({ a: offset + i, b: null })
      i++
    } else {
      pairs.push({ a: null, b: offset + j })
      j++
    }
  }
  while (i < n) {
    pairs.push({ a: offset + i, b: null })
    i++
  }
  while (j < m) {
    pairs.push({ a: null, b: offset + j })
    j++
  }
  return pairs
}

/**
 * Align two runs by signature. Phase 1 finds the identical prefix + first divergence; Phase 2
 * LCS-pairs the divergent tail. Identical runs → { prefixLen: len, firstDivergence: null, pairs: [] }.
 */
export function alignRuns(a: TurnLike[], b: TurnLike[]): AlignResult {
  const sa = a.map(turnSignature)
  const sb = b.map(turnSignature)
  // Phase 1: common-prefix walk in lockstep.
  let p = 0
  while (p < sa.length && p < sb.length && sa[p] === sb[p]) p++
  const firstDivergence = p < sa.length || p < sb.length ? p : null
  // Phase 2: LCS over the divergent tails (absolute indices via offset p).
  const pairs = lcsPairs(sa.slice(p), sb.slice(p), p)
  return { prefixLen: p, firstDivergence, pairs }
}

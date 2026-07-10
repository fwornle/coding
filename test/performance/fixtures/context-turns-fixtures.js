// ContextTurnRow[] fixtures for the run-align (D-07) + loop-heuristic (D-09) unit suites.
//
// A ContextTurnRow's alignment/loop signature is derived ONLY from `messages[].tool.{name,size}`
// (tool-bearing turn) or the summed `messages[].bytes` (pure-reasoning turn) — see
// run-align.ts turnSignature. These fixtures therefore only populate the fields the pure
// modules read (`messages[].tool`, `messages[].bytes`); the remaining ContextTurnRow fields
// (ts/task_id/agent/wire/usage/…) are filled with inert stand-ins so the shape stays honest
// without coupling the algorithm tests to capture semantics.

let _seq = 0

/** Build a ContextTurnRow whose signature is a single tool call `name` of byte-`size`. */
function toolTurn(name, size, extraBytes = 0) {
  _seq += 1
  return {
    ts: 1_000 + _seq,
    task_id: 'fixture',
    agent: 'claude',
    wire: 'anthropic',
    request_id: `req_${_seq}`,
    model: 'claude-sonnet',
    usage: { input: 10, output: 5, cache_read: 0, cache_write: 0 },
    cache_breakpoints: [],
    categories: [],
    messages: [
      { i: 0, role: 'assistant', bytes: size + extraBytes, tool: { name, size }, preview: `${name}(...)` },
    ],
    observation_ref: null,
  }
}

/** Build a pure-reasoning ContextTurnRow (no tool) whose signature keys on summed bytes. */
function reasoningTurn(bytes) {
  _seq += 1
  return {
    ts: 1_000 + _seq,
    task_id: 'fixture',
    agent: 'claude',
    wire: 'anthropic',
    request_id: `req_${_seq}`,
    model: 'claude-sonnet',
    usage: { input: 10, output: 5, cache_read: 0, cache_write: 0 },
    cache_breakpoints: [],
    categories: [],
    messages: [{ i: 0, role: 'assistant', bytes, tool: null, preview: 'thinking…' }],
    observation_ref: null,
  }
}

// (a) identical: A === B by signature. Read (256B) → Bash (1KB) → Write (2KB).
export const identicalPair = {
  a: [toolTurn('Read', 256), toolTurn('Bash', 1024), toolTurn('Write', 2048)],
  b: [toolTurn('Read', 256), toolTurn('Bash', 1024), toolTurn('Write', 2048)],
}

// (b) diverge-then-reconverge: shared prefix (Read, Bash), then B INSERTS an extra Bash
// turn at the divergence index, after which BOTH run the same Test signature — so LCS
// must re-pair the re-converged Test turns and mark the inserted B turn one-sided.
//   A: Read, Bash,            Test
//   B: Read, Bash, Bash(ins), Test
// firstDivergence = 2 (A[2]=Test vs B[2]=Bash differ); LCS tail pairs A.Test↔B.Test,
// leaving B's inserted Bash as { a: null, b: 2 }.
export const divergeReconverge = {
  a: [toolTurn('Read', 256), toolTurn('Bash', 1024), toolTurn('Test', 4096)],
  b: [toolTurn('Read', 256), toolTurn('Bash', 1024), toolTurn('Bash', 700), toolTurn('Test', 4096)],
}

// (c) known-looping: the same Read+Bash signature pair repeats 3× within a 6-turn window.
// Turns: Read(256), Bash(1024), Read(256), Bash(1024), Read(256), Bash(1024).
// loopFlags should flag the 2nd + 3rd Read and the 2nd + 3rd Bash (in-window repeats),
// NOT the first occurrence of each.
export const loopingRun = [
  toolTurn('Read', 256),
  toolTurn('Bash', 1024),
  toolTurn('Read', 256),
  toolTurn('Bash', 1024),
  toolTurn('Read', 256),
  toolTurn('Bash', 1024),
]

// Helpers exported for tests that need to build bespoke sequences (out-of-window,
// pure-reasoning) without duplicating the row-builder boilerplate.
export { toolTurn, reasoningTurn }

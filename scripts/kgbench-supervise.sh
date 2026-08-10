#!/usr/bin/env bash
#
# Detached, self-resuming supervisor for a kgbench matrix.
#
#   scripts/kgbench-supervise.sh --run-id coding-v1-r7 --set coding-v1 --reps 3 \
#                                --deepen A1,A2,A3,A4 --deepen-reps 10
#   scripts/kgbench-supervise.sh --run-id coding-v1-r6 --set coding-v1 --only A3,A4 --reps 10
#
# WHY THIS EXISTS
#
# A full matrix runs for hours, and during the r6 run two attempts were terminated
# part-way with no error, no stack, and nothing in any project log. The evidence says a
# supervising task manager sent the process group a catchable signal:
#
#   - kgbench-run.mjs cleans up its worktree on SIGINT/SIGTERM and would LEAK it on
#     SIGKILL. No worktree leaked either time, so the runner caught a signal and exited
#     through its own handler.
#   - The health coordinator logged only network polling across the whole window; no
#     project sweeper matches the runner's command line; memory was 48% free with no
#     jetsam events.
#   - The decisive comparison: both deaths were runs tracked by a task manager. The same
#     workload, launched detached with nohup, completed 188 further cells untouched.
#
# So the run must not be a child of anything that might tidy it up. This script
# re-executes itself detached, then supervises.
#
# WHAT IT WILL NOT DO
#
# It resumes only after a SIGNAL death (exit >= 128). kgbench exits 2 when it REFUSES to
# run — preflight failure, a leak found in the tree, three consecutive API errors — and
# those must never be retried: they mean the run would be meaningless, and a supervisor
# that restarts through them turns a loud refusal into an infinite quiet loop.
#
# Completed cells are preserved by the runner's own resume, so a restart costs only the
# cell that was in flight.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 2

RUN_ID=""; SET_NAME="coding-v1"; REPS="3"; ONLY=""; DEEPEN=""; DEEPEN_REPS="10"; ARMS=""
AGENTS=""; MODELS=""; BASELINE_WAIT=""
# Continuation turns per answer-file agent. Threaded into EVERY pass below, never one of
# them: passes differ in which questions they cover, not in how many turns an agent gets,
# and a budget that varied between the base and deepen passes would put cells of the same
# run on different terms — which is the asymmetry the budget exists to remove.
CONTINUATIONS=""
MAX_RESTARTS="8"

while [ $# -gt 0 ]; do
  case "$1" in
    --run-id)      RUN_ID="$2"; shift 2 ;;
    --set)         SET_NAME="$2"; shift 2 ;;
    --reps)        REPS="$2"; shift 2 ;;
    --only)        ONLY="$2"; shift 2 ;;
    --arms)        ARMS="$2"; shift 2 ;;
    --agents)      AGENTS="$2"; shift 2 ;;
    --models)      MODELS="$2"; shift 2 ;;
    --baseline-token-wait-s) BASELINE_WAIT="$2"; shift 2 ;;
    --continuations) CONTINUATIONS="$2"; shift 2 ;;
    --deepen)      DEEPEN="$2"; shift 2 ;;
    --deepen-reps) DEEPEN_REPS="$2"; shift 2 ;;
    --max-restarts) MAX_RESTARTS="$2"; shift 2 ;;
    *) echo "kgbench-supervise: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

[ -n "$RUN_ID" ] || { echo "kgbench-supervise: --run-id is required" >&2; exit 2; }

RUN_DIR="$REPO_ROOT/.data/kgbench/runs/$RUN_ID"
LOG="$RUN_DIR/supervise.log"
STATUS="$RUN_DIR/supervise.status"
LOCK="$RUN_DIR/supervise.pid"
mkdir -p "$RUN_DIR"

# ---- detach ----------------------------------------------------------------
# First invocation re-execs itself under nohup and returns immediately. setsid is not
# available on macOS; nohup + & + disown is enough to survive the parent's process group
# being signalled, which is the failure this exists to prevent.
if [ -z "${KGBENCH_SUPERVISED:-}" ]; then
  if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
    echo "kgbench-supervise: already running for $RUN_ID (pid $(cat "$LOCK")); refusing to double-launch." >&2
    exit 2
  fi
  KGBENCH_SUPERVISED=1 nohup "$0" \
    --run-id "$RUN_ID" --set "$SET_NAME" --reps "$REPS" \
    ${ONLY:+--only "$ONLY"} ${ARMS:+--arms "$ARMS"} ${AGENTS:+--agents "$AGENTS"} ${MODELS:+--models "$MODELS"} \
    ${BASELINE_WAIT:+--baseline-token-wait-s "$BASELINE_WAIT"} \
    ${CONTINUATIONS:+--continuations "$CONTINUATIONS"} \
    ${DEEPEN:+--deepen "$DEEPEN"} --deepen-reps "$DEEPEN_REPS" \
    --max-restarts "$MAX_RESTARTS" >>"$LOG" 2>&1 &
  disown
  echo "kgbench-supervise: detached (pid $!)"
  echo "  log      $LOG"
  echo "  status   $STATUS"
  echo "  progress wc -l $RUN_DIR/results.jsonl"
  exit 0
fi

echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
set_status() { echo "$1" > "$STATUS"; }

# Run one pass, resuming it if and only if it was killed by a signal.
run_pass() {
  local label="$1"; shift
  local tries=0 rc=0
  while :; do
    say "pass '$label' starting: node scripts/kgbench-run.mjs $*"
    node scripts/kgbench-run.mjs "$@"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      say "pass '$label' complete"
      return 0
    fi
    if [ "$rc" -ge 128 ]; then
      tries=$((tries + 1))
      local sig=$((rc - 128))
      if [ "$tries" -gt "$MAX_RESTARTS" ]; then
        say "pass '$label' died on signal $sig again; $tries deaths exceeds --max-restarts $MAX_RESTARTS. Giving up."
        set_status "abandoned: repeated signal deaths in pass '$label'"
        return "$rc"
      fi
      say "pass '$label' died on signal $sig (exit $rc). Completed cells are kept; resuming in 5s (attempt $tries/$MAX_RESTARTS)."
      set_status "resuming: pass '$label' after signal $sig, attempt $tries/$MAX_RESTARTS"
      sleep 5
      continue
    fi
    # 1..127 — kgbench refused on purpose. Retrying would loop on a real problem.
    say "pass '$label' exited $rc. That is a deliberate refusal (preflight, containment, or repeated API errors), not a crash — NOT retrying."
    set_status "failed: pass '$label' exited $rc (deliberate refusal; see log)"
    return "$rc"
  done
}

say "supervising run '$RUN_ID' (set=$SET_NAME reps=$REPS arms='${ARMS:-all enabled}' agents='${AGENTS:-claude}' models='${MODELS:-per-arm}' only='${ONLY:-all}' deepen='${DEEPEN:-none}' continuations='${CONTINUATIONS:-0 (arm default)}')"
set_status "running"

if [ -n "$ONLY" ]; then
  run_pass "only:$ONLY" --set "$SET_NAME" --reps "$REPS" --only "$ONLY" ${ARMS:+--arms "$ARMS"} ${AGENTS:+--agents "$AGENTS"} ${MODELS:+--models "$MODELS"} ${BASELINE_WAIT:+--baseline-token-wait-s "$BASELINE_WAIT"} ${CONTINUATIONS:+--continuations "$CONTINUATIONS"} --run-id "$RUN_ID" || exit $?
else
  run_pass "matrix" --set "$SET_NAME" --reps "$REPS" ${ARMS:+--arms "$ARMS"} ${AGENTS:+--agents "$AGENTS"} ${MODELS:+--models "$MODELS"} ${BASELINE_WAIT:+--baseline-token-wait-s "$BASELINE_WAIT"} ${CONTINUATIONS:+--continuations "$CONTINUATIONS"} --run-id "$RUN_ID" || exit $?
  if [ -n "$DEEPEN" ]; then
    # The axes travel to the deepen pass too: adding reps under a different agent set would
    # deepen a different experiment than the one the matrix measured.
    run_pass "deepen:$DEEPEN" --set "$SET_NAME" --reps "$DEEPEN_REPS" --only "$DEEPEN" ${ARMS:+--arms "$ARMS"} ${AGENTS:+--agents "$AGENTS"} ${MODELS:+--models "$MODELS"} ${BASELINE_WAIT:+--baseline-token-wait-s "$BASELINE_WAIT"} ${CONTINUATIONS:+--continuations "$CONTINUATIONS"} --run-id "$RUN_ID" || exit $?
  fi
fi

CELLS=$(grep -c . "$RUN_DIR/results.jsonl" 2>/dev/null || echo 0)
say "run '$RUN_ID' complete: $CELLS cells recorded"
set_status "complete: $CELLS cells"

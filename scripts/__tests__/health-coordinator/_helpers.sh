#!/bin/bash
# Test helpers for Phase 33 health-coordinator tests.
# Lifted from tests/integration/launcher-e2e.sh:43-105 (run_test + assert_*).
# NOTE: this file is sourced; do NOT add `set -e` here. Callers may.

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Counters
TOTAL_TESTS=${TOTAL_TESTS:-0}
TESTS_PASSED=${TESTS_PASSED:-0}
TESTS_FAILED=${TESTS_FAILED:-0}
TESTS_SKIPPED=${TESTS_SKIPPED:-0}

URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

run_test() {
  local test_name="$1"
  local test_func="$2"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  printf "${CYAN}[TEST %2d]${NC} %-60s " "$TOTAL_TESTS" "$test_name"
  local output exit_code
  output=$($test_func 2>&1) && exit_code=0 || exit_code=$?
  if [ $exit_code -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  elif [ $exit_code -eq 2 ]; then
    echo -e "${YELLOW}SKIP${NC}"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    [ -n "$output" ] && echo "    Reason: $output"
  else
    echo -e "${RED}FAIL${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    [ -n "$output" ] && echo "$output" | sed 's/^/    /'
  fi
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  local context="$3"
  if [ "$actual" -ne "$expected" ]; then
    echo "Expected exit code $expected, got $actual ($context)"
    return 1
  fi
}

assert_output_contains() {
  local needle="$1"
  local haystack="$2"
  local context="$3"
  if ! echo "$haystack" | grep -qF -- "$needle"; then
    echo "Expected output to contain '$needle' ($context)"
    return 1
  fi
}

assert_output_not_contains() {
  local needle="$1"
  local haystack="$2"
  local context="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    echo "Expected output to NOT contain '$needle' ($context)"
    return 1
  fi
}

# ============================================
# Coordinator-specific helpers (NEW in Phase 33)
# ============================================

assert_state_field() {
  local jq_path="$1"
  local expected="$2"
  local context="$3"
  local actual
  actual=$(curl -sf "$URL/health/state" | jq -r "$jq_path")
  if [ "$actual" != "$expected" ]; then
    echo "Expected $jq_path == $expected, got '$actual' ($context)"
    return 1
  fi
}

wait_for_coordinator() {
  local max_wait="${1:-30}"
  for i in $(seq 1 "$max_wait"); do
    if curl -sf "$URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "coordinator did not respond on $URL within ${max_wait}s"
  return 1
}

print_summary() {
  echo ""
  echo "============================================"
  echo "Total: $TOTAL_TESTS  Passed: $TESTS_PASSED  Failed: $TESTS_FAILED  Skipped: $TESTS_SKIPPED"
  echo "============================================"
  if [ "$TESTS_FAILED" -gt 0 ]; then
    return 1
  fi
  return 0
}

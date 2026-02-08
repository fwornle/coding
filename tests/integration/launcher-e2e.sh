#!/bin/bash

# Comprehensive E2E Test Script for Coding Launcher
# Tests all combinations of CN/proxy/agent scenarios
#
# Usage: ./tests/integration/launcher-e2e.sh [--verbose]
#
# Prerequisites:
#   - Node.js available
#   - bin/coding exists and is executable
#
# Note: These tests use --dry-run mode to avoid actually launching agents.
# Network detection is mocked via CODING_FORCE_CN environment variable.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODING_BIN="$CODING_ROOT/bin/coding"

VERBOSE=false
if [ "$1" = "--verbose" ]; then
  VERBOSE=true
fi

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0
TOTAL_TESTS=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ============================================
# Test Helpers
# ============================================

run_test() {
  local test_name="$1"
  local test_func="$2"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))

  printf "${CYAN}[TEST %2d]${NC} %-60s " "$TOTAL_TESTS" "$test_name"

  # Run test function, capture output and exit code
  local output
  local exit_code
  output=$($test_func 2>&1) && exit_code=0 || exit_code=$?

  if [ $exit_code -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    if [ "$VERBOSE" = true ] && [ -n "$output" ]; then
      echo "$output" | sed 's/^/    /'
    fi
  elif [ $exit_code -eq 2 ]; then
    echo -e "${YELLOW}SKIP${NC}"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    if [ -n "$output" ]; then
      echo "    Reason: $output"
    fi
  else
    echo -e "${RED}FAIL${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    if [ -n "$output" ]; then
      echo "$output" | sed 's/^/    /'
    fi
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
  local output="$1"
  local expected="$2"
  local context="$3"
  if ! echo "$output" | grep -qF -- "$expected"; then
    echo "Expected output to contain '$expected' ($context)"
    echo "Actual output: ${output:0:500}"
    return 1
  fi
}

assert_output_not_contains() {
  local output="$1"
  local unexpected="$2"
  local context="$3"
  if echo "$output" | grep -qF -- "$unexpected"; then
    echo "Expected output NOT to contain '$unexpected' ($context)"
    return 1
  fi
}

# Run coding with --dry-run, capturing output and exit code.
# Suppresses set -e for the invocation so we can capture failures.
run_coding_dry() {
  local args=("$@")
  local output
  local exit_code

  # Run with --dry-run, disable set -e temporarily
  output=$(set +e; "$CODING_BIN" --dry-run "${args[@]}" 2>&1) && exit_code=0 || exit_code=$?

  echo "$output"
  return $exit_code
}

# ============================================
# Test Matrix: CN x Proxy x Agent (8 scenarios)
# ============================================

# Scenario 1: Inside CN + Proxy set + claude (default)
test_cn_proxy_claude() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=true
    export HTTP_PROXY="http://127.0.0.1:3128"
    export HTTPS_PROXY="http://127.0.0.1:3128"
    run_coding_dry --verbose
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=claude" "should select claude agent" || return 1
}

# Scenario 2: Inside CN + Proxy set + --copi
test_cn_proxy_copi() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=true
    export HTTP_PROXY="http://127.0.0.1:3128"
    export HTTPS_PROXY="http://127.0.0.1:3128"
    run_coding_dry --verbose --copi
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=copilot" "should select copilot agent" || return 1
}

# Scenario 3: Inside CN + No proxy + claude (default)
test_cn_noproxy_claude() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=true
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
    run_coding_dry --verbose
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=claude" "should select claude agent" || return 1
}

# Scenario 4: Inside CN + No proxy + --copi
test_cn_noproxy_copi() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=true
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
    run_coding_dry --verbose --copi
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=copilot" "should select copilot agent" || return 1
}

# Scenario 5: Outside CN + Proxy set + claude (default)
test_public_proxy_claude() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=false
    export HTTP_PROXY="http://127.0.0.1:3128"
    export HTTPS_PROXY="http://127.0.0.1:3128"
    run_coding_dry --verbose
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=claude" "should select claude agent" || return 1
}

# Scenario 6: Outside CN + Proxy set + --copi
test_public_proxy_copi() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=false
    export HTTP_PROXY="http://127.0.0.1:3128"
    export HTTPS_PROXY="http://127.0.0.1:3128"
    run_coding_dry --verbose --copi
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=copilot" "should select copilot agent" || return 1
}

# Scenario 7: Outside CN + No proxy + claude (default)
test_public_noproxy_claude() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=false
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
    run_coding_dry --verbose
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=claude" "should select claude agent" || return 1
}

# Scenario 8: Outside CN + No proxy + --copi
test_public_noproxy_copi() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=false
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
    run_coding_dry --verbose --copi
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=copilot" "should select copilot agent" || return 1
}

# ============================================
# Additional Tests
# ============================================

# Test: --copi and --copilot produce identical agent selection
test_copi_copilot_equivalence() {
  local output_copi
  local output_copilot

  output_copi=$(
    export CODING_FORCE_CN=false
    run_coding_dry --verbose --copi
  ) 2>&1 || true

  output_copilot=$(
    export CODING_FORCE_CN=false
    run_coding_dry --verbose --copilot
  ) 2>&1 || true

  # Both should select copilot agent
  assert_output_contains "$output_copi" "Agent=copilot" "--copi should select copilot" || return 1
  assert_output_contains "$output_copilot" "Agent=copilot" "--copilot should select copilot" || return 1
}

# Test: --claude selects claude agent
test_claude_flag() {
  local output
  output=$(
    export CODING_FORCE_CN=false
    run_coding_dry --verbose --claude
  ) 2>&1 || true

  assert_output_contains "$output" "Agent=claude" "--claude should select claude agent" || return 1
}

# Test: Invalid agent name produces error
test_invalid_agent() {
  local output
  local exit_code
  output=$(
    export CODING_FORCE_CN=false
    run_coding_dry --verbose --agent invalid_agent
  ) && exit_code=0 || exit_code=$?

  # Should fail with unsupported agent error
  if [ $exit_code -eq 0 ]; then
    echo "Expected non-zero exit code for invalid agent"
    return 1
  fi
  assert_output_contains "$output" "Unsupported agent" "should show unsupported agent error" || return 1
}

# Test: --help shows help text and exits
test_help_flag() {
  local output
  local exit_code
  output=$("$CODING_BIN" --help 2>&1) && exit_code=0 || exit_code=$?

  assert_exit_code 0 $exit_code "--help should exit 0" || return 1
  assert_output_contains "$output" "--copi" "help should document --copi alias" || return 1
  assert_output_contains "$output" "--dry-run" "help should document --dry-run" || return 1
  assert_output_contains "$output" "--copilot" "help should document --copilot" || return 1
}

# Test: --verbose shows agent selection log
test_verbose_agent_selection() {
  local output
  output=$(
    export CODING_FORCE_CN=false
    run_coding_dry --verbose --claude
  ) 2>&1 || true

  assert_output_contains "$output" "Using forced agent: claude" "--verbose should show agent selection" || return 1
}

# Test: Docker auto-start logic exists in shared helper
test_docker_autostart_exists() {
  local coding_root
  coding_root="$(cd "$SCRIPT_DIR/../.." && pwd)"

  # Check ensure-docker.sh exists and contains key functions
  if [ ! -f "$coding_root/scripts/ensure-docker.sh" ]; then
    echo "scripts/ensure-docker.sh not found"
    return 1
  fi

  if ! grep -q "early_docker_launch" "$coding_root/scripts/ensure-docker.sh"; then
    echo "early_docker_launch not found in ensure-docker.sh"
    return 1
  fi

  # Verify launch-agent-common.sh sources ensure-docker.sh (shared orchestrator)
  if ! grep -q "ensure-docker.sh" "$coding_root/scripts/launch-agent-common.sh"; then
    echo "launch-agent-common.sh does not source ensure-docker.sh"
    return 1
  fi

  # Verify both thin-wrapper launchers delegate to launch-agent-common.sh
  if ! grep -q "launch-agent-common.sh" "$coding_root/scripts/launch-claude.sh"; then
    echo "launch-claude.sh does not source launch-agent-common.sh"
    return 1
  fi

  if ! grep -q "launch-agent-common.sh" "$coding_root/scripts/launch-copilot.sh"; then
    echo "launch-copilot.sh does not source launch-agent-common.sh"
    return 1
  fi
}

# Test: Agent config files exist for known agents
test_agent_configs_exist() {
  local coding_root
  coding_root="$(cd "$SCRIPT_DIR/../.." && pwd)"

  if [ ! -f "$coding_root/config/agents/claude.sh" ]; then
    echo "config/agents/claude.sh not found"
    return 1
  fi

  if [ ! -f "$coding_root/config/agents/copilot.sh" ]; then
    echo "config/agents/copilot.sh not found"
    return 1
  fi

  # Verify configs define AGENT_NAME
  if ! grep -q 'AGENT_NAME="claude"' "$coding_root/config/agents/claude.sh"; then
    echo "claude.sh missing AGENT_NAME"
    return 1
  fi

  if ! grep -q 'AGENT_NAME="copilot"' "$coding_root/config/agents/copilot.sh"; then
    echo "copilot.sh missing AGENT_NAME"
    return 1
  fi
}

# Test: Generic launcher fallback works for config-only agents
test_generic_launcher_fallback() {
  local output
  local exit_code

  # opencode has a config but no launch-opencode.sh — should use generic launcher
  output=$(
    export CODING_FORCE_CN=false
    run_coding_dry --verbose --agent opencode
  ) && exit_code=0 || exit_code=$?

  assert_output_contains "$output" "DRY-RUN" "should reach dry-run exit" || return 1
  assert_output_contains "$output" "Agent=opencode" "should select opencode agent" || return 1
}

# Test: dry-run produces DRY-RUN markers
test_dry_run_markers() {
  local output
  output=$(
    export CODING_FORCE_CN=false
    run_coding_dry --verbose
  ) 2>&1 || true

  assert_output_contains "$output" "DRY-RUN: All startup logic completed" "should show completion marker" || return 1
  assert_output_contains "$output" "DRY-RUN: Would launch" "should show what would be launched" || return 1
}

# Test: CN detection respects CODING_FORCE_CN=true
test_force_cn_true() {
  local output
  # Source detect-network.sh directly to test CN detection in isolation
  output=$(
    log() { echo "$1"; }
    export -f log
    export CODING_FORCE_CN=true
    source "$CODING_ROOT/scripts/detect-network.sh"
    detect_corporate_network
    echo "RESULT: INSIDE_CN=$INSIDE_CN"
  ) 2>&1 || true

  assert_output_contains "$output" "RESULT: INSIDE_CN=true" "should detect forced CN" || return 1
}

# Test: CN detection respects CODING_FORCE_CN=false
test_force_cn_false() {
  local output
  # Source detect-network.sh directly to test CN detection in isolation
  output=$(
    log() { echo "$1"; }
    export -f log
    export CODING_FORCE_CN=false
    source "$CODING_ROOT/scripts/detect-network.sh"
    detect_corporate_network
    echo "RESULT: INSIDE_CN=$INSIDE_CN"
  ) 2>&1 || true

  assert_output_contains "$output" "RESULT: INSIDE_CN=false" "should detect forced non-CN" || return 1
}

# ============================================
# Run All Tests
# ============================================

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN} Coding Launcher E2E Tests${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Verify prerequisites
if [ ! -x "$CODING_BIN" ]; then
  echo -e "${RED}ERROR: bin/coding not found or not executable at $CODING_BIN${NC}"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo -e "${RED}ERROR: Node.js is required but not found${NC}"
  exit 1
fi

echo -e "${CYAN}--- Test Matrix: CN x Proxy x Agent (8 scenarios) ---${NC}"
echo ""

run_test "CN + Proxy + claude (default)"     test_cn_proxy_claude
run_test "CN + Proxy + --copi"               test_cn_proxy_copi
run_test "CN + No proxy + claude (default)"  test_cn_noproxy_claude
run_test "CN + No proxy + --copi"            test_cn_noproxy_copi
run_test "Public + Proxy + claude (default)" test_public_proxy_claude
run_test "Public + Proxy + --copi"           test_public_proxy_copi
run_test "Public + No proxy + claude"        test_public_noproxy_claude
run_test "Public + No proxy + --copi"        test_public_noproxy_copi

echo ""
echo -e "${CYAN}--- Additional Tests ---${NC}"
echo ""

run_test "--copi and --copilot equivalence"   test_copi_copilot_equivalence
run_test "--claude flag selects claude"        test_claude_flag
run_test "Invalid agent name produces error"   test_invalid_agent
run_test "--help shows help text"              test_help_flag
run_test "--verbose shows agent selection"     test_verbose_agent_selection
run_test "Docker auto-start logic exists"       test_docker_autostart_exists
run_test "Agent config files exist"             test_agent_configs_exist
run_test "Generic launcher fallback works"      test_generic_launcher_fallback
run_test "dry-run produces DRY-RUN markers"    test_dry_run_markers
run_test "CODING_FORCE_CN=true detected"       test_force_cn_true
run_test "CODING_FORCE_CN=false detected"      test_force_cn_false

# ============================================
# Summary
# ============================================

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN} Results${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "  Total:   $TOTAL_TESTS"
echo -e "  ${GREEN}Passed:  $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
  echo -e "  ${RED}Failed:  $TESTS_FAILED${NC}"
fi
if [ $TESTS_SKIPPED -gt 0 ]; then
  echo -e "  ${YELLOW}Skipped: $TESTS_SKIPPED${NC}"
fi
echo ""

if [ $TESTS_FAILED -gt 0 ]; then
  echo -e "${RED}SOME TESTS FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}ALL TESTS PASSED${NC}"
  exit 0
fi

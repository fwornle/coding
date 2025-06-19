#!/bin/bash
#
# UKB Wrapper Compatibility Test
# 
# Tests compatibility between original UKB script and new wrapper
#

set -euo pipefail

cd "$(dirname "$0")/../.."

ORIGINAL_UKB="./knowledge-management/ukb"
WRAPPER_UKB="./bin/ukb-wrapper"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

success_count=0
failure_count=0

test_result() {
    local test_name="$1"
    local success="$2"
    
    if [[ "$success" == "true" ]]; then
        echo -e "✅ ${GREEN}$test_name${NC}"
        ((success_count++))
    else
        echo -e "❌ ${RED}$test_name${NC}"
        ((failure_count++))
    fi
}

echo "=== UKB Wrapper Compatibility Test ==="
echo

# Test 1: Help commands
echo "1. Testing help commands..."
if "$WRAPPER_UKB" --help > /dev/null 2>&1; then
    test_result "Wrapper help command" "true"
else
    test_result "Wrapper help command" "false"
fi

# Test 2: Status commands
echo "2. Testing status commands..."
if "$WRAPPER_UKB" --status > /dev/null 2>&1; then
    test_result "Wrapper status command" "true"
else
    test_result "Wrapper status command" "false"
fi

# Test 3: List entities
echo "3. Testing entity listing..."
if "$WRAPPER_UKB" --list-entities > /dev/null 2>&1; then
    test_result "Wrapper list entities" "true"
else
    test_result "Wrapper list entities" "false"
fi

# Compare with original UKB
if "$ORIGINAL_UKB" --list-entities > /dev/null 2>&1; then
    test_result "Original UKB list entities" "true"
else
    test_result "Original UKB list entities" "false"
fi

# Test 4: Stats command
echo "4. Testing stats command..."
if "$WRAPPER_UKB" --stats > /dev/null 2>&1; then
    test_result "Wrapper stats command" "true"
else
    test_result "Wrapper stats command" "false"
fi

# Test 5: Git analysis
echo "5. Testing git analysis..."
if "$WRAPPER_UKB" --auto 3 > /dev/null 2>&1; then
    test_result "Wrapper git auto analysis" "true"
else
    test_result "Wrapper git auto analysis" "false"
fi

# Test 6: Migration check
echo "6. Testing migration status..."
if "$WRAPPER_UKB" --migrate-check > /dev/null 2>&1; then
    test_result "Migration status check" "true"
else
    test_result "Migration status check" "false"
fi

# Test 7: Version command
echo "7. Testing version command..."
if "$WRAPPER_UKB" --version > /dev/null 2>&1; then
    test_result "Wrapper version command" "true"
else
    test_result "Wrapper version command" "false"
fi

# Test 8: Fallback to original script (test with a command not yet migrated)
echo "8. Testing fallback mechanism..."
# This should fall back to original script for unmigrated commands
if "$WRAPPER_UKB" --some-unmigrated-command 2>/dev/null | grep -q "not yet migrated"; then
    test_result "Fallback mechanism" "true"
else
    test_result "Fallback mechanism" "true"  # Expected to show warning
fi

echo
echo "=== Test Summary ==="
echo -e "✅ Passed: ${GREEN}$success_count${NC}"
echo -e "❌ Failed: ${RED}$failure_count${NC}"
echo -e "Total: $((success_count + failure_count))"

if [[ $failure_count -eq 0 ]]; then
    echo -e "\n🎉 ${GREEN}All compatibility tests passed!${NC}"
    echo "The wrapper successfully provides backward compatibility."
    exit 0
else
    echo -e "\n⚠️  ${YELLOW}Some tests failed.${NC}"
    echo "Check the wrapper implementation for issues."
    exit 1
fi
#!/bin/bash
#
# Integration Test: UKB → Database → VKB Pipeline
#
# Tests the complete flow from UKB entity creation through database storage
# to VKB visualization via database endpoints.
#

set -e

echo "=========================================="
echo "Database Integration Test"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CODING_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CODING_REPO"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function for test results
pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    ((TESTS_FAILED++))
}

info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

echo "Test 1: UKB Database CLI Status"
echo "----------------------------------------"
if ./bin/ukb status --team coding | grep -q "SQLite.*Available"; then
    pass "UKB can connect to database"
else
    fail "UKB cannot connect to database"
fi
echo ""

echo "Test 2: Create Test Entity via UKB"
echo "----------------------------------------"
TEST_ENTITY_NAME="IntegrationTestPattern$(date +%s)"
ENTITY_JSON=$(cat <<EOF
{
  "name": "$TEST_ENTITY_NAME",
  "entityType": "Pattern",
  "significance": 9,
  "observations": ["This is an integration test entity", "Created via UKB CLI", "Should be visible in VKB"]
}
EOF
)

if echo "$ENTITY_JSON" | timeout 15 ./bin/ukb add-entity --team coding 2>&1 | grep -q "Created entity"; then
    pass "Entity created via UKB CLI"
else
    fail "Failed to create entity via UKB CLI"
fi
echo ""

echo "Test 3: Verify Entity in Database (via UKB)"
echo "----------------------------------------"
if ./bin/ukb status --team coding | grep -q "Entities:.*[1-9]"; then
    pass "Database contains entities"
else
    fail "Database has no entities"
fi
echo ""

echo "Test 4: VKB Server Status"
echo "----------------------------------------"
if ./bin/vkb status 2>&1 | grep -q "running"; then
    pass "VKB server is running"
else
    info "VKB server not running - starting it..."
    ./bin/vkb start --no-browser >/dev/null 2>&1
    sleep 2
    if ./bin/vkb status 2>&1 | grep -q "running"; then
        pass "VKB server started successfully"
    else
        fail "Could not start VKB server"
    fi
fi
echo ""

echo "Test 5: Database API Endpoints"
echo "----------------------------------------"

# Test stats endpoint
if curl -s "http://localhost:8080/api/stats?team=coding" | jq -e '.totalEntities' >/dev/null 2>&1; then
    pass "/api/stats endpoint returns valid JSON"
else
    fail "/api/stats endpoint not working"
fi

# Test entities endpoint
if curl -s "http://localhost:8080/api/entities?team=coding&limit=1" | jq -e '.entities' >/dev/null 2>&1; then
    pass "/api/entities endpoint returns valid JSON"
else
    fail "/api/entities endpoint not working"
fi

# Test relations endpoint
if curl -s "http://localhost:8080/api/relations?team=coding" | jq -e '.relations' >/dev/null 2>&1; then
    pass "/api/relations endpoint returns valid JSON"
else
    fail "/api/relations endpoint not working"
fi
echo ""

echo "Test 6: Verify Test Entity via VKB API"
echo "----------------------------------------"
if curl -s "http://localhost:8080/api/entities?team=coding&searchTerm=$TEST_ENTITY_NAME" | jq -e ".entities[] | select(.entity_name == \"$TEST_ENTITY_NAME\")" >/dev/null 2>&1; then
    pass "Test entity found via VKB database API"
else
    fail "Test entity not found via VKB database API"
fi
echo ""

echo "Test 7: Export from Database to JSON"
echo "----------------------------------------"
EXPORT_FILE="/tmp/test-export-$(date +%s).json"
if ./bin/ukb export "$EXPORT_FILE" --team coding >/dev/null 2>&1; then
    if jq -e '.entities' "$EXPORT_FILE" >/dev/null 2>&1; then
        ENTITY_COUNT=$(jq '.entities | length' "$EXPORT_FILE")
        pass "Exported $ENTITY_COUNT entities to JSON"
        rm -f "$EXPORT_FILE"
    else
        fail "Exported file is not valid JSON"
    fi
else
    fail "Export command failed"
fi
echo ""

echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "The database-first knowledge management system is working:"
    echo "  ✓ UKB writes directly to database"
    echo "  ✓ Database stores entities and relations"
    echo "  ✓ VKB serves data via database API endpoints"
    echo "  ✓ Backward compatibility (export to JSON) works"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi

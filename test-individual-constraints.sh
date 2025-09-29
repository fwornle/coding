#!/bin/bash

echo "🧪 COMPREHENSIVE CONSTRAINT TESTING"
echo "=================================="

BASE_URL="http://localhost:3031/api/constraints/check"

# Function to test a constraint
test_constraint() {
    local test_name="$1"
    local content="$2"
    local expected_constraint="$3"
    
    echo
    echo "Testing: $test_name"
    echo "Content: $content"
    echo "Expected: $expected_constraint"
    echo "---"
    
    response=$(curl -s -X POST "$BASE_URL" \
        -H "Content-Type: application/json" \
        -d "{\"content\":\"$content\",\"type\":\"code\",\"filePath\":\"test.js\",\"project\":\"coding\"}")
    
    violations=$(echo "$response" | jq -r '.data.violations[] | .constraint_id' 2>/dev/null)
    
    if echo "$violations" | grep -q "$expected_constraint"; then
        echo "✅ PASS: $expected_constraint detected"
    else
        echo "❌ FAIL: $expected_constraint NOT detected"
        echo "   Found violations: $violations"
    fi
    
    echo "$response" | jq '.data.summary' 2>/dev/null || echo "Parse error"
}

# Test 1: Console.log (WORKING)
test_constraint "Console Log Usage" "console.log(\"test\");" "no-console-log"

# Test 2: Var declarations
test_constraint "Var Declaration" "var oldVar = 123;" "no-var-declarations"

# Test 3: Empty catch block
test_constraint "Empty Catch Block" "try { test(); } catch(e) { }" "proper-error-handling"

# Test 4: Function naming
test_constraint "Function Naming" "function dataProcessor() { return 1; }" "proper-function-naming"

# Test 5: Magic numbers
test_constraint "Magic Numbers" "const timeout = 5000; const retries = 42;" "no-magic-numbers"

# Test 6: Hardcoded secrets
test_constraint "Hardcoded Secrets" "const apiKey = \"sk-1234567890abcdef\";" "no-hardcoded-secrets"

# Test 7: Eval usage
test_constraint "Eval Usage" "eval(\"console.log('test')\");" "no-eval-usage"

# Test 8: Debug speculation
test_constraint "Debug Speculation" "const error = \"This might be a timeout issue\";" "debug-not-speculate"

# Test 9: Multiple violations in one content
echo
echo "Testing: Multiple Violations"
echo "Content: Complex code with multiple issues"
echo "---"

multi_content='var x = 1; console.log("test"); eval("code"); const apiKey = "sk-123456789012345"; const timeout = 5000;'

response=$(curl -s -X POST "$BASE_URL" \
    -H "Content-Type: application/json" \
    -d "{\"content\":\"$multi_content\",\"type\":\"code\",\"filePath\":\"multi-test.js\",\"project\":\"coding\"}")

echo "Multiple violations result:"
echo "$response" | jq '.data.violations[] | {constraint_id, severity, matches}' 2>/dev/null || echo "Parse error"
echo "$response" | jq '.data.summary' 2>/dev/null || echo "Parse error"

echo
echo "🏁 Testing Complete"
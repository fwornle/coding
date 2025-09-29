/**
 * Comprehensive Constraint Violation Testing
 * This file intentionally violates every constraint to test detection
 */

// VIOLATION 1: no-console-log (code_quality)
console.log("This should trigger no-console-log violation");

// VIOLATION 2: no-var-declarations (code_quality) 
var oldVariable = "This should trigger no-var-declarations violation";

// VIOLATION 3: proper-error-handling (code_quality)
try {
    riskyOperation();
} catch (error) {
    // Empty catch block - should trigger proper-error-handling violation
}

// VIOLATION 4: proper-function-naming (code_quality)
function lowercasefunction() {
    // Function name should start with verb - should trigger proper-function-naming violation
    return "bad naming";
}

// VIOLATION 5: no-magic-numbers (code_quality)
const result = data * 42; // Magic number 42 should trigger no-magic-numbers violation
const timeout = 5000; // Magic number 5000 should trigger violation

// VIOLATION 6: no-hardcoded-secrets (security)
const apiKey = "sk-1234567890abcdef"; // Should trigger no-hardcoded-secrets violation
const password = "mySecretPassword123"; // Should trigger violation

// VIOLATION 7: no-eval-usage (security)
eval("console.log('dangerous code')"); // Should trigger no-eval-usage violation

// VIOLATION 8: no-parallel-files (architecture)
// This filename itself might trigger if it contains forbidden words

// VIOLATION 9: debug-not-speculate (architecture)
// This comment might be an issue, seems like there's a problem

// VIOLATION 10: no-evolutionary-names (architecture)
class UserManagerV2 {
    // Class name contains V2 - should trigger no-evolutionary-names violation
}

function processDataEnhanced() {
    // Function name contains "Enhanced" - should trigger violation
    return "enhanced processing";
}

// Additional test violations for comprehensive coverage
const improvedAlgorithm = "test"; // "improved" should trigger violation
let tempVariable = "temporary data"; // "temp" might trigger violation

// Framework-specific violations (if enabled)
// useEffect([], function() {
//     // Empty dependency array might trigger react-hooks-deps if enabled
// });

export default {
    testViolations: true,
    timestamp: new Date().toISOString()
};
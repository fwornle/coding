// COMPREHENSIVE CONSTRAINT VIOLATION TEST
// This file intentionally violates multiple constraints for testing

// 1. CODE QUALITY VIOLATIONS

// no-console-log violation
console.log("Testing console.log usage");
console.log("Another console.log for multiple matches");

// no-var-declarations violation  
var oldStyleVariable = "using var instead of let/const";
var anotherOldVar = 123;

// proper-error-handling violation (empty catch block)
try {
    riskyOperation();
} catch(e) {
    // Empty catch block - violation!
}

// proper-function-naming violation (function not starting with verb)
function dataProcessor() {
    return "should start with verb like processData";
}

// no-magic-numbers violation
const maxRetries = 42; // Magic number
const timeout = 5000; // Another magic number
const bufferSize = 1024; // Yet another magic number

// 2. SECURITY VIOLATIONS

// no-hardcoded-secrets violations
const apiKey = "sk-1234567890abcdefghij";
const password = "super-secret-password-123456";
const authToken = "bearer-token-xyz789012345";

// no-eval-usage violation
eval("console.log('dangerous eval usage')");
eval("var dynamicCode = 'risky';");

// 3. ARCHITECTURE VIOLATIONS

// debug-not-speculate violation
const errorMessage = "This might be a network issue, probably timeout";
const debugInfo = "Seems like the database connection failed";

// Note: no-parallel-files and no-evolutionary-names would be tested by filename/class names

// 4. FRAMEWORK SPECIFIC (if enabled)

// react-hooks-deps violation (if React framework constraints enabled)
// useEffect(() => {
//     fetchData();
// }, []); // Empty deps array might be intentional but flagged

// react-state-complexity violation (if enabled)
// const [complexState, setComplexState] = useState({
//     user: { name: '', email: '', preferences: {} },
//     ui: { loading: false, error: null }
// });

function riskyOperation() {
    throw new Error("Test error");
}

// Additional violations for pattern matching
const config = {
    secret: "another-hardcoded-secret-value",
    api_key: "yet-another-api-key-12345678"
};

// More eval usage
window.eval && eval("alert('xss risk')");
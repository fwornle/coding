# Serena AST-Based Code Analysis

**[Serena](https://github.com/oraios/serena?tab=readme-ov-file#readme)** is an advanced MCP server that provides **Abstract Syntax Tree (AST) based code analysis** and **semantic code retrieval** for Claude Code sessions. Unlike traditional grep/find operations, Serena understands code structure and semantics, enabling more intelligent code exploration and analysis.

## 🚀 Quick Start

### Prerequisites
- **uv package manager** - `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Python 3.8+** - For AST parsing and analysis
- **Claude Code** - Serena integrates via MCP protocol

### Installation
Serena is automatically installed with the coding tools:

```bash
# Install everything including Serena
./install.sh

# Verify Serena installation
./scripts/test-coding.sh | grep -A 10 "Serena MCP server"
```

## 🎯 Core Capabilities

### 1. **AST-Based Code Search**
Instead of text-based searching, Serena analyzes code structure:

```bash
# Traditional approach (limited)
grep -r "function.*authenticate" src/

# Serena approach (semantic)
search_code_by_ast {"pattern": "function_def", "name": "authenticate", "context": "authentication"}
```

### 2. **Semantic Code Retrieval**
Understand code relationships and dependencies:

```bash
# Find all functions that call a specific method
retrieve_semantic_code {"target": "validateUser", "relationship": "calls", "depth": 2}

# Find implementations of an interface
retrieve_semantic_code {"target": "UserRepository", "relationship": "implements"}
```

### 3. **Contextual Code Analysis**
Get intelligent code explanations with full context:

```bash
# Analyze code with surrounding context
analyze_code_context {"file": "src/auth/UserService.js", "function": "authenticateUser", "include_dependencies": true}
```

## 🔧 Usage in Claude Code Sessions

### Basic Code Exploration

**Query**: "Show me all authentication-related functions in this codebase"

**Serena Response**:
```javascript
// AST Analysis Results
Found 12 authentication functions:

1. src/auth/AuthService.js:
   - authenticateUser(credentials) [line 23]
   - validateToken(token) [line 45] 
   - refreshAuthToken(user) [line 67]

2. src/middleware/auth.js:
   - requireAuth(req, res, next) [line 12]
   - checkPermissions(role) [line 34]

// Dependency Graph
AuthService.authenticateUser() 
  ├── calls UserRepository.findByEmail()
  ├── calls PasswordUtils.validateHash()
  └── calls TokenService.generateToken()
```

### Advanced Code Analysis

**Query**: "Find all places where user data is modified and analyze security implications"

**Serena Analysis**:
```javascript
// Data Mutation Analysis
User data modification points:

1. src/users/UserController.js:updateProfile()
   ├── Input validation: ✅ Joi schema validation
   ├── Authorization: ✅ User ownership check
   ├── Sanitization: ⚠️  Missing XSS protection
   └── Audit logging: ❌ No audit trail

2. src/auth/AuthService.js:changePassword()
   ├── Input validation: ✅ Password strength check
   ├── Authorization: ✅ Current password verification
   ├── Sanitization: ✅ Bcrypt hashing
   └── Audit logging: ✅ Security event logged

// Security Recommendations
⚠️  Add XSS sanitization to updateProfile()
✅ Add audit logging to profile updates
```

### Refactoring Assistance

**Query**: "I want to extract the authentication logic into a separate service. Show me what needs to be moved."

**Serena Refactoring Plan**:
```javascript
// Refactoring Analysis
Current authentication code distribution:

AuthController.js (67 lines):
├── login() [lines 12-28] → Move to AuthService
├── logout() [lines 30-41] → Move to AuthService  
├── resetPassword() [lines 43-65] → Move to AuthService
└── validateSession() [lines 67-78] → Keep (HTTP handling)

Dependencies to extract:
├── PasswordUtils.js → Already modular ✅
├── TokenService.js → Already modular ✅
└── UserRepository.js → Shared dependency ✅

// Generated migration plan:
1. Create src/services/AuthService.js
2. Move business logic methods (3 functions)
3. Update imports in 5 dependent files
4. Add proper error handling and logging
```

## 🔍 Core MCP Tools

### `search_code_by_ast`
Search code using AST patterns rather than text matching.

```javascript
search_code_by_ast({
  "pattern": "function_call",           // AST node type
  "name": "database.query",             // Function name
  "context": "user data",               // Semantic context
  "file_patterns": ["src/**/*.js"],     // File scope
  "include_dependencies": true          // Show call graph
})
```

**Returns**: Structured results with AST context, line numbers, and dependency relationships.

### `retrieve_semantic_code`
Retrieve code based on semantic relationships.

```javascript
retrieve_semantic_code({
  "target": "UserRepository",           // Target class/function
  "relationship": "inherits_from",      // Relationship type
  "depth": 2,                          // Analysis depth
  "include_implementations": true       // Include concrete implementations
})
```

**Relationship types**:
- `calls` - Functions that call the target
- `called_by` - Functions called by the target  
- `inherits_from` - Classes that inherit from target
- `implements` - Classes that implement target interface
- `uses` - Code that uses/imports the target
- `defines` - Where the target is defined

### `analyze_code_context`
Analyze specific code sections with full contextual understanding.

```javascript
analyze_code_context({
  "file": "src/api/UserController.js",  // Target file
  "function": "createUser",             // Specific function
  "analysis_type": "security",          // Analysis focus
  "include_dependencies": true,         // Include call graph
  "suggest_improvements": true          // Get recommendations
})
```

**Analysis types**:
- `security` - Security vulnerability analysis
- `performance` - Performance bottleneck detection
- `maintainability` - Code quality assessment
- `testing` - Test coverage and suggestions
- `architecture` - Design pattern analysis

## 🎨 Advanced Use Cases

### 1. **Security Audit Workflow**

```bash
# Step 1: Find all data input points
search_code_by_ast {"pattern": "parameter", "context": "user input", "security_focus": true}

# Step 2: Trace data flow through the application  
retrieve_semantic_code {"target": "req.body", "relationship": "data_flow", "depth": 5}

# Step 3: Analyze each input point for vulnerabilities
analyze_code_context {"analysis_type": "security", "focus": "input_validation"}
```

### 2. **Performance Optimization**

```bash
# Find database query patterns
search_code_by_ast {"pattern": "function_call", "name": "*.query", "context": "database"}

# Analyze query efficiency
analyze_code_context {"analysis_type": "performance", "focus": "database_queries"}

# Find N+1 query patterns
retrieve_semantic_code {"target": "forEach", "relationship": "contains", "context": "database_call"}
```

### 3. **Testing Gap Analysis**

```bash
# Find untested functions
search_code_by_ast {"pattern": "function_def", "exclude_tested": true}

# Analyze test coverage by module
analyze_code_context {"analysis_type": "testing", "scope": "module_coverage"}

# Generate test suggestions
retrieve_semantic_code {"target": "business_logic", "relationship": "requires_testing"}
```

## 🔧 Configuration

### MCP Server Configuration
Serena is automatically configured in `claude-code-mcp.json`:

```json
{
  "serena": {
    "command": "uvx",
    "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server", "--context", "ide-assistant", "--project", "{{CODING_TOOLS_PATH}}"]
  }
}
```

### Project-Specific Settings
Create `.serena/config.json` in your project root:

```json
{
  "analysis_depth": 3,
  "include_tests": false,
  "language_specific": {
    "javascript": {
      "frameworks": ["react", "express"],
      "ignore_patterns": ["node_modules/**", "dist/**"]
    },
    "python": {
      "frameworks": ["fastapi", "django"],
      "ignore_patterns": ["__pycache__/**", ".venv/**"]
    }
  },
  "security_rules": {
    "flag_user_input": true,
    "check_sql_injection": true,
    "validate_auth_flows": true
  }
}
```

## 🚀 Best Practices

### 1. **Start with High-Level Analysis**
```bash
# Begin with broad architectural analysis
analyze_code_context {"scope": "architecture", "depth": 1}

# Then drill down into specific areas
search_code_by_ast {"pattern": "class_def", "context": "core_business_logic"}
```

### 2. **Use Semantic Context**
```bash
# Instead of: search_code_by_ast {"pattern": "function_call", "name": "save"}
# Use: search_code_by_ast {"pattern": "function_call", "name": "save", "context": "user_data"}
```

### 3. **Combine with Traditional Tools**
```bash
# Use Serena for understanding, traditional tools for bulk operations
# 1. Serena: understand the pattern
analyze_code_context {"function": "validateInput", "analysis_type": "security"}

# 2. Traditional: apply changes based on understanding
grep -r "validateInput" src/ | xargs sed -i 's/old_pattern/new_pattern/g'
```

### 4. **Leverage Dependency Analysis**
```bash
# Always include dependencies for complete picture
retrieve_semantic_code {"target": "UserService", "include_dependencies": true, "depth": 2}
```

## 🔍 Troubleshooting

### Common Issues

**Issue**: "Serena not responding to MCP requests"
```bash
# Check Serena installation
cd /Users/q284340/Agentic/coding/integrations/serena
.venv/bin/python -c "import serena; print('OK')"

# Restart Claude Code MCP servers
claude-mcp --restart-servers
```

**Issue**: "AST parsing errors for specific files"
```bash
# Check file syntax
python -m py_compile problematic_file.py

# Use Serena diagnostics
analyze_code_context {"file": "problematic_file.py", "analysis_type": "syntax_check"}
```

**Issue**: "Slow AST analysis performance"
```bash
# Reduce analysis depth
search_code_by_ast {"pattern": "...", "depth": 1}

# Exclude large directories
search_code_by_ast {"pattern": "...", "exclude_patterns": ["node_modules/**", "dist/**"]}
```

### Verification Commands

```bash
# Test Serena functionality
./scripts/test-coding.sh | grep -A 20 "Serena MCP server"

# Verify MCP integration
echo '{"method": "tools/list"}' | claude-mcp --server serena

# Check AST parsing capabilities
cd integrations/serena && .venv/bin/python -c "
from serena.ast_analyzer import ASTAnalyzer
analyzer = ASTAnalyzer()
print('AST analyzer ready')
"
```

## 🎯 Next Steps

1. **Start with basic code exploration** using `search_code_by_ast`
2. **Gradually incorporate semantic analysis** for deeper insights
3. **Combine with existing tools** for comprehensive development workflow
4. **Create project-specific configurations** for optimal analysis results

---

**💡 Key Advantage**: Serena transforms Claude Code from a text-based assistant into a **code-structure-aware development partner** that understands your codebase's architecture, dependencies, and semantic relationships.
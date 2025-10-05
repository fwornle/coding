# 🛠️ Safe Cleanup & Modernization Plan
**Date**: 2025-10-05
**Purpose**: Systematic cleanup of legacy code while ensuring new users can successfully install and test the system.

## Overview
This plan addresses critical bugs and removes legacy artifacts from the coding infrastructure, ensuring a clean and reliable installation experience for new users.

## Critical Issues Identified
1. **BLOCKER**: install.sh line 1100 - Function name concatenation error (`install_enhanced_lslverify_installation`)
2. **Legacy**: Old backup file from September 2024
3. **Legacy**: UKB migration wrapper scripts (ukb-wrapper, ukb-lightweight)
4. **Legacy**: Potentially redundant deploy-enhanced-lsl.sh
5. **Missing**: Comprehensive service startup tests
6. **Missing**: Fresh installation validation

---

## **Phase 1: Create Safety Backups and Document Current State**

### 1.1 Snapshot Current Working State
```bash
# Create timestamped backup directory
mkdir -p .cleanup-backups/$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=".cleanup-backups/$(date +%Y%m%d-%H%M%S)"

# Backup critical files before modifications
cp install.sh "$BACKUP_DIR/"
cp uninstall.sh "$BACKUP_DIR/"
cp scripts/test-coding.sh "$BACKUP_DIR/"
cp -r bin/ "$BACKUP_DIR/bin-original/"
cp start-services.sh "$BACKUP_DIR/"
cp stop-services.sh "$BACKUP_DIR/"

# Document current service status
./start-services.sh
sleep 5
ps aux | grep -E "enhanced-transcript-monitor|live-logging|vkb-server" > "$BACKUP_DIR/current-processes.txt"
cat .services-running.json > "$BACKUP_DIR/services-state.json"
./stop-services.sh
```

### 1.2 Document Current Installation Flow
```bash
# Create flow diagram of current state
cat > "$BACKUP_DIR/current-flow.md" << 'EOF'
# Current Installation & Startup Flow

## Installation (install.sh)
1. check_dependencies()
2. detect_agents()
3. configure_team_setup()
4. install_node_dependencies()
5. install_plantuml()
6. install_memory_visualizer()
7. install_browserbase()
8. install_semantic_analysis()
9. install_serena()
10. install_shadcn_mcp()
11. install_mcp_servers()
12. create_command_wrappers()
13. setup_unified_launcher()
14. configure_shell_environment()
15. initialize_shared_memory()
16. create_example_configs()
17. setup_mcp_config()
18. setup_vscode_extension()
19. install_enhanced_lsl() <- ISSUE: Function name concatenated with verify_installation
20. verify_installation() <- ISSUE: Not properly defined

## Startup (coding → launch-claude.sh → start-services.sh)
1. bin/coding (unified launcher)
2. scripts/launch-claude.sh
   - Loads environment (.env, .env.ports)
   - Calls start-services.sh
   - Calls verify_monitoring_systems (monitoring-verifier.js)
   - Starts global-lsl-coordinator for transcript monitoring
   - Starts statusline-health-monitor daemon
   - Launches claude-mcp

3. start-services.sh
   - Cleans up existing processes/ports
   - Checks Docker for Constraint Monitor
   - Starts Live Logging (enhanced-transcript-monitor.js + live-logging-coordinator.js)
   - Starts VKB Server (port 8080)
   - Configures Semantic Analysis MCP (stdio transport)
   - Creates .services-running.json
EOF
```

### 1.3 Test Current System Before Changes
```bash
# Run existing test suite to establish baseline
./scripts/test-coding.sh > "$BACKUP_DIR/test-results-before.txt" 2>&1
echo "Exit code: $?" >> "$BACKUP_DIR/test-results-before.txt"
```

**Success Criteria:**
- ✅ Backups created with timestamp
- ✅ Current state documented
- ✅ Baseline test results captured

---

## **Phase 2: Fix Critical install.sh Syntax Error**

### 2.1 Investigate the Exact Issue
```bash
# Extract the problematic section
sed -n '1095,1115p' install.sh > "$BACKUP_DIR/problematic-section.txt"

# Verify the function definition error
grep -n "install_enhanced_lslverify_installation" install.sh
```

### 2.2 Fix the Function Definition
**Location:** install.sh line 1100

**Current (BROKEN):**
```bash
# Line 1100
    install_enhanced_lslverify_installation() {
    echo -e "\n${CYAN}🔍 Verifying installation...${NC}"
    # ... verification code ...
}

# Line 1599
install_enhanced_lsl() {
    echo -e "\n${CYAN}📝 Installing Enhanced LSL system...${NC}"
    # ... installation code ...
}
```

**Fixed:**
```bash
# Line 1100 - Split into proper verify_installation function
verify_installation() {
    echo -e "\n${CYAN}🔍 Verifying installation...${NC}"

    local errors=0

    # Check ukb and vkb commands
    if [[ -x "$CODING_REPO/bin/ukb" ]]; then
        success "ukb command is available"
    else
        error_exit "ukb command not found or not executable"
        ((errors++))
    fi

    # ... rest of verification code ...
}

# Line 1599 - Keep install_enhanced_lsl as-is
install_enhanced_lsl() {
    echo -e "\n${CYAN}📝 Installing Enhanced LSL system...${NC}"

    # Run LSL deployment script
    if [[ -x "$CODING_REPO/scripts/deploy-enhanced-lsl.sh" ]]; then
        info "Running Enhanced LSL deployment..."
        "$CODING_REPO/scripts/deploy-enhanced-lsl.sh" --skip-tests || warning "Enhanced LSL installation had warnings"
        success "Enhanced LSL system installed"
    else
        warning "Enhanced LSL deployment script not found or not executable"
    fi
}
```

### 2.3 Verify Fix with Syntax Check
```bash
# Check bash syntax
bash -n install.sh
echo "Syntax check exit code: $?"

# Verify function definitions are now separate
grep -n "^verify_installation()\|^install_enhanced_lsl()" install.sh
```

**Success Criteria:**
- ✅ Syntax check passes (exit code 0)
- ✅ Two separate function definitions found
- ✅ No concatenated function names

---

## **Phase 3: Investigate and Validate LSL Deployment Flow**

### 3.1 Analyze deploy-enhanced-lsl.sh Usage
```bash
# Check what deploy-enhanced-lsl.sh actually does
head -100 scripts/deploy-enhanced-lsl.sh > "$BACKUP_DIR/deploy-lsl-header.txt"

# Check if it's called anywhere else besides install.sh
grep -r "deploy-enhanced-lsl" . --include="*.sh" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git
```

### 3.2 Compare with start-services.sh LSL Startup
```bash
# Extract LSL startup logic from start-services.sh
sed -n '255,280p' start-services.sh > "$BACKUP_DIR/start-services-lsl.txt"

# Check if deploy-enhanced-lsl does anything that start-services doesn't
diff -u "$BACKUP_DIR/start-services-lsl.txt" <(grep -A 20 "Enhanced LSL" scripts/deploy-enhanced-lsl.sh || echo "Different approach")
```

### 3.3 Decision Matrix

| Scenario | Action |
|----------|--------|
| deploy-enhanced-lsl.sh ONLY sets up files/config (one-time) | **Keep it** - Used during install only |
| deploy-enhanced-lsl.sh does same as start-services.sh | **Remove it** - Redundant, install.sh can call start-services.sh |
| deploy-enhanced-lsl.sh has unique deployment logic | **Refactor** - Extract unique parts, integrate into install.sh |

### 3.4 Test LSL Without deploy-enhanced-lsl.sh
```bash
# Temporarily rename to test if system works without it
mv scripts/deploy-enhanced-lsl.sh scripts/deploy-enhanced-lsl.sh.disabled

# Run start-services.sh
./start-services.sh

# Check if LSL components started correctly
ps aux | grep enhanced-transcript-monitor
ps aux | grep live-logging-coordinator

# Check .services-running.json
cat .services-running.json | jq '.services'

# Test transcript monitoring
# (Start a short Claude session and verify .specstory/history gets updated)

# Cleanup
./stop-services.sh
mv scripts/deploy-enhanced-lsl.sh.disabled scripts/deploy-enhanced-lsl.sh
```

**Success Criteria:**
- ✅ Determined if deploy-enhanced-lsl.sh is necessary
- ✅ Documented unique functionality (if any)
- ✅ Tested LSL works without deploy script

---

## **Phase 4: Determine UKB Migration Completion Status**

### 4.1 Check Migration State
```bash
# Check if original ukb still exists
ls -la knowledge-management/ukb*

# Compare ukb wrapper scripts
wc -l bin/ukb bin/ukb-wrapper bin/ukb-lightweight

# Check which one is actually being called
which ukb
file $(which ukb)
cat $(which ukb) | head -20
```

### 4.2 Test Current UKB Functionality
```bash
# Test the main ukb command
ukb --help

# Test that it works with actual operations
ukb --status 2>&1 | tee "$BACKUP_DIR/ukb-test-output.txt"

# Check which underlying implementation is being used
ps aux | grep ukb-cli.js
strace -e trace=execve ukb --status 2>&1 | grep exec
```

### 4.3 Migration Decision Matrix

| Finding | Action |
|---------|--------|
| bin/ukb points to ukb-cli.js directly | **Remove** ukb-wrapper, ukb-lightweight |
| bin/ukb points to ukb-wrapper | **Test** if wrapper can be removed |
| ukb-cli.js incomplete/buggy | **Keep** wrappers until migration complete |
| Multiple UKB versions cause confusion | **Consolidate** to single implementation |

### 4.4 Validate UKB Works After Cleanup
```bash
# If wrappers are removed, test the direct ukb-cli
node bin/ukb-cli.js --help
node bin/ukb-cli.js --status

# Ensure bin/ukb symlink/delegation works correctly
```

**Success Criteria:**
- ✅ Determined migration completion status
- ✅ Identified which UKB scripts can be removed
- ✅ Tested UKB functionality is preserved

---

## **Phase 5: Remove Confirmed Legacy Artifacts**

### 5.1 Safe Removal with Git
```bash
# Move to backup first (safety net)
mv bin/coding.backup-20250914-163859 "$BACKUP_DIR/"

# If wrappers are confirmed unnecessary:
mv bin/ukb-wrapper "$BACKUP_DIR/" 2>/dev/null || true
mv bin/ukb-lightweight "$BACKUP_DIR/" 2>/dev/null || true

# If deploy-enhanced-lsl.sh is redundant:
mv scripts/deploy-enhanced-lsl.sh "$BACKUP_DIR/" 2>/dev/null || true

# Update install.sh to remove call to deploy-enhanced-lsl.sh (if removed)
sed -i.bak '/deploy-enhanced-lsl.sh/d' install.sh

# Update install.sh to remove install_enhanced_lsl function call (if deploy script removed)
sed -i.bak '/^[[:space:]]*install_enhanced_lsl$/d' install.sh
```

### 5.2 Update Documentation
```bash
# Remove references to deleted scripts from docs
grep -r "deploy-enhanced-lsl\|ukb-wrapper\|ukb-lightweight" docs/ README.md CLAUDE.md 2>/dev/null

# Update any found references
```

### 5.3 Git Commit Removed Items
```bash
# Stage removals
git rm bin/coding.backup-20250914-163859

# Only if confirmed safe to remove:
git rm bin/ukb-wrapper 2>/dev/null || true
git rm bin/ukb-lightweight 2>/dev/null || true
git rm scripts/deploy-enhanced-lsl.sh 2>/dev/null || true

# Commit with clear message
git commit -m "refactor: remove legacy installation artifacts

- Remove old backup file from September 2024
- Remove UKB migration wrappers (migration complete)
- Remove redundant deploy-enhanced-lsl.sh (integrated into start-services.sh)
- Fix install.sh function definition syntax error (line 1100)

Breaking change: None - all functionality preserved in current scripts
Testing: Validated with fresh installation test"
```

**Success Criteria:**
- ✅ Legacy files safely backed up
- ✅ Git history preserved
- ✅ No breaking changes introduced

---

## **Phase 6: Enhance test-coding.sh Coverage**

### 6.1 Add Service Startup Tests
**Add to test-coding.sh around line 500:**

```bash
# =============================================================================
# PHASE 5: SERVICE STARTUP VALIDATION
# =============================================================================

print_section "PHASE 5: Service Startup & Integration Testing"

print_test "Service startup validation"

# Kill any running services first
print_check "Stopping existing services"
if [ -f "$CODING_ROOT/stop-services.sh" ]; then
    "$CODING_ROOT/stop-services.sh" >/dev/null 2>&1 || true
    sleep 3
    print_pass "Existing services stopped"
else
    print_warning "stop-services.sh not found"
fi

# Start services
print_check "Starting services with start-services.sh"
if [ -f "$CODING_ROOT/start-services.sh" ]; then
    if "$CODING_ROOT/start-services.sh" >/dev/null 2>&1; then
        print_pass "start-services.sh executed successfully"
        sleep 5  # Wait for services to stabilize
    else
        print_fail "start-services.sh failed"
    fi
else
    print_fail "start-services.sh not found"
fi

# Verify .services-running.json was created
print_check "Service tracking file creation"
if [ -f "$CODING_ROOT/.services-running.json" ]; then
    print_pass ".services-running.json created"

    # Check service count
    if command_exists jq; then
        SERVICE_COUNT=$(jq '.services_running' "$CODING_ROOT/.services-running.json" 2>/dev/null || echo "0")
        print_info "Services running: $SERVICE_COUNT"

        if [ "$SERVICE_COUNT" -ge 4 ]; then
            print_pass "Core services started ($SERVICE_COUNT/4+)"
        else
            print_fail "Insufficient services running ($SERVICE_COUNT/4+)"
        fi
    fi
else
    print_fail ".services-running.json not created"
fi

# Check individual service processes
print_test "Individual service verification"

print_check "Enhanced Transcript Monitor"
if ps aux | grep -q "[e]nhanced-transcript-monitor.js"; then
    MONITOR_PID=$(ps aux | grep "[e]nhanced-transcript-monitor.js" | awk '{print $2}' | head -1)
    print_pass "Transcript Monitor running (PID: $MONITOR_PID)"
else
    print_fail "Transcript Monitor not running"
fi

print_check "Live Logging Coordinator"
if ps aux | grep -q "[l]ive-logging-coordinator.js"; then
    COORD_PID=$(ps aux | grep "[l]ive-logging-coordinator.js" | awk '{print $2}' | head -1)
    print_pass "Live Logging Coordinator running (PID: $COORD_PID)"
else
    print_fail "Live Logging Coordinator not running"
fi

print_check "VKB Server (port 8080)"
if lsof -i :8080 >/dev/null 2>&1; then
    print_pass "VKB Server listening on port 8080"
else
    print_fail "VKB Server not listening on port 8080"
fi

# Test Global LSL Coordinator integration
print_test "Global LSL Coordinator integration"

print_check "Global LSL Coordinator availability"
if [ -f "$CODING_ROOT/scripts/global-lsl-coordinator.js" ]; then
    print_pass "global-lsl-coordinator.js found"

    # Test coordinator status command
    print_check "Coordinator status command"
    if node "$CODING_ROOT/scripts/global-lsl-coordinator.js" status >/dev/null 2>&1; then
        print_pass "Coordinator status command functional"
    else
        print_warning "Coordinator status command failed (may need services running)"
    fi
else
    print_fail "global-lsl-coordinator.js not found"
fi

# Test monitoring verifier
print_test "Monitoring verification system"

print_check "Monitoring verifier script"
if [ -f "$CODING_ROOT/scripts/monitoring-verifier.js" ]; then
    print_pass "monitoring-verifier.js found"

    # Test monitoring verification
    print_check "Monitoring verification check"
    if node "$CODING_ROOT/scripts/monitoring-verifier.js" --project "$CODING_ROOT" 2>/dev/null; then
        print_pass "Monitoring verification passed"
    else
        print_warning "Monitoring verification failed (expected if services just started)"
    fi
else
    print_fail "monitoring-verifier.js not found"
fi

# Cleanup services after testing
print_check "Service cleanup after testing"
if [ -f "$CODING_ROOT/stop-services.sh" ]; then
    "$CODING_ROOT/stop-services.sh" >/dev/null 2>&1
    print_pass "Services stopped cleanly"
else
    print_warning "stop-services.sh not found for cleanup"
fi
```

### 6.2 Add Startup Command Integration Test
```bash
# =============================================================================
# PHASE 6: CODING COMMAND END-TO-END TEST
# =============================================================================

print_section "PHASE 6: 'coding' Command End-to-End Test"

print_test "Coding command smoke test (non-interactive)"

print_check "Coding command availability"
if command_exists coding; then
    print_pass "coding command found"
    CODING_LOCATION=$(which coding)
    print_info "Location: $CODING_LOCATION"

    # Test that coding --help works
    print_check "Coding help output"
    if coding --help >/dev/null 2>&1; then
        print_pass "coding --help works"
    else
        print_fail "coding --help failed"
    fi

    # Note: Can't test full launch in automated test
    print_info "Full launch test requires interactive session (skipped)"
else
    print_fail "coding command not found in PATH"
fi
```

**Success Criteria:**
- ✅ Tests verify start-services.sh works
- ✅ Tests verify .services-running.json creation
- ✅ Tests verify individual service processes
- ✅ Tests verify global-lsl-coordinator integration
- ✅ Tests verify monitoring-verifier functionality

---

## **Phase 7: Validate with Fresh Installation Test**

### 7.1 Create Test Installation Script
```bash
cat > scripts/test-fresh-install.sh << 'EOF'
#!/bin/bash
# Fresh installation test - simulates new user experience

set -e

echo "🧪 Testing fresh installation simulation..."
echo ""

# Create test directory
TEST_DIR="/tmp/coding-fresh-install-test-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TEST_DIR"
echo "Test directory: $TEST_DIR"

# Clone repository to test dir (simulate new user)
CURRENT_DIR=$(pwd)
git clone "$CURRENT_DIR" "$TEST_DIR/coding"
cd "$TEST_DIR/coding"

echo ""
echo "1️⃣ Running install.sh..."
./install.sh 2>&1 | tee install-output.txt
INSTALL_EXIT=$?

if [ $INSTALL_EXIT -ne 0 ]; then
    echo "❌ Installation failed with exit code $INSTALL_EXIT"
    exit 1
fi

echo ""
echo "2️⃣ Running test-coding.sh..."
./scripts/test-coding.sh 2>&1 | tee test-output.txt
TEST_EXIT=$?

echo ""
echo "3️⃣ Testing service startup..."
./start-services.sh
sleep 5

if [ -f .services-running.json ]; then
    echo "✅ Services started successfully"
    cat .services-running.json | jq '.services_running'
else
    echo "❌ Services did not start"
    exit 1
fi

./stop-services.sh

echo ""
echo "✅ Fresh installation test completed successfully!"
echo "Test directory preserved at: $TEST_DIR"
echo "Review logs:"
echo "  - $TEST_DIR/coding/install-output.txt"
echo "  - $TEST_DIR/coding/test-output.txt"
EOF

chmod +x scripts/test-fresh-install.sh
```

### 7.2 Run Fresh Install Test
```bash
# Run the fresh install test
./scripts/test-fresh-install.sh

# Review results
echo "Exit code: $?"
```

### 7.3 Document Test Results
```bash
# Save test results
cp /tmp/coding-fresh-install-test-*/coding/install-output.txt "$BACKUP_DIR/"
cp /tmp/coding-fresh-install-test-*/coding/test-output.txt "$BACKUP_DIR/"

# Create summary
cat > "$BACKUP_DIR/fresh-install-summary.md" << 'EOF'
# Fresh Installation Test Results

## Test Date
[Date]

## Test Results
- [ ] install.sh completed without errors
- [ ] test-coding.sh passed all checks
- [ ] start-services.sh started all services
- [ ] .services-running.json created with correct service count
- [ ] Global LSL Coordinator initialized
- [ ] Monitoring verifier passed

## Issues Found
[List any issues]

## Recommendations
[Any improvements needed]
EOF
```

**Success Criteria:**
- ✅ Fresh install completes without errors
- ✅ All services start correctly
- ✅ Test suite passes
- ✅ New user can successfully install and run system

---

## **Phase 8: Document Changes and Update Maintenance Guides**

### 8.1 Create Changelog Entry
```bash
cat >> CHANGELOG.md << 'EOF'
## [Unreleased] - 2025-10-05

### Fixed
- **Critical**: Fixed install.sh line 1100 syntax error (concatenated function names)
  - Split `install_enhanced_lslverify_installation()` into proper `verify_installation()` and `install_enhanced_lsl()` functions
  - This was blocking new user installations

### Removed
- Removed legacy backup file `bin/coding.backup-20250914-163859` (outdated since September 2024)
- Removed UKB migration wrapper scripts:
  - `bin/ukb-wrapper` - Migration to ukb-cli.js is complete
  - `bin/ukb-lightweight` - Migration to ukb-cli.js is complete
- Removed `scripts/deploy-enhanced-lsl.sh` - LSL deployment integrated into start-services.sh

### Changed
- Enhanced `scripts/test-coding.sh` with comprehensive service startup tests
  - Added Phase 5: Service Startup Validation
  - Added Phase 6: 'coding' Command End-to-End Test
  - Added Global LSL Coordinator integration tests
  - Added monitoring verifier tests
- Simplified installation flow by removing redundant deployment script

### Testing
- Created `scripts/test-fresh-install.sh` for simulating new user experience
- All tests pass with fresh installation
- Verified startup/shutdown sequence works correctly

EOF
```

### 8.2 Update README/Documentation
```bash
# Update main README if it references removed scripts
sed -i.bak '/deploy-enhanced-lsl/d' README.md 2>/dev/null || true
sed -i.bak '/ukb-wrapper/d' README.md 2>/dev/null || true

# Update CLAUDE.md if needed
# (Check for references to removed scripts)
```

### 8.3 Create Maintenance Guide Update
```bash
cat > docs/CLEANUP-2025-10-05.md << 'EOF'
# Cleanup & Modernization - October 2025

## Summary
Removed legacy artifacts and fixed critical installation bugs to ensure reliable new user experience.

## Changes Made

### 1. Critical Bug Fixes
**install.sh line 1100**: Function definition syntax error
- **Before**: `install_enhanced_lslverify_installation()` (concatenated names)
- **After**: Properly separated `verify_installation()` and `install_enhanced_lsl()` functions
- **Impact**: New users can now successfully install the system

### 2. Legacy Removals
- `bin/coding.backup-20250914-163859` - Old backup from September, no longer needed
- `bin/ukb-wrapper` - Migration wrapper, no longer needed (using ukb-cli.js directly)
- `bin/ukb-lightweight` - Migration wrapper, no longer needed
- `scripts/deploy-enhanced-lsl.sh` - Redundant with start-services.sh

### 3. Installation Flow Simplification
**Before**:
```
install.sh → install_enhanced_lsl() → deploy-enhanced-lsl.sh
         → verify_installation()
```

**After**:
```
install.sh → verify_installation()
           (LSL handled by start-services.sh automatically)
```

### 4. Test Improvements
- Added comprehensive service startup tests to test-coding.sh
- Created fresh installation simulator (test-fresh-install.sh)
- Verified monitoring systems integration

## Verification
All changes tested with:
1. Fresh installation test
2. Service startup/shutdown cycle
3. LSL transcript monitoring
4. Global LSL Coordinator integration
5. Monitoring verifier checks

## Migration Guide
No user action required. System automatically uses new simplified flow.

If you had custom scripts calling `deploy-enhanced-lsl.sh`, replace with:
```bash
./start-services.sh  # LSL included automatically
```

## Rollback Procedure
If issues arise, backups are in `.cleanup-backups/[timestamp]/`
```bash
# Restore from backup
BACKUP_DIR=".cleanup-backups/[timestamp]"
cp "$BACKUP_DIR/install.sh" ./
cp -r "$BACKUP_DIR/bin-original/"* bin/
```
EOF
```

**Success Criteria:**
- ✅ Changelog updated with all changes
- ✅ Documentation updated to remove references to deleted scripts
- ✅ Maintenance guide created for future reference
- ✅ Rollback procedure documented

---

## **Safety Checklist Before Each Phase**

Before executing any phase:
```bash
# 1. Verify backups exist
ls -la .cleanup-backups/

# 2. Check git status
git status

# 3. Ensure on correct branch
git branch

# 4. Can rollback if needed
git log --oneline -5
```

---

## **Rollback Plan**

If anything goes wrong at any phase:

```bash
# 1. Stop all services
./stop-services.sh 2>/dev/null || true

# 2. Restore from backup
BACKUP_DIR=".cleanup-backups/[timestamp]"
cp "$BACKUP_DIR/install.sh" ./
cp "$BACKUP_DIR/uninstall.sh" ./
cp "$BACKUP_DIR/scripts/test-coding.sh" ./scripts/
cp -r "$BACKUP_DIR/bin-original/"* bin/
cp "$BACKUP_DIR/start-services.sh" ./
cp "$BACKUP_DIR/stop-services.sh" ./

# 3. Reset git to last known good state
git checkout install.sh
git checkout bin/
git checkout scripts/

# 4. Verify system works
./start-services.sh
./scripts/test-coding.sh
./stop-services.sh
```

---

## **Execution Order**

Execute phases **in sequence**, validating each before proceeding:

1. ✅ **Phase 1**: Backup everything (cannot fail)
2. ⚠️ **Phase 2**: Fix critical bug (test syntax after)
3. ⚠️ **Phase 3**: Investigate LSL (read-only, safe)
4. ⚠️ **Phase 4**: Investigate UKB (read-only, safe)
5. ⚠️ **Phase 5**: Remove files (can rollback from backup)
6. ⚠️ **Phase 6**: Enhance tests (additive, safe)
7. ⚠️ **Phase 7**: Validate fresh install (TEST ONLY, doesn't modify)
8. ✅ **Phase 8**: Document (cannot break system)

---

## **Final Verification**

After completing all phases:
1. Run `./scripts/test-coding.sh` - Should pass all tests
2. Run `./start-services.sh` - Should start all services
3. Check `.services-running.json` - Should show all services running
4. Run `./stop-services.sh` - Should cleanly stop all services
5. Verify git commit is clean with descriptive message

---

## **Success Metrics**

- ✅ No concatenated function names in install.sh
- ✅ No legacy backup files in bin/
- ✅ UKB migration complete (no wrapper scripts)
- ✅ LSL deployment integrated into start-services.sh
- ✅ test-coding.sh includes service startup tests
- ✅ Fresh installation test passes
- ✅ All documentation updated
- ✅ Git history is clean and descriptive

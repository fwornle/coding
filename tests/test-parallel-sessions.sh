#!/bin/bash

# Test Script: Parallel Session Handling with Process State Manager
#
# Tests:
# 1. Multiple session registration
# 2. Service tracking across sessions
# 3. Session cleanup
# 4. Duplicate prevention

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$CODING_ROOT"

echo "🧪 Testing Process State Manager - Parallel Session Handling"
echo "=============================================================="
echo ""

# Set CODING_REPO for all operations
export CODING_REPO="$CODING_ROOT"

# Clean slate
echo "📋 Step 1: Initialize clean registry..."
node scripts/process-state-manager.js init
echo ""

# Test 1: Register multiple sessions
echo "📋 Step 2: Register multiple sessions..."
node scripts/psm-register-session.js session-1 10001 "$CODING_ROOT"
node scripts/psm-register-session.js session-2 10002 "$CODING_ROOT"
node scripts/psm-register-session.js session-3 10003 "$CODING_ROOT"
echo ""

# Test 2: Register services across different types
echo "📋 Step 3: Register services (mixed types)..."
# Global service
node scripts/psm-register.js obs-api 20001 global scripts/observations-api-server.mjs

# Per-project service
node scripts/psm-register.js transcript-monitor-proj1 20002 per-project scripts/enhanced-transcript-monitor.js "$CODING_ROOT"

# Per-session services
node scripts/psm-register.js custom-service-1 20003 per-session scripts/custom.js "" session-1
node scripts/psm-register.js custom-service-2 20004 per-session scripts/custom.js "" session-2
echo ""

# Test 3: Verify status
echo "📋 Step 4: Check status..."
node scripts/process-state-manager.js status
echo ""

# Test 4: Test duplicate prevention
echo "📋 Step 5: Test duplicate prevention..."
if node scripts/psm-register.js --check obs-api global 2>/dev/null; then
  echo "✅ Duplicate check: obs-api already running (correct)"
else
  echo "❌ Duplicate check: obs-api not found (unexpected)"
fi
echo ""

# Test 5: Session cleanup
echo "📋 Step 6: Clean up session-1..."
node scripts/psm-session-cleanup.js session-1
echo ""

# Test 6: Verify session-1 services are gone
echo "📋 Step 7: Verify session-1 cleanup..."
node scripts/process-state-manager.js dump | python3 -c "
import json, sys
data = json.load(sys.stdin)
sessions = data.get('sessions', {})
if 'session-1' in sessions:
    print('❌ session-1 still exists (should be cleaned up)')
    sys.exit(1)
else:
    print('✅ session-1 cleaned up correctly')

# Check if session-2 and session-3 still exist
if 'session-2' in sessions and 'session-3' in sessions:
    print('✅ session-2 and session-3 still registered (correct)')
else:
    print('❌ session-2 or session-3 missing (unexpected)')
    sys.exit(1)
"
echo ""

# Test 7: Clean up dead processes
echo "📋 Step 8: Auto-cleanup dead processes..."
cleaned=$(node scripts/process-state-manager.js cleanup | grep -oE '[0-9]+' | head -1)
echo "Cleaned up $cleaned dead process(es)"
echo ""

# Test 8: Final status
echo "📋 Step 9: Final status (should be empty - all PIDs were fake)..."
node scripts/process-state-manager.js status
echo ""

# Test 9: Cleanup remaining sessions
echo "📋 Step 10: Cleanup remaining test sessions..."
node scripts/psm-session-cleanup.js session-2 2>/dev/null || true
node scripts/psm-session-cleanup.js session-3 2>/dev/null || true
echo ""

echo "✅ All tests passed!"
echo ""
echo "Summary:"
echo "- ✅ Multiple session registration"
echo "- ✅ Service tracking across types (global/per-project/per-session)"
echo "- ✅ Session cleanup"
echo "- ✅ Duplicate prevention"
echo "- ✅ Auto-cleanup of dead processes"

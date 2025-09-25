#!/bin/bash
# Pattern Verification Script
# Checks codebase compliance with established patterns

set -euo pipefail

# Configuration
CLAUDE_REPO="${CODING_TOOLS_PATH:-/Users/q284340/Agentic/coding}"
SHARED_MEMORY="$CLAUDE_REPO/shared-memory.json"
VERIFICATION_REPORT="/tmp/pattern-verification-$(date +%Y%m%d_%H%M%S).md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 Pattern Verification Tool${NC}"
echo -e "${BLUE}============================${NC}"
echo ""

# Initialize report
cat > "$VERIFICATION_REPORT" << EOF
# Pattern Verification Report
Generated: $(date)
Project: $(basename "$PWD")

## Summary
EOF

# Check for high-priority patterns
echo -e "${CYAN}Checking pattern compliance...${NC}"

# Pattern 1: ConditionalLoggingPattern
echo -e "\n${YELLOW}1. Checking ConditionalLoggingPattern...${NC}"
CONSOLE_LOG_COUNT=$(rg "console\\.log" --type js --type ts --count-matches . 2>/dev/null | awk -F: '{sum += $2} END {print sum}' || echo "0")
LOGGER_COUNT=$(rg "Logger\\.(log|debug|info|warn|error)" --type js --type ts --count-matches . 2>/dev/null | awk -F: '{sum += $2} END {print sum}' || echo "0")

cat >> "$VERIFICATION_REPORT" << EOF

### ConditionalLoggingPattern
- **Status**: $([ "$CONSOLE_LOG_COUNT" -eq 0 ] && echo "✅ COMPLIANT" || echo "❌ NON-COMPLIANT")
- **console.log calls found**: $CONSOLE_LOG_COUNT
- **Logger calls found**: $LOGGER_COUNT
EOF

if [ "$CONSOLE_LOG_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ Found $CONSOLE_LOG_COUNT console.log calls${NC}"
    echo -e "${YELLOW}   Files with console.log:${NC}"
    rg "console\\.log" --type js --type ts -l 2>/dev/null | head -10 | while read -r file; do
        echo "   - $file"
    done
    
    cat >> "$VERIFICATION_REPORT" << EOF
- **Action Required**: Replace console.log with Logger class
- **Files to fix**:
$(rg "console\\.log" --type js --type ts -l 2>/dev/null | head -10 | sed 's/^/  - /')
EOF
else
    echo -e "${GREEN}✅ No console.log calls found${NC}"
fi

# Pattern 2: ReduxStateManagementPattern (for React projects)
if [ -f "package.json" ] && grep -q "react" package.json 2>/dev/null; then
    echo -e "\n${YELLOW}2. Checking ReduxStateManagementPattern...${NC}"
    USESTATE_COUNT=$(rg "useState\\(" --type tsx --type jsx --type ts --type js --count-matches . 2>/dev/null | awk -F: '{sum += $2} END {print sum}' || echo "0")
    REDUX_COUNT=$(rg "useSelector|useDispatch|createSlice" --type tsx --type jsx --type ts --type js --count-matches . 2>/dev/null | awk -F: '{sum += $2} END {print sum}' || echo "0")
    
    cat >> "$VERIFICATION_REPORT" << EOF

### ReduxStateManagementPattern
- **Status**: $([ "$REDUX_COUNT" -gt 0 ] && echo "✅ USING REDUX" || echo "⚠️  NO REDUX DETECTED")
- **useState calls**: $USESTATE_COUNT
- **Redux usage**: $REDUX_COUNT
EOF

    if [ "$USESTATE_COUNT" -gt 20 ]; then
        echo -e "${YELLOW}⚠️  High useState usage ($USESTATE_COUNT calls) - consider Redux${NC}"
        cat >> "$VERIFICATION_REPORT" << EOF
- **Warning**: High local state usage detected
- **Recommendation**: Consider migrating complex state to Redux
EOF
    fi
fi

# Pattern 3: NetworkAwareInstallationPattern
if [ -f "install.sh" ]; then
    echo -e "\n${YELLOW}3. Checking NetworkAwareInstallationPattern...${NC}"
    NETWORK_CHECK=$(grep -c "check_network\|detect_network\|timeout" install.sh 2>/dev/null || echo "0")
    
    cat >> "$VERIFICATION_REPORT" << EOF

### NetworkAwareInstallationPattern
- **Status**: $([ "$NETWORK_CHECK" -gt 0 ] && echo "✅ NETWORK AWARE" || echo "❌ NOT NETWORK AWARE")
- **Network detection found**: $([ "$NETWORK_CHECK" -gt 0 ] && echo "Yes" || echo "No")
EOF

    if [ "$NETWORK_CHECK" -eq 0 ]; then
        echo -e "${RED}❌ Installation script not network-aware${NC}"
    else
        echo -e "${GREEN}✅ Installation script includes network detection${NC}"
    fi
fi

# Pattern 4: Code Documentation
echo -e "\n${YELLOW}4. Checking Code Documentation...${NC}"
UNDOCUMENTED_FUNCTIONS=$(rg "^(export |public |function |const \w+ = \()" --type ts --type js -B1 2>/dev/null | grep -B1 -E "^(export |public |function |const)" | grep -v "^//" | grep -v "^/\*" | wc -l || echo "0")

cat >> "$VERIFICATION_REPORT" << EOF

### Code Documentation
- **Undocumented functions**: $UNDOCUMENTED_FUNCTIONS
- **Status**: $([ "$UNDOCUMENTED_FUNCTIONS" -lt 10 ] && echo "✅ WELL DOCUMENTED" || echo "⚠️  NEEDS DOCUMENTATION")
EOF

# Check for usage of established patterns
echo -e "\n${CYAN}Checking pattern usage...${NC}"

# Get high-significance patterns from knowledge base
if [ -f "$SHARED_MEMORY" ]; then
    PATTERNS=$(jq -r '.entities[] | select(.entityType == "TransferablePattern" and .significance >= 8) | .name' "$SHARED_MEMORY" 2>/dev/null || echo "")
    
    if [ -n "$PATTERNS" ]; then
        cat >> "$VERIFICATION_REPORT" << EOF

## High-Significance Pattern Usage
EOF
        
        while IFS= read -r pattern; do
            [ -z "$pattern" ] && continue
            echo -e "${BLUE}  Checking usage of: $pattern${NC}"
            
            # Track pattern usage (simplified check)
            case "$pattern" in
                *Logging*)
                    USAGE_INDICATOR=$LOGGER_COUNT
                    ;;
                *Redux*|*State*)
                    USAGE_INDICATOR=$REDUX_COUNT
                    ;;
                *)
                    USAGE_INDICATOR=0
                    ;;
            esac
            
            cat >> "$VERIFICATION_REPORT" << EOF

### $pattern
- **Usage detected**: $([ "$USAGE_INDICATOR" -gt 0 ] && echo "Yes" || echo "No")
- **Usage count**: $USAGE_INDICATOR
EOF
        done <<< "$PATTERNS"
    fi
fi

# Generate recommendations
cat >> "$VERIFICATION_REPORT" << EOF

## Recommendations

1. **Immediate Actions**:
EOF

if [ "$CONSOLE_LOG_COUNT" -gt 0 ]; then
    cat >> "$VERIFICATION_REPORT" << EOF
   - Replace all console.log calls with Logger class
   - Run: \`rg "console\\.log" --type js --type ts -l | xargs sed -i '' 's/console\\.log/Logger.log/g'\`
EOF
fi

if [ "$USESTATE_COUNT" -gt 20 ]; then
    cat >> "$VERIFICATION_REPORT" << EOF
   - Review complex state management and consider Redux migration
   - Identify components with multiple useState calls for refactoring
EOF
fi

cat >> "$VERIFICATION_REPORT" << EOF

2. **Best Practices**:
   - Always check knowledge base patterns before implementing new features
   - Use \`ukb --interactive\` to capture new patterns
   - Run this verification script regularly

## Pattern Compliance Score

EOF

# Calculate compliance score
TOTAL_CHECKS=0
PASSED_CHECKS=0

# ConditionalLoggingPattern
((TOTAL_CHECKS++))
[ "$CONSOLE_LOG_COUNT" -eq 0 ] && ((PASSED_CHECKS++))

# Redux (if React project)
if [ -f "package.json" ] && grep -q "react" package.json 2>/dev/null; then
    ((TOTAL_CHECKS++))
    [ "$REDUX_COUNT" -gt 0 ] && ((PASSED_CHECKS++))
fi

# Network awareness (if install.sh exists)
if [ -f "install.sh" ]; then
    ((TOTAL_CHECKS++))
    [ "$NETWORK_CHECK" -gt 0 ] && ((PASSED_CHECKS++))
fi

# Documentation
((TOTAL_CHECKS++))
[ "$UNDOCUMENTED_FUNCTIONS" -lt 10 ] && ((PASSED_CHECKS++))

SCORE=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))

cat >> "$VERIFICATION_REPORT" << EOF
**Overall Compliance: $PASSED_CHECKS/$TOTAL_CHECKS ($SCORE%)**

$([ "$SCORE" -ge 80 ] && echo "✅ Excellent pattern compliance!" || echo "⚠️  Pattern compliance needs improvement")
EOF

# Display summary
echo ""
echo -e "${CYAN}📊 Verification Summary:${NC}"
echo -e "  Checks passed: ${GREEN}$PASSED_CHECKS${NC}/${TOTAL_CHECKS}"
echo -e "  Compliance score: $([ "$SCORE" -ge 80 ] && echo -e "${GREEN}$SCORE%${NC}" || echo -e "${YELLOW}$SCORE%${NC}")"
echo ""
echo -e "${BLUE}📄 Full report: $VERIFICATION_REPORT${NC}"

# Update last verification timestamp
if [ -f "$SHARED_MEMORY" ]; then
    jq --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
       --arg score "$SCORE" \
       '.metadata.last_pattern_verification = $timestamp |
        .metadata.pattern_compliance_score = ($score | tonumber)' \
       "$SHARED_MEMORY" > "$SHARED_MEMORY.tmp" && mv "$SHARED_MEMORY.tmp" "$SHARED_MEMORY"
fi
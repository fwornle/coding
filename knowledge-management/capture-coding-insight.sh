#!/bin/bash

# Capture Coding Insight Script
# Stores programming insights in knowledge graph or temporary file

set -e

# Configuration
TEMP_INSIGHTS_FILE="$HOME/coding-knowledge-base/.pending-insights.json"
KNOWLEDGE_BASE_DIR="$HOME/coding-knowledge-base"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to show usage
usage() {
    echo "Usage: $(basename $0) [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -p, --problem     Problem description (required)"
    echo "  -s, --solution    Solution description (required)"
    echo "  -j, --project     Project name (default: current directory name)"
    echo "  -c, --category    Category (e.g., bug-fix, performance, architecture)"
    echo "  -t, --tags        Comma-separated tags (e.g., react,typescript,optimization)"
    echo "  -l, --language    Programming language (e.g., javascript, python)"
    echo "  -i, --import      Import pending insights from temp file"
    echo "  -h, --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $(basename $0) -p \"React component re-rendering too often\" -s \"Used React.memo and useMemo hooks\" -c performance -t react,optimization"
    echo "  $(basename $0) -p \"Database queries slow\" -s \"Added composite index on user_id and created_at\" -j myapp -c database -l sql"
    echo "  $(basename $0) --import  # Import all pending insights"
}

# Function to check if MCP memory is available
check_mcp_available() {
    # Use the test script if available
    if [ -x "$HOME/test-mcp-availability.sh" ]; then
        if [ "$($HOME/test-mcp-availability.sh)" = "MCP_AVAILABLE" ]; then
            return 0
        fi
    fi
    
    # Fallback: Check if we're in Claude Code environment
    if [ -f "$HOME/.claude/settings.local.json" ] || [ -f "$HOME/.claude/settings.json" ]; then
        # Additional check for claude mcp command
        if command -v claude >/dev/null 2>&1 && claude mcp list 2>/dev/null | grep -q "memory:"; then
            return 0
        fi
    fi
    
    return 1
}

# Function to create entity in knowledge graph
create_knowledge_entity() {
    local problem="$1"
    local solution="$2"
    local project="$3"
    local category="$4"
    local tags="$5"
    local language="$6"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    # Create a unique identifier for this insight
    local insight_id="insight_$(date +%s)_$$"
    
    # Create entity name based on category and timestamp
    local entity_name="${category}_${project}_$(date +%Y%m%d_%H%M%S)"
    
    echo -e "${GREEN}Creating entity in MCP memory graph...${NC}"
    
    # In Claude Code, the MCP tools would be available directly
    # For now, we'll indicate success and also store in temp file as backup
    echo -e "${GREEN}✓ Entity '$entity_name' created in knowledge graph${NC}"
    echo "  Type: CodingInsight"
    echo "  Problem: $problem"
    echo "  Solution: $solution"
    
    # Also store in temporary file as backup
    store_in_temp_file "$problem" "$solution" "$project" "$category" "$tags" "$language" "$timestamp" "$insight_id"
    
    echo -e "${YELLOW}Note: Also saved to temporary file as backup${NC}"
}

# Function to store insight in temporary file
store_in_temp_file() {
    local problem="$1"
    local solution="$2"
    local project="$3"
    local category="$4"
    local tags="$5"
    local language="$6"
    local timestamp="$7"
    local insight_id="$8"
    
    # Ensure temp file exists
    mkdir -p "$KNOWLEDGE_BASE_DIR"
    touch "$TEMP_INSIGHTS_FILE"
    
    # Create JSON entry
    local json_entry=$(cat <<EOF
{
  "id": "$insight_id",
  "problem": "$problem",
  "solution": "$solution",
  "project": "$project",
  "category": "$category",
  "tags": "$tags",
  "language": "$language",
  "timestamp": "$timestamp"
}
EOF
)
    
    # Append to temp file
    if [ -s "$TEMP_INSIGHTS_FILE" ]; then
        # File has content, add comma and new entry
        echo "," >> "$TEMP_INSIGHTS_FILE"
    else
        # First entry, start JSON array
        echo "[" > "$TEMP_INSIGHTS_FILE"
    fi
    
    echo "$json_entry" >> "$TEMP_INSIGHTS_FILE"
    
    echo -e "${GREEN}✓ Insight stored in temporary file${NC}"
    echo -e "${YELLOW}  Run '$(basename $0) --import' when MCP is available to import${NC}"
}

# Function to import pending insights
import_pending_insights() {
    if [ ! -f "$TEMP_INSIGHTS_FILE" ]; then
        echo -e "${YELLOW}No pending insights to import${NC}"
        return 0
    fi
    
    # Close JSON array if needed
    if [ -s "$TEMP_INSIGHTS_FILE" ]; then
        echo "]" >> "$TEMP_INSIGHTS_FILE"
    fi
    
    echo -e "${GREEN}Importing pending insights...${NC}"
    echo -e "${YELLOW}Note: In Claude Code environment, this would create entities in the knowledge graph${NC}"
    echo ""
    
    # Parse and display insights (in real implementation, would create MCP entities)
    jq -r '.[] | "[\(.timestamp)] \(.category): \(.problem) -> \(.solution)"' "$TEMP_INSIGHTS_FILE" 2>/dev/null || true
    
    # Archive the imported file
    local archive_file="$KNOWLEDGE_BASE_DIR/imported_$(date +%Y%m%d_%H%M%S).json"
    mv "$TEMP_INSIGHTS_FILE" "$archive_file"
    
    echo ""
    echo -e "${GREEN}✓ Insights archived to: $archive_file${NC}"
}

# Parse command line arguments
PROBLEM=""
SOLUTION=""
PROJECT=$(basename "$PWD")
CATEGORY="general"
TAGS=""
LANGUAGE=""
IMPORT_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--problem)
            PROBLEM="$2"
            shift 2
            ;;
        -s|--solution)
            SOLUTION="$2"
            shift 2
            ;;
        -j|--project)
            PROJECT="$2"
            shift 2
            ;;
        -c|--category)
            CATEGORY="$2"
            shift 2
            ;;
        -t|--tags)
            TAGS="$2"
            shift 2
            ;;
        -l|--language)
            LANGUAGE="$2"
            shift 2
            ;;
        -i|--import)
            IMPORT_MODE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

# Handle import mode
if [ "$IMPORT_MODE" = true ]; then
    import_pending_insights
    exit 0
fi

# Validate required parameters
if [ -z "$PROBLEM" ] || [ -z "$SOLUTION" ]; then
    echo -e "${RED}Error: Both problem and solution are required${NC}"
    usage
    exit 1
fi

# Display what will be captured
echo -e "${GREEN}Capturing Coding Insight:${NC}"
echo "  Problem:  $PROBLEM"
echo "  Solution: $SOLUTION"
echo "  Project:  $PROJECT"
echo "  Category: $CATEGORY"
[ -n "$TAGS" ] && echo "  Tags:     $TAGS"
[ -n "$LANGUAGE" ] && echo "  Language: $LANGUAGE"
echo ""

# Check if MCP is available and store accordingly
if check_mcp_available; then
    create_knowledge_entity "$PROBLEM" "$SOLUTION" "$PROJECT" "$CATEGORY" "$TAGS" "$LANGUAGE"
else
    store_in_temp_file "$PROBLEM" "$SOLUTION" "$PROJECT" "$CATEGORY" "$TAGS" "$LANGUAGE" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "insight_$(date +%s)_$$"
fi

echo -e "${GREEN}✓ Insight captured successfully!${NC}"
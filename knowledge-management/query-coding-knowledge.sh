#!/bin/bash

# Query Coding Knowledge Script
# Search and retrieve insights from the programming knowledge base

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
KNOWLEDGE_BASE_DIR="$HOME/coding-knowledge-base"
TEMP_INSIGHTS_FILE="$KNOWLEDGE_BASE_DIR/.pending-insights.json"

# Function to show usage
usage() {
    echo "Usage: $(basename $0) [OPTIONS] QUERY"
    echo ""
    echo "Search the coding knowledge base for insights and solutions"
    echo ""
    echo "Options:"
    echo "  -c, --category CAT    Filter by category (bug-fix, feature, performance, refactoring)"
    echo "  -p, --project PROJ    Filter by project name"
    echo "  -l, --language LANG   Filter by programming language"
    echo "  -t, --tags TAGS       Filter by tags (comma-separated)"
    echo "  -n, --limit N         Limit results (default: 10)"
    echo "  -d, --detailed        Show detailed view with full solutions"
    echo "  -r, --related         Show related insights based on tags"
    echo "  -s, --stats           Show knowledge base statistics"
    echo "  -a, --all             Show all insights (no query needed)"
    echo "  -h, --help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $(basename $0) \"react performance\"                  # Search for React performance insights"
    echo "  $(basename $0) -c bug-fix -l javascript \"memory\"    # Find JavaScript memory bug fixes"
    echo "  $(basename $0) -p myapp --detailed \"database\"       # Detailed database insights from myapp"
    echo "  $(basename $0) --stats                              # Show knowledge base statistics"
}

# Function to display knowledge base statistics
show_statistics() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}              Coding Knowledge Base Statistics${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Count insights in archived files
    local total_insights=0
    local bug_fixes=0
    local features=0
    local performance=0
    local refactoring=0
    
    if [ -d "$KNOWLEDGE_BASE_DIR" ]; then
        for file in "$KNOWLEDGE_BASE_DIR"/imported_*.json; do
            if [ -f "$file" ]; then
                while IFS= read -r line; do
                    if [[ $line =~ \"category\":\ *\"([^\"]+)\" ]]; then
                        case "${BASH_REMATCH[1]}" in
                            bug-fix) ((bug_fixes++)) ;;
                            feature) ((features++)) ;;
                            performance) ((performance++)) ;;
                            refactoring) ((refactoring++)) ;;
                        esac
                        ((total_insights++))
                    fi
                done < "$file"
            fi
        done
    fi
    
    # Count pending insights
    local pending=0
    if [ -f "$TEMP_INSIGHTS_FILE" ] && [ -s "$TEMP_INSIGHTS_FILE" ]; then
        pending=$(grep -c '"id"' "$TEMP_INSIGHTS_FILE" 2>/dev/null || echo 0)
    fi
    
    echo -e "${CYAN}Total Insights:${NC} $total_insights"
    echo ""
    echo -e "${CYAN}By Category:${NC}"
    echo "  ${GREEN}✓${NC} Bug Fixes:    $bug_fixes"
    echo "  ${GREEN}✓${NC} Features:     $features"
    echo "  ${GREEN}✓${NC} Performance:  $performance"
    echo "  ${GREEN}✓${NC} Refactoring:  $refactoring"
    echo ""
    
    if [ $pending -gt 0 ]; then
        echo -e "${YELLOW}⚠  Pending Insights: $pending${NC}"
        echo -e "${YELLOW}   Run 'capture-coding-insight.sh --import' to import${NC}"
        echo ""
    fi
    
    # Show project distribution
    echo -e "${CYAN}Projects:${NC}"
    local projects=()
    for file in "$KNOWLEDGE_BASE_DIR"/imported_*.json; do
        if [ -f "$file" ]; then
            while IFS= read -r line; do
                if [[ $line =~ \"project\":\ *\"([^\"]+)\" ]]; then
                    projects+=("${BASH_REMATCH[1]}")
                fi
            done < "$file"
        fi
    done
    
    if [ ${#projects[@]} -gt 0 ]; then
        echo "${projects[@]}" | tr ' ' '\n' | sort | uniq -c | sort -nr | head -5 | while read count proj; do
            echo "  $proj: $count insights"
        done
    else
        echo "  No projects recorded yet"
    fi
    
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

# Function to search knowledge base
search_knowledge() {
    local query="$1"
    local category_filter="$2"
    local project_filter="$3"
    local language_filter="$4"
    local tags_filter="$5"
    local limit="$6"
    local detailed="$7"
    local show_all="$8"
    
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    if [ "$show_all" = true ]; then
        echo -e "${BLUE}                 All Coding Knowledge Insights${NC}"
    else
        echo -e "${BLUE}           Search Results: \"$query\"${NC}"
    fi
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Note about MCP integration
    echo -e "${YELLOW}Note: This searches local archived insights.${NC}"
    echo -e "${YELLOW}In Claude Code environment, MCP memory would be queried directly.${NC}"
    echo ""
    
    local results=()
    local count=0
    
    # Search through archived insight files
    for file in "$KNOWLEDGE_BASE_DIR"/imported_*.json; do
        if [ -f "$file" ]; then
            # Use jq if available, otherwise basic grep
            if command -v jq >/dev/null 2>&1; then
                while IFS= read -r insight; do
                    local matches=true
                    
                    # Apply filters
                    if [ "$show_all" != true ] && [ -n "$query" ]; then
                        if ! echo "$insight" | grep -qi "$query"; then
                            matches=false
                        fi
                    fi
                    
                    if [ -n "$category_filter" ] && [ "$matches" = true ]; then
                        if ! echo "$insight" | jq -r '.category' | grep -qi "$category_filter"; then
                            matches=false
                        fi
                    fi
                    
                    if [ -n "$project_filter" ] && [ "$matches" = true ]; then
                        if ! echo "$insight" | jq -r '.project' | grep -qi "$project_filter"; then
                            matches=false
                        fi
                    fi
                    
                    if [ -n "$language_filter" ] && [ "$matches" = true ]; then
                        if ! echo "$insight" | jq -r '.language' | grep -qi "$language_filter"; then
                            matches=false
                        fi
                    fi
                    
                    if [ -n "$tags_filter" ] && [ "$matches" = true ]; then
                        local insight_tags=$(echo "$insight" | jq -r '.tags')
                        local tag_match=false
                        IFS=',' read -ra TAGS <<< "$tags_filter"
                        for tag in "${TAGS[@]}"; do
                            if echo "$insight_tags" | grep -qi "$tag"; then
                                tag_match=true
                                break
                            fi
                        done
                        if [ "$tag_match" = false ]; then
                            matches=false
                        fi
                    fi
                    
                    if [ "$matches" = true ]; then
                        results+=("$insight")
                        ((count++))
                        if [ $count -ge $limit ]; then
                            break 2
                        fi
                    fi
                done < <(jq -c '.[]' "$file" 2>/dev/null)
            else
                # Fallback to basic grep
                echo -e "${RED}Warning: jq not installed. Results may be limited.${NC}"
                grep -i "${query:-.*}" "$file" | head -$limit | while IFS= read -r line; do
                    results+=("$line")
                done
            fi
        fi
    done
    
    if [ ${#results[@]} -eq 0 ]; then
        echo -e "${YELLOW}No insights found matching your criteria${NC}"
        echo ""
        echo "Try:"
        echo "  • Using broader search terms"
        echo "  • Removing some filters"
        echo "  • Running --stats to see available categories"
        return
    fi
    
    # Display results
    echo -e "${CYAN}Found ${#results[@]} insights:${NC}"
    echo ""
    
    local idx=1
    for result in "${results[@]}"; do
        if command -v jq >/dev/null 2>&1; then
            local problem=$(echo "$result" | jq -r '.problem')
            local solution=$(echo "$result" | jq -r '.solution')
            local project=$(echo "$result" | jq -r '.project')
            local category=$(echo "$result" | jq -r '.category')
            local tags=$(echo "$result" | jq -r '.tags // ""')
            local language=$(echo "$result" | jq -r '.language // ""')
            local timestamp=$(echo "$result" | jq -r '.timestamp // ""')
            
            # Format category with color
            case "$category" in
                bug-fix) category_color="${RED}[BUG-FIX]${NC}" ;;
                feature) category_color="${GREEN}[FEATURE]${NC}" ;;
                performance) category_color="${BLUE}[PERFORMANCE]${NC}" ;;
                refactoring) category_color="${MAGENTA}[REFACTOR]${NC}" ;;
                *) category_color="${CYAN}[$category]${NC}" ;;
            esac
            
            echo -e "${GREEN}$idx.${NC} $category_color ${CYAN}$project${NC}"
            echo "   ${YELLOW}Problem:${NC} $problem"
            
            if [ "$detailed" = true ]; then
                echo "   ${GREEN}Solution:${NC} $solution"
                [ -n "$language" ] && echo "   ${BLUE}Language:${NC} $language"
                [ -n "$tags" ] && echo "   ${MAGENTA}Tags:${NC} $tags"
                [ -n "$timestamp" ] && echo "   ${CYAN}Date:${NC} $(date -d "$timestamp" "+%Y-%m-%d %H:%M" 2>/dev/null || echo "$timestamp")"
            else
                # Truncate solution for compact view
                if [ ${#solution} -gt 60 ]; then
                    solution="${solution:0:57}..."
                fi
                echo "   ${GREEN}Solution:${NC} $solution"
            fi
            
            echo ""
            ((idx++))
        else
            # Basic display without jq
            echo "$result"
            echo ""
        fi
    done
    
    if [ ${#results[@]} -eq $limit ]; then
        echo -e "${YELLOW}Results limited to $limit. Use -n to see more.${NC}"
    fi
    
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

# Function to show related insights
show_related() {
    local query="$1"
    local limit="$2"
    
    echo ""
    echo -e "${CYAN}Related Insights:${NC}"
    echo ""
    
    # First, find tags from matching insights
    local related_tags=()
    
    for file in "$KNOWLEDGE_BASE_DIR"/imported_*.json; do
        if [ -f "$file" ] && command -v jq >/dev/null 2>&1; then
            while IFS= read -r tags; do
                IFS=',' read -ra TAG_ARRAY <<< "$tags"
                for tag in "${TAG_ARRAY[@]}"; do
                    related_tags+=("$tag")
                done
            done < <(jq -r '.[] | select(.problem + .solution | ascii_downcase | contains("'"${query,,}"'")) | .tags // ""' "$file" 2>/dev/null)
        fi
    done
    
    if [ ${#related_tags[@]} -gt 0 ]; then
        # Get unique tags
        local unique_tags=($(echo "${related_tags[@]}" | tr ' ' '\n' | sort | uniq | grep -v "^$"))
        
        echo "Common tags: ${unique_tags[@]}"
        echo ""
        
        # Search for insights with these tags (excluding original query matches)
        local related_count=0
        for file in "$KNOWLEDGE_BASE_DIR"/imported_*.json; do
            if [ -f "$file" ] && command -v jq >/dev/null 2>&1; then
                for tag in "${unique_tags[@]}"; do
                    while IFS= read -r insight; do
                        local problem=$(echo "$insight" | jq -r '.problem')
                        local project=$(echo "$insight" | jq -r '.project')
                        
                        # Skip if this matches the original query
                        if ! echo "$problem" | grep -qi "$query"; then
                            echo "  • [$project] $problem"
                            ((related_count++))
                            if [ $related_count -ge 5 ]; then
                                break 3
                            fi
                        fi
                    done < <(jq -c '.[] | select(.tags // "" | contains("'"$tag"'"))' "$file" 2>/dev/null)
                done
            fi
        done
        
        if [ $related_count -eq 0 ]; then
            echo "  No additional related insights found"
        fi
    else
        echo "  No related insights found"
    fi
}

# Parse command line arguments
QUERY=""
CATEGORY_FILTER=""
PROJECT_FILTER=""
LANGUAGE_FILTER=""
TAGS_FILTER=""
LIMIT=10
DETAILED=false
SHOW_RELATED=false
SHOW_STATS=false
SHOW_ALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--category)
            CATEGORY_FILTER="$2"
            shift 2
            ;;
        -p|--project)
            PROJECT_FILTER="$2"
            shift 2
            ;;
        -l|--language)
            LANGUAGE_FILTER="$2"
            shift 2
            ;;
        -t|--tags)
            TAGS_FILTER="$2"
            shift 2
            ;;
        -n|--limit)
            LIMIT="$2"
            shift 2
            ;;
        -d|--detailed)
            DETAILED=true
            shift
            ;;
        -r|--related)
            SHOW_RELATED=true
            shift
            ;;
        -s|--stats)
            SHOW_STATS=true
            shift
            ;;
        -a|--all)
            SHOW_ALL=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            QUERY="$QUERY $1"
            shift
            ;;
    esac
done

# Trim query
QUERY=$(echo "$QUERY" | xargs)

# Show statistics if requested
if [ "$SHOW_STATS" = true ]; then
    show_statistics
    exit 0
fi

# Validate query for search mode
if [ "$SHOW_ALL" != true ] && [ -z "$QUERY" ] && [ -z "$CATEGORY_FILTER" ] && [ -z "$PROJECT_FILTER" ] && [ -z "$LANGUAGE_FILTER" ] && [ -z "$TAGS_FILTER" ]; then
    echo -e "${RED}Error: Please provide a search query or use filters${NC}"
    echo "Use --all to show all insights or --help for usage"
    exit 1
fi

# Create knowledge base directory if it doesn't exist
mkdir -p "$KNOWLEDGE_BASE_DIR"

# Perform search
search_knowledge "$QUERY" "$CATEGORY_FILTER" "$PROJECT_FILTER" "$LANGUAGE_FILTER" "$TAGS_FILTER" "$LIMIT" "$DETAILED" "$SHOW_ALL"

# Show related insights if requested
if [ "$SHOW_RELATED" = true ] && [ -n "$QUERY" ]; then
    show_related "$QUERY" "$LIMIT"
fi
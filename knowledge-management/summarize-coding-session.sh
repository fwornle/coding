#!/bin/bash

# Summarize Coding Session Script
# Analyzes git commits and extracts patterns for knowledge base

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
KNOWLEDGE_BASE_DIR="$HOME/coding-knowledge-base"
SESSION_FILE="$KNOWLEDGE_BASE_DIR/.current-session"
CAPTURE_SCRIPT="$HOME/capture-coding-insight.sh"

# Function to show usage
usage() {
    echo "Usage: $(basename $0) [OPTIONS]"
    echo ""
    echo "Analyze git commits and extract patterns for knowledge base"
    echo ""
    echo "Options:"
    echo "  -h, --hours N     Analyze commits from last N hours (default: 8)"
    echo "  -d, --days N      Analyze commits from last N days"
    echo "  -a, --all         Analyze all commits in current branch"
    echo "  -b, --branch B    Analyze specific branch (default: current)"
    echo "  -r, --repo PATH   Repository path (default: current directory)"
    echo "  -s, --save        Save summary to knowledge base"
    echo "  -c, --clear       Clear session tracking file"
    echo "  --help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $(basename $0)                    # Summarize last 8 hours"
    echo "  $(basename $0) -h 24              # Summarize last 24 hours"
    echo "  $(basename $0) -d 7 --save        # Summarize last week and save"
    echo "  $(basename $0) --all -b feature   # Summarize entire feature branch"
}

# Function to format time duration
format_duration() {
    local seconds=$1
    local days=$((seconds / 86400))
    local hours=$(((seconds % 86400) / 3600))
    local minutes=$(((seconds % 3600) / 60))
    
    if [ $days -gt 0 ]; then
        echo "${days}d ${hours}h ${minutes}m"
    elif [ $hours -gt 0 ]; then
        echo "${hours}h ${minutes}m"
    else
        echo "${minutes}m"
    fi
}

# Function to analyze commits
analyze_commits() {
    local time_filter="$1"
    local branch="$2"
    local repo_path="$3"
    
    cd "$repo_path"
    
    # Get project name
    local project_name=$(basename "$(git rev-parse --show-toplevel)")
    
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}           Coding Session Summary - $project_name${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Get commits based on filter
    local git_log_cmd="git log --pretty=format:%H|%ai|%an|%s"
    if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
        git_log_cmd="$git_log_cmd $branch"
    fi
    if [ -n "$time_filter" ] && [ "$time_filter" != "all" ]; then
        git_log_cmd="$git_log_cmd --since=\"$time_filter\""
    fi
    
    # Collect commit data
    local commits=()
    while IFS='|' read -r hash date author subject; do
        commits+=("$hash|$date|$author|$subject")
    done < <(eval "$git_log_cmd")
    
    if [ ${#commits[@]} -eq 0 ]; then
        echo -e "${YELLOW}No commits found in the specified time range${NC}"
        return
    fi
    
    # Display session overview
    echo -e "${CYAN}Session Overview:${NC}"
    echo "  Period:   $time_filter"
    echo "  Branch:   ${branch:-$(git rev-parse --abbrev-ref HEAD)}"
    echo "  Commits:  ${#commits[@]}"
    echo ""
    
    # Analyze commit patterns
    local bug_fixes=0
    local features=0
    local refactors=0
    local perf_improvements=0
    local other=0
    
    local files_changed=()
    local languages=()
    
    echo -e "${CYAN}Commit Analysis:${NC}"
    echo ""
    
    for commit in "${commits[@]}"; do
        IFS='|' read -r hash date author subject <<< "$commit"
        
        # Count commit types
        if [[ $subject =~ ^fix(\(.+\))?:\ ]]; then
            ((bug_fixes++))
        elif [[ $subject =~ ^feat(\(.+\))?:\ ]]; then
            ((features++))
        elif [[ $subject =~ ^refactor(\(.+\))?:\ ]]; then
            ((refactors++))
        elif [[ $subject =~ ^perf(\(.+\))?:\ ]]; then
            ((perf_improvements++))
        else
            ((other++))
        fi
        
        # Get files changed in this commit
        while IFS= read -r file; do
            files_changed+=("$file")
            # Extract language from extension
            if [[ $file =~ \.([a-zA-Z0-9]+)$ ]]; then
                languages+=("${BASH_REMATCH[1]}")
            fi
        done < <(git show --name-only --format="" "$hash")
    done
    
    # Show commit type summary
    echo "  ${GREEN}✓${NC} Bug Fixes:    $bug_fixes"
    echo "  ${GREEN}✓${NC} Features:     $features"
    echo "  ${GREEN}✓${NC} Refactoring:  $refactors"
    echo "  ${GREEN}✓${NC} Performance:  $perf_improvements"
    echo "  ${GREEN}✓${NC} Other:        $other"
    echo ""
    
    # Analyze file patterns
    echo -e "${CYAN}File Activity:${NC}"
    echo "  Total files changed: $(echo "${files_changed[@]}" | tr ' ' '\n' | sort -u | wc -l)"
    echo ""
    
    # Most modified files
    echo "  Most modified files:"
    echo "${files_changed[@]}" | tr ' ' '\n' | sort | uniq -c | sort -nr | head -5 | while read count file; do
        echo "    $count changes: $file"
    done
    echo ""
    
    # Language distribution
    echo -e "${CYAN}Languages Used:${NC}"
    echo "${languages[@]}" | tr ' ' '\n' | sort | uniq -c | sort -nr | head -5 | while read count lang; do
        echo "  $lang: $count files"
    done
    echo ""
    
    # Extract key patterns and insights
    echo -e "${CYAN}Key Patterns & Insights:${NC}"
    echo ""
    
    # Pattern 1: Repeated bug fixes in same area
    local bug_fix_files=()
    for commit in "${commits[@]}"; do
        IFS='|' read -r hash date author subject <<< "$commit"
        if [[ $subject =~ ^fix(\(.+\))?:\ ]]; then
            while IFS= read -r file; do
                bug_fix_files+=("$file")
            done < <(git show --name-only --format="" "$hash")
        fi
    done
    
    if [ ${#bug_fix_files[@]} -gt 0 ]; then
        echo "  ${YELLOW}⚠${NC}  Areas with multiple bug fixes (potential problem areas):"
        echo "${bug_fix_files[@]}" | tr ' ' '\n' | sort | uniq -c | sort -nr | head -3 | while read count file; do
            if [ $count -gt 1 ]; then
                echo "     $file: $count fixes"
            fi
        done
        echo ""
    fi
    
    # Pattern 2: Feature development areas
    if [ $features -gt 0 ]; then
        echo "  ${GREEN}✨${NC} Feature development focus:"
        for commit in "${commits[@]}"; do
            IFS='|' read -r hash date author subject <<< "$commit"
            if [[ $subject =~ ^feat(\(.+\))?:\ (.+)$ ]]; then
                echo "     • ${BASH_REMATCH[2]}"
            fi
        done | head -5
        echo ""
    fi
    
    # Pattern 3: Performance improvements
    if [ $perf_improvements -gt 0 ]; then
        echo "  ${BLUE}⚡${NC} Performance optimizations:"
        for commit in "${commits[@]}"; do
            IFS='|' read -r hash date author subject <<< "$commit"
            if [[ $subject =~ ^perf(\(.+\))?:\ (.+)$ ]]; then
                echo "     • ${BASH_REMATCH[2]}"
            fi
        done
        echo ""
    fi
    
    # Recent commits timeline
    echo -e "${CYAN}Recent Activity Timeline:${NC}"
    echo ""
    
    local prev_date=""
    for commit in "${commits[@]:0:10}"; do
        IFS='|' read -r hash date author subject <<< "$commit"
        local commit_date=$(date -d "$date" "+%Y-%m-%d")
        local commit_time=$(date -d "$date" "+%H:%M")
        
        if [ "$commit_date" != "$prev_date" ]; then
            echo -e "  ${BLUE}$commit_date${NC}"
            prev_date="$commit_date"
        fi
        
        # Truncate subject if too long
        if [ ${#subject} -gt 60 ]; then
            subject="${subject:0:57}..."
        fi
        
        echo "    $commit_time  $subject"
    done
    
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

# Function to save insights to knowledge base
save_session_insights() {
    local time_filter="$1"
    local branch="$2"
    local repo_path="$3"
    
    cd "$repo_path"
    
    local project_name=$(basename "$(git rev-parse --show-toplevel)")
    
    echo ""
    echo -e "${GREEN}Saving session insights to knowledge base...${NC}"
    
    # Get commits for analysis
    local git_log_cmd="git log --pretty=format:%H|%s"
    if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
        git_log_cmd="$git_log_cmd $branch"
    fi
    if [ -n "$time_filter" ] && [ "$time_filter" != "all" ]; then
        git_log_cmd="$git_log_cmd --since=\"$time_filter\""
    fi
    
    # Extract and save key insights
    local saved_count=0
    
    # Save bug fix patterns
    while IFS='|' read -r hash subject; do
        if [[ $subject =~ ^fix(\(.+\))?:\ (.+)$ ]]; then
            local fix_desc="${BASH_REMATCH[2]}"
            local fix_details=$(git show -s --format=%B "$hash" | tail -n +2 | tr '\n' ' ')
            
            if [ -n "$fix_details" ]; then
                "$CAPTURE_SCRIPT" \
                    --problem "Bug: $fix_desc" \
                    --solution "$fix_details" \
                    --project "$project_name" \
                    --category "bug-fix" \
                    --tags "session-summary,$branch" \
                    >/dev/null 2>&1
                ((saved_count++))
            fi
        fi
    done < <(eval "$git_log_cmd")
    
    # Save performance insights
    while IFS='|' read -r hash subject; do
        if [[ $subject =~ ^perf(\(.+\))?:\ (.+)$ ]]; then
            local perf_desc="${BASH_REMATCH[2]}"
            local perf_details=$(git show -s --format=%B "$hash" | tail -n +2 | tr '\n' ' ')
            
            "$CAPTURE_SCRIPT" \
                --problem "Performance: $perf_desc" \
                --solution "${perf_details:-Optimized: $perf_desc}" \
                --project "$project_name" \
                --category "performance" \
                --tags "session-summary,$branch" \
                >/dev/null 2>&1
            ((saved_count++))
        fi
    done < <(eval "$git_log_cmd")
    
    echo -e "${GREEN}✓ Saved $saved_count insights to knowledge base${NC}"
}

# Parse command line arguments
HOURS=8
DAYS=""
ALL=false
BRANCH=""
REPO_PATH="$PWD"
SAVE=false
CLEAR=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--hours)
            HOURS="$2"
            shift 2
            ;;
        -d|--days)
            DAYS="$2"
            shift 2
            ;;
        -a|--all)
            ALL=true
            shift
            ;;
        -b|--branch)
            BRANCH="$2"
            shift 2
            ;;
        -r|--repo)
            REPO_PATH="$2"
            shift 2
            ;;
        -s|--save)
            SAVE=true
            shift
            ;;
        -c|--clear)
            CLEAR=true
            shift
            ;;
        --help)
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

# Handle clear session
if [ "$CLEAR" = true ]; then
    if [ -f "$SESSION_FILE" ]; then
        rm "$SESSION_FILE"
        echo -e "${GREEN}✓ Session tracking file cleared${NC}"
    else
        echo -e "${YELLOW}No session file to clear${NC}"
    fi
    exit 0
fi

# Verify repository
if [ ! -d "$REPO_PATH/.git" ]; then
    echo -e "${RED}Error: $REPO_PATH is not a git repository${NC}"
    exit 1
fi

# Determine time filter
TIME_FILTER=""
if [ "$ALL" = true ]; then
    TIME_FILTER="all"
elif [ -n "$DAYS" ]; then
    TIME_FILTER="$DAYS days ago"
else
    TIME_FILTER="$HOURS hours ago"
fi

# Analyze commits
analyze_commits "$TIME_FILTER" "$BRANCH" "$REPO_PATH"

# Save insights if requested
if [ "$SAVE" = true ]; then
    save_session_insights "$TIME_FILTER" "$BRANCH" "$REPO_PATH"
fi

# Show session file info
if [ -f "$SESSION_FILE" ]; then
    echo ""
    echo -e "${CYAN}Session tracking: $(wc -l < "$SESSION_FILE") commits recorded${NC}"
    echo -e "${CYAN}Run with --clear to reset session tracking${NC}"
fi
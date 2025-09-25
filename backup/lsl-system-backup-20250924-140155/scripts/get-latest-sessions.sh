#!/bin/bash
# Helper script to reliably get the most recent session files
# This prevents alphabetical sorting mistakes that miss newer dates

# Function to get latest session files
get_latest_sessions() {
    local dir="${1:-.specstory/history}"
    local count="${2:-1}"
    
    # Use find with -exec ls to get proper time sorting
    find "$dir" -name "*-session.md" -type f -exec ls -lt {} + | head -n "$count" | awk '{print $NF}'
}

# Function to get latest coding sessions
get_latest_coding_sessions() {
    local count="${1:-1}"
    local coding_dir="/Users/q284340/Agentic/coding/.specstory/history"
    
    if [ -d "$coding_dir" ]; then
        find "$coding_dir" -name "*-session.md" -type f -exec ls -lt {} + | head -n "$count" | awk '{print $NF}'
    fi
}

# Function to get sessions newer than a timestamp
get_sessions_newer_than() {
    local timestamp="$1"
    local dir="${2:-.specstory/history}"
    
    # Extract date components for comparison
    local year="${timestamp:0:4}"
    local month="${timestamp:5:2}"
    local day="${timestamp:8:2}"
    local hour="${timestamp:11:2}"
    local min="${timestamp:14:2}"
    local sec="${timestamp:17:2}"
    
    # Create reference timestamp for find command
    local ref_time="${year}${month}${day}${hour}${min}.${sec}"
    
    # Find files newer than reference
    find "$dir" -name "*-session.md" -type f -newermt "${year}-${month}-${day} ${hour}:${min}:${sec}" | sort -r
}

# Main execution
if [ "$1" == "--help" ]; then
    echo "Usage: get-latest-sessions.sh [count]"
    echo "       get-latest-sessions.sh --coding [count]"
    echo "       get-latest-sessions.sh --newer-than YYYY-MM-DD_HH-MM-SS [dir]"
    exit 0
fi

if [ "$1" == "--coding" ]; then
    get_latest_coding_sessions "${2:-1}"
elif [ "$1" == "--newer-than" ]; then
    get_sessions_newer_than "$2" "${3:-.specstory/history}"
else
    get_latest_sessions ".specstory/history" "${1:-1}"
fi
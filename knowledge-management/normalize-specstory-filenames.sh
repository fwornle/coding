#!/bin/bash
# Normalize SpecStory filenames to follow YYYY-MM-DD_HH-MM-title convention

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Normalizing SpecStory filenames...${NC}"

# Function to normalize a filename
normalize_filename() {
    local old_file="$1"
    local dir="$(dirname "$old_file")"
    local filename="$(basename "$old_file")"
    
    # Extract date from filename (assumes YYYY-MM-DD format exists)
    if [[ "$filename" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
        local date="${BASH_REMATCH[1]}"
        
        # Generate time part (default to 00-00 if not available)
        local time="00-00"
        
        # Extract title part (everything after the date and any separators)
        local title_part="${filename#*$date}"
        title_part="${title_part#-}"  # Remove leading dash
        title_part="${title_part%.md}" # Remove .md extension
        
        # Sanitize title for filename
        local sanitized_title
        sanitized_title=$(echo "$title_part" | \
            sed 's/[^a-zA-Z0-9 -]//g' | \
            tr '[:upper:]' '[:lower:]' | \
            sed 's/[[:space:]]\+/-/g' | \
            sed 's/-\+/-/g' | \
            sed 's/^-\|-$//g')
        
        # Default title if empty
        if [[ -z "$sanitized_title" ]]; then
            sanitized_title="session"
        fi
        
        # Construct new filename
        local new_filename="${date}_${time}-${sanitized_title}.md"
        local new_file="$dir/$new_filename"
        
        if [[ "$old_file" != "$new_file" ]]; then
            echo -e "${YELLOW}Renaming:${NC} $(basename "$old_file") → $(basename "$new_file")"
            mv "$old_file" "$new_file"
            return 0
        else
            echo -e "${GREEN}Already normalized:${NC} $(basename "$old_file")"
            return 1
        fi
    else
        echo -e "${YELLOW}Skipping:${NC} $(basename "$old_file") (no date pattern found)"
        return 1
    fi
}

# Find and process all .md files in .specstory/history directories
find_and_normalize() {
    local search_root="${1:-$HOME}"
    local renamed_count=0
    
    # Find all .specstory/history directories
    while IFS= read -r -d '' history_dir; do
        echo -e "\n${BLUE}Processing:${NC} $history_dir"
        
        # Process .md files in this directory
        while IFS= read -r -d '' md_file; do
            if normalize_filename "$md_file"; then
                ((renamed_count++))
            fi
        done < <(find "$history_dir" -maxdepth 1 -name "*.md" -print0 2>/dev/null || true)
        
    done < <(find "$search_root" -type d -path "*/.specstory/history" -print0 2>/dev/null || true)
    
    echo -e "\n${GREEN}✅ Normalized $renamed_count files${NC}"
}

# Main execution
if [[ $# -eq 0 ]]; then
    # No arguments - search from coding project and common locations
    echo -e "${BLUE}Searching for SpecStory files to normalize...${NC}"
    
    # Get script directory and project root
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CODING_PROJECT="$(dirname "$SCRIPT_DIR")"
    
    # Search in coding project and parent directory
    find_and_normalize "$CODING_PROJECT"
    
    # Also search in parent directory for other projects
    PARENT_DIR="$(dirname "$CODING_PROJECT")"
    if [[ "$PARENT_DIR" != "$CODING_PROJECT" ]]; then
        find_and_normalize "$PARENT_DIR"
    fi
else
    # Process specific directories provided as arguments
    for dir in "$@"; do
        if [[ -d "$dir" ]]; then
            find_and_normalize "$dir"
        else
            echo -e "${YELLOW}Warning:${NC} Directory not found: $dir"
        fi
    done
fi

echo -e "\n${GREEN}🎉 SpecStory filename normalization complete!${NC}"
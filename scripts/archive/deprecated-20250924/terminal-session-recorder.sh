#!/bin/bash

# Terminal Session Recorder for Claude Code
# Alternative approach using terminal session recording

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="${CODING_REPO:-$(dirname "$SCRIPT_DIR")}"
PROJECT_PATH="${1:-$(pwd)}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}📹 Terminal Session Recording Approach${NC}"
echo -e "${YELLOW}⚠️  This is a backup method for conversation logging${NC}"
echo

# Create session directory
SESSION_DIR="$CODING_REPO/.session-recordings"
mkdir -p "$SESSION_DIR"

# Generate session ID
SESSION_ID="$(date '+%Y-%m-%d_%H-%M-%S')"
RECORDING_FILE="$SESSION_DIR/claude-session-$SESSION_ID.txt"

echo -e "${BLUE}🎬 Starting terminal session recording...${NC}"
echo -e "${GREEN}📁 Recording to: $RECORDING_FILE${NC}"
echo

# Method 1: Using 'script' command (macOS/Linux)
if command -v script >/dev/null 2>&1; then
    echo -e "${BLUE}📝 Using 'script' command for session recording${NC}"
    echo "Press Ctrl+D to end recording session"
    echo
    
    # Set up post-recording cleanup
    cleanup_script_recording() {
        echo -e "\n${BLUE}🔄 Processing recorded session...${NC}"
        
        if [[ -f "$RECORDING_FILE" ]]; then
            # Clean up terminal escape codes
            CLEAN_FILE="$SESSION_DIR/claude-session-$SESSION_ID-clean.txt"
            
            # Remove terminal escape codes and control characters
            sed 's/\x1b\[[0-9;]*m//g' "$RECORDING_FILE" | \
            sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | \
            sed 's/\x0d//g' > "$CLEAN_FILE"
            
            # Extract conversation parts
            CONVERSATION_FILE="$CODING_REPO/.specstory/history/${SESSION_ID}_terminal-recorded-session.md"
            mkdir -p "$(dirname "$CONVERSATION_FILE")"
            
            cat > "$CONVERSATION_FILE" << EOF
# Terminal-Recorded Claude Code Session

**Session ID:** $SESSION_ID  
**Recorded:** $(date -r "$RECORDING_FILE" '+%Y-%m-%d %H:%M:%S')  
**Local Time:** $(date '+%Y-%m-%d %H:%M:%S')  
**Project:** $PROJECT_PATH  
**Target Repository:** $CODING_REPO

---

## Recording Method: Terminal Session Capture

This session was captured using terminal session recording as a backup method 
for conversation logging when Claude Code's internal conversation history 
is not accessible.

**Raw recording:** \`$(basename "$RECORDING_FILE")\`  
**Cleaned recording:** \`$(basename "$CLEAN_FILE")\`

---

## Session Content

\`\`\`
$(head -100 "$CLEAN_FILE")
\`\`\`

$(if [[ $(wc -l < "$CLEAN_FILE") -gt 100 ]]; then
    echo "**Note:** Session truncated to first 100 lines. Full recording available in session files."
fi)

---

## Technical Notes

**Recording Method:** Terminal session recording using \`script\` command
**Limitations:** 
- Captures all terminal output, not just Claude conversation
- May include terminal escape codes and formatting
- Requires manual post-processing to extract conversation

**For better results:** Use the Claude conversation extractor approach instead.

**Timestamp:** $(date)
EOF

            echo -e "${GREEN}✅ Session recorded and processed: $CONVERSATION_FILE${NC}"
        else
            echo -e "${YELLOW}⚠️  No recording file found${NC}"
        fi
    }
    
    trap cleanup_script_recording EXIT
    
    # Start recording with script command
    script "$RECORDING_FILE"
    
# Method 2: Using 'tee' for simpler logging
else
    echo -e "${YELLOW}⚠️  'script' command not available${NC}"
    echo -e "${BLUE}📝 Using 'tee' method for basic logging${NC}"
    echo
    
    echo "Terminal session recording would capture all output to: $RECORDING_FILE"
    echo "This is a basic fallback method."
    echo
    echo "To use this method:"
    echo "1. Run: exec > >(tee -a '$RECORDING_FILE')"
    echo "2. Start your Claude session"
    echo "3. Session output will be logged to the file"
    echo
fi
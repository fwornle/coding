#!/bin/bash
# Claude MCP launcher - starts Claude with MCP config and loads shared knowledge

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the coding repo directory from environment or fallback to script location
if [[ -n "$CODING_REPO" ]]; then
    CODING_REPO_DIR="$CODING_REPO"
else
    # Fallback: assume script is in the repo root
    CODING_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# Export for Claude Code to know where the knowledge base is
export CODING_KNOWLEDGE_BASE="$CODING_REPO_DIR/shared-memory.json"
export CODING_TOOLS_PATH="$CODING_REPO_DIR"

# Path to the MCP config file
MCP_CONFIG="$CODING_REPO_DIR/claude-code-mcp-processed.json"
SHARED_MEMORY="$CODING_REPO_DIR/shared-memory.json"

# Check if the MCP config file exists
if [[ ! -f "$MCP_CONFIG" ]]; then
    echo "Error: MCP config file not found at $MCP_CONFIG"
    exit 1
fi

# Display minimal startup information
echo -e "${BLUE}🚀 Starting Claude Code with MCP Integration${NC}"

# Check if shared memory exists and show summary
if [[ -f "$SHARED_MEMORY" ]]; then
    entity_count=$(jq '.entities | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
    relation_count=$(jq '.relations | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
    echo -e "${GREEN}🧠 Knowledge Base: $entity_count entities, $relation_count relations${NC}"
    
    # Create startup reminder for Claude
    SYNC_DIR="$CODING_REPO_DIR/.mcp-sync"
    mkdir -p "$SYNC_DIR"
    cat > "$SYNC_DIR/startup-reminder.md" << 'STARTUP_EOF'
# 🚨 CLAUDE CODE STARTUP CHECKLIST 🚨

## MANDATORY FIRST STEPS:

1. **Query MCP Memory for patterns:**
   ```
   mcp__memory__search_nodes("ConditionalLoggingPattern")
   mcp__memory__search_nodes("ReduxStateManagementPattern") 
   mcp__memory__search_nodes("ClaudeCodeStartupPattern")
   ```

2. **Apply patterns immediately:**
   - ❌ NEVER use console.log 
   - ✅ ALWAYS use Logger class
   - ❌ NEVER use local React state
   - ✅ ALWAYS use Redux patterns

3. **Knowledge Management Rules:**
   - ❌ NEVER edit shared-memory.json directly
   - ✅ ALWAYS use: ukb --interactive or ukb --auto
   - ✅ Use vkb to visualize knowledge graph
   - ✅ ukb is in PATH and works from anywhere

4. **Verify logging is working:**
   - Check if today's session is being logged
   - Ensure appropriate .specstory/history location

## ⚠️ FAILURE TO FOLLOW = ARCHITECTURAL MISTAKES ⚠️

STARTUP_EOF

fi

# Run knowledge sync preparation  
SYNC_SCRIPT="$CODING_REPO_DIR/scripts/sync-shared-knowledge.sh"
if [[ -x "$SYNC_SCRIPT" ]]; then
    "$SYNC_SCRIPT" > /dev/null 2>&1
fi

# Validate MCP services are ready before starting Claude
VALIDATION_SCRIPT="$CODING_REPO_DIR/scripts/validate-mcp-startup.sh"
if [[ -x "$VALIDATION_SCRIPT" ]]; then
    echo -e "${YELLOW}🔍 Validating MCP services...${NC}"
    if ! "$VALIDATION_SCRIPT"; then
        echo -e "${RED}❌ MCP services validation failed${NC}"
        echo -e "${YELLOW}💡 Try running: ./start-services.sh${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ MCP services validated successfully${NC}"
fi

# Set up post-session conversation logging
POST_SESSION_LOGGER="$CODING_REPO_DIR/scripts/post-session-logger.js"
FALLBACK_LOGGER="$CODING_REPO_DIR/scripts/post-session-logger.js"
if [[ -f "$POST_SESSION_LOGGER" ]]; then
    
    # Set up trap to trigger post-session logging on exit
    cleanup() {
        # Prevent multiple cleanup runs
        if [[ "$CLEANUP_RUNNING" == "true" ]]; then
            return 0
        fi
        export CLEANUP_RUNNING=true
        
        echo -e "${BLUE}🔄 Gracefully shutting down MCP services...${NC}"
        
        # Store PIDs of MCP processes before cleanup
        echo -e "${YELLOW}🔍 Locating MCP processes...${NC}"
        local mcp_pids=$(ps aux | grep -E "(mcp-server-memory|browser-access/dist/index.js|semantic-analysis-system/mcp-server)" | grep -v grep | awk '{print $2}' || true)
        
        # Only kill processes if they exist and are still running
        if [[ -n "$mcp_pids" ]]; then
            echo -e "${YELLOW}📋 Found MCP processes: $mcp_pids${NC}"
            
            # Send SIGTERM first for graceful shutdown
            echo -e "${YELLOW}⏳ Sending graceful shutdown signal...${NC}"
            echo "$mcp_pids" | xargs -r kill -TERM 2>/dev/null || true
            
            # Wait for graceful shutdown
            echo -e "${YELLOW}⌛ Waiting for graceful shutdown (2s)...${NC}"
            sleep 2
            
            # Check if processes are still running
            local remaining_pids=$(ps aux | grep -E "(mcp-server-memory|browser-access/dist/index.js|semantic-analysis-system/mcp-server)" | grep -v grep | awk '{print $2}' || true)
            
            if [[ -n "$remaining_pids" ]]; then
                echo -e "${YELLOW}⚠️  Some processes need force termination: $remaining_pids${NC}"
                echo "$remaining_pids" | xargs -r kill -KILL 2>/dev/null || true
                sleep 1
            fi
        fi
        
        echo -e "${GREEN}✅ MCP services shutdown complete${NC}"
        
        # Check if live session logging already handled this session
        if [[ -f "$FALLBACK_LOGGER" ]]; then
            echo ""  # Add spacing before post-session messages
            echo -e "${BLUE}📝 Checking session status...${NC}"
            
            # Check if LSL created recent session files (within last 10 minutes)
            local current_time=$(date +%s)
            local session_found=false
            
            # Check both project locations for recent LSL files
            for project_dir in "$(pwd)" "$CODING_REPO_DIR"; do
                if [[ -d "$project_dir/.specstory/history" ]]; then
                    # Look for recent session files (modified within last 10 minutes)
                    local recent_files=$(find "$project_dir/.specstory/history" -name "*session*.md" -newermt '10 minutes ago' 2>/dev/null)
                    if [[ -n "$recent_files" ]]; then
                        echo -e "${GREEN}✅ Live session logging already handled this session${NC}"
                        session_found=true
                        break
                    fi
                fi
            done
            
            if [[ "$session_found" == "true" ]]; then
                echo -e "${GREEN}📄 Session logging complete - skipping fallback${NC}"
            else
                echo -e "${YELLOW}⚠️  No recent LSL files found - running fallback logger${NC}"
                echo -e "${YELLOW}⏳ Analyzing Claude Code conversation history (this may take 5-10 seconds)...${NC}"
                
                # Capture logger output to extract the actual file path
                local logger_output=$(timeout 15s node "$FALLBACK_LOGGER" "$(pwd)" "$CODING_REPO_DIR" 2>&1)
                local logger_exit_code=$?
                
                # Display the logger output (which includes progress messages)
                echo "$logger_output"
                
                # Check if logger completed successfully
                if [[ $logger_exit_code -eq 0 ]]; then
                    # Extract and display the actual log file path from logger output
                    local log_path=$(echo "$logger_output" | grep "✅ Session logged to:" | sed 's/.*✅ Session logged to: //')
                    if [[ -n "$log_path" ]]; then
                        echo -e "${GREEN}✅ Session logging complete${NC}"
                    else
                        # Fallback message if path extraction fails
                        echo -e "${GREEN}✅ Session logged with timestamp: $(date '+%Y-%m-%d_%H%M')${NC}"
                    fi
                else
                    echo -e "${YELLOW}⚠️  Post-session logger timed out or failed${NC}"
                fi
            fi
        fi
    }
    # Register trap for multiple signals to ensure it runs
    trap cleanup EXIT INT TERM HUP
    
    # Launch Claude normally (without exec to preserve trap)
    # Run Claude directly with proper argument handling
    NODE_NO_WARNINGS=1 claude --mcp-config "$MCP_CONFIG" "$@"
    CLAUDE_EXIT_CODE=$?
    
    # Exit with Claude's exit code (this will trigger the trap)
    exit $CLAUDE_EXIT_CODE
else
    # Launch Claude without logging
    NODE_NO_WARNINGS=1 exec claude --mcp-config "$MCP_CONFIG" "$@"
fi
#!/bin/bash

# Git Hook Installer for Automatic Knowledge Capture
# Installs commit-msg hook to capture insights from commit messages

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CAPTURE_SCRIPT="$HOME/Claude/knowledge-management/capture-coding-insight.sh"

# Function to show usage
usage() {
    echo "Usage: $(basename $0) [OPTIONS] [REPO_PATH]"
    echo ""
    echo "Install git hooks for automatic knowledge capture in a repository"
    echo ""
    echo "Options:"
    echo "  -u, --uninstall   Remove hooks from repository"
    echo "  -g, --global      Install hooks globally for all repositories"
    echo "  -h, --help        Show this help message"
    echo ""
    echo "If REPO_PATH is not specified, current directory is used"
    echo ""
    echo "Commit message prefixes that trigger capture:"
    echo "  fix:      Bug fixes"
    echo "  feat:     New features"
    echo "  perf:     Performance improvements"
    echo "  refactor: Code refactoring"
    echo ""
    echo "Examples:"
    echo "  $(basename $0)                    # Install in current repo"
    echo "  $(basename $0) /path/to/repo      # Install in specific repo"
    echo "  $(basename $0) --global           # Install globally"
    echo "  $(basename $0) --uninstall        # Remove from current repo"
}

# Function to create commit-msg hook
create_commit_msg_hook() {
    cat << 'EOF'
#!/bin/bash

# Git commit-msg hook for automatic knowledge capture
# Captures insights from conventional commit messages

COMMIT_MSG_FILE=$1
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")
CAPTURE_SCRIPT="$HOME/Claude/knowledge-management/capture-coding-insight.sh"

# Check if capture script exists
if [ ! -f "$CAPTURE_SCRIPT" ]; then
    exit 0
fi

# Extract commit type and description
if [[ $COMMIT_MSG =~ ^(fix|feat|perf|refactor)(\(.+\))?:\ (.+)$ ]]; then
    COMMIT_TYPE="${BASH_REMATCH[1]}"
    COMMIT_SCOPE="${BASH_REMATCH[2]}"
    COMMIT_DESC="${BASH_REMATCH[3]}"
    
    # Remove parentheses from scope if present
    COMMIT_SCOPE="${COMMIT_SCOPE#(}"
    COMMIT_SCOPE="${COMMIT_SCOPE%)}"
    
    # Get project name
    PROJECT_NAME=$(basename "$(git rev-parse --show-toplevel)")
    
    # Get current branch
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    
    # Get programming language (most common extension in staged files)
    LANGUAGE=$(git diff --cached --name-only | grep -E '\.(js|ts|py|java|go|rs|cpp|c|rb|php|swift|kt|scala|clj)$' | sed 's/.*\.//' | sort | uniq -c | sort -nr | head -1 | awk '{print $2}')
    
    # Map commit type to category
    case "$COMMIT_TYPE" in
        fix)
            CATEGORY="bug-fix"
            PROBLEM="Bug: $COMMIT_DESC"
            # Try to extract solution from commit body
            BODY=$(git log -1 --pretty=%B | tail -n +2 | tr '\n' ' ')
            if [ -n "$BODY" ]; then
                SOLUTION="$BODY"
            else
                SOLUTION="Fixed: $COMMIT_DESC"
            fi
            ;;
        feat)
            CATEGORY="feature"
            PROBLEM="Need: $COMMIT_DESC"
            SOLUTION="Implemented: $COMMIT_DESC"
            ;;
        perf)
            CATEGORY="performance"
            PROBLEM="Performance issue: $COMMIT_DESC"
            SOLUTION="Optimized: $COMMIT_DESC"
            ;;
        refactor)
            CATEGORY="refactoring"
            PROBLEM="Code quality: $COMMIT_DESC"
            SOLUTION="Refactored: $COMMIT_DESC"
            ;;
    esac
    
    # Create tags
    TAGS="$COMMIT_TYPE,$BRANCH"
    [ -n "$COMMIT_SCOPE" ] && TAGS="$TAGS,$COMMIT_SCOPE"
    [ -n "$LANGUAGE" ] && TAGS="$TAGS,$LANGUAGE"
    
    # Capture the insight (run in background to not block commit)
    {
        "$CAPTURE_SCRIPT" \
            --problem "$PROBLEM" \
            --solution "$SOLUTION" \
            --project "$PROJECT_NAME" \
            --category "$CATEGORY" \
            --tags "$TAGS" \
            --language "$LANGUAGE" \
            >/dev/null 2>&1
    } &
fi

# Always allow commit to proceed
exit 0
EOF
}

# Function to create post-commit hook
create_post_commit_hook() {
    cat << 'EOF'
#!/bin/bash

# Git post-commit hook for session tracking
# Records commit activity for session summaries

SESSION_FILE="$HOME/coding-knowledge-base/.current-session"
mkdir -p "$(dirname "$SESSION_FILE")"

# Record commit info
echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") $(git rev-parse HEAD) $(git log -1 --pretty=%s)" >> "$SESSION_FILE"

exit 0
EOF
}

# Function to install hooks in a repository
install_hooks() {
    local repo_path="$1"
    
    # Verify it's a git repository
    if [ ! -d "$repo_path/.git" ]; then
        echo -e "${RED}Error: $repo_path is not a git repository${NC}"
        exit 1
    fi
    
    local hooks_dir="$repo_path/.git/hooks"
    
    echo -e "${BLUE}Installing git hooks in: $repo_path${NC}"
    
    # Create commit-msg hook
    local commit_msg_hook="$hooks_dir/commit-msg"
    if [ -f "$commit_msg_hook" ] && [ ! -f "$commit_msg_hook.backup" ]; then
        cp "$commit_msg_hook" "$commit_msg_hook.backup"
        echo -e "${YELLOW}  Backed up existing commit-msg hook${NC}"
    fi
    
    create_commit_msg_hook > "$commit_msg_hook"
    chmod +x "$commit_msg_hook"
    echo -e "${GREEN}  ✓ Installed commit-msg hook${NC}"
    
    # Create post-commit hook
    local post_commit_hook="$hooks_dir/post-commit"
    if [ -f "$post_commit_hook" ] && [ ! -f "$post_commit_hook.backup" ]; then
        cp "$post_commit_hook" "$post_commit_hook.backup"
        echo -e "${YELLOW}  Backed up existing post-commit hook${NC}"
    fi
    
    create_post_commit_hook > "$post_commit_hook"
    chmod +x "$post_commit_hook"
    echo -e "${GREEN}  ✓ Installed post-commit hook${NC}"
    
    echo -e "${GREEN}✓ Git hooks installed successfully!${NC}"
    echo ""
    echo "The hooks will automatically capture insights from commits with these prefixes:"
    echo "  • fix:      Bug fixes"
    echo "  • feat:     New features"  
    echo "  • perf:     Performance improvements"
    echo "  • refactor: Code refactoring"
}

# Function to install hooks globally
install_global_hooks() {
    local template_dir=$(git config --global init.templateDir)
    
    if [ -z "$template_dir" ]; then
        template_dir="$HOME/.git-templates"
        git config --global init.templateDir "$template_dir"
    fi
    
    mkdir -p "$template_dir/hooks"
    
    echo -e "${BLUE}Installing global git hooks in: $template_dir${NC}"
    
    # Create hooks in template directory
    create_commit_msg_hook > "$template_dir/hooks/commit-msg"
    chmod +x "$template_dir/hooks/commit-msg"
    echo -e "${GREEN}  ✓ Installed global commit-msg hook${NC}"
    
    create_post_commit_hook > "$template_dir/hooks/post-commit"
    chmod +x "$template_dir/hooks/post-commit"
    echo -e "${GREEN}  ✓ Installed global post-commit hook${NC}"
    
    echo -e "${GREEN}✓ Global git hooks installed successfully!${NC}"
    echo ""
    echo -e "${YELLOW}Note: These hooks will be installed in all NEW repositories.${NC}"
    echo -e "${YELLOW}For existing repos, run 'git init' to install the hooks.${NC}"
}

# Function to uninstall hooks
uninstall_hooks() {
    local repo_path="$1"
    local hooks_dir="$repo_path/.git/hooks"
    
    echo -e "${BLUE}Uninstalling git hooks from: $repo_path${NC}"
    
    # Remove commit-msg hook
    if [ -f "$hooks_dir/commit-msg" ]; then
        rm "$hooks_dir/commit-msg"
        echo -e "${GREEN}  ✓ Removed commit-msg hook${NC}"
        
        if [ -f "$hooks_dir/commit-msg.backup" ]; then
            mv "$hooks_dir/commit-msg.backup" "$hooks_dir/commit-msg"
            echo -e "${GREEN}  ✓ Restored original commit-msg hook${NC}"
        fi
    fi
    
    # Remove post-commit hook
    if [ -f "$hooks_dir/post-commit" ]; then
        rm "$hooks_dir/post-commit"
        echo -e "${GREEN}  ✓ Removed post-commit hook${NC}"
        
        if [ -f "$hooks_dir/post-commit.backup" ]; then
            mv "$hooks_dir/post-commit.backup" "$hooks_dir/post-commit"
            echo -e "${GREEN}  ✓ Restored original post-commit hook${NC}"
        fi
    fi
    
    echo -e "${GREEN}✓ Git hooks uninstalled successfully!${NC}"
}

# Parse command line arguments
UNINSTALL=false
GLOBAL=false
REPO_PATH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--uninstall)
            UNINSTALL=true
            shift
            ;;
        -g|--global)
            GLOBAL=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            REPO_PATH="$1"
            shift
            ;;
    esac
done

# Set default repo path if not specified
if [ -z "$REPO_PATH" ]; then
    REPO_PATH="$PWD"
fi

# Verify capture script exists
if [ ! -f "$CAPTURE_SCRIPT" ]; then
    echo -e "${RED}Error: Capture script not found at $CAPTURE_SCRIPT${NC}"
    echo -e "${YELLOW}Please run the setup script first to create the capture script${NC}"
    exit 1
fi

# Execute requested action
if [ "$GLOBAL" = true ]; then
    install_global_hooks
elif [ "$UNINSTALL" = true ]; then
    uninstall_hooks "$REPO_PATH"
else
    install_hooks "$REPO_PATH"
fi
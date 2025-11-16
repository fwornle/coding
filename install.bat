@echo off
REM ============================================================================
REM Claude Knowledge Management System - Comprehensive Windows Installation
REM ============================================================================
REM This script provides full automated installation matching install.sh
REM Requirements: Node.js, npm, Git, Python, Git Bash

setlocal enabledelayedexpansion

REM Color codes for Windows console
set "GREEN=[92m"
set "YELLOW=[93m"
set "RED=[91m"
set "BLUE=[94m"
set "NC=[0m"

echo.
echo ============================================================================
echo Claude Knowledge Management System - Windows Installation
echo ============================================================================
echo.

REM ============================================================================
REM 1. DEPENDENCY CHECKING
REM ============================================================================

echo %BLUE%[1/12] Checking dependencies...%NC%
echo.

REM Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo %RED%ERROR: Node.js is not installed!%NC%
    echo Please download and install Node.js from https://nodejs.org/
    echo Recommended version: v18 or higher
    echo.
    pause
    exit /b 1
)

REM Check Node version
for /f "tokens=*" %%v in ('node --version') do set NODE_VERSION=%%v
echo %GREEN%[OK]%NC% Node.js %NODE_VERSION% found

REM Check for npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo %RED%ERROR: npm is not installed!%NC%
    echo npm should come with Node.js installation.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('npm --version') do set NPM_VERSION=%%v
echo %GREEN%[OK]%NC% npm %NPM_VERSION% found

REM Check for Git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo %RED%ERROR: Git is not installed!%NC%
    echo Please download and install Git from https://git-scm.com/downloads
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('git --version') do set GIT_VERSION=%%v
echo %GREEN%[OK]%NC% %GIT_VERSION%

REM Check for Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo %RED%ERROR: Python is not installed!%NC%
    echo Please download and install Python from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('python --version') do set PYTHON_VERSION=%%v
echo %GREEN%[OK]%NC% %PYTHON_VERSION% found

REM Check for Git Bash
where bash >nul 2>nul
if %errorlevel% neq 0 (
    echo %YELLOW%WARNING: Git Bash not found in PATH%NC%
    echo Git Bash is required for the 'coding' command to work properly.
    echo Please ensure Git for Windows is installed with Git Bash.
    echo.
)

echo.
echo %GREEN%All required dependencies found!%NC%
echo.

REM ============================================================================
REM 2. SET INSTALLATION PATHS
REM ============================================================================

set CODING_REPO=%~dp0
set CODING_REPO=%CODING_REPO:~0,-1%

REM Convert to forward slashes for cross-platform compatibility
set CODING_REPO_UNIX=%CODING_REPO:\=/%

echo %BLUE%[2/12] Installation directory:%NC%
echo   %CODING_REPO%
echo.

REM ============================================================================
REM 3. INSTALL MAIN PROJECT DEPENDENCIES
REM ============================================================================

echo %BLUE%[3/12] Installing main project dependencies...%NC%
cd /d "%CODING_REPO%"
call npm install
if %errorlevel% neq 0 (
    echo %RED%ERROR: Failed to install main project dependencies%NC%
    pause
    exit /b 1
)
echo %GREEN%[OK]%NC% Main project dependencies installed
echo.

REM ============================================================================
REM 4. INSTALL LIB/KNOWLEDGE-API DEPENDENCIES
REM ============================================================================

echo %BLUE%[4/12] Installing knowledge-api dependencies...%NC%
if exist "%CODING_REPO%\lib\knowledge-api" (
    cd /d "%CODING_REPO%\lib\knowledge-api"
    call npm install
    if %errorlevel% neq 0 (
        echo %RED%ERROR: Failed to install knowledge-api dependencies%NC%
        pause
        exit /b 1
    )
    echo %GREEN%[OK]%NC% Knowledge-api dependencies installed
) else (
    echo %YELLOW%WARNING: lib/knowledge-api directory not found, skipping%NC%
)
echo.

REM ============================================================================
REM 5. INSTALL LIB/VKB-SERVER DEPENDENCIES
REM ============================================================================

echo %BLUE%[5/12] Installing vkb-server dependencies...%NC%
if exist "%CODING_REPO%\lib\vkb-server" (
    cd /d "%CODING_REPO%\lib\vkb-server"
    call npm install
    if %errorlevel% neq 0 (
        echo %RED%ERROR: Failed to install vkb-server dependencies%NC%
        pause
        exit /b 1
    )
    echo %GREEN%[OK]%NC% VKB-server dependencies installed
) else (
    echo %YELLOW%WARNING: lib/vkb-server directory not found, skipping%NC%
)
echo.

REM ============================================================================
REM 6. CLONE AND BUILD MEMORY-VISUALIZER
REM ============================================================================

echo %BLUE%[6/12] Setting up memory-visualizer...%NC%
cd /d "%CODING_REPO%"

if not exist "%CODING_REPO%\integrations\memory-visualizer" (
    mkdir integrations 2>nul
    echo Cloning memory-visualizer from fwornle fork...
    git clone https://github.com/fwornle/memory-visualizer.git "%CODING_REPO%\integrations\memory-visualizer"
    if %errorlevel% neq 0 (
        echo %RED%ERROR: Failed to clone memory-visualizer%NC%
        pause
        exit /b 1
    )
) else (
    echo Memory-visualizer directory exists, updating...
    cd /d "%CODING_REPO%\integrations\memory-visualizer"
    git pull
)

cd /d "%CODING_REPO%\integrations\memory-visualizer"
echo Installing memory-visualizer dependencies...
call npm install
if %errorlevel% neq 0 (
    echo %RED%ERROR: Failed to install memory-visualizer dependencies%NC%
    pause
    exit /b 1
)

echo Building memory-visualizer...
call npm run build
if %errorlevel% neq 0 (
    echo %RED%ERROR: Failed to build memory-visualizer%NC%
    pause
    exit /b 1
)

echo %GREEN%[OK]%NC% Memory-visualizer installed and built
echo.

REM ============================================================================
REM 7. INSTALL MCP SERVERS
REM ============================================================================

echo %BLUE%[7/12] Installing MCP servers...%NC%
cd /d "%CODING_REPO%"

REM Install browser-access MCP server
if exist "%CODING_REPO%\browser-access" (
    echo Installing browser-access MCP server...
    cd /d "%CODING_REPO%\browser-access"
    call npm install
    call npm run build
    echo %GREEN%[OK]%NC% Browser-access MCP server installed
    echo.
)

REM Install claude-logger MCP server
if exist "%CODING_REPO%\claude-logger-mcp" (
    echo Installing claude-logger MCP server...
    cd /d "%CODING_REPO%\claude-logger-mcp"
    call npm install
    call npm run build
    echo %GREEN%[OK]%NC% Claude-logger MCP server installed
    echo.
)

REM Install semantic-analysis MCP server
if exist "%CODING_REPO%\semantic-analysis" (
    echo Installing semantic-analysis MCP server...
    cd /d "%CODING_REPO%\semantic-analysis"
    call npm install
    call npm run build
    echo %GREEN%[OK]%NC% Semantic-analysis MCP server installed
    echo.
)

REM Install serena MCP server
if exist "%CODING_REPO%\serena" (
    echo Installing serena MCP server...
    cd /d "%CODING_REPO%\serena"
    call npm install
    call npm run build
    echo %GREEN%[OK]%NC% Serena MCP server installed
    echo.
)

REM Install browserbase MCP server
if exist "%CODING_REPO%\browserbase" (
    echo Installing browserbase MCP server...
    cd /d "%CODING_REPO%\browserbase"
    call npm install
    call npm run build
    echo %GREEN%[OK]%NC% Browserbase MCP server installed
    echo.
)

REM Install constraint-monitor MCP server
if exist "%CODING_REPO%\constraint-monitor" (
    echo Installing constraint-monitor MCP server...
    cd /d "%CODING_REPO%\constraint-monitor"
    call npm install
    call npm run build
    echo %GREEN%[OK]%NC% Constraint-monitor MCP server installed
    echo.
)

echo MCP server installation complete
echo.

REM ============================================================================
REM 8. CREATE .ENV FILE
REM ============================================================================

echo %BLUE%[8/12] Creating .env configuration...%NC%
cd /d "%CODING_REPO%"

if not exist "%CODING_REPO%\.env" (
    echo Creating .env file with Windows paths...
    (
        echo # Claude Knowledge Management System - Environment Variables
        echo.
        echo # API Keys - Add your API keys here
        echo # XAI_API_KEY=your_key_here
        echo # OPENAI_API_KEY=your_key_here
        echo # GROQ_API_KEY=your_key_here
        echo # ANTHROPIC_API_KEY=your_key_here
        echo.
        echo # For browser-access MCP server ^(optional^)
        echo # BROWSERBASE_API_KEY=your_key_here
        echo # BROWSERBASE_PROJECT_ID=your_project_id
        echo.
        echo LOCAL_CDP_URL=ws://localhost:9222
        echo.
        echo # Primary coding tools path
        echo CODING_TOOLS_PATH=%CODING_REPO_UNIX%
        echo.
        echo # Knowledge Base path
        echo CODING_KB_PATH=%CODING_REPO_UNIX%
        echo.
        echo # Default knowledge views to display
        echo KNOWLEDGE_VIEW=coding,ui
        echo.
        echo # Database Configuration
        echo QDRANT_URL=http://localhost:6333
        echo SQLITE_PATH=%CODING_REPO_UNIX%/.data/knowledge.db
    ) > .env
    echo %GREEN%[OK]%NC% .env file created
) else (
    echo .env file already exists, skipping creation
    echo %YELLOW%NOTE:%NC% You may need to update paths manually if they are incorrect
)
echo.

REM ============================================================================
REM 9. CREATE COMMAND WRAPPERS
REM ============================================================================

echo %BLUE%[9/12] Creating command wrappers...%NC%
cd /d "%CODING_REPO%"

REM Create bin directory
mkdir "%CODING_REPO%\bin" 2>nul

REM Create ukb.bat wrapper (self-detecting)
(
    echo @echo off
    echo setlocal
    echo.
    echo REM Get the directory where this batch file is located
    echo set "SCRIPT_DIR=%%~dp0"
    echo REM Remove trailing backslash
    echo set "SCRIPT_DIR=%%SCRIPT_DIR:~0,-1%%"
    echo REM Get parent directory ^(coding repo root^)
    echo for %%%%I in ^("%%SCRIPT_DIR%%\..") do set "CODING_REPO=%%%%~fI"
    echo.
    echo bash "%%CODING_REPO%%\knowledge-management\ukb" %%*
) > "%CODING_REPO%\bin\ukb.bat"

REM Create vkb.bat wrapper (self-detecting)
(
    echo @echo off
    echo setlocal
    echo.
    echo REM Get the directory where this batch file is located
    echo set "SCRIPT_DIR=%%~dp0"
    echo REM Remove trailing backslash
    echo set "SCRIPT_DIR=%%SCRIPT_DIR:~0,-1%%"
    echo REM Get parent directory ^(coding repo root^)
    echo for %%%%I in ^("%%SCRIPT_DIR%%\..") do set "CODING_REPO=%%%%~fI"
    echo.
    echo bash "%%CODING_REPO%%\knowledge-management\vkb" %%*
) > "%CODING_REPO%\bin\vkb.bat"

REM Create coding.bat wrapper (self-detecting)
(
    echo @echo off
    echo setlocal
    echo.
    echo REM Get the directory where this batch file is located
    echo set "SCRIPT_DIR=%%~dp0"
    echo REM Remove trailing backslash
    echo set "SCRIPT_DIR=%%SCRIPT_DIR:~0,-1%%"
    echo REM Get parent directory ^(coding repo root^)
    echo for %%%%I in ^("%%SCRIPT_DIR%%\..") do set "CODING_REPO=%%%%~fI"
    echo.
    echo REM Export for the bash script
    echo set "CODING_REPO=%%CODING_REPO%%"
    echo.
    echo bash "%%CODING_REPO%%\bin\coding" %%*
) > "%CODING_REPO%\bin\coding.bat"

echo %GREEN%[OK]%NC% Batch wrappers created in bin/
echo.

REM ============================================================================
REM 10. CREATE UKB BASH WRAPPER IN KNOWLEDGE-MANAGEMENT
REM ============================================================================

echo %BLUE%[10/12] Creating ukb bash wrapper...%NC%

if not exist "%CODING_REPO%\knowledge-management\ukb" (
    echo Creating knowledge-management/ukb wrapper...
    (
        echo #!/bin/bash
        echo #
        echo # UKB Lightweight Script - Minimal wrapper for ukb-cli
        echo #
        echo # This lightweight script provides backward compatibility while
        echo # delegating all functionality to the new ukb-cli Node.js implementation.
        echo #
        echo.
        echo set -euo pipefail
        echo.
        echo # Get script directory and project root
        echo SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        echo PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
        echo UKB_CLI="$PROJECT_ROOT/bin/ukb-cli.js"
        echo.
        echo # Load environment variables from .env file if it exists
        echo if [[ -f "$PROJECT_ROOT/.env" ]]; then
        echo     set -a  # automatically export all variables
        echo     source "$PROJECT_ROOT/.env"
        echo     set +a
        echo fi
        echo.
        echo # Ensure Node.js and ukb-cli are available
        echo if ! command -v node ^>/dev/null 2^>^&1; then
        echo     echo "Error: Node.js is required but not installed" ^>^&2
        echo     exit 1
        echo fi
        echo.
        echo if [[ ! -f "$UKB_CLI" ]]; then
        echo     echo "Error: ukb-cli not found at $UKB_CLI" ^>^&2
        echo     exit 1
        echo fi
        echo.
        echo # Execute ukb-cli with all arguments
        echo exec node "$UKB_CLI" "$@"
    ) > "%CODING_REPO%\knowledge-management\ukb"
    echo %GREEN%[OK]%NC% ukb wrapper created
) else (
    echo ukb wrapper already exists
)
echo.

REM ============================================================================
REM 11. CONFIGURE ENVIRONMENT
REM ============================================================================

echo %BLUE%[11/12] Configuring environment...%NC%
echo.

REM ===== 11a. Configure Windows PATH =====
echo Configuring Windows PATH...

REM Check if bin directory is already in PATH
echo %PATH% | findstr /C:"%CODING_REPO%\bin" >nul 2>nul
if %errorlevel% neq 0 (
    echo Adding %CODING_REPO%\bin to Windows PATH...
    setx PATH "%PATH%;%CODING_REPO%\bin" >nul 2>nul
    if %errorlevel% equ 0 (
        echo %GREEN%[OK]%NC% Added to Windows PATH
        echo %YELLOW%NOTE:%NC% You may need to restart your terminal for PATH changes to take effect
    ) else (
        echo %YELLOW%WARNING:%NC% Failed to automatically add to PATH
        echo Please add manually: %CODING_REPO%\bin
    )
) else (
    echo %GREEN%[OK]%NC% Already in Windows PATH
)
echo.

REM ===== 11b. Configure Git Bash Environment =====
echo Configuring Git Bash environment...

REM Create configuration snippet
set BASH_CONFIG_FILE=%USERPROFILE%\.bash_profile

if exist "%BASH_CONFIG_FILE%" (
    findstr /C:"CODING_REPO" "%BASH_CONFIG_FILE%" >nul 2>nul
    if %errorlevel% neq 0 (
        echo Adding coding configuration to ~/.bash_profile...
        (
            echo.
            echo # Claude Knowledge Management System
            echo export CODING_REPO="%CODING_REPO_UNIX%"
            echo export PATH="%CODING_REPO_UNIX%/bin:$PATH"
        ) >> "%BASH_CONFIG_FILE%"
        echo %GREEN%[OK]%NC% Configuration added to ~/.bash_profile
    ) else (
        echo Configuration already exists in ~/.bash_profile
    )
) else (
    echo Creating ~/.bash_profile...
    (
        echo # Claude Knowledge Management System
        echo export CODING_REPO="%CODING_REPO_UNIX%"
        echo export PATH="%CODING_REPO_UNIX%/bin:$PATH"
    ) > "%BASH_CONFIG_FILE%"
    echo %GREEN%[OK]%NC% ~/.bash_profile created with coding configuration
)
echo.

REM ============================================================================
REM 12. CREATE CLAUDE CODE SETTINGS
REM ============================================================================

echo %BLUE%[12/13] Creating Claude Code settings...%NC%
cd /d "%CODING_REPO%"

REM Create .claude directory if needed
mkdir "%CODING_REPO%\.claude" 2>nul

REM Create settings.local.json with Windows-compatible paths
echo Creating .claude/settings.local.json...
(
    echo {
    echo   "permissions": {
    echo     "allow": [
    echo       "Bash(npm run api:*)",
    echo       "mcp__serena__find_symbol",
    echo       "mcp__serena__search_for_pattern",
    echo       "Bash(TRANSCRIPT_DEBUG=true node scripts/enhanced-transcript-monitor.js --test)",
    echo       "Bash(node:*)",
    echo       "Bash(plantuml:*)",
    echo       "mcp__serena__check_onboarding_performed",
    echo       "Bash(bin/coding:*)",
    echo       "Bash(cp:*)",
    echo       "mcp__serena__find_file",
    echo       "mcp__serena__replace_symbol_body",
    echo       "mcp__serena__activate_project",
    echo       "mcp__serena__get_symbols_overview",
    echo       "Bash(cat:*)",
    echo       "Bash(timeout:*)",
    echo       "Bash(watch:*)",
    echo       "mcp__serena__list_dir",
    echo       "mcp__serena__insert_after_symbol",
    echo       "Bash(find:*)",
    echo       "Bash(CODING_REPO=%CODING_REPO% node %CODING_REPO%\\scripts\\combined-status-line.js)",
    echo       "Bash(kill:*)",
    echo       "Bash(pkill:*)",
    echo       "Bash(grep:*)",
    echo       "Bash(lsof:*)",
    echo       "Bash(curl:*)",
    echo       "Bash(PORT=3030 npm run dev)",
    echo       "mcp__serena__insert_before_symbol",
    echo       "mcp__constraint-monitor__check_constraints",
    echo       "Bash(npm start)",
    echo       "Bash(git rm:*)",
    echo       "Bash(npm run:*)",
    echo       "Bash(chmod:*)",
    echo       "Bash(./test-individual-constraints.sh:*)",
    echo       "Bash(docker stop:*)",
    echo       "Bash(docker rm:*)",
    echo       "Bash(docker-compose up:*)",
    echo       "Bash(docker logs:*)",
    echo       "Bash(docker restart:*)",
    echo       "Bash(PORT=3031 npm run api)",
    echo       "Bash(git checkout:*)",
    echo       "Bash(xargs kill:*)",
    echo       "mcp__mcp-git-ingest__git_directory_structure",
    echo       "mcp__mcp-git-ingest__git_read_important_files",
    echo       "WebSearch",
    echo       "Bash(git remote get-url:*)",
    echo       "Bash(basename:*)",
    echo       "mcp__spec-workflow__spec-workflow-guide",
    echo       "mcp__spec-workflow__approvals",
    echo       "Bash(PORT=3030 npm run dashboard)",
    echo       "Bash(sort:*)",
    echo       "mcp__serena__think_about_task_adherence",
    echo       "Bash(awk:*)",
    echo       "Bash(PORT=3031 node src/dashboard-server.js)",
    echo       "mcp__serena__onboarding",
    echo       "mcp__serena__write_memory",
    echo       "Bash(jq:*)",
    echo       "mcp__serena__think_about_collected_information",
    echo       "mcp__serena__get_current_config",
    echo       "Bash(npm install:*)",
    echo       "Read(//C:/Users/%USERNAME%/.claude/**)",
    echo       "WebFetch(domain:console.groq.com)",
    echo       "Read(//private/tmp/**)",
    echo       "Bash(./collect-test-results.js)",
    echo       "WebFetch(domain:github.com)",
    echo       "Bash(sqlite3 .data/knowledge.db \"SELECT source, COUNT(*) as count FROM knowledge_extractions GROUP BY source\")",
    echo       "Bash(sqlite3 .data/knowledge.db \"PRAGMA table_info(knowledge_extractions)\")",
    echo       "mcp__memory__read_graph",
    echo       "Bash(vkb restart:*)",
    echo       "Bash(bin/vkb restart:*)",
    echo       "Bash(ps:*)",
    echo       "Bash(git submodule:*)",
    echo       "mcp__serena__find_referencing_symbols",
    echo       "Bash(git config:*)",
    echo       "Bash(git restore:*)",
    echo       "Bash(git diff:*)",
    echo       "Bash(xargs -I {} git restore --source=HEAD {})",
    echo       "WebFetch(domain:claude.ai)",
    echo       "mcp__constraint-monitor__get_constraint_status",
    echo       "Bash(for coll in ontology-coding ontology-raas ontology-resi ontology-agentic ontology-ui)",
    echo       "Bash(do echo -n \"$coll: \")",
    echo       "Bash(done)",
    echo       "Bash(npm test:*)",
    echo       "Bash(docker info:*)",
    echo       "Bash(bash %CODING_REPO%\\bin\\ukb:*)",
    echo       "Bash(bin/ukb:*)",
    echo       "Bash(bin/vkb:*)",
    echo       "Bash(SYSTEM_HEALTH_API_PORT=3033 pnpm api:*)",
    echo       "mcp__serena__initial_instructions",
    echo       "Bash(git add:*)",
    echo       "Bash(git commit:*)",
    echo       "Bash(rm:*)",
    echo       "Bash(npm view:*)",
    echo       "Bash(while read name)",
    echo       "Bash(do [ ! -f \"docs/presentation/images/$name.png\" ])",
    echo       "Bash(echo:*)",
    echo       "Bash(git fetch:*)"
    echo     ],
    echo     "deny": [],
    echo     "ask": []
    echo   },
    echo   "hooks": {
    echo     "UserPromptSubmit": [
    echo       {
    echo         "hooks": [
    echo           {
    echo             "type": "command",
    echo             "command": "node %CODING_REPO%\\integrations\\mcp-constraint-monitor\\src\\hooks\\pre-prompt-hook-wrapper.js"
    echo           }
    echo         ]
    echo       }
    echo     ],
    echo     "PreToolUse": [
    echo       {
    echo         "hooks": [
    echo           {
    echo             "type": "command",
    echo             "command": "node %CODING_REPO%\\integrations\\mcp-constraint-monitor\\src\\hooks\\pre-tool-hook-wrapper.js"
    echo           }
    echo         ]
    echo       }
    echo     ]
    echo   },
    echo   "statusLine": {
    echo     "type": "command",
    echo     "command": "CODING_REPO=%CODING_REPO% node %CODING_REPO%\\scripts\\combined-status-line.js"
    echo   }
    echo }
) > "%CODING_REPO%\.claude\settings.local.json"

echo %GREEN%[OK]%NC% Claude Code settings created
echo.

REM ============================================================================
REM 13. INITIALIZE KNOWLEDGE DATABASES
REM ============================================================================

echo %BLUE%[13/13] Initializing knowledge databases and log directories...%NC%

REM Create .data directory
mkdir "%CODING_REPO%\.data" 2>nul
mkdir "%CODING_REPO%\.data\knowledge-graph" 2>nul

REM Create .logs directory for system monitoring
mkdir "%CODING_REPO%\.logs" 2>nul

REM Initialize shared memory if needed
if not exist "%CODING_REPO%\shared-memory.json" (
    echo Creating initial shared-memory.json...
    (
        echo {
        echo   "entities": [],
        echo   "relations": [],
        echo   "metadata": {
        echo     "version": "1.0.0",
        echo     "created": "%date% %time%",
        echo     "contributors": [],
        echo     "total_entities": 0,
        echo     "total_relations": 0
        echo   }
        echo }
    ) > "%CODING_REPO%\shared-memory.json"
    echo %GREEN%[OK]%NC% shared-memory.json created
) else (
    echo shared-memory.json already exists
)

echo %GREEN%[OK]%NC% Knowledge databases initialized
echo.

REM ============================================================================
REM INSTALLATION COMPLETE
REM ============================================================================

echo.
echo ============================================================================
echo %GREEN%Installation completed successfully!%NC%
echo ============================================================================
echo.
echo %YELLOW%NEXT STEPS:%NC%
echo.
echo %BLUE%Step 1: Restart Your Terminal%NC%
echo   - Windows PATH has been automatically configured
echo   - Close and reopen your terminal (CMD/PowerShell/Git Bash) for changes to take effect
echo.
echo %BLUE%Step 2: Configure API Keys (Optional)%NC%
echo   - Edit %CODING_REPO%\.env
echo   - Add your API keys for AI services you plan to use
echo.
echo %BLUE%Available Commands:%NC%
echo   - ukb          : Update Knowledge Base
echo   - vkb          : View Knowledge Base (starts server on port 8080)
echo   - coding       : Main coding command (starts all services)
echo.
echo %BLUE%Testing Installation:%NC%
echo   1. Open a new Git Bash window
echo   2. Run: coding --help
echo   3. Run: vkb status
echo.
echo %YELLOW%Note:%NC% For Git Bash, you may need to restart your terminal
echo       or run 'source ~/.bash_profile' for PATH changes to take effect
echo.
echo For more information, see the documentation in the coding directory.
echo.
pause

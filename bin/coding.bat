@echo off
REM coding runs on Windows through WSL only (no native Windows install).
REM Open your WSL distribution and run `coding` there:
REM     wsl
REM     cd ~/Agentic/coding ^&^& ./install.sh
echo coding does not run natively on Windows. Use WSL:
echo.
echo   1. Install WSL (once):        wsl --install
echo   2. Open your distribution:    wsl
echo   3. Clone and install there:   git clone ^<coding repo^> ^&^& cd coding ^&^& ./install.sh
echo   4. Then start agents with:    coding
echo.
echo Details: docs/getting-started.md (Windows section)
exit /b 1

@echo off
setlocal

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"
REM Remove trailing backslash
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
REM Get parent directory (coding repo root)
for %%I in ("%SCRIPT_DIR%\..") do set "CODING_REPO=%%~fI"

REM Export for the bash script
set "CODING_REPO=%CODING_REPO%"

bash "%CODING_REPO%\bin\coding" %*

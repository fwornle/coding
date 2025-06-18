# VKB (View Knowledge Base) - Linux Setup Guide

## Overview
The `vkb` command has been updated to be fully compatible with Linux systems. This guide covers the setup and usage on Linux.

## Prerequisites

### Required Dependencies
1. **Python 3**
   ```bash
   # Ubuntu/Debian
   sudo apt-get install python3
   
   # RHEL/CentOS/Fedora
   sudo yum install python3
   # or
   sudo dnf install python3
   
   # Arch Linux
   sudo pacman -S python
   ```

2. **jq (JSON processor)**
   ```bash
   # Ubuntu/Debian
   sudo apt-get install jq
   
   # RHEL/CentOS/Fedora
   sudo yum install jq
   # or
   sudo dnf install jq
   
   # Arch Linux
   sudo pacman -S jq
   ```

3. **Port checking utility** (at least one of these):
   - `lsof` (recommended)
     ```bash
     # Ubuntu/Debian
     sudo apt-get install lsof
     
     # RHEL/CentOS/Fedora
     sudo yum install lsof
     ```
   - `ss` (usually pre-installed with iproute2)
   - `netstat` (part of net-tools package)

### Optional Dependencies
- **xdg-utils** (for automatic browser opening)
  ```bash
  # Usually pre-installed, but if needed:
  sudo apt-get install xdg-utils
  ```

## Installation

1. Clone the repository and run the install script:
   ```bash
   ./install.sh
   ```

2. Source the activation script:
   ```bash
   source .activate
   ```

## Usage

### Start the visualization server
```bash
vkb
# or
vkb start
```

### Stop the server
```bash
vkb stop
```

### Check server status
```bash
vkb status
```

### View server logs
```bash
vkb logs
```

### Restart the server
```bash
vkb restart
```

## Troubleshooting

### Port Already in Use
If port 8080 is already in use:
1. Stop the existing vkb server: `vkb stop`
2. If that doesn't work, find the process: `lsof -i :8080` or `ss -tlnp | grep 8080`
3. Kill the process manually if needed

### Browser Doesn't Open Automatically
- The server will still start successfully
- Manually open: http://localhost:8080
- Install xdg-utils if you want automatic browser opening

### Permission Errors
- The script uses `/tmp` for PID and log files, which should be writable
- If you get permission errors, check that you can write to `/tmp`

### Missing Dependencies
The script will check for required dependencies and provide clear error messages if any are missing.

## Linux-Specific Features

1. **Multiple port checking methods**: The script will try `lsof`, `ss`, and `netstat` in that order
2. **Terminal detection**: Colors are automatically disabled if not in a terminal
3. **Path resolution**: No hardcoded paths - works from any location within the repository
4. **Browser compatibility**: Uses `xdg-open` for Linux browser opening

## Log Files

- Server logs: `/tmp/vkb-server.log`
- PID file: `/tmp/vkb-server.pid`

These files are automatically cleaned up when the server stops properly.
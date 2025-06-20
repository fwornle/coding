import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

/**
 * Check if a command exists in the system PATH
 * @param {string} command - Command to check
 * @returns {Promise<boolean>} - True if command exists
 */
async function commandExists(command) {
  try {
    const checkCommand = process.platform === 'win32' ? 'where' : 'which';
    await execAsync(`${checkCommand} ${command}`);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if a file exists, expanding ~ to home directory
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} - True if file exists
 */
async function fileExists(filePath) {
  try {
    const expandedPath = filePath.replace(/^~/, os.homedir());
    await fs.access(expandedPath);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Execute a command and return the output
 * @param {string} command - Command to execute
 * @returns {Promise<string>} - Command output
 */
async function executeCommand(command) {
  try {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

/**
 * Find files matching a glob pattern
 * @param {string} pattern - Glob pattern
 * @returns {Promise<string[]>} - Array of matching file paths
 */
async function glob(pattern) {
  try {
    const { glob: globAsync } = await import('glob');
    const files = await globAsync(pattern);
    return files;
  } catch (error) {
    return [];
  }
}

/**
 * Get VSCode extensions directory path
 * @returns {string} - Path to VSCode extensions
 */
function getVSCodeExtensionsPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.USERPROFILE, '.vscode', 'extensions');
  }
  return path.join(os.homedir(), '.vscode', 'extensions');
}

export {
  commandExists,
  fileExists,
  executeCommand,
  glob,
  getVSCodeExtensionsPath
};
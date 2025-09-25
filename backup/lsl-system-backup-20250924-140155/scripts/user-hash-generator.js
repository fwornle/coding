#!/usr/bin/env node

/**
 * User Hash Generator - Secure USER Environment Variable Hashing
 * 
 * Generates 6-character deterministic hashes from USER environment variable
 * for multi-user filename collision prevention in Live Session Logging system.
 * 
 * Features:
 * - SHA-256 based cryptographic hashing
 * - 6-character deterministic output
 * - Fallback to machine hostname if USER not available
 * - No sensitive data leakage
 * - Comprehensive error handling
 */

import crypto from 'crypto';
import os from 'os';

class UserHashGenerator {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.saltPrefix = options.saltPrefix || 'lsl-user-hash';
  }

  /**
   * Generate a 6-character hash from USER environment variable
   * Falls back to hostname if USER is not available
   * @returns {string} 6-character deterministic hash
   */
  generateUserHash() {
    try {
      // Get user identifier with fallback chain
      const userIdentifier = this.getUserIdentifier();
      
      // Create deterministic hash
      const hash = this.createDeterministicHash(userIdentifier);
      
      this.log(`Generated user hash: ${hash} (from: ${userIdentifier})`);
      return hash;
      
    } catch (error) {
      console.error('Error generating user hash:', error.message);
      // Emergency fallback - use a safe default
      return this.createDeterministicHash('fallback-user');
    }
  }

  /**
   * Get user identifier with fallback strategy
   * Priority: USER -> USERNAME -> LOGNAME -> hostname -> 'unknown'
   * @returns {string} User identifier for hashing
   */
  getUserIdentifier() {
    // Try different environment variables in order of preference
    const userEnvVars = ['USER', 'USERNAME', 'LOGNAME'];
    
    for (const envVar of userEnvVars) {
      const value = process.env[envVar];
      if (value && value.trim() && value !== 'undefined') {
        this.log(`Using ${envVar}: ${value}`);
        return value.trim();
      }
    }
    
    // Fallback to hostname
    try {
      const hostname = os.hostname();
      if (hostname && hostname.trim()) {
        this.log(`Fallback to hostname: ${hostname}`);
        return hostname.trim();
      }
    } catch (error) {
      this.log(`Hostname fallback failed: ${error.message}`);
    }
    
    // Final fallback
    this.log('Using final fallback: unknown-user');
    return 'unknown-user';
  }

  /**
   * Create a deterministic 6-character hash using SHA-256
   * @param {string} input - Input string to hash
   * @returns {string} 6-character hash
   */
  createDeterministicHash(input) {
    if (!input || typeof input !== 'string') {
      throw new Error('Input must be a non-empty string');
    }

    // Create salted input to prevent rainbow table attacks
    const saltedInput = `${this.saltPrefix}-${input}-${this.saltPrefix}`;
    
    // Generate SHA-256 hash
    const hash = crypto.createHash('sha256')
      .update(saltedInput, 'utf8')
      .digest('hex');
    
    // Take first 6 characters for filename safety
    const shortHash = hash.substring(0, 6);
    
    // Ensure it starts with a letter (filesystem safety)
    const safeHash = this.ensureAlphaStart(shortHash);
    
    this.log(`Hash generation: ${input} -> ${saltedInput} -> ${hash} -> ${safeHash}`);
    return safeHash;
  }

  /**
   * Ensure hash starts with a letter for filesystem safety
   * @param {string} hash - 6-character hash
   * @returns {string} Hash starting with a letter
   */
  ensureAlphaStart(hash) {
    if (!hash || hash.length !== 6) {
      throw new Error('Hash must be exactly 6 characters');
    }

    // If first character is not a letter, map it to a letter
    const firstChar = hash[0];
    if (!/[a-zA-Z]/.test(firstChar)) {
      // Map digits and other characters to letters deterministically
      const charMap = {
        '0': 'a', '1': 'b', '2': 'c', '3': 'd', '4': 'e',
        '5': 'f', '6': 'g', '7': 'h', '8': 'i', '9': 'j'
      };
      
      const mappedChar = charMap[firstChar] || 'x';
      return mappedChar + hash.substring(1);
    }
    
    return hash.toLowerCase();
  }

  /**
   * Validate that a hash meets requirements
   * @param {string} hash - Hash to validate
   * @returns {boolean} True if valid
   */
  validateHash(hash) {
    if (!hash || typeof hash !== 'string') {
      return false;
    }
    
    // Must be exactly 6 characters
    if (hash.length !== 6) {
      return false;
    }
    
    // Must start with a letter
    if (!/^[a-zA-Z]/.test(hash)) {
      return false;
    }
    
    // Must contain only alphanumeric characters
    if (!/^[a-zA-Z0-9]+$/.test(hash)) {
      return false;
    }
    
    return true;
  }

  /**
   * Test hash consistency - same input should always produce same output
   * @param {string} input - Test input
   * @param {number} iterations - Number of test iterations
   * @returns {boolean} True if consistent
   */
  testConsistency(input = null, iterations = 10) {
    const testInput = input || this.getUserIdentifier();
    const firstHash = this.createDeterministicHash(testInput);
    
    for (let i = 1; i < iterations; i++) {
      const currentHash = this.createDeterministicHash(testInput);
      if (currentHash !== firstHash) {
        this.log(`Consistency test failed: ${firstHash} !== ${currentHash}`);
        return false;
      }
    }
    
    this.log(`Consistency test passed: ${iterations} iterations of "${firstHash}"`);
    return true;
  }

  /**
   * Get comprehensive system information for debugging
   * @returns {object} System information
   */
  getSystemInfo() {
    return {
      userIdentifier: this.getUserIdentifier(),
      userHash: this.generateUserHash(),
      environment: {
        USER: process.env.USER || 'undefined',
        USERNAME: process.env.USERNAME || 'undefined',
        LOGNAME: process.env.LOGNAME || 'undefined',
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch()
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Debug logging
   * @param {string} message - Log message
   */
  log(message) {
    if (this.debug) {
      console.log(`[UserHashGenerator] ${message}`);
    }
  }
}

// Static convenience method
UserHashGenerator.generateHash = function(options = {}) {
  const generator = new UserHashGenerator(options);
  return generator.generateUserHash();
};

// Static method to get system info
UserHashGenerator.getSystemInfo = function(options = {}) {
  const generator = new UserHashGenerator(options);
  return generator.getSystemInfo();
};

export default UserHashGenerator;

// CLI usage when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const generator = new UserHashGenerator({ debug: true });
  
  console.log('=== User Hash Generator Test ===');
  console.log('System Info:', JSON.stringify(generator.getSystemInfo(), null, 2));
  console.log('Consistency Test:', generator.testConsistency());
  console.log('Generated Hash:', generator.generateUserHash());
}
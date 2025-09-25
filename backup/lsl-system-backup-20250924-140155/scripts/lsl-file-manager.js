#!/usr/bin/env node

/**
 * Live Session Logging (LSL) File Manager
 * 
 * Manages session log files with automatic rotation, compression, and redaction
 * Integrates with the Enhanced Redaction System for security
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const EnhancedRedactionSystem = require('./enhanced-redaction-system');

class LSLFileManager {
    constructor(options = {}) {
        this.projectPath = options.projectPath || process.cwd();
        this.userHash = options.userHash || 'default';
        this.debug = options.debug || false;
        
        // File management settings
        this.maxFileSize = options.maxFileSize || 100 * 1024 * 1024; // 100MB
        this.enableAutoRotation = options.enableAutoRotation !== false;
        this.enableCompression = options.enableCompression !== false;
        this.enableArchiving = options.enableArchiving !== false;
        this.maxArchiveAge = options.maxArchiveAge || 30 * 24 * 60 * 60 * 1000; // 30 days
        
        // Enhanced security and privacy with new redaction system
        this.enableRedaction = options.enableRedaction !== false;
        this.enhancedRedaction = new EnhancedRedactionSystem({
            debug: this.debug,
            strictMode: options.strictRedaction !== false
        });
        
        // Statistics
        this.stats = {
            filesCreated: 0,
            filesRotated: 0,
            filesCompressed: 0,
            filesArchived: 0,
            redactionApplied: 0,
            securityEvents: 0
        };
        
        // Ensure directories exist
        this.ensureDirectories();
    }
    
    ensureDirectories() {
        const dirs = [
            this.getLogsDirectory(),
            this.getArchiveDirectory(),
            this.getTempDirectory()
        ];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                if (this.debug) {
                    console.log(`[LSL File Manager] Created directory: ${dir}`);
                }
            }
        });
    }
    
    getLogsDirectory() {
        return path.join(this.projectPath, '.lsl', 'logs');
    }
    
    getArchiveDirectory() {
        return path.join(this.projectPath, '.lsl', 'archive');
    }
    
    getTempDirectory() {
        return path.join(this.projectPath, '.lsl', 'temp');
    }
    
    getCurrentLogFile() {
        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const filename = `lsl-${timestamp}-USER-${this.userHash}.jsonl`;
        return path.join(this.getLogsDirectory(), filename);
    }
    
    async writeLogEntry(entry) {
        try {
            const logFile = this.getCurrentLogFile();
            
            // Apply redaction to entry content
            const processedEntry = this.applyRedaction(entry);
            
            // Check if rotation is needed
            if (this.enableAutoRotation && await this.shouldRotateFile(logFile)) {
                await this.rotateFile(logFile);
            }
            
            // Write entry
            const logLine = JSON.stringify(processedEntry) + '\n';
            await fs.promises.appendFile(logFile, logLine, 'utf8');
            
            if (this.debug) {
                console.log(`[LSL File Manager] Logged entry to: ${logFile}`);
            }
            
            return { success: true, file: logFile };
            
        } catch (error) {
            console.error('[LSL File Manager] Write error:', error);
            return { success: false, error: error.message };
        }
    }
    
    applyRedaction(entry) {
        if (!this.enableRedaction || !entry) {
            return entry;
        }

        try {
            // Create a deep copy to avoid modifying original
            const processedEntry = JSON.parse(JSON.stringify(entry));
            
            // Apply redaction to string fields
            const applyRedactionToValue = (value) => {
                if (typeof value === 'string') {
                    const result = this.enhancedRedaction.redact(value, {
                        includeLog: this.debug
                    });

                    // Log redaction statistics if debug mode
                    if (this.debug && result.redactionCount > 0) {
                        console.log(`[LSL File Manager] Enhanced redaction applied: ${result.redactionCount} redactions, security level: ${result.securityLevel}`);
                        
                        if (result.redactionLog) {
                            console.log('[LSL File Manager] Redaction patterns triggered:', 
                                result.redactionLog.map(r => `${r.category}.${r.pattern}`).join(', ')
                            );
                        }
                    }

                    // Track redaction statistics
                    this.stats.redactionApplied += result.redactionCount;
                    this.stats.securityEvents += result.securityLevel === 'MAXIMUM' ? 1 : 0;

                    return result.content;

                } else if (typeof value === 'object' && value !== null) {
                    // Recursively process objects
                    for (const key in value) {
                        value[key] = applyRedactionToValue(value[key]);
                    }
                }
                return value;
            };
            
            return applyRedactionToValue(processedEntry);

        } catch (error) {
            console.error('[LSL File Manager] Enhanced redaction failed, using fallback:', error);
            
            // Fallback to blocking content on redaction failure
            return {
                ...entry,
                content: '[REDACTION_SYSTEM_ERROR_CONTENT_BLOCKED]',
                redaction_error: true
            };
        }
    }
    
    async shouldRotateFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }
            
            const stats = await fs.promises.stat(filePath);
            return stats.size >= this.maxFileSize;
            
        } catch (error) {
            console.error('[LSL File Manager] Error checking file size:', error);
            return false;
        }
    }
    
    async rotateFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return;
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const rotatedPath = filePath.replace('.jsonl', `-rotated-${timestamp}.jsonl`);
            
            // Move current file to rotated name
            await fs.promises.rename(filePath, rotatedPath);
            
            // Optionally compress rotated file
            if (this.enableCompression) {
                await this.compressFile(rotatedPath);
            }
            
            this.stats.filesRotated++;
            
            if (this.debug) {
                console.log(`[LSL File Manager] Rotated file: ${filePath} -> ${rotatedPath}`);
            }
            
        } catch (error) {
            console.error('[LSL File Manager] Rotation error:', error);
        }
    }
    
    async compressFile(filePath) {
        try {
            const compressedPath = filePath + '.gz';
            
            const readStream = fs.createReadStream(filePath);
            const writeStream = fs.createWriteStream(compressedPath);
            const gzip = zlib.createGzip();
            
            await new Promise((resolve, reject) => {
                readStream
                    .pipe(gzip)
                    .pipe(writeStream)
                    .on('finish', resolve)
                    .on('error', reject);
            });
            
            // Remove original file after compression
            await fs.promises.unlink(filePath);
            
            this.stats.filesCompressed++;
            
            if (this.debug) {
                console.log(`[LSL File Manager] Compressed file: ${filePath} -> ${compressedPath}`);
            }
            
        } catch (error) {
            console.error('[LSL File Manager] Compression error:', error);
        }
    }
    
    async archiveOldFiles() {
        if (!this.enableArchiving) {
            return;
        }
        
        try {
            const logsDir = this.getLogsDirectory();
            const archiveDir = this.getArchiveDirectory();
            const cutoffDate = Date.now() - this.maxArchiveAge;
            
            const files = await fs.promises.readdir(logsDir);
            
            for (const file of files) {
                const filePath = path.join(logsDir, file);
                const stats = await fs.promises.stat(filePath);
                
                if (stats.mtime.getTime() < cutoffDate) {
                    const archivePath = path.join(archiveDir, file);
                    await fs.promises.rename(filePath, archivePath);
                    
                    this.stats.filesArchived++;
                    
                    if (this.debug) {
                        console.log(`[LSL File Manager] Archived file: ${filePath} -> ${archivePath}`);
                    }
                }
            }
            
        } catch (error) {
            console.error('[LSL File Manager] Archiving error:', error);
        }
    }
    
    async cleanup() {
        try {
            // Archive old files
            await this.archiveOldFiles();
            
            // Clean up temp directory
            const tempDir = this.getTempDirectory();
            if (fs.existsSync(tempDir)) {
                const tempFiles = await fs.promises.readdir(tempDir);
                for (const file of tempFiles) {
                    await fs.promises.unlink(path.join(tempDir, file));
                }
            }
            
            if (this.debug) {
                console.log('[LSL File Manager] Cleanup completed');
            }
            
        } catch (error) {
            console.error('[LSL File Manager] Cleanup error:', error);
        }
    }
    
    getStats() {
        return {
            ...this.stats,
            redactionStats: this.enhancedRedaction.getStats(),
            timestamp: new Date().toISOString()
        };
    }
    
    async getStatus() {
        try {
            const logsDir = this.getLogsDirectory();
            const currentLog = this.getCurrentLogFile();
            
            let currentLogSize = 0;
            let currentLogExists = false;
            
            if (fs.existsSync(currentLog)) {
                const stats = await fs.promises.stat(currentLog);
                currentLogSize = stats.size;
                currentLogExists = true;
            }
            
            const logFiles = fs.existsSync(logsDir) ? 
                await fs.promises.readdir(logsDir) : [];
            
            return {
                status: 'operational',
                currentLogFile: currentLog,
                currentLogExists,
                currentLogSize,
                totalLogFiles: logFiles.length,
                stats: this.getStats(),
                configuration: {
                    projectPath: this.projectPath,
                    userHash: this.userHash,
                    maxFileSize: this.maxFileSize,
                    enableAutoRotation: this.enableAutoRotation,
                    enableCompression: this.enableCompression,
                    enableArchiving: this.enableArchiving,
                    enableRedaction: this.enableRedaction
                }
            };
            
        } catch (error) {
            return {
                status: 'error',
                error: error.message
            };
        }
    }
}

// Export for use in other modules
module.exports = LSLFileManager;

// CLI usage when run directly
if (require.main === module) {
    const manager = new LSLFileManager({
        debug: true,
        projectPath: process.cwd()
    });
    
    // Test functionality
    (async () => {
        console.log('🔧 LSL File Manager Test');
        console.log('========================');
        
        // Test log entry
        const testEntry = {
            timestamp: new Date().toISOString(),
            type: 'test',
            content: 'Test entry with sensitive data: user@example.com and card 4532015112830366',
            metadata: { source: 'test' }
        };
        
        console.log('Writing test entry...');
        const result = await manager.writeLogEntry(testEntry);
        
        if (result.success) {
            console.log('✅ Test entry written successfully');
            console.log('📄 Log file:', result.file);
            
            // Show status
            const status = await manager.getStatus();
            console.log('\n📊 Manager Status:');
            console.log('  Status:', status.status);
            console.log('  Current log file:', status.currentLogFile);
            console.log('  Current log size:', status.currentLogSize, 'bytes');
            console.log('  Total log files:', status.totalLogFiles);
            
            // Show statistics
            const stats = manager.getStats();
            console.log('\n📈 Statistics:');
            console.log('  Files created:', stats.filesCreated);
            console.log('  Redactions applied:', stats.redactionApplied);
            console.log('  Security events:', stats.securityEvents);
            
        } else {
            console.log('❌ Test failed:', result.error);
        }
        
        // Cleanup
        await manager.cleanup();
        console.log('\n🧹 Cleanup completed');
        
    })().catch(console.error);
}
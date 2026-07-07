#!/usr/bin/env node

/**
 * Enhanced Redaction System for Live Session Logging
 * Minimal implementation for deployment purposes
 */

const fs = require('fs');
const path = require('path');

// Default config path resolved relative to this script (repo-root/.specstory/config).
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '.specstory', 'config', 'redaction-patterns.json');

/**
 * Load and compile the configured redaction pattern set.
 *
 * Returns a compiled array of `{ id, re, replacement }` for every enabled
 * pattern. Returns `[]` when the top-level `cfg.enabled === false`. Each
 * `new RegExp()` compile is guarded so a single malformed pattern is skipped
 * (with a stderr note) rather than crashing the loader or its host daemon.
 *
 * Exported so the proxy-side raw-body writer (Plan 06) consumes the identical
 * compiled pattern list from the identical config file (one source of truth).
 *
 * @param {string} configPath - path to redaction-patterns.json
 * @returns {{ id: string, re: RegExp, replacement: string }[]}
 */
function loadRedactionPatterns(configPath) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg.enabled === false) {
        return [];
    }
    return (cfg.patterns || [])
        .filter((p) => p.enabled)
        .map((p) => {
            try {
                return { id: p.id, re: new RegExp(p.pattern, p.flags), replacement: p.replacement };
            } catch (e) {
                process.stderr.write(`[redaction] bad pattern ${p.id}: ${e.message}\n`);
                return null;
            }
        })
        .filter(Boolean);
}

class EnhancedRedactionSystem {
    constructor(options = {}) {
        this.debug = options.debug || false;
        this.strictMode = options.strictMode !== false;

        // Compile the configured pattern set once at construction. Fail-soft:
        // a missing/unreadable config must never crash the host daemon — the
        // hardcoded PII safety net in redact() still applies.
        this.configPatterns = [];
        try {
            this.configPatterns = loadRedactionPatterns(options.configPath || DEFAULT_CONFIG_PATH);
        } catch (e) {
            process.stderr.write(`[redaction] config load failed (${e.message}); PII safety net only\n`);
        }

        this.stats = {
            totalRedactions: 0,
            bypassAttempts: 0,
            patternMatches: {},
            securityLevel: 'HIGH'
        };
    }

    redact(content, options = {}) {
        if (!content || typeof content !== 'string') {
            return content;
        }

        let redactedContent = content;
        let redactionCount = 0;

        try {
            // Configured 27-pattern set (sk-/XAI/Groq/AWS/Bearer/JWT/env-var/PII)
            // applied in order FIRST — strictly additive so the hardcoded PII
            // net below cannot regress the existing LSL redaction behavior.
            for (const { re, replacement } of this.configPatterns) {
                const matches = redactedContent.match(re);
                if (matches && matches.length > 0) {
                    redactedContent = redactedContent.replace(re, replacement);
                    redactionCount += matches.length;
                }
            }

            // Basic redaction patterns (hardcoded PII safety net)
            const patterns = {
                email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
                creditCard: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g,
                ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
                phone: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g
            };

            for (const [category, pattern] of Object.entries(patterns)) {
                const matches = redactedContent.match(pattern);
                if (matches && matches.length > 0) {
                    redactedContent = redactedContent.replace(pattern, `[REDACTED_${category.toUpperCase()}]`);
                    redactionCount += matches.length;
                }
            }

            this.stats.totalRedactions += redactionCount;

            return {
                content: redactedContent,
                redactionCount,
                securityLevel: redactionCount > 0 ? 'HIGH' : 'CLEAN'
            };

        } catch (error) {
            console.error('[Enhanced Redaction] Error during redaction:', error);
            
            return {
                content: '[REDACTION_ERROR_CONTENT_BLOCKED]',
                redactionCount: 1,
                error: error.message,
                securityLevel: 'MAXIMUM'
            };
        }
    }

    getStats() {
        return {
            ...this.stats,
            timestamp: new Date().toISOString()
        };
    }

    resetStats() {
        this.stats = {
            totalRedactions: 0,
            bypassAttempts: 0,
            patternMatches: {},
            securityLevel: 'HIGH'
        };
    }
}

module.exports = EnhancedRedactionSystem;
module.exports.EnhancedRedactionSystem = EnhancedRedactionSystem;
module.exports.loadRedactionPatterns = loadRedactionPatterns;

// CLI test when run directly
if (require.main === module) {
    const system = new EnhancedRedactionSystem({ debug: true });
    
    const testCases = [
        "Contact user@company.com for details",
        "SSN: 555-123-4567",
        "Credit card: 4532015112830366"
    ];
    
    console.log('🔒 Enhanced Redaction System Test');
    
    testCases.forEach((testCase, index) => {
        const result = system.redact(testCase);
        console.log(`Test ${index + 1}: "${testCase}" → "${result.content}"`);
    });
    
    console.log('📊 Statistics:', system.getStats());
}
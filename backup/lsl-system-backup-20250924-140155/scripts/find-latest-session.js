#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the most recent session files, properly sorted by modification time
 * This prevents the alphabetical sorting mistake where 07-20 > 07-31
 */
function findLatestSessions(directory = '.specstory/history', count = 1) {
    try {
        // Use ls -lt for proper time-based sorting
        const command = `find "${directory}" -name "*-session.md" -type f -exec ls -lt {} + | head -n ${count} | awk '{print $NF}'`;
        const result = execSync(command, { encoding: 'utf8' }).trim();
        return result.split('\n').filter(f => f);
    } catch (error) {
        console.error('Error finding sessions:', error.message);
        return [];
    }
}

/**
 * Find sessions newer than a given timestamp
 */
function findSessionsNewerThan(timestamp, directory = '.specstory/history') {
    try {
        // Parse timestamp YYYY-MM-DD_HH-MM-SS
        const [date, time] = timestamp.split('_');
        const [year, month, day] = date.split('-');
        const [hour, min, sec] = time.split('-');
        
        const refDate = `${year}-${month}-${day} ${hour}:${min}:${sec}`;
        
        const command = `find "${directory}" -name "*-session.md" -type f -newermt "${refDate}" | sort -r`;
        const result = execSync(command, { encoding: 'utf8' }).trim();
        return result.split('\n').filter(f => f);
    } catch (error) {
        console.error('Error finding newer sessions:', error.message);
        return [];
    }
}

// Export for use in other scripts
export {
    findLatestSessions,
    findSessionsNewerThan
};

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    
    if (args[0] === '--help') {
        console.log('Usage: find-latest-session.js [count]');
        console.log('       find-latest-session.js --newer-than YYYY-MM-DD_HH-MM-SS [dir]');
        process.exit(0);
    }
    
    if (args[0] === '--newer-than') {
        const sessions = findSessionsNewerThan(args[1], args[2]);
        sessions.forEach(s => console.log(s));
    } else {
        const count = parseInt(args[0]) || 1;
        const sessions = findLatestSessions('.specstory/history', count);
        sessions.forEach(s => console.log(s));
    }
}
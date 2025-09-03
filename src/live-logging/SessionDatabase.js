#!/usr/bin/env node

/**
 * Session Database for Live Logging
 * SQLite database to store session analysis and interactions
 */

import fs from 'fs';
import path from 'path';

export class SessionDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    
    // Ensure database directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    // Use better-sqlite3 if available, otherwise use simple file storage
    this.useFile = true;
    this.data = this.loadData();
  }

  /**
   * Load data from file storage
   */
  loadData() {
    const dataFile = this.dbPath.replace('.db', '.json');
    if (fs.existsSync(dataFile)) {
      try {
        return JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
      } catch {
        return this.getEmptyData();
      }
    }
    return this.getEmptyData();
  }

  /**
   * Get empty data structure
   */
  getEmptyData() {
    return {
      sessions: {},
      interactions: [],
      analysis: [],
      lastProcessed: {}
    };
  }

  /**
   * Save data to file
   */
  saveData() {
    try {
      const dataFile = this.dbPath.replace('.db', '.json');
      fs.writeFileSync(dataFile, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error(`Error saving database: ${error.message}`);
    }
  }

  /**
   * Save interaction analysis
   */
  saveInteractionAnalysis(sessionId, interaction, analysis) {
    const record = {
      id: `${sessionId}_${interaction.uuid}_${Date.now()}`,
      sessionId,
      messageUuid: interaction.uuid,
      toolName: interaction.toolName,
      toolInput: interaction.toolInput,
      toolResult: interaction.toolResult,
      success: interaction.success,
      timestamp: interaction.timestamp,
      analysis: analysis,
      createdAt: Date.now()
    };

    this.data.interactions.push(record);
    this.data.analysis.push({
      id: record.id,
      insight: analysis.insight,
      category: analysis.category,
      timestamp: analysis.timestamp
    });

    // Keep only recent data (last 1000 interactions)
    if (this.data.interactions.length > 1000) {
      this.data.interactions = this.data.interactions.slice(-1000);
    }
    if (this.data.analysis.length > 1000) {
      this.data.analysis = this.data.analysis.slice(-1000);
    }

    this.saveData();
  }

  /**
   * Get last processed message for session
   */
  getLastProcessedMessage(sessionId) {
    return this.data.lastProcessed[sessionId] || null;
  }

  /**
   * Update last processed message
   */
  updateLastProcessed(sessionId, interaction) {
    this.data.lastProcessed[sessionId] = {
      messageUuid: interaction.uuid,
      timestamp: interaction.timestamp,
      updatedAt: Date.now()
    };
    this.saveData();
  }

  /**
   * Get recent interactions for session
   */
  getRecentInteractions(sessionId, limit = 10) {
    return this.data.interactions
      .filter(i => i.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId) {
    const interactions = this.data.interactions.filter(i => i.sessionId === sessionId);
    
    if (interactions.length === 0) {
      return {
        totalInteractions: 0,
        successRate: 0,
        toolCounts: {},
        duration: 0
      };
    }

    const toolCounts = {};
    let successCount = 0;
    
    for (const interaction of interactions) {
      toolCounts[interaction.toolName] = (toolCounts[interaction.toolName] || 0) + 1;
      if (interaction.success) successCount++;
    }

    const sorted = interactions.sort((a, b) => a.timestamp - b.timestamp);
    const duration = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;

    return {
      totalInteractions: interactions.length,
      successRate: Math.round((successCount / interactions.length) * 100),
      toolCounts,
      duration,
      firstInteraction: sorted[0].timestamp,
      lastInteraction: sorted[sorted.length - 1].timestamp
    };
  }

  /**
   * Get recent analysis insights
   */
  getRecentInsights(sessionId, limit = 5) {
    return this.data.analysis
      .filter(a => {
        const interaction = this.data.interactions.find(i => i.id === a.id);
        return interaction && interaction.sessionId === sessionId;
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Clean old data
   */
  cleanup(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
    const cutoff = Date.now() - maxAge;
    
    this.data.interactions = this.data.interactions.filter(i => i.createdAt > cutoff);
    this.data.analysis = this.data.analysis.filter(a => a.timestamp > cutoff);
    
    // Clean last processed for old sessions
    for (const [sessionId, processed] of Object.entries(this.data.lastProcessed)) {
      if (processed.updatedAt < cutoff) {
        delete this.data.lastProcessed[sessionId];
      }
    }

    this.saveData();
  }

  /**
   * Export session data
   */
  exportSession(sessionId) {
    const interactions = this.data.interactions.filter(i => i.sessionId === sessionId);
    const analysis = this.data.analysis.filter(a => {
      const interaction = interactions.find(i => i.id === a.id);
      return !!interaction;
    });

    return {
      sessionId,
      interactions,
      analysis,
      stats: this.getSessionStats(sessionId),
      exportedAt: Date.now()
    };
  }

  /**
   * Get all session IDs
   */
  getAllSessions() {
    const sessionIds = new Set();
    for (const interaction of this.data.interactions) {
      sessionIds.add(interaction.sessionId);
    }
    return Array.from(sessionIds).sort();
  }

  /**
   * Close database
   */
  close() {
    this.saveData();
  }
}
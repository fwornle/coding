import * as fs from 'fs-extra';
import * as path from 'path';
import sanitizeFilename from 'sanitize-filename';

interface ConversationMetadata {
  timestamp?: string;
  model?: string;
  tools_used?: string[];
  project_path?: string;
  branch?: string;
}

interface SessionInfo {
  id: string;
  title?: string;
  startTime: string;
  endTime?: string;
  projectPath?: string;
  filePath: string;
  messageCount: number;
}

export class SpecStoryLogger {
  private basePath: string;
  private activeSessions: Map<string, SessionInfo> = new Map();

  constructor(basePath?: string) {
    // Default to current working directory or specified path
    this.basePath = basePath || process.cwd();
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const specStoryDir = path.join(this.basePath, '.specstory');
    const historyDir = path.join(specStoryDir, 'history');
    
    fs.ensureDirSync(historyDir);
    
    // Create .gitignore if it doesn't exist
    const gitignorePath = path.join(specStoryDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '# SpecStory auto-generated files\n*.tmp\n');
    }
  }

  private getHistoryDir(): string {
    return path.join(this.basePath, '.specstory', 'history');
  }

  private generateFilename(sessionId: string, title?: string): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    const sanitizedTitle = title ? this.sanitizeForFilename(title) : 'claude-code-session';
    return `${dateStr}_${timeStr.substring(0, 5)}-${sanitizedTitle}.md`; // YYYY-MM-DD_HH-MM-title.md
  }

  private sanitizeForFilename(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
      .replace(/\s+/g, '-')         // Replace spaces with hyphens
      .replace(/-+/g, '-')          // Collapse multiple hyphens
      .replace(/^-|-$/g, '')        // Remove leading/trailing hyphens
      .substring(0, 50);            // Limit length
  }

  private formatTimestamp(date?: Date): string {
    return (date || new Date()).toISOString();
  }

  private formatMessage(
    role: 'user' | 'assistant',
    content: string,
    metadata?: ConversationMetadata
  ): string {
    const timestamp = this.formatTimestamp();
    const header = `## ${role === 'user' ? 'User' : 'Assistant'}\n\n*${timestamp}*\n\n`;
    
    let message = header + content + '\n\n';
    
    if (metadata && role === 'assistant') {
      const metadataLines = [];
      if (metadata.model) metadataLines.push(`Model: ${metadata.model}`);
      if (metadata.tools_used && metadata.tools_used.length > 0) {
        metadataLines.push(`Tools Used: ${metadata.tools_used.join(', ')}`);
      }
      if (metadata.branch) metadataLines.push(`Branch: ${metadata.branch}`);
      
      if (metadataLines.length > 0) {
        message += `<details>\n<summary>Metadata</summary>\n\n${metadataLines.join('  \n')}\n</details>\n\n`;
      }
    }
    
    return message;
  }

  async startSession(
    sessionId: string,
    projectPath?: string,
    title?: string
  ): Promise<string> {
    const filename = this.generateFilename(sessionId, title);
    const filePath = path.join(this.getHistoryDir(), filename);
    
    const sessionInfo: SessionInfo = {
      id: sessionId,
      title,
      startTime: this.formatTimestamp(),
      projectPath,
      filePath,
      messageCount: 0,
    };
    
    this.activeSessions.set(sessionId, sessionInfo);
    
    // Create initial markdown file
    const header = `# ${title || `Conversation Session: ${sessionId}`}\n\n`;
    const sessionMetadata = [
      `**Session ID:** ${sessionId}`,
      `**Started:** ${sessionInfo.startTime}`,
    ];
    
    if (projectPath) {
      sessionMetadata.push(`**Project:** ${projectPath}`);
    }
    
    const initialContent = header + sessionMetadata.join('  \n') + '\n\n---\n\n';
    
    await fs.writeFile(filePath, initialContent);
    
    return filePath;
  }

  async logConversation(
    sessionId: string,
    userMessage: string,
    assistantMessage: string,
    metadata?: ConversationMetadata
  ): Promise<void> {
    let sessionInfo = this.activeSessions.get(sessionId);
    
    // If session doesn't exist, create it
    if (!sessionInfo) {
      await this.startSession(sessionId, metadata?.project_path);
      sessionInfo = this.activeSessions.get(sessionId)!;
    }
    
    const userContent = this.formatMessage('user', userMessage);
    const assistantContent = this.formatMessage('assistant', assistantMessage, metadata);
    
    const conversationBlock = userContent + assistantContent;
    
    await fs.appendFile(sessionInfo.filePath, conversationBlock);
    
    // Update session info
    sessionInfo.messageCount += 2; // user + assistant
    this.activeSessions.set(sessionId, sessionInfo);
  }

  async endSession(sessionId: string, summary?: string): Promise<void> {
    const sessionInfo = this.activeSessions.get(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    sessionInfo.endTime = this.formatTimestamp();
    
    let endContent = '\n---\n\n';
    endContent += `**Session Ended:** ${sessionInfo.endTime}  \n`;
    endContent += `**Total Messages:** ${sessionInfo.messageCount}\n\n`;
    
    if (summary) {
      endContent += `## Session Summary\n\n${summary}\n\n`;
    }
    
    await fs.appendFile(sessionInfo.filePath, endContent);
    
    // Remove from active sessions
    this.activeSessions.delete(sessionId);
  }

  async listSessions(limit: number = 10, projectFilter?: string): Promise<SessionInfo[]> {
    const historyDir = this.getHistoryDir();
    
    if (!fs.existsSync(historyDir)) {
      return [];
    }
    
    const files = await fs.readdir(historyDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));
    
    const sessions: SessionInfo[] = [];
    
    for (const file of markdownFiles.slice(0, limit)) {
      const filePath = path.join(historyDir, file);
      const stats = await fs.stat(filePath);
      
      // Try to extract session info from file content
      const content = await fs.readFile(filePath, 'utf-8');
      const sessionIdMatch = content.match(/\*\*Session ID:\*\* (.+)/);
      const projectMatch = content.match(/\*\*Project:\*\* (.+)/);
      const startTimeMatch = content.match(/\*\*Started:\*\* (.+)/);
      const endTimeMatch = content.match(/\*\*Session Ended:\*\* (.+)/);
      const messageCountMatch = content.match(/\*\*Total Messages:\*\* (\d+)/);
      
      const projectPath = projectMatch ? projectMatch[1].trim() : undefined;
      
      // Apply project filter if specified
      if (projectFilter && (!projectPath || !projectPath.includes(projectFilter))) {
        continue;
      }
      
      sessions.push({
        id: sessionIdMatch ? sessionIdMatch[1].trim() : path.basename(file, '.md'),
        title: content.split('\n')[0].replace('# ', ''),
        startTime: startTimeMatch ? startTimeMatch[1].trim() : stats.birthtime.toISOString(),
        endTime: endTimeMatch ? endTimeMatch[1].trim() : undefined,
        projectPath,
        filePath,
        messageCount: messageCountMatch ? parseInt(messageCountMatch[1]) : 0,
      });
    }
    
    // Sort by start time, most recent first
    sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    
    return sessions;
  }

  async getSession(sessionId: string): Promise<string | null> {
    // Check active sessions first
    const activeSession = this.activeSessions.get(sessionId);
    if (activeSession) {
      if (fs.existsSync(activeSession.filePath)) {
        return await fs.readFile(activeSession.filePath, 'utf-8');
      }
    }
    
    // Search in history directory
    const historyDir = this.getHistoryDir();
    if (!fs.existsSync(historyDir)) {
      return null;
    }
    
    const files = await fs.readdir(historyDir);
    
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      
      const filePath = path.join(historyDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Check if this file contains the session ID
      if (content.includes(`**Session ID:** ${sessionId}`)) {
        return content;
      }
    }
    
    return null;
  }
}
/**
 * ABAP FS Telemetry Service
 * Centralized telemetry collection and storage
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AppInsightsService } from './appInsightsService';

interface TelemetryEntry {
  timestamp: string;    // ISO format
  sessionId: string;    // Extension session
  userId: string;       // Anonymous hash
  action: string;       // "command_xxx_called" or "tool_xxx_called"
  version: string;      // Extension version
}

export class TelemetryService {
  private static instance: TelemetryService;
  private sessionId: string;
  private userId: string;
  private version: string;
  private buffer: TelemetryEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private telemetryDir: string;
  private isFlushInProgress: boolean = false;
  private maxBufferSize: number = 1000;

  private constructor(context: vscode.ExtensionContext) {
    // Generate session ID using cryptographically secure random UUID
    this.sessionId = `session-${Date.now()}-${crypto.randomUUID()}`;
    
    // Generate anonymous user ID (hash of machine info)
    const machineInfo = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`;
    this.userId = `user-${crypto.createHash('sha256').update(machineInfo).digest('hex').substring(0, 16)}`;
    
    // Get extension version
    this.version = vscode.extensions.getExtension('murbani.vscode-abap-remote-fs')?.packageJSON?.version || 'unknown';
    
    // Setup telemetry directory
    this.telemetryDir = path.join(context.globalStorageUri.fsPath, 'telemetry');
    this.ensureTelemetryDir();
    
    // Start periodic flush (every 5 minutes)
    this.startPeriodicFlush();
    
    // Flush on extension deactivation
    context.subscriptions.push(new vscode.Disposable(() => {
      this.flushToFile();
      if (this.flushInterval) {
        clearInterval(this.flushInterval);
      }
    }));
  }

  public static initialize(context: vscode.ExtensionContext): void {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService(context);
    }
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      throw new Error('TelemetryService not initialized. Call initialize() first.');
    }
    return TelemetryService.instance;
  }

  /**
   * Log a telemetry event
   * @param action - Action description (e.g., "command_activate_called", "tool_create_test_include_called")
   */
  public log(action: string): void {
    const entry: TelemetryEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userId: this.userId,
      action: action,
      version: this.version
    };

    this.buffer.push(entry);
    
    // Prevent memory leaks - drop old entries if buffer gets too large
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }
    
    // If buffer gets large, flush immediately (but don't block if already flushing)
    if (this.buffer.length >= 25 && !this.isFlushInProgress) {
      this.flushToFile();
    }
  }


  private ensureTelemetryDir(): void {
    try {
      if (!fs.existsSync(this.telemetryDir)) {
        fs.mkdirSync(this.telemetryDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create telemetry directory:', error);
    }
  }

  private startPeriodicFlush(): void {
    // Flush every 5 minutes
    this.flushInterval = setInterval(() => {
      this.flushToFile();
    }, 5 * 60 * 1000);
  }

  private flushToFile(): void {
    if (this.buffer.length === 0 || this.isFlushInProgress) return;

    // Prevent concurrent flushes
    this.isFlushInProgress = true;
    
    // Copy buffer and clear it immediately to prevent race conditions
    const entriesToFlush = [...this.buffer];
    this.buffer = [];

    // Use async operation to prevent blocking
    setImmediate(async () => {
      try {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const filename = `telemetry-${today}.csv`;
        const filepath = path.join(this.telemetryDir, filename);
        
        // Create CSV header if file doesn't exist
        let csvContent = '';
        if (!fs.existsSync(filepath)) {
          csvContent = 'timestamp,sessionId,userId,action,version\n';
        }
        
        // Add entries to flush
        for (const entry of entriesToFlush) {
          csvContent += `${entry.timestamp},${entry.sessionId},${entry.userId},${entry.action},${entry.version}\n`;
        }
        
        // Use async write to prevent blocking
        await fs.promises.appendFile(filepath, csvContent, 'utf8');
        
      } catch (error) {
        console.error('Failed to flush telemetry to file:', error);
        // Re-add failed entries to buffer (at the beginning to maintain order)
        this.buffer.unshift(...entriesToFlush);
        
        // Prevent infinite buffer growth on persistent failures
        if (this.buffer.length > this.maxBufferSize) {
          this.buffer = this.buffer.slice(0, this.maxBufferSize);
        }
      } finally {
        this.isFlushInProgress = false;
      }
    });
  }

  /**
   * Get telemetry statistics (for debugging)
   */
  public getStats(): { bufferSize: number, sessionId: string, userId: string, version: string } {
    return {
      bufferSize: this.buffer.length,
      sessionId: this.sessionId,
      userId: this.userId,
      version: this.version
    };
  }
}

/**
 * Convenience function for logging telemetry
 * @param action - Action description (e.g., "command_activate_called", "tool_create_test_include_called")
 */
export function logTelemetry(
  action: string, 
  options?: {
    connectionId?: string;
    activeEditor?: vscode.TextEditor;
    username?: string;
  }
): void {
  try {
    
    // Existing CSV logging
    TelemetryService.getInstance().log(action);
    
    // Send to App Insights with context
    AppInsightsService.getInstance().track(action, options);
  } catch (error) {
    // Silently fail - telemetry should never break functionality
    console.error('Telemetry logging failed:', error);
  }
}

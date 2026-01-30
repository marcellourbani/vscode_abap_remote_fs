/**
 * Application Insights Service
 * Handles telemetry data parsing and sending to Application Insights
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as crypto from 'crypto';
import { log } from '../lib';

// Application Insights SDK
import * as appInsights from 'applicationinsights';

interface ParsedTelemetry {
  type: 'command' | 'tool' | 'code_change' | 'unknown';
  name?: string;
  linesChanged?: number;
}

export class AppInsightsService {
  private static instance: AppInsightsService;
  private isInitialized: boolean = false;
  private sessionId: string;
  private userId: string;
  private version: string;

  private constructor(context: vscode.ExtensionContext) {
    // Generate session ID using cryptographically secure random UUID
    this.sessionId = `session-${Date.now()}-${crypto.randomUUID()}`;
    
    // Generate anonymous user ID (hash of machine info)
    const machineInfo = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`;
    this.userId = `user-${crypto.createHash('sha256').update(machineInfo).digest('hex').substring(0, 16)}`;
    
    // Get extension version
    this.version = vscode.extensions.getExtension('murbani.vscode-abap-remote-fs')?.packageJSON?.version || 'unknown';
    
    this.initialize();
    
    // Register cleanup on extension deactivation (same pattern as local telemetry)
    context.subscriptions.push(new vscode.Disposable(() => {
      this.flush();
    }));
  }

  public static getInstance(context?: vscode.ExtensionContext): AppInsightsService {
    if (!AppInsightsService.instance) {
      if (!context) {
        throw new Error('AppInsightsService requires ExtensionContext for initialization');
      }
      AppInsightsService.instance = new AppInsightsService(context);
    }
    return AppInsightsService.instance;
  }

  private initialize(): void {
    try {
      const connectionString = 'your-key-here';
      
      if (!connectionString || connectionString.includes('your-key-here')) {
        log('AppInsights: Connection string not configured, skipping initialization');
        return;
      }

      // Set environment variables for cloud role information (recommended approach for newer SDK)
      process.env.WEBSITE_SITE_NAME = 'abap-copilot-extension';
      process.env.WEBSITE_INSTANCE_ID = 'anonymous';

      // Setup Application Insights with minimal auto-collection
      appInsights.setup(connectionString)
        .setAutoCollectRequests(false)           // Disable - we'll track manually
        .setAutoCollectPerformance(false,false)        // Disable - we'll track manually
        .setAutoCollectExceptions(false)         // Disable - prevents logging internal timeout errors
        .setAutoCollectDependencies(false)       // Disable - we'll track manually
        .setAutoCollectConsole(false)            // Disable - we don't want console logs
        .setUseDiskRetryCaching(true)            // Keep - helps with connectivity
        .setSendLiveMetrics(false)               // Disable - we don't need live metrics
        .setInternalLogging(true, true);
      
      // Start Application Insights
      appInsights.start();

      // Set custom flush interval to 30 seconds
      appInsights.defaultClient.config.maxBatchIntervalMs = 30000; // 30 seconds

      // Disable additional auto-collection features
      appInsights.defaultClient.config.enableAutoCollectConsole = false;
      appInsights.defaultClient.config.enableAutoCollectDependencies = false;
      appInsights.defaultClient.config.enableAutoCollectExceptions = false;
      appInsights.defaultClient.config.enableAutoCollectPerformance = false;
      appInsights.defaultClient.config.enableAutoCollectRequests = false;

        // Set global properties for all telemetry
      appInsights.defaultClient.commonProperties = {
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch(),
        userId: this.userId,
        sessionId: this.sessionId
      };
     
      this.isInitialized = true;
      
    } catch (error) {
      console.error('AppInsights: Failed to initialize:', error);
    }
  }

  /**
   * Track telemetry event by parsing the action text
   */
  public track(
    action: string, 
    options?: {
      connectionId?: string;
      activeEditor?: vscode.TextEditor;
      username?: string;
    }
  ): void {
    if (!this.isInitialized) return;

    try {
      const parsed = this.parseTelemetryText(action);
      
      // Get user mapping with priority: username → connectionId → activeEditor → settings
      const userMapping = this.getUserMapping(options);
      
      switch (parsed.type) {
        case 'command':
          this.trackCommand(parsed.name!, action, userMapping);
          break;
        case 'tool':
          this.trackTool(parsed.name!, action, userMapping);
          break;
        case 'code_change':
          this.trackCodeChange(parsed.linesChanged!, action, userMapping);
          break;
        default:
          this.trackGeneric(action, userMapping);
          break;
      }
    } catch (error) {
      console.error('AppInsights: Failed to track event:', error);
    }
  }

  /**
   * Get user mapping with priority: username → connectionId → activeEditor → settings
   */
  private getUserMapping(options?: {
    connectionId?: string;
    activeEditor?: vscode.TextEditor;
    username?: string;
  }): { uniqueId: string; manager: string; sapSystem: string } | null {
    try {
      // Import SapSystemValidator dynamically to avoid circular dependency
      const { SapSystemValidator } = require('./sapSystemValidator');
      const validator = SapSystemValidator.getInstance();
      
      let username: string | null = null;
      let connectionId: string | null = null;
      
      // Priority 1: Direct username
      if (options?.username) {
        username = options.username;
      }
      // Priority 2: Get username from connectionId (convert to lowercase for consistency)
      else if (options?.connectionId) {
        const normalizedConnectionId = options.connectionId.toLowerCase();
        connectionId = normalizedConnectionId;
        username = this.getUsernameFromConnectionId(normalizedConnectionId);
      }
      // Priority 3: Get username from activeEditor (convert to lowercase for consistency)
      else if (options?.activeEditor && options.activeEditor.document.uri.scheme === 'adt') {
        const editorConnectionId = options.activeEditor.document.uri.authority.toLowerCase();
        connectionId = editorConnectionId;
        username = this.getUsernameFromConnectionId(editorConnectionId);
      }
      // Priority 4: Get from VS Code settings (backup)
      else {
        username = this.getUsernameFromSettings();
      }
      
      if (!username) {
        log(`❌ getUserMapping: No username found, returning null`);
        return null;
      }
      
      const mapping = validator.getUserMapping(username);
      const sapSystem = connectionId || 'generic';
      return mapping ? { ...mapping, sapSystem } : null;
    } catch (error) {
      log(`❌ getUserMapping: Error occurred: ${error}`);
      return null;
    }
  }

  /**
   * Get username from connection ID using RemoteManager
   */
  private getUsernameFromConnectionId(connectionId: string): string | null {
    try {
      const { RemoteManager } = require('../config');
      const manager = RemoteManager.get();
      const connection = manager.byId(connectionId);
      return connection?.username || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get username from VS Code settings (backup method)
   */
  private getUsernameFromSettings(): string | null {
    try {
      const { RemoteManager } = require('../config');
      const manager = RemoteManager.get();
      const connections = manager.remoteList();
      return connections.length > 0 ? connections[0].username : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse telemetry text to extract structured data
   */
  private parseTelemetryText(action: string): ParsedTelemetry {
    // Commands: "command_xxx_called"
    if (action.startsWith('command_') && action.endsWith('_called')) {
      const name = action.replace('command_', '').replace('_called', '');
      return { type: 'command', name };
    }
    
    // Tools: "tool_yyy_called"
    if (action.startsWith('tool_') && action.endsWith('_called')) {
      const name = action.replace('tool_', '').replace('_called', '');
      return { type: 'tool', name };
    }
    
    // Code changes: "Number of code lines changed: xxx"
    if (action.startsWith('Number of code lines changed: ')) {
      const linesStr = action.replace('Number of code lines changed: ', '');
      const lines = parseInt(linesStr, 10);
      if (!isNaN(lines)) {
        return { type: 'code_change', linesChanged: lines };
      }
    }
    
    return { type: 'unknown' };
  }

  /**
   * Track command execution
   */
  private trackCommand(commandName: string, originalAction: string, userMapping: { uniqueId: string; manager: string; sapSystem: string } | null): void {
    const userId = userMapping?.uniqueId || this.userId;
    const manager = userMapping?.manager || 'Unknown';
    const sapSystem = userMapping?.sapSystem || 'generic';
    
    appInsights.defaultClient.trackEvent({
      name: 'command_executed',
      properties: {
        commandName: commandName,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        sessionId: this.sessionId,
        originalAction: originalAction,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    });

    // Also track as metric for counting
    appInsights.defaultClient.trackMetric({
      name: 'command_usage_count',
      value: 1,
      properties: {
        commandName: commandName,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    });
  }

  /**
   * Track tool execution
   */
  private trackTool(toolName: string, originalAction: string, userMapping: { uniqueId: string; manager: string; sapSystem: string } | null): void {
    const userId = userMapping?.uniqueId || this.userId;
    const manager = userMapping?.manager || 'Unknown';
    const sapSystem = userMapping?.sapSystem || 'generic';
    
    appInsights.defaultClient.trackEvent({
      name: 'tool_executed',
      properties: {
        toolName: toolName,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        sessionId: this.sessionId,
        originalAction: originalAction,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    });

    // Also track as metric for counting
    appInsights.defaultClient.trackMetric({
      name: 'tool_usage_count',
      value: 1,
      properties: {
        toolName: toolName,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    });
  }

  /**
   * Track code changes
   */
  private trackCodeChange(linesChanged: number, originalAction: string, userMapping: { uniqueId: string; manager: string; sapSystem: string } | null): void {
    const userId = userMapping?.uniqueId || this.userId;
    const manager = userMapping?.manager || 'Unknown';
    const sapSystem = userMapping?.sapSystem || 'generic';
    
    appInsights.defaultClient.trackEvent({
      name: 'code_changed',
      properties: {
        changeType: 'copilot',
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        sessionId: this.sessionId,
        originalAction: originalAction,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      },
      measurements: {
        linesChanged: linesChanged
      }
    });

    // Also track as metric for counting
    appInsights.defaultClient.trackMetric({
      name: 'code_changes_count',
      value: linesChanged,
      properties: {
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    });
  }

  /**
   * Track generic/unknown events
   */
  private trackGeneric(action: string, userMapping: { uniqueId: string; manager: string; sapSystem: string } | null): void {
    const userId = userMapping?.uniqueId || this.userId;
    const manager = userMapping?.manager || 'Unknown';
    const sapSystem = userMapping?.sapSystem || 'generic';
    
    appInsights.defaultClient.trackEvent({
      name: 'generic_event',
      properties: {
        action: action,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        sessionId: this.sessionId,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    });
  }

  /**
   * Flush all pending telemetry
   */
  public flush(): void {
    if (!this.isInitialized) return;

    try {
      appInsights.defaultClient.flush();
    } catch (error) {
      console.error('AppInsights: Failed to flush:', error);
    }
  }
}

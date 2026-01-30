/**
 * ABAP FS Logger
 * Dedicated logging for ABAP FS features with separate output channel
 */

import * as vscode from 'vscode';
import { channel as abapFSChannel } from '../lib/logger'; // Reuse existing ABAP FS channel

class ABAPCopilotLogger {
  private static instance: ABAPCopilotLogger;
  private outputChannel: vscode.OutputChannel;

  private constructor() {
    // Reuse the existing ABAP FS output channel instead of creating a new one
    this.outputChannel = abapFSChannel;
  }

  public static getInstance(): ABAPCopilotLogger {
    if (!ABAPCopilotLogger.instance) {
      ABAPCopilotLogger.instance = new ABAPCopilotLogger();
    }
    return ABAPCopilotLogger.instance;
  }

  private formatMessage(level: string, component: string, message: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const timestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}`;
    return `[${timestamp}] [${level}] [${component}] ${message}`;
  }

  public info(component: string, message: string) {
    const formatted = this.formatMessage('INFO', component, message);
    this.outputChannel.appendLine(formatted);
    console.log(formatted);
  }

  public warn(component: string, message: string) {
    const formatted = this.formatMessage('WARN', component, message);
    this.outputChannel.appendLine(formatted);
    console.warn(formatted);
  }

  public error(component: string, message: string, error?: any) {
    let formatted = this.formatMessage('ERROR', component, message);
    if (error) {
      formatted += `\n  Error: ${error}`;
      if (error.stack) {
        formatted += `\n  Stack: ${error.stack}`;
      }
    }
    this.outputChannel.appendLine(formatted);
    console.error(formatted);
  }

  public debug(component: string, message: string) {
    const formatted = this.formatMessage('DEBUG', component, message);
    this.outputChannel.appendLine(formatted);
    console.debug(formatted);
  }

  public trace(component: string, operation: string, data?: any) {
    let message = `TRACE: ${operation}`;
    if (data) {
      message += ` | Data: ${JSON.stringify(data, null, 2)}`;
    }
    const formatted = this.formatMessage('TRACE', component, message);
    this.outputChannel.appendLine(formatted);
    console.debug(formatted);
  }

  public show() {
    this.outputChannel.show();
  }

  public clear() {
    this.outputChannel.clear();
  }

  public dispose() {
    this.outputChannel.dispose();
  }
}

// Export singleton instance
export const copilotLogger = ABAPCopilotLogger.getInstance();

export const logInlineProvider = {
  info: (msg: string) => copilotLogger.info('InlineProvider', msg),
  warn: (msg: string) => copilotLogger.warn('InlineProvider', msg),
  error: (msg: string, err?: any) => copilotLogger.error('InlineProvider', msg, err),
  debug: (msg: string) => copilotLogger.debug('InlineProvider', msg),
  trace: (op: string, data?: any) => copilotLogger.trace('InlineProvider', op, data)
};

export const logSearch = {
  info: (msg: string) => copilotLogger.info('Search', msg),
  warn: (msg: string) => copilotLogger.warn('Search', msg),
  error: (msg: string, err?: any) => copilotLogger.error('Search', msg, err),
  debug: (msg: string) => copilotLogger.debug('Search', msg),
  trace: (op: string, data?: any) => copilotLogger.trace('Search', op, data)
};

export const logCommands = {
  info: (msg: string) => copilotLogger.info('Commands', msg),
  warn: (msg: string) => copilotLogger.warn('Commands', msg),
  error: (msg: string, err?: any) => copilotLogger.error('Commands', msg, err),
  debug: (msg: string) => copilotLogger.debug('Commands', msg),
  trace: (op: string, data?: any) => copilotLogger.trace('Commands', op, data)
};

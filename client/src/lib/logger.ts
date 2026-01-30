import { funWindow as window } from "../services/funMessenger"

export const CHANNELNAME = "ABAP FS"

export const channel = window.createOutputChannel(CHANNELNAME)

// Enhanced logging with consistent timestamp format
function formatMessage(level: string, component: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] [${component}] ${message}`;
}

export function log(...messages: string[]) {
  const fullMessage = messages.join("");
  // Add timestamp and format for basic log calls
  const formatted = formatMessage('INFO', 'Extension', fullMessage);
  channel.appendLine(formatted);
}

export function logJ(...messages: any) {
  for (const m of messages) {
    try {
      if (m instanceof Object) {
        const formatted = formatMessage('INFO', 'Extension', JSON.stringify(m));
        channel.appendLine(formatted);
      } else {
        const formatted = formatMessage('INFO', 'Extension', `${m}`);
        channel.appendLine(formatted);
      }
    } catch (error) {
      // usually circular dependencies
      const formatted = formatMessage('INFO', 'Extension', `${m}`);
      channel.appendLine(formatted);
    }
  }
}

// Add enhanced logging functions to match Copilot logger
export const logger = {
  info: (component: string, message: string) => {
    const formatted = formatMessage('INFO', component, message);
    channel.appendLine(formatted);
    console.log(formatted);
  },
  warn: (component: string, message: string) => {
    const formatted = formatMessage('WARN', component, message);
    channel.appendLine(formatted);
    console.warn(formatted);
  },
  error: (component: string, message: string, error?: any) => {
    let formatted = formatMessage('ERROR', component, message);
    if (error) {
      formatted += `\n  Error: ${error}`;
      if (error.stack) {
        formatted += `\n  Stack: ${error.stack}`;
      }
    }
    channel.appendLine(formatted);
    console.error(formatted);
  },
  debug: (component: string, message: string) => {
    const formatted = formatMessage('DEBUG', component, message);
    channel.appendLine(formatted);
    console.debug(formatted);
  }
};

/**
 * ABAP Debugger Language Model Tool
 * Enables GitHub Copilot to debug ABAP code programmatically
 * 
 * Features:
 * - Start/Stop debugging sessions
 * - Set/Remove breakpoints and watchpoints
 * - Control debugging flow (F5, F6, F7, F8 equivalents)
 * - Read runtime variables and internal tables (with data management)
 * - Evaluate expressions
 * - Navigate stack frames
 * - Manage debugging sessions
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { DebugProtocol } from '@vscode/debugprotocol';
import { AbapDebugSession } from '../../adt/debugger/abapDebugSession';
import { DebugListener } from '../../adt/debugger/debugListener';
import { logCommands } from './../abapCopilotLogger';
import { logTelemetry } from './../telemetry';
import { log, caughtToString } from '../../lib';

// Helper for detailed debug logging - disabled, can be enabled when debugging the debugger!!
const debugLog = (tool: string, message: string, data?: any) => {
  //const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : '';
 // log(`[DEBUG-TOOL] [${tool}] ${message}${dataStr}`);
};

// ====================================
// INTERFACES AND TYPES
// ====================================

interface IDebugSessionParameters {
  connectionId: string;
  debugUser?: string;
  terminalMode?: boolean;
  action?: 'start' | 'stop' | 'status';
}

interface IBreakpointParameters {
  connectionId: string;
  filePath: string;
  lineNumbers: number[];
  condition?: string;
  action?: 'set' | 'remove';
}

interface IDebugStepParameters {
  connectionId: string;
  threadId?: number;
  stepType: 'continue' | 'stepInto' | 'stepOver' | 'stepReturn' | 'jumpToLine';
  targetLine?: number;
}

interface IVariableParameters {
  connectionId: string;
  threadId?: number;
  frameId?: number;
  variableName?: string;
  rowStart?: number; // Start row for table data (0-based)
  rowCount?: number; // Number of rows to return
  expression?: string;
  scopeName?: string;
  filter?: string; // Filter condition for internal tables
  maxVariables?: number; // Maximum variables to show in scope (default 100)
  filterPattern?: string; // Pattern to filter variable names (e.g., "LT_*")
  expandStructures?: boolean; // Show all structure components expanded
  expandTables?: boolean; // Show table contents inline
}

interface IStackTraceParameters {
  connectionId: string;
  threadId?: number;
}

interface IDebugStatusParameters {
  connectionId: string;
}

// ====================================
// DEBUG SESSION MANAGEMENT TOOL
// ====================================

export class ABAPDebugSessionTool implements vscode.LanguageModelTool<IDebugSessionParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDebugSessionParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId, debugUser, terminalMode } = options.input;
    
    const confirmationMessages = {
      title: 'ABAP Debug Session Control',
      message: new vscode.MarkdownString(
        `Managing ABAP debugging session:\n\n` +
        `**Connection:** ${connectionId}\n` +
        (debugUser ? `**Debug User:** ${debugUser}\n` : '') +
        `**Terminal Mode:** ${terminalMode ? 'Yes' : 'No'}\n\n` +
        `This will start or manage an ABAP debugging session.`
      ),
    };

    return {
      invocationMessage: `Managing ABAP debug session for ${connectionId}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDebugSessionParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { connectionId, debugUser, terminalMode = false, action = 'start' } = options.input;
    logTelemetry("tool_debug_session_called", { connectionId });

    try {
      const existingSession = AbapDebugSession.byConnection(connectionId);
      
      switch (action) {
        case 'status':
          if (existingSession) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `🔍 **Debug Session Status:**\n` +
                `**Connection:** ${connectionId}\n` +
                `**Status:** Active\n` +
                `**Total Sessions:** ${AbapDebugSession.activeSessions}\n` +
                `**Ready for debugging operations**`
              )
            ]);
          } else {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `❌ **Debug Session Status:**\n` +
                `**Connection:** ${connectionId}\n` +
                `**Status:** No active session\n` +
                `**Action Required:** Start a debug session first`
              )
            ]);
          }

        case 'stop':
          if (existingSession) {
            await existingSession.logOut();
            
            // Also stop the VS Code debug session
            const activeDebugSession = vscode.debug.activeDebugSession;
            if (activeDebugSession && activeDebugSession.type === 'abap') {
              await vscode.debug.stopDebugging(activeDebugSession);
            }
            
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `✅ Debug session stopped for connection ${connectionId}`
              )
            ]);
          } else {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `⚠️ No active debug session found for connection ${connectionId}`
              )
            ]);
          }

        case 'start':
        default:
          if (existingSession) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `🔍 Debug session already active for connection ${connectionId}.\n` +
                `Use other debug tools to interact with the session.`
              )
            ]);
          }

          // Production system guard - debugging production can be dangerous
          const guardResult = await this.checkProductionGuard(connectionId);
          if (guardResult.action === 'cancel') {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `Debug session cancelled by user. The system is a production system and user chose not to debug.`
              )
            ]);
          }

          // Create debug configuration matching the existing pattern
          const debugConfig = {
            type: 'abap',
            request: 'attach',
            name: 'Copilot Debug Session',
            connId: connectionId,
            debugUser: debugUser || '',
            terminalMode: terminalMode
          };

          // Start debugging session using VS Code's debug API
          const started = await vscode.debug.startDebugging(undefined, debugConfig);
          
          if (started) {
            // Wait a moment for session to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `✅ **ABAP debug session started!**\n` +
                `**Connection:** ${connectionId}\n` +
                `**Mode:** ${terminalMode ? 'Terminal' : 'User'}\n` +
                `**Status:** Ready for debugging\n\n` +
                `**Next Steps:**\n` +
                `1. Set breakpoints in your ABAP code\n` +
                `2. Execute your ABAP program\n` +
                `3. Use debug tools when execution pauses`
              )
            ]);
          } else {
            throw new Error('Failed to start VS Code debug session');
          }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logCommands.error(`Debug session error: ${errorMessage}`);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to manage debug session: ${errorMessage}`)
      ]);
    }
  }

  /**
   * Check if debugging on a production system and prompt user for confirmation
   */
  private async checkProductionGuard(
    connectionId: string
  ): Promise<{ action: 'proceed' | 'cancel' }> {
    try {
      const { getSAPSystemInfo } = await import('../sapSystemInfo');
      
      const systemInfo = await getSAPSystemInfo(connectionId);
      
      // Check if production (category 'P' or contains 'Production')
      const isProduction = systemInfo.currentClient?.category === 'Production' ||
                          systemInfo.currentClient?.category?.startsWith('P');
      
      if (!isProduction) {
        return { action: 'proceed' }; // Not production, allow
      }
      
      // Production system detected - show dialog
      const clientInfo = systemInfo.currentClient 
        ? `${connectionId.toUpperCase()} (Client ${systemInfo.currentClient.clientNumber}: ${systemInfo.currentClient.clientName})`
        : connectionId.toUpperCase();
      
      const choice = await vscode.window.showWarningMessage(
        `⚠️ PRODUCTION SYSTEM DETECTED\n\n` +
        `Copilot wants to start debugging on: ${clientInfo}\n\n` +
        `⚠️ Security Risk: Debugging may expose sensitive data.\n` +
        `⚠️ Stability Risk: VS Code debugging can be fragile on production.\n\n` +
        `Recommendation: Use SAP GUI for production debugging.`,
        { modal: true },
        { title: 'Start Debugging Anyway', action: 'proceed' },
        { title: 'Cancel', action: 'cancel', isCloseAffordance: true }
      );
      
      if (!choice || choice.action === 'cancel') {
        return { action: 'cancel' };
      }
      
      return { action: 'proceed' };
      
    } catch (error) {
      // If check fails, allow debugging to proceed (don't block on errors)
      console.warn('Production guard check failed:', error);
      return { action: 'proceed' };
    }
  }
}

// ====================================
// BREAKPOINT MANAGEMENT TOOL
// ====================================

export class ABAPBreakpointTool implements vscode.LanguageModelTool<IBreakpointParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IBreakpointParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId, filePath, lineNumbers, condition } = options.input;
    
    const confirmationMessages = {
      title: 'ABAP Breakpoint Management',
      message: new vscode.MarkdownString(
        `Managing breakpoints:\n\n` +
        `**File:** ${filePath}\n` +
        `**Lines:** ${lineNumbers.join(', ')}\n` +
        (condition ? `**Condition:** ${condition}\n` : '') +
        `**Connection:** ${connectionId}`
      ),
    };

    return {
      invocationMessage: `Managing breakpoints in ${filePath}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IBreakpointParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { connectionId, filePath, lineNumbers, condition, action = 'set' } = options.input;
    debugLog('Breakpoint', `invoke called`, { connectionId, filePath, lineNumbers, condition, action });
    logTelemetry("tool_debug_breakpoint_called", { connectionId });

    try {
      debugLog('Breakpoint', `Looking for debug session`);
      const session = AbapDebugSession.byConnection(connectionId);
      if (!session) {
        debugLog('Breakpoint', `No session found for ${connectionId}`);
        throw new Error(`No active debug session found for connection ${connectionId}. Start a debug session first.`);
      }
      debugLog('Breakpoint', `Session found`);

      // Create source breakpoints in the format expected by Debug Protocol
      const sourceBreakpoints: DebugProtocol.SourceBreakpoint[] = lineNumbers.map(line => ({
        line,
        condition: condition
      }));
      debugLog('Breakpoint', `Created sourceBreakpoints`, sourceBreakpoints);

      const source: DebugProtocol.Source = { 
        path: filePath,
        name: filePath.split('/').pop() || 'unknown'
      };
      debugLog('Breakpoint', `Source object`, source);

      if (action === 'set') {
        // Step 1: Set breakpoints in SAP debugger backend
        debugLog('Breakpoint', `Getting debugListener`);
        const debugListener = session.debugListener;
        if (!debugListener) {
          debugLog('Breakpoint', `No debugListener available`);
          throw new Error('Debug listener not available');
        }
        debugLog('Breakpoint', `debugListener found`);
        
        const breakpointManager = debugListener.breakpointManager;
        debugLog('Breakpoint', `Got breakpointManager`);
        
        let verifiedCount = 0;
        let failedCount = 0;
        let actualBreakpoints: any[] = [];
        
        try {
          debugLog('Breakpoint', `Calling breakpointManager.setBreakpoints`);
          actualBreakpoints = await breakpointManager.setBreakpoints(source, sourceBreakpoints);
          debugLog('Breakpoint', `setBreakpoints returned`, actualBreakpoints);
          verifiedCount = actualBreakpoints.filter(bp => bp.verified).length;
          failedCount = actualBreakpoints.length - verifiedCount;
          debugLog('Breakpoint', `Verified: ${verifiedCount}, Failed: ${failedCount}`);
        } catch (breakpointError) {
          debugLog('Breakpoint', `setBreakpoints error: ${caughtToString(breakpointError)}`);
          throw new Error(`Failed to set breakpoints in SAP: ${breakpointError}`);
        }
        
        // Step 2: Set breakpoints in VS Code UI (for visual indicators)
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(filePath));
          
          // Get current breakpoints for this file
          const currentBreakpoints = vscode.debug.breakpoints.filter(bp =>
            bp instanceof vscode.SourceBreakpoint && bp.location.uri.toString() === document.uri.toString()
          ) as vscode.SourceBreakpoint[];
          
          // Create new breakpoints for VS Code UI
          const newVSCodeBreakpoints = lineNumbers.map(line => {
            const position = new vscode.Position(line - 1, 0); // VS Code uses 0-based line numbers
            const location = new vscode.Location(document.uri, position);
            return condition ?
              new vscode.SourceBreakpoint(location, true, condition) :
              new vscode.SourceBreakpoint(location, true);
          });
          
          // Remove old breakpoints for these lines and add new ones
          const filteredOldBreakpoints = currentBreakpoints.filter(bp =>
            !lineNumbers.includes(bp.location.range.start.line + 1)
          );
          
          vscode.debug.removeBreakpoints(currentBreakpoints);
          vscode.debug.addBreakpoints(newVSCodeBreakpoints);
          
        } catch (uiError) {
          // UI update failed, but SAP breakpoints might still work
          debugLog('Breakpoint', `VS Code UI update failed: ${caughtToString(uiError)}`);
        }
        
        let result = '';
        
        // Show detailed status for each breakpoint line
        result = `📍 **Breakpoint Results:**\n`;
        result += `**File:** ${source.name}\n`;
        if (condition) result += `**Condition:** ${condition}\n`;
        result += `\n**Line-by-Line Status:**\n`;
        
        lineNumbers.forEach((lineNum, index) => {
          const bp = actualBreakpoints[index];
          if (bp && bp.verified) {
            result += `  Line ${lineNum}: ✅ Set successfully\n`;
          } else if (bp) {
            result += `  Line ${lineNum}: ❌ Failed - Not executable code or invalid location\n`;
          } else {
            result += `  Line ${lineNum}: ❌ Failed - Unknown error\n`;
          }
        });
        
        result += `\n**Summary:** ${verifiedCount} of ${lineNumbers.length} breakpoints verified\n`;
        
        if (verifiedCount > 0) {
          result += `**VS Code UI:** Red dot indicators added\n`;
          result += `\n🎯 **Status:** Active breakpoints ready\n`;
          result += `Execute your ABAP program to trigger debugging.`;
        } else {
          result += `\n❌ **Issue:** No breakpoints were successfully set\n`;
          result += `**Possible causes:**\n`;
          result += `• Lines contain comments or non-executable statements\n`;
          result += `• Invalid line numbers for this source file\n`;
          result += `• Debug session not properly attached to SAP\n`;
        }
        
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(result)
        ]);
      } else if (action === 'remove') {
        // Remove breakpoints by setting an empty array using the breakpoint manager
        const debugListener = session.debugListener;
        if (!debugListener) {
          throw new Error('Debug listener not available');
        }

        const breakpointManager = debugListener.breakpointManager;
        const emptyBreakpoints: any[] = [];
        await breakpointManager.setBreakpoints(source, emptyBreakpoints);

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `✅ **Breakpoints removed from ABAP debugger!**\n` +
            `**File:** ${source.name}\n` +
            `**Lines:** ${lineNumbers.join(', ')}\n` +
            `All breakpoints have been cleared from SAP system.`
          )
        ]);
      } else {
        throw new Error(`Unknown breakpoint action: ${action}`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logCommands.error(`Breakpoint error: ${errorMessage}`);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to manage breakpoints: ${errorMessage}`)
      ]);
    }
  }
}

// ====================================
// DEBUG STEPPING CONTROL TOOL
// ====================================

export class ABAPDebugStepTool implements vscode.LanguageModelTool<IDebugStepParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDebugStepParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId, stepType, threadId, targetLine } = options.input;
    
    const stepDescriptions = {
      continue: 'Continue execution (F5)',
      stepOver: 'Step over (F6)',
      stepInto: 'Step into (F7)',
      stepReturn: 'Step return (F8)',
      jumpToLine: 'Jump to line'
    };
    
    const confirmationMessages = {
      title: 'ABAP Debug Step Control',
      message: new vscode.MarkdownString(
        `Debug step operation:\n\n` +
        `**Action:** ${stepDescriptions[stepType]}\n` +
        `**Connection:** ${connectionId}\n` +
        (threadId ? `**Thread ID:** ${threadId}\n` : '') +
        (targetLine ? `**Target Line:** ${targetLine}\n` : '')
      ),
    };

    return {
      invocationMessage: `Executing ${stepDescriptions[stepType]}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDebugStepParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { connectionId, stepType, threadId = 1, targetLine } = options.input;
    debugLog('Step', `invoke called`, { connectionId, stepType, threadId, targetLine });
    logTelemetry("tool_debug_step_called", { connectionId });

    try {
      debugLog('Step', `Looking for debug session for connection: ${connectionId}`);
      const session = AbapDebugSession.byConnection(connectionId);
      if (!session) {
        debugLog('Step', `No AbapDebugSession found for ${connectionId}`);
        throw new Error(`No active debug session found for connection ${connectionId}`);
      }
      debugLog('Step', `Found AbapDebugSession, checking VS Code debug session`);

      const activeDebugSession = vscode.debug.activeDebugSession;
      debugLog('Step', `VS Code activeDebugSession:`, { 
        exists: !!activeDebugSession, 
        type: activeDebugSession?.type,
        name: activeDebugSession?.name 
      });
      
      if (!activeDebugSession || activeDebugSession.type !== 'abap') {
        debugLog('Step', `No active ABAP debug session in VS Code`);
        throw new Error('No active ABAP debug session in VS Code');
      }

      debugLog('Step', `Executing step type: ${stepType}`);
      
      // Execute the appropriate debug command using VS Code Debug API
      switch (stepType) {
        case 'continue':
          debugLog('Step', `Sending continue request`);
          await activeDebugSession.customRequest('continue', { threadId });
          debugLog('Step', `Continue request completed`);
          break;
        
        case 'stepOver':
          debugLog('Step', `Sending next (stepOver) request`);
          await activeDebugSession.customRequest('next', { threadId });
          debugLog('Step', `Next request completed`);
          break;
        
        case 'stepInto':
          debugLog('Step', `Sending stepIn request`);
          await activeDebugSession.customRequest('stepIn', { threadId });
          debugLog('Step', `StepIn request completed`);
          break;
        
        case 'stepReturn':
          debugLog('Step', `Sending stepOut request`);
          await activeDebugSession.customRequest('stepOut', { threadId });
          debugLog('Step', `StepOut request completed`);
          break;
        
        case 'jumpToLine':
          if (!targetLine) {
            throw new Error('Target line is required for jumpToLine operation');
          }
          debugLog('Step', `Getting gotoTargets for line ${targetLine}`);
          // First get goto targets for the current source
          const gotoTargets = await activeDebugSession.customRequest('gotoTargets', {
            source: { path: window.activeTextEditor?.document.uri.toString() },
            line: targetLine
          });
          debugLog('Step', `gotoTargets response:`, gotoTargets);
          
          if (gotoTargets && gotoTargets.targets && gotoTargets.targets.length > 0) {
            debugLog('Step', `Sending goto request to target ${gotoTargets.targets[0].id}`);
            await activeDebugSession.customRequest('goto', {
              threadId,
              targetId: gotoTargets.targets[0].id
            });
            debugLog('Step', `Goto request completed`);
          } else {
            throw new Error(`Cannot jump to line ${targetLine} - target not available`);
          }
          break;
        
        default:
          throw new Error(`Unknown step type: ${stepType}`);
      }

      const stepDescriptions = {
        continue: 'Continued execution (F5)',
        stepOver: 'Stepped over (F6)', 
        stepInto: 'Stepped into (F7)',
        stepReturn: 'Stepped return (F8)',
        jumpToLine: `Jumped to line ${targetLine}`
      };

      debugLog('Step', `Step completed, waiting 500ms for location update`);
      // Wait a moment for the step to complete and get new location
      await new Promise(resolve => setTimeout(resolve, 500));
      
      let locationInfo = '';
      try {
        debugLog('Step', `Requesting stackTrace for new location`);
        const newStackTrace = await activeDebugSession.customRequest('stackTrace', {
          threadId,
          startFrame: 0,
          levels: 1
        });
        debugLog('Step', `stackTrace response:`, newStackTrace);
        
        if (newStackTrace && newStackTrace.stackFrames && newStackTrace.stackFrames.length > 0) {
          const currentFrame = newStackTrace.stackFrames[0];
          locationInfo += `\n📍 **New Location:** ${currentFrame.source?.name || 'unknown'} line ${currentFrame.line}\n`;
          locationInfo += `**Method:** ${currentFrame.name}\n`;
          
          // Get current code line
          if (currentFrame.source?.path) {
            try {
              const sourceUri = vscode.Uri.parse(currentFrame.source.path);
              let document = vscode.workspace.textDocuments.find(doc => 
                doc.uri.toString() === sourceUri.toString()
              );
              if (!document) {
                document = await vscode.workspace.openTextDocument(sourceUri);
              }
              
              const lineIndex = currentFrame.line - 1;
              if (lineIndex >= 0 && lineIndex < document.lineCount) {
                const currentLine = document.lineAt(lineIndex);
                const lineText = currentLine.text.trim();
                locationInfo += `**Current Code:** \`${lineText}\`\n`;
                
                // Add code context (2 lines before and after)
                const contextLines: string[] = [];
                for (let i = Math.max(0, lineIndex - 2); i <= Math.min(document.lineCount - 1, lineIndex + 2); i++) {
                  const line = document.lineAt(i);
                  const prefix = i === lineIndex ? '→ ' : '  ';
                  const lineNum = (i + 1).toString().padStart(3);
                  contextLines.push(`${prefix}${lineNum}: ${line.text}`);
                }
                
                if (contextLines.length > 0) {
                  locationInfo += `\n📝 **Code Context:**\n\`\`\`abap\n${contextLines.join('\n')}\n\`\`\`\n`;
                }
              }
            } catch (sourceErr) {
              debugLog('Step', `Error reading source: ${caughtToString(sourceErr)}`);
            }
          }
        }
      } catch (stackErr) {
        debugLog('Step', `Error getting stack trace: ${caughtToString(stackErr)}`);
        // If we can't get stack trace after continue, program likely finished
        if (stepType === 'continue') {
          // Check if there are any active services/threads left
          const session = AbapDebugSession.byConnection(connectionId);
          const debugListener = session?.debugListener;
          const activeServices = debugListener?.activeServices() || [];
          
          if (activeServices.length === 0) {
            locationInfo = '\n⏹️ **Program execution completed.** No active debug threads.\n' +
              '**Session remains active** - you can run another program to debug.\n' +
              'Use `abap_debug_session stop` if you want to end the session.';
          } else {
            locationInfo = '\n⏹️ **Execution continued.** Waiting at another breakpoint or running.\n' +
              `**Active threads:** ${activeServices.length}`;
          }
        } else {
          locationInfo = '\n⚠️ Could not retrieve new location. Debug session may have ended.';
        }
      }

      debugLog('Step', `Step completed successfully`);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ **${stepDescriptions[stepType]}**\n` +
          `**Connection:** ${connectionId}\n` +
          `**Thread:** ${threadId}\n` +
          `**Status:** Command executed successfully${locationInfo}`
        )
      ]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      debugLog('Step', `Error: ${errorMessage}`, error);
      logCommands.error(`Debug step error: ${errorMessage}`);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to execute debug step: ${errorMessage}`)
      ]);
    }
  }
}

// ====================================
// VARIABLE INSPECTION TOOL
// ====================================

export class ABAPDebugVariableTool implements vscode.LanguageModelTool<IVariableParameters> {
  
  /**
   * Apply advanced filtering to table rows
   * Supports multiple filter types:
   * - Simple: "ERROR" (contains text)
   * - Field-specific: "field:CUSTOMER_ID=1000" or "field:STATUS=ERROR"  
   * - Multiple conditions: "ERROR AND STATUS" or "field:TYPE=E OR field:TYPE=W"
   * - Numeric: "field:AMOUNT>1000" or "field:COUNT<5"
   * - Regex: "regex:^[A-Z]{3}[0-9]{3}$"
   */
  private applyAdvancedFilter(rows: any[], filter: string): any[] {
    const filterLower = filter.toLowerCase().trim();
    
    // Field-specific filter: field:FIELDNAME=VALUE or field:FIELDNAME>VALUE
    if (filterLower.startsWith('field:')) {
      return this.applyFieldFilter(rows, filterLower.substring(6));
    }
    
    // Regex filter: regex:pattern
    if (filterLower.startsWith('regex:')) {
      return this.applyRegexFilter(rows, filter.substring(6));
    }
    
    // Multiple conditions with AND/OR
    if (filterLower.includes(' and ') || filterLower.includes(' or ')) {
      return this.applyLogicalFilter(rows, filterLower);
    }
    
    // Simple contains filter (default)
    return rows.filter(row => {
      const rowValue = row.value.toString().toLowerCase();
      return rowValue.includes(filterLower);
    });
  }
  
  private applyFieldFilter(rows: any[], fieldFilter: string): any[] {
    // Parse field:FIELDNAME=VALUE, field:FIELDNAME>VALUE, etc.
    const match = fieldFilter.match(/^([^=<>!]+)([=<>!]+)(.+)$/);
    if (!match) {
      throw new Error(`Invalid field filter syntax: ${fieldFilter}. Use field:FIELDNAME=VALUE`);
    }
    
    const [, fieldName, operator, value] = match;
    const fieldNameUpper = fieldName.trim().toUpperCase();
    const targetValue = value.trim();
    
    return rows.filter(row => {
      try {
        // Extract field value from row (assuming structure format like "{ FIELD1: 'value1', FIELD2: 'value2' }")
        const rowStr = row.value.toString();
        const fieldMatch = rowStr.match(new RegExp(`${fieldNameUpper}:\\s*'([^']*)'|${fieldNameUpper}:\\s*([^,}\\s]+)`, 'i'));
        
        if (!fieldMatch) return false;
        
        const fieldValue = (fieldMatch[1] || fieldMatch[2] || '').trim();
        
        switch (operator) {
          case '=': return fieldValue.toLowerCase() === targetValue.toLowerCase();
          case '!=': return fieldValue.toLowerCase() !== targetValue.toLowerCase();
          case '>': return this.compareNumeric(fieldValue, targetValue, '>');
          case '<': return this.compareNumeric(fieldValue, targetValue, '<');
          case '>=': return this.compareNumeric(fieldValue, targetValue, '>=');
          case '<=': return this.compareNumeric(fieldValue, targetValue, '<=');
          default: return fieldValue.toLowerCase().includes(targetValue.toLowerCase());
        }
      } catch {
        return false;
      }
    });
  }
  
  private applyRegexFilter(rows: any[], pattern: string): any[] {
    try {
      const regex = new RegExp(pattern, 'i');
      return rows.filter(row => regex.test(row.value.toString()));
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${pattern}`);
    }
  }
  
  private applyLogicalFilter(rows: any[], filter: string): any[] {
    // Split by AND/OR and apply each condition
    const isAnd = filter.includes(' and ');
    const conditions = isAnd ? filter.split(' and ') : filter.split(' or ');
    
    return rows.filter(row => {
      const rowValue = row.value.toString().toLowerCase();
      const results = conditions.map(condition => {
        const conditionTrimmed = condition.trim();
        
        if (conditionTrimmed.startsWith('field:')) {
          try {
            return this.applyFieldFilter([row], conditionTrimmed.substring(6)).length > 0;
          } catch {
            return false;
          }
        } else {
          return rowValue.includes(conditionTrimmed);
        }
      });
      
      return isAnd ? results.every(r => r) : results.some(r => r);
    });
  }
  
  private compareNumeric(value1: string, value2: string, operator: string): boolean {
    const num1 = parseFloat(value1);
    const num2 = parseFloat(value2);
    
    if (isNaN(num1) || isNaN(num2)) {
      // Fallback to string comparison
      return operator === '>' ? value1 > value2 : value1 < value2;
    }
    
    switch (operator) {
      case '>': return num1 > num2;
      case '<': return num1 < num2;
      case '>=': return num1 >= num2;
      case '<=': return num1 <= num2;
      default: return false;
    }
  }

  private getVariableTypeIndicator(variable: any): string {
    if (variable.value.includes('Standard Table') || variable.value.includes('lines')) {
      return '📊'; // Table
    } else if (variable.variablesReference > 0) {
      return '📁'; // Structure  
    } else if (variable.value.match(/^\d+$/)) {
      return '🔢'; // Number
    } else if (variable.value.includes("'")) {
      return '📝'; // String
    } else {
      return '•'; // Other
    }
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IVariableParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId, variableName, expression, rowStart, rowCount, filter } = options.input;
    
    const confirmationMessages = {
      title: 'ABAP Variable Inspection',
      message: new vscode.MarkdownString(
        `Inspecting runtime data:\n\n` +
        `**Connection:** ${connectionId}\n` +
        (variableName ? `**Variable:** ${variableName}\n` : '') +
        (expression ? `**Expression:** ${expression}\n` : '') +
        (rowStart !== undefined ? `**Row Start:** ${rowStart}\n` : '') +
        (rowCount ? `**Row Count:** ${rowCount}\n` : '') +
        (filter ? `**Filter:** ${filter}\n` : '') +
        `\n📊 This will retrieve current runtime values.`
      ),
    };

    return {
      invocationMessage: `Inspecting ${variableName || expression || 'variables'}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IVariableParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { 
      connectionId, 
      threadId = 1, 
      frameId = 0, 
      variableName, 
      expression, 
      rowStart = 0,
      rowCount = 50,
      scopeName,
      filter,
      maxVariables = 100,
      filterPattern,
      expandStructures = false,
      expandTables = false
    } = options.input;
    
    debugLog('Variable', `invoke called`, { connectionId, threadId, frameId, variableName, expression, scopeName, filter });
    logTelemetry("tool_debug_variable_called", { connectionId });

    try {
      debugLog('Variable', `Looking for debug session`);
      const session = AbapDebugSession.byConnection(connectionId);
      if (!session) {
        debugLog('Variable', `No session found for ${connectionId}`);
        throw new Error(`No active debug session found for connection ${connectionId}`);
      }

      const activeDebugSession = vscode.debug.activeDebugSession;
      debugLog('Variable', `VS Code debug session:`, { exists: !!activeDebugSession, type: activeDebugSession?.type });
      
      if (!activeDebugSession || activeDebugSession.type !== 'abap') {
        throw new Error('No active ABAP debug session in VS Code');
      }

      let result = '';
      let frameIdWarning = '';
      let actualFrameId = frameId;
      
      // Auto-recover frame ID: Check if provided frameId is valid, if not get current stack
      try {
        debugLog('Variable', `Validating frameId ${frameId}`);
        const testScopes = await activeDebugSession.customRequest('scopes', { frameId });
        if (!testScopes || !testScopes.scopes || testScopes.scopes.length === 0) {
          throw new Error('Invalid frame');
        }
        debugLog('Variable', `FrameId ${frameId} is valid`);
      } catch (frameError) {
        debugLog('Variable', `FrameId ${frameId} is invalid, getting current stack`);
        try {
          const stackTrace = await activeDebugSession.customRequest('stackTrace', {
            threadId,
            startFrame: 0,
            levels: 5
          });
          if (stackTrace && stackTrace.stackFrames && stackTrace.stackFrames.length > 0) {
            const currentFrame = stackTrace.stackFrames[0];
            actualFrameId = currentFrame.id;
            frameIdWarning = `⚠️ **Note:** Provided frameId ${frameId} is no longer valid. ` +
              `Auto-recovered to current frame ${actualFrameId} (${currentFrame.name} at line ${currentFrame.line}).\n\n`;
            debugLog('Variable', `Auto-recovered to frameId ${actualFrameId}`);
          } else {
            throw new Error('No stack frames available - debug session may have ended');
          }
        } catch (stackError) {
          debugLog('Variable', `Failed to get stack trace: ${caughtToString(stackError)}`);
          throw new Error(`FrameId ${frameId} is invalid and could not auto-recover. Call abap_debug_stack to get valid frame IDs.`);
        }
      }

      if (expression) {
        // Evaluate ABAP expression
        debugLog('Variable', `Evaluating expression: ${expression}`);
        try {
          const evalResult = await activeDebugSession.customRequest('evaluate', {
            expression,
            frameId: actualFrameId,
            context: 'watch'
          });
          debugLog('Variable', `Expression result:`, evalResult);

          if (evalResult) {
            result += `🔍 **Expression Evaluation:**\n`;
            result += `**Expression:** ${expression}\n`;
            result += `**Result:** ${evalResult.result}\n`;
            result += `**Type:** ${evalResult.type || 'unknown'}\n`;
            
            if (evalResult.variablesReference && evalResult.variablesReference > 0) {
              result += `**Complex Type:** Yes (can be expanded)\n`;
            }
            result += `\n`;
          }
        } catch (evalError) {
          debugLog('Variable', `Expression evaluation error: ${caughtToString(evalError)}`);
          result += `❌ **Expression Error:** ${evalError}\n\n`;
        }
      }

      if (variableName) {
        debugLog('Variable', `Searching for variable ${variableName}`);
        
        // Get all stack frames to search through all of them
        let allFrames: any[] = [];
        try {
          const stackTrace = await activeDebugSession.customRequest('stackTrace', {
            threadId,
            startFrame: 0,
            levels: 20  // Get up to 20 frames
          });
          if (stackTrace && stackTrace.stackFrames) {
            allFrames = stackTrace.stackFrames;
          }
        } catch (stackErr) {
          debugLog('Variable', `Could not get stack trace, using single frame: ${caughtToString(stackErr)}`);
          allFrames = [{ id: actualFrameId, name: 'current' }];
        }
        
        let foundVariable: any = null;
        let foundScope: string | null = null;
        let foundFrameId: number | null = null;
        let foundFrameName: string | null = null;

        // Pre-parse SY-* variable names outside the loop
        const upperVariableName = variableName.toUpperCase();
        const syMatch = upperVariableName.match(/^SY[-_](.+)$/);
        const isSyVariable = !!syMatch;
        const syFieldName = syMatch ? syMatch[1] : null; // e.g., "DATUM" from "SY-DATUM"

        // Search through all frames for the variable
        for (const frame of allFrames) {
          debugLog('Variable', `Searching frame ${frame.id}: ${frame.name}`);
          try {
            const scopes = await activeDebugSession.customRequest('scopes', { frameId: frame.id });
            
            if (scopes && scopes.scopes) {
              for (const scope of scopes.scopes) {
                const scopeName = scope.name?.toUpperCase() || '';
                
                // For SY-* variables, ONLY search in the SY scope
                if (isSyVariable) {
                  if (scopeName !== 'SY') continue; // Skip non-SY scopes for SY-* variables
                }
                
                const scopeVars = await activeDebugSession.customRequest('variables', {
                  variablesReference: scope.variablesReference
                });

                if (scopeVars && scopeVars.variables) {
                  let variable: any = null;
                  
                  if (isSyVariable && scopeName === 'SY') {
                    // For SY-* variables in SY scope, search for just the field name
                    variable = scopeVars.variables.find((v: any) => 
                      v.name.toUpperCase() === syFieldName
                    );
                  } else {
                    // Normal variable search
                    variable = scopeVars.variables.find((v: any) => 
                      v.name.toUpperCase() === upperVariableName
                    );
                  }
                  
                  if (variable) {
                    debugLog('Variable', `Found variable ${variableName} in frame ${frame.id}, scope ${scope.name}`);
                    foundVariable = variable;
                    foundScope = scope.name;
                    foundFrameId = frame.id;
                    foundFrameName = frame.name;
                    break;
                  }
                }
              }
              if (foundVariable) break;
            }
          } catch (frameErr) {
            debugLog('Variable', `Error searching frame ${frame.id}: ${caughtToString(frameErr)}`);
          }
          if (foundVariable) break;
        }

        if (foundVariable) {
          result += `📋 **Variable Details:**\n`;
          result += `**Name:** ${foundVariable.name}\n`;
          result += `**Value:** ${foundVariable.value}\n`;
          result += `**Type:** ${foundVariable.type || 'unknown'}\n`;
          result += `**Scope:** ${foundScope}\n`;
          if (foundFrameId !== actualFrameId) {
            result += `**Frame:** ${foundFrameName} (ID: ${foundFrameId})\n`;
          }

          // Handle complex variables (structures, tables)
          if (foundVariable.variablesReference && foundVariable.variablesReference > 0) {
            const childVars = await activeDebugSession.customRequest('variables', {
              variablesReference: foundVariable.variablesReference
            });

            if (childVars && childVars.variables) {
              const isTable = foundVariable.value && foundVariable.value.includes('lines');
              
              if (isTable) {
                const totalRows = childVars.variables.length;
                let rowsToShow = childVars.variables;
                
                if (filter) {
                  // FILTER MODE: Return first N matching rows, ignore row interval
                  try {
                    const filteredRows = this.applyAdvancedFilter(childVars.variables, filter);
                    const maxRows = rowCount; // Use rowCount as max results when filtering
                    rowsToShow = filteredRows.slice(0, maxRows);
                    
                    result += `**Total Table Rows:** ${totalRows}\n`;
                    result += `**Filter:** "${filter}"\n`;
                    result += `**Matching Rows:** ${filteredRows.length}\n`;
                    result += `**Showing:** ${rowsToShow.length} of ${filteredRows.length} matches\n\n`;
                    
                    if (filteredRows.length === 0) {
                      result += `❌ **No rows match filter:** "${filter}"\n`;
                    } else {
                      result += `📊 **Filtered Table Content:**\n`;
                      rowsToShow.forEach((row: any, index: number) => {
                        result += `Match ${index + 1}: ${row.name} = ${row.value}\n`;
                      });
                      
                      if (filteredRows.length > maxRows) {
                        result += `\n💡 **${filteredRows.length - maxRows} more matches available.** Refine filter or increase rowCount.\n`;
                      }
                    }
                  } catch (filterError) {
                    result += `⚠️ **Filter Error:** ${filterError}\n`;
                    // Fallback to simple contains filter
                    const simpleFiltered = childVars.variables.filter((row: any) => {
                      const rowValue = row.value.toString().toLowerCase();
                      return rowValue.includes(filter.toLowerCase());
                    });
                    rowsToShow = simpleFiltered.slice(0, rowCount);
                    result += `**Fallback Filter Applied:** ${rowsToShow.length} matches\n\n`;
                  }
                } else {
                  // ROW INTERVAL MODE: Pagination without filtering
                  const endRow = Math.min(rowStart + rowCount, totalRows);
                  const actualRowStart = Math.min(rowStart, Math.max(0, totalRows - 1));
                  rowsToShow = childVars.variables.slice(actualRowStart, endRow);
                  
                  result += `**Total Table Rows:** ${totalRows}\n`;
                  result += `**Row Range:** ${actualRowStart + 1}-${Math.min(endRow, totalRows)}\n`;
                  result += `**Showing:** ${rowsToShow.length} rows\n\n`;
                  
                  result += `📊 **Table Content:**\n`;
                  rowsToShow.forEach((row: any, index: number) => {
                    const actualRowNum = actualRowStart + index + 1;
                    result += `Row ${actualRowNum}: ${row.name} = ${row.value}\n`;
                  });
                  
                  if (totalRows > endRow) {
                    result += `\n💡 **More data available:** Use rowStart=${endRow} to see next rows\n`;
                  }
                }
              } else {
                // Structure or other complex type
                result += `**Components:** ${childVars.variables.length}\n\n`;
                result += `📊 **Structure Content:**\n`;
                
                const componentCount = Math.min(childVars.variables.length, 20);
                for (let i = 0; i < componentCount; i++) {
                  const component = childVars.variables[i];
                  result += `${component.name}: ${component.value}\n`;
                }
                
                if (childVars.variables.length > 20) {
                  result += `... and ${childVars.variables.length - 20} more components\n`;
                }
              }
            }
          }
          result += `\n`;
        } else {
          result += `❌ Variable '${variableName}' not found in any stack frame.\n\n`;
        }
      }

      if (!variableName && !expression) {
        // Get all variables in current scope or specific scope
        const scopes = await activeDebugSession.customRequest('scopes', { frameId: actualFrameId });

        if (scopes && scopes.scopes) {
          result += `📋 **Available Scopes (Frame ${actualFrameId}):**\n\n`;
          
          const scopesToShow = scopeName ? 
            scopes.scopes.filter((s: any) => s.name === scopeName) : 
            scopes.scopes;

          for (const scope of scopesToShow) {
            result += `**${scope.name}:**\n`;
            
            const scopeVars = await activeDebugSession.customRequest('variables', {
              variablesReference: scope.variablesReference
            });

            if (scopeVars && scopeVars.variables) {
              let filteredVars = scopeVars.variables;
              
              // Apply filter pattern if provided
              if (filterPattern) {
                const pattern = filterPattern.replace(/\*/g, '.*').replace(/\?/g, '.');
                const regex = new RegExp(`^${pattern}$`, 'i');
                filteredVars = scopeVars.variables.filter((v: any) => regex.test(v.name));
                result += `**Filter Pattern:** ${filterPattern} (${filteredVars.length} matches)\n`;
              }
              
              // Group variables by name for display (but preserve all instances for debugging)
              const variableGroups = new Map<string, any[]>();
              filteredVars.forEach((variable: any) => {
                if (!variableGroups.has(variable.name)) {
                  variableGroups.set(variable.name, []);
                }
                variableGroups.get(variable.name)!.push(variable);
              });
              
              const uniqueNames = Array.from(variableGroups.keys());
              const displayCount = Math.min(uniqueNames.length, maxVariables);
              
              for (let i = 0; i < displayCount; i++) {
                const varName = uniqueNames[i];
                const instances = variableGroups.get(varName)!;
                const variable = instances[0]; // Use first instance for display
                
                let valuePreview = variable.value.length > 100 ? 
                  variable.value.substring(0, 100) + '...' : 
                  variable.value;
                
                // Add type indicators
                const typeIndicator = this.getVariableTypeIndicator(variable);
                const duplicateInfo = instances.length > 1 ? ` (${instances.length} instances)` : '';
                result += `  ${typeIndicator} ${variable.name}: ${valuePreview}${duplicateInfo}\n`;
                
                // Expand structures if requested
                if (expandStructures && variable.variablesReference > 0 && !variable.value.includes('lines')) {
                  try {
                    const childVars = await activeDebugSession.customRequest('variables', {
                      variablesReference: variable.variablesReference
                    });
                    if (childVars && childVars.variables) {
                      // Show all components up to maxVariables limit (not just 20)
                      const componentsToShow = Math.min(childVars.variables.length, maxVariables);
                      
                      for (let j = 0; j < componentsToShow; j++) {
                        const child = childVars.variables[j];
                        result += `    ├─ ${child.name}: ${child.value}\n`;
                      }
                      
                      if (childVars.variables.length > componentsToShow) {
                        result += `    └─ ... and ${childVars.variables.length - componentsToShow} more components\n`;
                      }
                    }
                  } catch {
                    // Ignore expansion errors
                  }
                }
                
                // Expand tables if requested
                if (expandTables && variable.variablesReference > 0 && variable.value.includes('lines')) {
                  try {
                    const tableVars = await activeDebugSession.customRequest('variables', {
                      variablesReference: variable.variablesReference
                    });
                    if (tableVars && tableVars.variables) {
                      const showRows = Math.min(tableVars.variables.length, 5);
                      for (let j = 0; j < showRows; j++) {
                        const row = tableVars.variables[j];
                        
                        // If row is a structure, expand it to show field values
                        if (row.variablesReference > 0) {
                          try {
                            const rowFields = await activeDebugSession.customRequest('variables', {
                              variablesReference: row.variablesReference
                            });
                            if (rowFields && rowFields.variables) {
                              const fieldValues = rowFields.variables.map((field: any) => 
                                `${field.name}: ${field.value}`
                              ).join(', ');
                              result += `    [${j + 1}] { ${fieldValues} }\n`;
                            } else {
                              result += `    [${j + 1}] ${row.value}\n`;
                            }
                          } catch {
                            result += `    [${j + 1}] ${row.value}\n`;
                          }
                        } else {
                          result += `    [${j + 1}] ${row.value}\n`;
                        }
                      }
                      if (tableVars.variables.length > 5) {
                        result += `    ... and ${tableVars.variables.length - 5} more rows\n`;
                      }
                    }
                  } catch {
                    // Ignore expansion errors
                  }
                }
              }
              
              if (uniqueNames.length > maxVariables) {
                result += `  ... and ${uniqueNames.length - maxVariables} more unique variables (use maxVariables to see more)\n`;
              }
              
              if (filterPattern && filteredVars.length === 0) {
                result += `  No variables match pattern "${filterPattern}"\n`;
              }
            }
            result += `\n`;
          }
        }
      }

      if (!result) {
        result = '❌ No variable data available. Ensure debugger is paused at a breakpoint.';
      }

      // Prepend frame ID warning if applicable
      const finalResult = frameIdWarning + result;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(finalResult)
      ]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logCommands.error(`Variable inspection error: ${errorMessage}`);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to inspect variables: ${errorMessage}`)
      ]);
    }
  }
}

// ====================================
// STACK TRACE TOOL
// ====================================

export class ABAPDebugStackTool implements vscode.LanguageModelTool<IStackTraceParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IStackTraceParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId, threadId } = options.input;
    
    const confirmationMessages = {
      title: 'ABAP Stack Trace',
      message: new vscode.MarkdownString(
        `Getting call stack information:\n\n` +
        `**Connection:** ${connectionId}\n` +
        (threadId ? `**Thread ID:** ${threadId}\n` : '') +
        `\n📚 This will show the current execution stack.`
      ),
    };

    return {
      invocationMessage: `Getting stack trace for ${connectionId}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IStackTraceParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { connectionId, threadId = 1 } = options.input;
    debugLog('Stack', `invoke called`, { connectionId, threadId });
    logTelemetry("tool_debug_stack_called", { connectionId });

    try {
      debugLog('Stack', `Looking for debug session`);
      const session = AbapDebugSession.byConnection(connectionId);
      if (!session) {
        debugLog('Stack', `No session found for ${connectionId}`);
        throw new Error(`No active debug session found for connection ${connectionId}`);
      }
      
      debugLog('Stack', `Session found, checking debugListener`);
      const debugListener = session.debugListener;
      debugLog('Stack', `debugListener:`, { 
        exists: !!debugListener, 
        activeServices: debugListener?.activeServices()?.length || 0 
      });

      const activeDebugSession = vscode.debug.activeDebugSession;
      debugLog('Stack', `VS Code debug session:`, { exists: !!activeDebugSession, type: activeDebugSession?.type });
      
      if (!activeDebugSession || activeDebugSession.type !== 'abap') {
        throw new Error('No active ABAP debug session in VS Code');
      }

      debugLog('Stack', `Requesting stackTrace for thread ${threadId}`);
      // Get stack trace
      const stackTrace = await activeDebugSession.customRequest('stackTrace', {
        threadId,
        startFrame: 0,
        levels: 50 // Limit stack depth
      });
      debugLog('Stack', `stackTrace response:`, { frameCount: stackTrace?.stackFrames?.length || 0 });

      if (!stackTrace || !stackTrace.stackFrames) {
        throw new Error('No stack trace available - debugger may not be paused');
      }

      let result = `📚 **Call Stack (${stackTrace.stackFrames.length} frames):**\n\n`;

      for (let i = 0; i < stackTrace.stackFrames.length; i++) {
        const frame = stackTrace.stackFrames[i];
        result += `**Frame ${frame.id}:** ${frame.name}\n`;
        result += `  📄 Source: ${frame.source?.name || 'unknown'}\n`;
        result += `  📍 Line: ${frame.line}`;
        if (frame.column && frame.column > 0) {
          result += `, Column: ${frame.column}`;
        }
        result += `\n`;
        
        // Add current execution indicator
        if (i === 0) {
          result += `  ➤ **Current execution point**\n`;
        }
        result += `\n`;
      }

      result += `🔍 **Usage Tips:**\n`;
      result += `• Use frame IDs to inspect variables at different call levels\n`;
      result += `• Frame 0 is the current execution point\n`;
      result += `• Use variable tool with frameId parameter to inspect variables at specific frames\n`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(result)
      ]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logCommands.error(`Stack trace error: ${errorMessage}`);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to get stack trace: ${errorMessage}`)
      ]);
    }
  }
}

// ====================================
// DEBUG STATUS TOOL
// ====================================

export class ABAPDebugStatusTool implements vscode.LanguageModelTool<IDebugStatusParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDebugStatusParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'ABAP Debug Status',
      message: new vscode.MarkdownString(
        `Checking debugging session status:\n\n` +
        `**Connection:** ${connectionId}\n` +
        `\n📊 This will show current debug session information.`
      ),
    };

    return {
      invocationMessage: `Checking debug status for ${connectionId}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDebugStatusParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { connectionId } = options.input;
    debugLog('Status', `invoke called`, { connectionId });
    logTelemetry("tool_debug_status_called", { connectionId });

    try {
      debugLog('Status', `Looking for sessions`);
      const session = AbapDebugSession.byConnection(connectionId);
      const activeSession = vscode.debug.activeDebugSession;
      
      debugLog('Status', `Session info:`, { 
        hasAbapSession: !!session, 
        hasVSCodeSession: !!activeSession,
        vsCodeType: activeSession?.type,
        totalSessions: AbapDebugSession.activeSessions
      });
      
      // Log debugListener details if available
      if (session) {
        const debugListener = session.debugListener;
        debugLog('Status', `DebugListener info:`, {
          exists: !!debugListener,
          activeServicesCount: debugListener?.activeServices()?.length || 0,
          services: debugListener?.activeServices()?.map(([id, s]) => ({ id, name: s.debuggee?.NAME })) || []
        });
      }
      
      let result = `📊 **ABAP Debug Status:**\n\n`;
      
      result += `**Connection:** ${connectionId}\n`;
      result += `**ABAP Session Active:** ${session ? 'Yes' : 'No'}\n`;
      result += `**VS Code Debug Active:** ${activeSession ? 'Yes' : 'No'}\n`;
      result += `**Debug Session Type:** ${activeSession?.type || 'None'}\n`;
      result += `**Total Active Sessions:** ${AbapDebugSession.activeSessions}\n`;

      if (session && activeSession && activeSession.type === 'abap') {
        try {
          debugLog('Status', `Getting threads`);
          // Get threads
          const threads = await activeSession.customRequest('threads');
          debugLog('Status', `Threads response:`, threads);
          
          if (threads && threads.threads) {
            result += `**Active Threads:** ${threads.threads.length}\n`;
            
            result += `\n🧵 **Thread Details:**\n`;
            for (const thread of threads.threads) {
              result += `  • Thread ${thread.id}: ${thread.name}\n`;
            }
          }

          // Try to get current stack to see if we're paused
          try {
            debugLog('Status', `Getting stackTrace`);
            const stackTrace = await activeSession.customRequest('stackTrace', {
              threadId: 1,
              startFrame: 0,
              levels: 1
            });
            debugLog('Status', `StackTrace response:`, { frameCount: stackTrace?.stackFrames?.length || 0 });
            
            if (stackTrace && stackTrace.stackFrames && stackTrace.stackFrames.length > 0) {
              const currentFrame = stackTrace.stackFrames[0];
              result += `\n🎯 **Current State:** Paused at breakpoint\n`;
              result += `**Current Location:** ${currentFrame.source?.name || 'unknown'} line ${currentFrame.line}\n`;
              result += `**Current Method:** ${currentFrame.name}\n`;
              
              // Try to get the actual source code at current line
              if (currentFrame.source?.path) {
                try {
                  const sourceUri = vscode.Uri.parse(currentFrame.source.path);
                  
                  // First check if document is already open (to get current editor content with unsaved changes)
                  let document = vscode.workspace.textDocuments.find(doc => 
                    doc.uri.toString() === sourceUri.toString()
                  );
                  
                  // If not already open, then open it (will get SAP server version)
                  if (!document) {
                    document = await vscode.workspace.openTextDocument(sourceUri);
                  }
                  
                  const lineIndex = currentFrame.line - 1; // VS Code uses 0-based line numbers
                  
                  if (lineIndex >= 0 && lineIndex < document.lineCount) {
                    const currentLine = document.lineAt(lineIndex);
                    const lineText = currentLine.text.trim();
                    
                    const isDirty = document.isDirty ? ' (unsaved changes)' : '';
                    result += `**Current Code:** \`${lineText}\`${isDirty}\n`;
                    
                    // Also show some context (2 lines before and after)
                    const contextLines: string[] = [];
                    for (let i = Math.max(0, lineIndex - 2); i <= Math.min(document.lineCount - 1, lineIndex + 2); i++) {
                      const line = document.lineAt(i);
                      const prefix = i === lineIndex ? '→ ' : '  ';
                      const lineNum = (i + 1).toString().padStart(3);
                      contextLines.push(`${prefix}${lineNum}: ${line.text}`);
                    }
                    
                    if (contextLines.length > 0) {
                      result += `\n📝 **Code Context:**${isDirty}\n\`\`\`abap\n${contextLines.join('\n')}\n\`\`\`\n`;
                    }
                  }
                } catch (sourceError) {
                  // Couldn't get source code, but that's okay
                  result += `**Current Code:** (source not available)\n`;
                }
              }
            } else {
              // Check if there are any threads - if none, execution likely completed
              const threads = await activeSession.customRequest('threads');
              if (threads && threads.threads && threads.threads.length === 0) {
                result += `\n✅ **Current State:** Completed - Execution finished\n`;
              } else {
                result += `\n🏃 **Current State:** Running - Executing between breakpoints\n`;
              }
            }
          } catch {
            // If we can't get stack trace, check thread count to determine state
            try {
              const threads = await activeSession.customRequest('threads');
              if (threads && threads.threads && threads.threads.length === 0) {
                result += `\n✅ **Current State:** Completed - Execution finished\n`;
              } else {
                result += `\n🏃 **Current State:** Running - Executing between breakpoints\n`;
              }
            } catch {
              result += `\n❓ **Current State:** Unknown - Cannot determine execution state\n`;
            }
          }

          result += `\n🔧 **Available Operations:**\n`;
          result += `• Set/remove breakpoints\n`;
          result += `• Step through code (continue, stepOver, stepInto, stepReturn)\n`;
          result += `• Inspect variables and expressions\n`;
          result += `• Navigate call stack\n`;
          result += `• Evaluate ABAP expressions\n`;
          result += `• Jump to specific lines\n`;
          
        } catch (statusError) {
          result += `\n⚠️ **Status Check Error:** ${statusError}\n`;
        }
      } else {
        result += `\n❌ **Status:** No active debugging session\n`;
        result += `\n💡 **To start debugging:**\n`;
        result += `1. Use abap_debug_session tool with action='start'\n`;
        result += `2. Set breakpoints using abap_debug_breakpoint tool\n`;
        result += `3. Execute your ABAP program in SAP\n`;
        result += `4. Debugger will pause at breakpoints\n`;
        result += `5. Use debug tools to control execution and inspect data\n`;
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(result)
      ]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logCommands.error(`Debug status error: ${errorMessage}`);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to get debug status: ${errorMessage}`)
      ]);
    }
  }
}

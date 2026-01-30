/**
 * Connected Systems Tool
 * LM tool to list all currently connected SAP systems in VS Code
 * 
 * This is especially useful for MCP clients (Cursor, Claude Code, etc.) that 
 * cannot see VS Code's workspace and need to discover available connection IDs.
 */

import * as vscode from 'vscode';
import { connectedRoots } from '../../config';

// ============================================================================
// INTERFACE
// ============================================================================

// No input parameters needed - this tool just lists what's connected
export interface IConnectedSystemsParameters {
  // Empty - no parameters required
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🔗 CONNECTED SYSTEMS TOOL
 * Lists all SAP systems currently connected in VS Code.
 * Returns connection IDs that can be used with other ABAP FS tools.
 */
export class ConnectedSystemsTool implements vscode.LanguageModelTool<IConnectedSystemsParameters> {
  
  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<IConnectedSystemsParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: 'Getting list of connected SAP systems...',
    };
  }

  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<IConnectedSystemsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const roots = connectedRoots();
      const connectionIds = Array.from(roots.keys());
      
      if (connectionIds.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            'No SAP systems are currently connected. User needs to connect first using "ABAP FS: Connect to an SAP system" command.'
          )
        ]);
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Connected SAP systems: ${connectionIds.join(', ')}`
        )
      ]);

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get connected systems: ${errorMsg}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerConnectedSystemsTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('get_connected_systems', new ConnectedSystemsTool())
  );
}

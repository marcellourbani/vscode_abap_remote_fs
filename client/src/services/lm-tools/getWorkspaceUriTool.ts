/**
 * ABAP Get Workspace URI Tool
 * Get workspace URI for direct file access to ABAP objects
 */

import * as vscode from 'vscode';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IGetAbapObjectWorkspaceUriParameters {
  objectName: string;
  objectType: string;
  connectionId: string;
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🔗 GET ABAP OBJECT WORKSPACE URI TOOL - Get workspace URI for direct file access
 */
export class GetAbapObjectWorkspaceUriTool implements vscode.LanguageModelTool<IGetAbapObjectWorkspaceUriParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetAbapObjectWorkspaceUriParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, objectType, connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Get ABAP Object Workspace URI',
      message: new vscode.MarkdownString(
        `Get workspace URI for ABAP object:\n` +
        `• **Object:** ${objectName}\n` +
        `• **Type:** ${objectType}\n` +
        `• **Connection:** ${connectionId}`
      ),
    };

    return {
      invocationMessage: `Getting workspace URI for ${objectName} (${objectType})`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetAbapObjectWorkspaceUriParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { objectName, objectType, connectionId } = options.input;
    logTelemetry("tool_get_abap_object_workspace_uri_called", { connectionId });
    
    if (connectionId) {
      connectionId = connectionId.toLowerCase();
    }

    try {
      const { getClient } = await import('../../adt/conections');
      const { getOrCreateRoot } = await import('../../adt/conections');
      
      const client = getClient(connectionId);
      
      const results = await client.searchObject(objectName, objectType);
      
      const exactMatch = results.find(r => 
        r["adtcore:name"] === objectName &&
        r["adtcore:type"] === objectType
      );
      
      if (!exactMatch) {
        throw new Error(`Object ${objectName} (${objectType}) not found in connection ${connectionId}`);
      }
      
      if (results.length > 1) {
        throw new Error(`Multiple objects found for ${objectName} (${objectType})`);
      }
      
      const root = await getOrCreateRoot(connectionId);
      const { path } = (await root.findByAdtUri(exactMatch["adtcore:uri"], true)) || {};
      
      if (!path) {
        throw new Error(`Could not resolve workspace path for object ${objectName}`);
      }
      
      const workspaceUri = `adt://${connectionId}${path}`;
      
      const resultText = `**ABAP Object Workspace URI** ✅\n\n` +
        `• **Object:** ${exactMatch["adtcore:name"]}\n` +
        `• **Type:** ${exactMatch["adtcore:type"]}\n` +
        `• **Package:** ${exactMatch["adtcore:packageName"] || 'Unknown'}\n` +
        `• **Description:** ${exactMatch["adtcore:description"] || 'No description'}\n` +
        `• **ADT URI:** \`${exactMatch["adtcore:uri"]}\`\n` +
        `• **Workspace URI:** \`${workspaceUri}\`\n\n` +
        `**📁 Use the workspace URI to access the object content directly with standard VS Code file operations.**`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      throw new Error(`Failed to get workspace URI for ABAP object: ${String(error)}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerGetWorkspaceUriTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('get_abap_object_workspace_uri', new GetAbapObjectWorkspaceUriTool())
  );
}

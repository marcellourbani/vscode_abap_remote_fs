/**
 * ABAP Open Object Tool
 * Open ABAP objects in the VS Code editor
 */

import * as vscode from 'vscode';
import { getSearchService } from '../abapSearchService';
import { openObject } from '../../commands/commands';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IOpenObjectParameters {
  objectName: string;
  objectType?: string;
  connectionId: string;
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 📂 OPEN OBJECT TOOL
 */
export class OpenObjectTool implements vscode.LanguageModelTool<IOpenObjectParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IOpenObjectParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, objectType, connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Open ABAP Object',
      message: new vscode.MarkdownString(
        `Opening ABAP object in editor:\n\n` +
        `**Object:** ${objectName}\n` +
        (objectType ? `**Type:** ${objectType}\n` : '') +
        `**Connection:** ${connectionId}`
      ),
    };

    return {
      invocationMessage: `Opening ${objectName}${objectType ? ` (${objectType})` : ''}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IOpenObjectParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { objectName, objectType, connectionId } = options.input;
    logTelemetry("tool_open_object_called", { connectionId });

    try {
      const searcher = getSearchService(connectionId.toLowerCase());
      const searchResults = await searcher.searchObjects(objectName, objectType ? [objectType] : undefined, 1);
      
      if (!searchResults || searchResults.length === 0) {
        throw new Error(`Could not find ABAP object: ${objectName}. Please check the object name and ensure it exists.`);
      }
      
      const objectInfo = searchResults[0];
      if (!objectInfo.uri) {
        throw new Error(`Could not get URI for ABAP object: ${objectName}.`);
      }

      await openObject(connectionId.toLowerCase(), objectInfo.uri);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`✅ Object ${objectName} opened successfully in the editor.`)
      ]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to open object: ${errorMessage}`)
      ]);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerOpenObjectTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('open_object', new OpenObjectTool())
  );
}

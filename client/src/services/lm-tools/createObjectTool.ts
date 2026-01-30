/**
 * ABAP Create Object Tool
 * Programmatic creation of ABAP objects
 */

import * as vscode from 'vscode';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACE
// ============================================================================

export interface ICreateObjectParameters {
  objectType: string;  // e.g., "PROG/P", "CLAS/OC"
  name: string;
  description: string;
  packageName?: string;
  parentName?: string;
  connectionId?: string;
  additionalOptions?: {
    serviceDefinition?: string;
    bindingType?: string;
    bindingCategory?: string;
    softwareComponent?: string;
    packageType?: string;
    transportLayer?: string;
    transportRequest?: {
      type: 'new' | 'existing';
      number?: string;
      description?: string;
    };
  };
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🏗️ CREATE ABAP OBJECT TOOL - Programmatic object creation
 */
export class CreateABAPObjectTool implements vscode.LanguageModelTool<ICreateObjectParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ICreateObjectParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectType, name, description, packageName = '$TMP', connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Create ABAP Object',
      message: new vscode.MarkdownString(
        `Create new ABAP object:\n` +
        `• **Type:** ${objectType}\n` +
        `• **Name:** ${name}\n` +
        `• **Description:** ${description}\n` +
        `• **Package:** ${packageName}` +
        (connectionId ? `\n• **Connection:** ${connectionId}` : '')
      ),
    };

    return {
      invocationMessage: `Creating ${objectType}: ${name}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICreateObjectParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { objectType, name, description, packageName = '$TMP', parentName, connectionId, additionalOptions } = options.input;
    logTelemetry("tool_create_abap_object_called", { connectionId });
    
    if (connectionId) {
      connectionId = connectionId.toLowerCase();
    }

    try {
      const result = await vscode.commands.executeCommand(
        'abapfs.createObjectProgrammatically',
        objectType,
        name,
        description,
        packageName,
        parentName,
        connectionId,
        additionalOptions
      );

      if (result && typeof result === 'object' && 'success' in result) {
        const structuredResult = result as any;
        
        if (!structuredResult.success) {
          let errorText = '';
          
          if (structuredResult.message && structuredResult.message.includes('Object not found in workspace')) {
            errorText = `**ABAP Object Creation Failed** ❌\n\n` +
              `• **Object Type:** ${objectType}\n` +
              `• **Name:** ${name}\n` +
              `• **Error:** ${structuredResult.error || 'WORKSPACE_REGISTRATION_FAILED'}\n` +
              `• **Message:** ${structuredResult.message}\n\n` +
              `**NOTE:** Even though this error occurred, the object may have been successfully created in SAP. This error typically happens during the workspace registration phase, not during object creation itself.\n\n` +
              `**Suggested Actions:**\n` +
              `1. Use get_abap_object_workspace_uri tool to get the workspace URI for object "${name}" with type "${objectType}"\n` +
              `2. If you get a valid URI, try opening it in VS Code to verify the object exists\n` +
              `3. The object creation in SAP was likely successful despite this error`;
          } else {
            errorText = `**ABAP Object Creation Failed** ❌\n\n` +
              `• **Object Type:** ${objectType}\n` +
              `• **Name:** ${name}\n` +
              `• **Error:** ${structuredResult.error || 'UNKNOWN_ERROR'}\n` +
              `• **Message:** ${structuredResult.message || 'No error message provided'}\n\n` +
              `The object could not be created. Please check the error details above and try again.`;
          }

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(errorText)
          ]);
        }
      }

      const resultText = `**ABAP Object Created Successfully** ✅\n\n` +
        `• **Object Type:** ${objectType}\n` +
        `• **Name:** ${name}\n` +
        `• **Description:** ${description}\n` +
        `• **Package:** ${packageName}\n` +
        `• **Status:** Created and ready for development\n\n` +
        `The object has been created in the SAP system and is ready for editing.`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      throw new Error(`Failed to create ABAP object: ${String(error)}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerCreateObjectTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('create_object_programmatically', new CreateABAPObjectTool())
  );
}

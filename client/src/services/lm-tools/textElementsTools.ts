import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { logCommands } from "../abapCopilotLogger";
import { session_types } from "abap-adt-api";
import { logTelemetry } from '../telemetry';

// Text Elements Tool Interfaces
export interface IManageTextElementsParameters {
  objectName: string; // Name of the ABAP object
  objectType: 'PROGRAM' | 'CLASS' | 'FUNCTION_GROUP'; // Type of object (mandatory for Language Model Tool - Copilot provides this)
  action: 'read' | 'create' | 'update';
  textElements?: Array<{
    id: string;
    text: string;
    maxLength?: number;
  }>;
  connectionId?: string;
}

/**
 * � MANAGE TEXT ELEMENTS TOOL - Unified tool for read/create/update text elements
 */
export class ManageTextElementsTool implements vscode.LanguageModelTool<IManageTextElementsParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IManageTextElementsParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, objectType, action, textElements, connectionId } = options.input;
    
    let message = `**Action:** ${action.toUpperCase()}\n**Object:** ${objectName}`;
    if (objectType) {
      message += `\n**Type:** ${objectType}`;
    }
    message += `\n**Connection:** ${connectionId || 'auto-detect'}`;
    
    if (action === 'create' || action === 'update') {
      message += `\n**Text Elements:** ${textElements?.length || 0}`;
      message += '\n\n💡 **Best Practice:** Always read existing text elements first to avoid duplicates and to know which text IDs are already in use.';
      if (action === 'update') {
        message += '\n\n⚠️ **This will modify existing text elements in the SAP system.**';
      }
    }
    
    const confirmationMessages = {
      title: `${action === 'read' ? 'Read' : action === 'create' ? 'Create' : 'Update'} Text Elements`,
      message: new vscode.MarkdownString(message),
    };

    return {
      invocationMessage: `${action === 'read' ? 'Reading' : action === 'create' ? 'Creating' : 'Updating'} text elements for ${objectType ? objectType + ' ' : ''}${objectName}...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IManageTextElementsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { objectName, objectType, action, textElements, connectionId } = options.input;
    logTelemetry("tool_manage_text_elements_called", { connectionId });
    
    // 🚫 FORCE READ ACTION ONLY - Create/Update disabled due to lock handle issues
    // if (action === 'create' || action === 'update') {
    //  // logCommands.info(`⚠️ Text Elements Tool: ${action} action disabled, forcing READ action instead`);
    //   action = 'read'; // Force to read action
    // }
    
    // Ensure connectionId is lowercase for consistency
    if (connectionId) {
        connectionId = connectionId.toLowerCase();
    }
   // logCommands.info(`📖 Manage Text Elements Tool: ${action} for ${objectName}`);

    try {
      // Import the connection and text elements API
      const { getClient, abapUri } = await import('../../adt/conections');
     // const { getTextElementsSafe, updateTextElementsWithTransport } = await import('../adt/textElements');
      
      // Resolve connectionId - same pattern as other language model tools
      let actualConnectionId = connectionId;
      
      // If no connectionId provided, try to get from active editor
      if (!actualConnectionId) {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor || !abapUri(activeEditor.document.uri)) {
          throw new Error('No active ABAP document and no connectionId provided. Please open an ABAP file or provide connectionId parameter.');
        }
        actualConnectionId = activeEditor.document.uri.authority;
      }
      
      // Get connection
      const client = getClient(actualConnectionId,false);
      if (!client) {
        throw new Error('No ADT connection available. Please connect to an SAP system first.');
      }

      if (action === 'read') {
        return await this.handleRead(client, objectName, objectType, actualConnectionId);
      } else if (action === 'create' || action === 'update') {
        if (!textElements || textElements.length === 0) {
          throw new Error('Text elements array is required for create/update operations');
        }
        
        // For both CREATE and UPDATE, merge with existing text elements to avoid data loss
        let finalTextElements = textElements;
        try {
          const { getTextElementsSafe } = await import('../../adt/textElements');
          const existingResult = await getTextElementsSafe(client, objectName, objectType);
          const existingElements = existingResult.textElements;
          
          if (existingElements.length > 0) {
            // Create a map of new/updated elements by ID
            const updatesMap = new Map(textElements.map(el => [el.id, el]));
            
            // Start with existing elements, then apply updates
            const mergedElements = existingElements.map(existing => 
              updatesMap.get(existing.id) || existing
            );
            
            // Add any completely new elements that weren't in existing
            const existingIds = new Set(existingElements.map(el => el.id));
            const newElements = textElements.filter(el => !existingIds.has(el.id));
            
            finalTextElements = [...mergedElements, ...newElements];
          }
        } catch (error) {
          // If we can't read existing elements, proceed with just the provided ones
          logCommands.warn(`⚠️ Could not read existing text elements for merge: ${error}`);
        }
        
        client.stateful = session_types.stateful;       
        return await this.handleCreateUpdate(client, objectName, objectType, finalTextElements, action);
      } else {
        throw new Error(`Invalid action: ${action}. Must be 'read', 'create', or 'update'`);
      }

    } catch (error) {
      logCommands.error(`❌ Manage Text Elements Tool error: ${error}`);
      throw new Error(`Failed to ${action} text elements: ${String(error)}`);
    }
  }

  private async handleRead(client: any, objectName: string, objectType?: string, connectionId?: string): Promise<vscode.LanguageModelToolResult> {
    const { getTextElementsSafe, parseObjectName, getTextElementsUrlFromObjectInfo } = await import('../../adt/textElements');
    
    try {
      // Use explicit object type when provided, fallback to detection when not
      const result = await getTextElementsSafe(client, objectName, objectType);
      
      let resultText = `**📖 Text Elements for ${result.programName}** ✅\n\n`;
      resultText += `• **Object:** ${result.programName}\n`;
      resultText += `• **Total Text Elements:** ${result.textElements.length}\n\n`;

      if (result.textElements.length > 0) {
        resultText += `**🎯 Text Elements:**\n`;
        result.textElements.forEach(element => {
          const maxLengthInfo = element.maxLength ? ` (max: ${element.maxLength})` : '';
          resultText += `• **${element.id}:** "${element.text}"${maxLengthInfo}\n`;
        });
      } else {
        resultText += `**ℹ️ No text elements found** - This program has no defined text elements.`;
      }

     // logCommands.info(`✅ Read Text Elements: Found ${result.textElements.length} text elements`);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);
      
    } catch (error) {
      // Check if it's a "Resource does not exist" error - fallback to SAP GUI for old systems
      const errorMessage = String(error);
      if (errorMessage.includes('Resource') && errorMessage.includes('does not exist')) {
        
        if (!connectionId) {
          throw new Error('Cannot determine connection ID for SAP GUI fallback');
        }
        
        // Call the existing SAP GUI fallback function with proper object type
        const { openTextElementsInSapGui } = await import('../../commands/textElementsCommands');
        await openTextElementsInSapGui(objectName + (objectType === 'CLASS' ? '.clas.abap' : objectType === 'FUNCTION_GROUP' ? '.fugr.abap' : '.prog.abap'), connectionId);
        
        const resultText = `**🌐 Text Elements Editor Opened in SAP GUI** ✅\n\n` +
          `• **Object:** ${objectName}\n` +
          `• **System:** ${connectionId.toUpperCase()}\n` +
          `• **Reason:** ADT text elements API not available on this system\n\n` +
          `**ℹ️ The text elements editor has been opened in an embedded SAP GUI webview.** ` +
          `User can edit text elements directly in the SAP GUI interface.`;

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(resultText)
        ]);
        
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  }

  private async handleCreateUpdate(
    client: any, 
    objectName: string,
    objectType: string | undefined,
    textElements: Array<{id: string, text: string, maxLength?: number}>,
    action: 'create' | 'update'
  ): Promise<vscode.LanguageModelToolResult> {
    // Import the transport-aware function
    const { updateTextElementsWithTransport } = await import('../../adt/textElements');
    
    // Create/update text elements using our transport-aware API with explicit object type when available
    await updateTextElementsWithTransport(client, objectName, textElements, objectType);
    
    let resultText = `**✏️ Text Elements ${action === 'create' ? 'Created' : 'Updated'} for ${objectName}** ✅\n\n`;
    resultText += `• **Object:** ${objectName}\n`;
    resultText += `• **Text Elements ${action === 'create' ? 'Created' : 'Updated'}:** ${textElements.length}\n\n`;

    resultText += `**🎯 ${action === 'create' ? 'Created' : 'Updated'} Text Elements:**\n`;
    textElements.forEach(element => {
      const maxLengthInfo = element.maxLength ? ` (max: ${element.maxLength})` : '';
      resultText += `• **${element.id}:** "${element.text}"${maxLengthInfo}\n`;
    });

    resultText += `\n**✅ Success:** Text elements have been ${action === 'create' ? 'created' : 'updated'} in the SAP system.`;
    resultText += `\n\n**💡 Next Steps:** Update your ABAP code to use these text elements:`;
    textElements.forEach(element => {
      resultText += `\n• Replace hardcoded text with: \`TEXT-${element.id}\``;
    });

    logCommands.info(`✅ ${action} Text Elements: Successfully processed ${textElements.length} text elements`);

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(resultText)
    ]);
  }
}

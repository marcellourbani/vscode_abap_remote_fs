/**
 * ABAP Get Object URL Tool
 * Generate SAP GUI URLs for browser automation
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IGetAbapObjectUrlParameters {
  objectName: string;
  objectType?: string;
  connectionId?: string;
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🔗 GET ABAP OBJECT URL TOOL - Generate SAP GUI URLs for browser automation
 */
export class GetAbapObjectUrlTool implements vscode.LanguageModelTool<IGetAbapObjectUrlParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetAbapObjectUrlParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, objectType = 'PROG/P', connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Generate SAP GUI URL',
      message: new vscode.MarkdownString(
        `Generate SAP GUI URL for ABAP object: \`${objectName}\` (${objectType})` +
        (connectionId ? ` (connection: ${connectionId})` : '')
      ),
    };

    return {
      invocationMessage: `Generating SAP GUI URL for: ${objectName}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetAbapObjectUrlParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { 
      objectName, 
      objectType = 'PROG/P',
      connectionId 
    } = options.input;
    logTelemetry("tool_get_abap_object_url_called", { connectionId });
    
    if (connectionId) {
      connectionId = connectionId.toLowerCase();
    }

    try {
      const { SapGuiPanel } = await import('../../views/sapgui/SapGuiPanel');
      const { RemoteManager } = await import('../../config');
      
      let activeConnectionId = connectionId;
      
      if (!activeConnectionId) {
        const activeEditor = window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.scheme === 'adt') {
          activeConnectionId = activeEditor.document.uri.authority;
        } else {
          throw new Error('No connection ID provided and no active ABAP document found');
        }
      }
      
      const config = RemoteManager.get().byId(activeConnectionId);
      if (!config) {
        throw new Error(`Connection configuration not found for ID: ${activeConnectionId}`);
      }

      const { ADTClient } = await import('abap-adt-api');
      
      const client = new ADTClient(
        config.url,
        config.username,
        config.password,
        config.client,
        config.language
      );
      
      const sapGuiPanel = SapGuiPanel.createOrShow(
        vscode.Uri.file(__dirname),
        client,
        activeConnectionId,
        objectName,
        objectType
      );
      
      const webguiUrl = await sapGuiPanel.buildWebGuiUrl();
      
      const transactionInfo = SapGuiPanel.getTransactionInfo(objectType, objectName);
      
      sapGuiPanel.dispose();

      const resultText = `**🔗 SAP GUI URL Generated Successfully** ✅\n\n` +
        `• **Object:** ${objectName}\n` +
        `• **Type:** ${objectType}\n` +
        `• **Connection:** ${activeConnectionId}\n` +
        `• **Transaction:** ${transactionInfo.transaction}\n` +
        `• **URL:** \`${webguiUrl}\`\n\n` +
        `**📖 Usage with MCP Playwright:**\n` +
        `Use this URL with the Playwright MCP server (HTTP mode) to automate SAP GUI interactions:\n` +
        `1. Navigate to the URL using \`mcp_playwright_browser_navigate\`\n` +
        `2. Ask user to login so you can continue \n` +
        `3. Use \`mcp_playwright_browser_snapshot\` for testing/navigation (not screenshots)\n` +
        `4. Interact with elements using \`mcp_playwright_browser_click\` and \`mcp_playwright_browser_type\`\n` +
        `5. Take screenshots only for reference using \`mcp_playwright_browser_take_screenshot\`\n\n` +
        `**🎯 Ready for Browser Automation!**`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      throw new Error(`Failed to generate SAP GUI URL: ${String(error)}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerGetObjectUrlTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('get_abap_object_url', new GetAbapObjectUrlTool())
  );
}

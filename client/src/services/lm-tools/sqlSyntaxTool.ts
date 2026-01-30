/**
 * Get ABAP SQL Syntax Tool
 * Returns ABAP SQL syntax documentation from a markdown file
 */

import * as vscode from 'vscode';
import { logTelemetry } from '../telemetry';
import { logCommands } from '../abapCopilotLogger';

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 📘 GET ABAP SQL SYNTAX DOCUMENTATION TOOL
 * Returns ABAP SQL syntax documentation from a markdown file
 * No parameters needed - just returns the full syntax guide
 */
export class GetABAPSQLSyntaxTool implements vscode.LanguageModelTool<{}> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<{}>,
    _token: vscode.CancellationToken
  ) {
    const confirmationMessages = {
      title: 'Get ABAP SQL Syntax',
      message: new vscode.MarkdownString(
        `Retrieve ABAP SQL syntax documentation to understand ABAP-specific SQL syntax before executing queries.`
      ),
    };

    return {
      invocationMessage: `Loading ABAP SQL syntax documentation...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{}>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    logTelemetry("tool_get_abap_sql_syntax_called");
    
    try {
      const context = (await import('../../extension')).context;
      const path = await import('path');
      const fs = await import('fs');
      
      const syntaxFilePath = path.join(context.extensionPath, 'client', 'dist', 'media', 'sql_syntax.md');
      
      if (!fs.existsSync(syntaxFilePath)) {
        throw new Error(`SQL syntax file not found at: ${syntaxFilePath}`);
      }
      
      const syntaxContent = fs.readFileSync(syntaxFilePath, 'utf8');
      
      let resultText = `⚠️ **IMPORTANT: READ THIS COMPLETE SYNTAX GUIDE CAREFULLY BEFORE CALLING execute_data_query**\n\n`;
      resultText += `📘 **ABAP SQL Syntax Documentation**\n\n`;
      resultText += `The following syntax guide contains CRITICAL differences between standard SQL and ABAP SQL. `;
      resultText += `You MUST follow these rules when constructing SQL queries for SAP systems.\n\n`;
      resultText += `---\n\n`;
      resultText += syntaxContent;
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      logCommands.error('❌ Failed to get ABAP SQL syntax:', error);
      
      throw new Error(`Failed to load ABAP SQL syntax documentation: ${error}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerSqlSyntaxTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('get_abap_sql_syntax', new GetABAPSQLSyntaxTool())
  );
}

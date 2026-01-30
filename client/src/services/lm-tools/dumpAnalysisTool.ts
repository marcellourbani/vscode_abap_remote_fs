/**
 * ABAP Dump Analysis Tool
 * Analyze runtime dumps for troubleshooting
 */

import * as vscode from 'vscode';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IDumpAnalysisParameters {
  action: 'list_dumps' | 'analyze_dump';
  connectionId: string; // Mandatory - need SAP system connection
  dumpId?: string; // Required for analyze_dump action
  maxResults?: number; // For list_dumps action (default: 20, max: 100)
  includeFullContent?: boolean; // Include raw HTML content for analysis
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🔍 ABAP DUMP ANALYSIS TOOL - Comprehensive dump analysis and troubleshooting
 */
export class ABAPDumpAnalysisTool implements vscode.LanguageModelTool<IDumpAnalysisParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDumpAnalysisParameters>,
    _token: vscode.CancellationToken
  ) {
    const { action, connectionId, dumpId, maxResults = 20 } = options.input;
    
    let actionDescription = '';
    switch (action) {
      case 'list_dumps':
        actionDescription = `List available ABAP runtime dumps from system feed (max ${maxResults})`;
        break;
      case 'analyze_dump':
        actionDescription = `Analyze specific dump: ${dumpId}`;
        break;
    }

    const confirmationMessages = {
      title: 'Analyze ABAP Dumps',
      message: new vscode.MarkdownString(
        actionDescription + (connectionId ? ` (connection: ${connectionId})` : '') +
        '\n\nThis will access dump data for AI-powered analysis and troubleshooting assistance.'
      ),
    };

    return {
      invocationMessage: `Analyzing ABAP dumps: ${action}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDumpAnalysisParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { action, connectionId, dumpId, maxResults = 20, includeFullContent = false } = options.input;
    logTelemetry("tool_analyze_abap_dumps_called", { connectionId });

    try {
      // connectionId is now mandatory
      const actualConnectionId = connectionId.toLowerCase();

      const { getClient } = await import('../../adt/conections');
      const client = getClient(actualConnectionId);

      // Validate required parameters based on action
      if (action === 'analyze_dump' && !dumpId) {
        throw new Error('dumpId parameter is required for analyze_dump action');
      }

      switch (action) {
        case 'list_dumps':
          return await this.listDumps(client, actualConnectionId, maxResults);
        
        case 'analyze_dump':
          return await this.analyzeDump(client, actualConnectionId, dumpId!, includeFullContent);
        
        default:
          throw new Error(`Unknown action: ${action}`);
      }

    } catch (error) {
      throw new Error(`Failed to analyze ABAP dumps: ${String(error)}`);
    }
  }

  private async listDumps(client: any, connectionId: string, maxResults: number): Promise<vscode.LanguageModelToolResult> {
    // Safety limit to prevent excessive API calls
    maxResults = Math.min(maxResults, 100);
    try {
      // Check if dumps feed is available
      const feeds = await client.feeds();
      const dumpFeed = feeds.find((f: any) => f.href === '/sap/bc/adt/runtime/dumps');
      
      if (!dumpFeed) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`❌ **Dumps not available** - This SAP system does not support dump access via ADT API.`)
        ]);
      }

      const dumpfeed = await client.dumps();
      const dumps = dumpfeed.dumps || [];

      if (dumps.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`✅ **No dumps found** - No recent ABAP runtime errors in system ${connectionId}.`)
        ]);
      }

      // Limit results
      const limitedDumps = dumps.slice(0, maxResults);
      
      let result = `**ABAP Runtime Dumps** (${limitedDumps.length} of ${dumps.length} total)\n`;
      result += `System: ${connectionId}\n\n`;
      result += `💡 **To analyze a specific dump, use the analyze_dump action with the exact Dump ID shown below.**\n\n`;
      
      for (let i = 0; i < limitedDumps.length; i++) {
        const dump = limitedDumps[i];
        const errorType = dump.categories?.find((c: any) => c.label === "ABAP runtime error")?.term || "Unknown Error";
        
        result += `${i + 1}. **${errorType}**\n`;
        result += `   Dump ID: \`${dump.id || 'N/A'}\`\n`;
        if (dump.updated) result += `   Timestamp: ${new Date(dump.updated).toLocaleString()}\n`;
        if (dump.text) result += `   Content Size: ${Math.round(dump.text.length / 1024)}KB\n`;
        result += `\n`;
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(result)
      ]);
      
    } catch (error) {
      throw new Error(`Failed to list dumps: ${String(error)}`);
    }
  }

  private async analyzeDump(client: any, connectionId: string, dumpId: string, includeFullContent: boolean): Promise<vscode.LanguageModelToolResult> {
    try {
      const dumpfeed = await client.dumps();
      const dump = dumpfeed.dumps?.find((d: any) => d.id === dumpId);
      
      if (!dump) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`❌ **Dump not found** - No dump with ID "${dumpId}" found in system ${connectionId}.`)
        ]);
      }

      const errorType = dump.categories?.find((c: any) => c.label === "ABAP runtime error")?.term || "Unknown Error";
      
      let result = `**ABAP Dump Analysis**\n`;
      result += `System: ${connectionId}\n`;
      result += `Dump ID: ${dumpId}\n`;
      result += `Error Type: ${errorType}\n`;
      if (dump.updated) result += `Timestamp: ${new Date(dump.updated).toLocaleString()}\n`;
      result += `\n`;

      // Analyze HTML content structure (without unreliable parsing)
      if (dump.text) {
        const htmlContent = dump.text;
        
        result += `Content Size: ${Math.round(htmlContent.length / 1024)}KB HTML\n`;
        
        const hasTableStructure = htmlContent.includes('<table') || htmlContent.includes('<tr');
        const hasPreformatted = htmlContent.includes('<pre>') || htmlContent.includes('<code>');
        const hasLinks = htmlContent.includes('href');
        
        if (hasTableStructure) result += `Contains tabular data\n`;
        if (hasPreformatted) result += `Contains code blocks\n`;
        if (hasLinks) result += `Contains navigation links\n`;

        if (includeFullContent) {
          result += `\n**Full Dump Content:**\n`;
          result += `\`\`\`html\n${htmlContent}\n\`\`\`\n`;
        }


      } else {
        result += `No detailed content available\n`;
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(result)
      ]);
      
    } catch (error) {
      throw new Error(`Failed to analyze dump: ${String(error)}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerDumpAnalysisTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('analyze_abap_dumps', new ABAPDumpAnalysisTool())
  );
}

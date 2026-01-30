/**
 * ABAP Get Batch Lines Tool
 * Retrieve lines from multiple ABAP objects in a single request
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { getSearchService } from '../abapSearchService';
import { abapUri } from '../../adt/conections';
import { logTelemetry } from '../telemetry';
import { getOptimalObjectURI, resolveCorrectURI } from './shared';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IBatchLinesParameters {
  requests: Array<{
    objectName: string;
    startLine?: number;
    lineCount?: number;
  }>;
  connectionId?: string;
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 📦 GET BATCH LINES TOOL
 */
export class GetBatchLinesTool implements vscode.LanguageModelTool<IBatchLinesParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IBatchLinesParameters>,
    _token: vscode.CancellationToken
  ) {
    const { requests, connectionId } = options.input;
    
    const objectNames = requests.map(req => req.objectName).join(', ');
    
    const confirmationMessages = {
      title: 'Get Batch Lines from ABAP Objects',
      message: new vscode.MarkdownString(
        `Get lines from ${requests.length} ABAP objects: \`${objectNames}\`` +
        (connectionId ? ` (connection: ${connectionId})` : '')
      ),
    };

    return {
      invocationMessage: `Getting batch lines from ${requests.length} objects`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IBatchLinesParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { requests, connectionId } = options.input;
    logTelemetry("tool_get_batch_lines_called", { connectionId });
    
    if (connectionId) {
      connectionId = connectionId.toLowerCase();
    }

    try {
      let actualConnectionId = connectionId;
      
      if (!actualConnectionId) {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor || !abapUri(activeEditor.document.uri)) {
          throw new Error('No active ABAP document and no connectionId provided. Please open an ABAP file or provide connectionId parameter.');
        }
        actualConnectionId = activeEditor.document.uri.authority;
      }

      const finalConnectionId = actualConnectionId;
      const searcher = getSearchService(finalConnectionId);
      
      // Process all requests in parallel
      const results = await Promise.all(
        requests.map(async (req) => {
          try {
            const searchResults = await searcher.searchObjects(req.objectName, undefined, 1);
            
            if (!searchResults || searchResults.length === 0) {
              return {
                objectName: req.objectName,
                success: false,
                content: `Object ${req.objectName} not found`,
                lines: 0
              };
            }
            
            const objectInfo = searchResults[0];
            if (!objectInfo.uri) {
              return {
                objectName: req.objectName,
                success: false,
                content: `No URI available for ${req.objectName}`,
                lines: 0
              };
            }
            
            const { getClient } = await import('../../adt/conections');
            const client = getClient(finalConnectionId);
            
            let sourceContent = '';
            let uriUsed = '';
            
            const optimalUri = getOptimalObjectURI(objectInfo.type, objectInfo.uri);
            
            try {
              sourceContent = await client.getObjectSource(optimalUri);
              uriUsed = optimalUri;
            } catch (optimizedError) {
              if (optimalUri !== objectInfo.uri) {
                try {
                  sourceContent = await client.getObjectSource(objectInfo.uri);
                  uriUsed = objectInfo.uri;
                } catch (originalError) {
                  const resolvedUri = await resolveCorrectURI(objectInfo.uri, finalConnectionId);
                  const finalUri = getOptimalObjectURI(objectInfo.type, resolvedUri);
                  
                  try {
                    sourceContent = await client.getObjectSource(finalUri);
                    uriUsed = finalUri;
                  } catch (finalError) {
                    throw new Error(`Could not get source content after trying multiple approaches. Last error: ${finalError}`);
                  }
                }
              } else {
                const resolvedUri = await resolveCorrectURI(objectInfo.uri, finalConnectionId);
                const finalUri = getOptimalObjectURI(objectInfo.type, resolvedUri);
                
                try {
                  sourceContent = await client.getObjectSource(finalUri);
                  uriUsed = finalUri;
                } catch (finalError) {
                  throw new Error(`Could not get source content. Optimized error: ${optimizedError}. Resolved error: ${finalError}`);
                }
              }
            }
            
            if (!sourceContent) {
              throw new Error('Source content is empty');
            }
            
            const lines = sourceContent.split('\n');
            const startLine = req.startLine || 0;
            const lineCount = req.lineCount || 10;
            const totalLines = lines.length;
            const endLine = Math.min(startLine + lineCount, totalLines);
            const actualLines = endLine - startLine;
            
            const requestedLines = lines.slice(startLine, endLine);
            const content = requestedLines.join('\n');
            
            return {
              objectName: req.objectName,
              success: true,
              content: content.trim(),
              lines: actualLines,
              uriUsed: uriUsed
            };
            
          } catch (error) {
            return {
              objectName: req.objectName,
              success: false,
              content: `Error accessing ${req.objectName}: ${error}`,
              lines: 0
            };
          }
        })
      );

      const resultText = `**Batch Lines Results** (${requests.length} objects):\n\n` +
        results.map(result => {
          if (result.success) {
            return `### **${result.objectName}** (${result.lines} lines)\n` +
                   `\`\`\`abap\n${result.content}\n\`\`\`\n`;
          } else {
            return `### **${result.objectName}**\n❌ ${result.content}\n`;
          }
        }).join('\n');

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      throw new Error(`Failed to get batch lines: ${String(error)}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerGetBatchLinesTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('get_batch_lines', new GetBatchLinesTool())
  );
}

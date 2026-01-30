/**
 * ABAP Get Object By URI Tool
 * Direct access to ABAP objects using ADT URIs
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

export interface IGetObjectByURIParameters {
  uri: string;
  startLine?: number;
  lineCount?: number;
  connectionId?: string;
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🎯 GET OBJECT BY URI TOOL - Direct access using ADT paths!
 */
export class GetObjectByURITool implements vscode.LanguageModelTool<IGetObjectByURIParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetObjectByURIParameters>,
    _token: vscode.CancellationToken
  ) {
    const { uri, startLine = 0, lineCount = 50, connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Get ABAP Object by URI',
      message: new vscode.MarkdownString(
        `Direct access to ABAP object via URI: \`${uri}\`\n` +
        `Lines: ${startLine}-${startLine + lineCount}` +
        (connectionId ? ` (connection: ${connectionId})` : '')
      ),
    };

    return {
      invocationMessage: `Accessing object via URI: ${uri}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetObjectByURIParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { uri, startLine = 0, lineCount = 50, connectionId } = options.input;
    logTelemetry("tool_get_object_by_uri_called", { connectionId });
    
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
      
      const { getClient } = await import('../../adt/conections');
      const client = getClient(actualConnectionId);
      
      let sourceContent = '';
      let uriUsed = '';
      
      // Intelligent URI approach
      let optimalUri = uri;
      
      if (!uri.includes('/source/main')) {
        const objectTypeMatch = uri.match(/\/(ddic|oo|programs|functions)\/(\w+)\/([^\/]+)/);
        if (objectTypeMatch) {
          const [, category, subType] = objectTypeMatch;
          let detectedType = '';
          
          if (category === 'ddic') {
            if (subType === 'tables') detectedType = 'TABL/TA';
            else if (subType === 'dataelements') detectedType = 'DTEL/DE';
            else if (subType === 'domains') detectedType = 'DOMA/DD';
            else if (subType === 'tabletypes') detectedType = 'TTYP/DA';
          } else if (category === 'oo') {
            if (subType === 'classes') detectedType = 'CLAS/OC';
            else if (subType === 'interfaces') detectedType = 'INTF/OI';
          } else if (category === 'programs') {
            detectedType = 'PROG/P';
          } else if (category === 'functions') {
            detectedType = 'FUNC/FF';
          }
          
          if (detectedType) {
            optimalUri = getOptimalObjectURI(detectedType, uri);
          }
        }
      }
      
      try {
        sourceContent = await client.getObjectSource(optimalUri);
        uriUsed = optimalUri;
      } catch (primaryError) {
        if (optimalUri !== uri) {
          try {
            sourceContent = await client.getObjectSource(uri);
            uriUsed = uri;
          } catch (originalError) {
            const resolvedUri = await resolveCorrectURI(uri, actualConnectionId);
            try {
              sourceContent = await client.getObjectSource(resolvedUri);
              uriUsed = resolvedUri;
            } catch (resolvedError) {
              throw new Error(`Could not get source content after trying multiple approaches. Last error: ${resolvedError}`);
            }
          }
        } else {
          const resolvedUri = await resolveCorrectURI(uri, actualConnectionId);
          try {
            sourceContent = await client.getObjectSource(resolvedUri);
            uriUsed = resolvedUri;
          } catch (resolvedError) {
            throw new Error(`Could not get source content. Primary error: ${primaryError}. Resolved error: ${resolvedError}`);
          }
        }
      }
      
      if (!sourceContent) {
        throw new Error('Source content is empty');
      }
      
      const lines = sourceContent.split('\n');
      const totalLines = lines.length;
      const endLine = Math.min(startLine + lineCount, totalLines);
      const actualLines = endLine - startLine;
      
      const requestedLines = lines.slice(startLine, endLine);
      const content = requestedLines.join('\n');
      
      try {
        const resultText = `**Direct URI Access Successful** ✅\n\n` +
          `**Original URI:** \`${uri}\`\n` +
          `**URI Used:** \`${uriUsed}\`\n` +
          `**Lines:** ${startLine}-${endLine} (${actualLines} lines retrieved)\n` +
          `**Total Lines:** ${totalLines}\n\n` +
          `\`\`\`abap\n${content.trim()}\n\`\`\``;

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(resultText)
        ]);

      } catch (docError) {
        const objectName = this.extractObjectNameFromURI(uri);
        
        if (objectName) {
          try {
            const searcher = getSearchService(actualConnectionId);
            const searchResults = await searcher.searchObjects(objectName, undefined, 1);
            
            if (searchResults && searchResults.length > 0) {
              const objectInfo = searchResults[0];
              if (objectInfo.uri) {
                const resolvedUri = await resolveCorrectURI(objectInfo.uri, actualConnectionId);
                const fallbackUri = `adt://${actualConnectionId}${resolvedUri}`;
                const fallbackUriObj = vscode.Uri.parse(fallbackUri);
                
                const existingEditor = window.visibleTextEditors.find(
                  editor => editor.document.uri.toString() === fallbackUriObj.toString()
                );
                
                let document: vscode.TextDocument;
                if (existingEditor) {
                  document = existingEditor.document;
                } else {
                  document = await vscode.workspace.openTextDocument(fallbackUriObj);
                }
                
                const totalLines = document.lineCount;
                const endLine = Math.min(startLine + lineCount, totalLines);
                const actualLines = endLine - startLine;
                
                let content = '';
                for (let i = startLine; i < endLine; i++) {
                  content += document.lineAt(i).text + '\n';
                }
                
                const resultText = `**URI Access via Object Name** ⚠️\n\n` +
                  `**Original URI:** \`${uri}\`\n` +
                  `**Extracted Name:** ${objectName}\n` +
                  `**Resolved URI:** \`${resolvedUri}\`\n` +
                  `**Lines:** ${startLine}-${endLine} (${actualLines} lines)\n\n` +
                  `\`\`\`abap\n${content.trim()}\n\`\`\``;

                return new vscode.LanguageModelToolResult([
                  new vscode.LanguageModelTextPart(resultText)
                ]);
              }
            }
          } catch {
            // Fallback failed
          }
        }
        
        throw new Error(`Could not access object via URI: ${uri}. Direct access failed: ${docError}`);
      }

    } catch (error) {
      throw new Error(`Failed to access object by URI: ${String(error)}`);
    }
  }

  private extractObjectNameFromURI(uri: string): string | null {
    const patterns = [
      /\/programs\/programs\/([^\/]+)$/i,
      /\/oo\/classes\/([^\/]+)$/i,
      /\/functions\/groups\/([^\/]+)\/fmodules\/([^\/]+)$/i,
      /\/ddic\/tables\/([^\/]+)$/i
    ];

    for (const pattern of patterns) {
      const match = uri.match(pattern);
      if (match) {
        return match[match.length - 1].toUpperCase();
      }
    }

    return null;
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerGetObjectByUriTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('get_object_by_uri', new GetObjectByURITool())
  );
}

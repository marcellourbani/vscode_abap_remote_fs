/**
 * ABAP Search Objects Tool - VSCode AI Integration
 * 
 * Provides object search capabilities using the ABAP object searcher
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { getSearchService } from '../abapSearchService';
import { abapUri } from '../../adt/conections';
import { logTelemetry } from '../telemetry';

// Tool parameter interface
export interface ISearchABAPObjectsParameters {
  pattern: string;
  connectionId?: string;
  types?: Array<
    'FUNC' | 'CLAS' | 'TABL' | 'PROG' | 'INTF' | 'DTEL' | 'DDLS' | 'DOMA' | 'TTYP' | 
    'ENQU' | 'MSAG' | 'FUGR' | 'DEVC' | 'TRAN' | 'VIEW' | 'SICF' | 'WDYN' | 
    'SPRX' | 'XSLT' | 'TRANSFORMATIONS' | 'SUSH' | 'SUSC' | 'PINF' | 
    'ENHC' | 'ENHS' | 'BADI' | 'BADII' | 'SAMC' | 'SAPC' | 'SFSW' | 'SFBF' | 'SFBS' | 
    'JOBD' | 'NROB'
  >;
  maxResults?: number;
}

/**
 * 🔍 SEARCH ABAP OBJECTS TOOL
 */
export class SearchABAPObjectsTool implements vscode.LanguageModelTool<ISearchABAPObjectsParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchABAPObjectsParameters>,
    _token: vscode.CancellationToken
  ) {
    const { pattern, types, maxResults, connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Search ABAP Objects',
      message: new vscode.MarkdownString(
        `Search SAP system for ABAP objects matching pattern: \`${pattern}\`` +
        (connectionId ? ` (connection: ${connectionId})` : '') +
        (types ? ` (types: ${types.join(', ')})` : ' (all types)') +
        (maxResults ? ` (max ${maxResults} results)` : '')
      ),
    };

    return {
      invocationMessage: `Searching ABAP objects: ${pattern}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ISearchABAPObjectsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { pattern, types, maxResults = 20, connectionId } = options.input;
    logTelemetry("tool_search_abap_objects_called", { connectionId });

    // Ensure connectionId is lowercase for consistency
    if (connectionId) {
      connectionId = connectionId.toLowerCase();
    }
    

    try {
      let actualConnectionId = connectionId;
      
      // If no connectionId provided, try to get from active editor
      if (!actualConnectionId) {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor || !abapUri(activeEditor.document.uri)) {
          throw new Error('No active ABAP document and no connectionId provided. Please open an ABAP file or provide connectionId parameter.');
        }
        actualConnectionId = activeEditor.document.uri.authority;
      }

      const searcher = getSearchService(actualConnectionId);
      
      // Search for objects
      const objects = await searcher.searchObjects(pattern, types, maxResults);

      if (!objects || objects.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`No ABAP objects found matching pattern: ${pattern}`)
        ]);
      }

      // Format results for LLM with URI paths
      const results = objects.map(obj => ({
        name: obj.name,
        type: obj.type,
        description: obj.description || '',
        package: obj.package || '',
        uri: obj.uri || ''
      }));

      const resultText = `Found ${results.length} ABAP objects matching "${pattern}":\n\n` +
        results.map(obj => 
          `• **${obj.name}** (${obj.type})\n` +
          `  - Description: ${obj.description}\n` +
          `  - Package: ${obj.package}\n` +
          `  - URI Path: \`${obj.uri}\`\n` +
          `  - Full ADT Path: \`adt://${actualConnectionId}${obj.uri}\``
        ).join('\n\n');


      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      throw new Error(`Failed to search ABAP objects: ${String(error)}`);
    }
  }
}

/**
 * Register the Search Objects tool
 */
export function registerSearchObjectsTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.lm.registerTool('search_abap_objects', new SearchABAPObjectsTool())
  );
}

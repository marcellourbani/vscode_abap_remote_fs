/**
 * ABAP Where-Used Analysis Tool
 * Find all references and usage locations
 */

import * as vscode from 'vscode';
import { getSearchService } from '../abapSearchService';
import { getOptimalObjectURI } from './shared';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IWhereUsedParameters {
  objectName: string; // Mandatory - need object to search for
  connectionId: string; // Mandatory - need SAP system connection
  objectType?: string; // Optional: specify exact type to avoid ambiguity
  searchTerm?: string; // Optional: specific symbol/method/variable to search for
  line?: number; // Optional: specific line number for context-sensitive search
  character?: number; // Optional: character position for precise symbol search
  maxResults?: number; // Maximum number of references to return (default: 50)
  includeSnippets?: boolean; // Include code snippets showing usage context (warning: can be slow for large result sets)
  
  // Pagination support - for large result sets
  startIndex?: number; // Start from this result index (0-based). Use to skip earlier results and access later ones (e.g., startIndex: 5000 to get results starting from 5000)
  
  // Filtering support - narrow down results
  filter?: {
    objectNamePattern?: string; // Filter by object name pattern (supports wildcards: "Z*", "*CUSTOM*", "ZXX_*")
    objectTypes?: string[]; // Filter by specific object types (e.g., ["PROG/P", "CLAS/OC", "FUGR/FF"])
    excludeSystemObjects?: boolean; // Exclude SAP standard objects (objects not starting with Z or Y)
  };
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🔍 ABAP WHERE-USED ANALYSIS TOOL - Find all references and usage locations
 */
export class ABAPWhereUsedTool implements vscode.LanguageModelTool<IWhereUsedParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IWhereUsedParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, objectType, searchTerm, line, character, connectionId, maxResults = 50, startIndex, filter } = options.input;
    
    let target = objectName;
    if (objectType) target += ` (${objectType})`;
    if (searchTerm) target += ` - ${searchTerm}`;
    if (line !== undefined) target += ` at line ${line}`;

    let filterInfo = '';
    if (filter) {
      const filters: string[] = [];
      if (filter.objectNamePattern) filters.push(`object: ${filter.objectNamePattern}`);
      if (filter.objectTypes?.length) filters.push(`types: ${filter.objectTypes.join(', ')}`);
      if (filter.excludeSystemObjects) filters.push('exclude SAP standard');
      if (filters.length > 0) {
        filterInfo = `\n\nFilters: ${filters.join('; ')}`;
      }
    }

    const rangeInfo = startIndex !== undefined ? `\n\nStarting from result #${startIndex}` : '';

    const confirmationMessages = {
      title: 'Find Where Used (References)',
      message: new vscode.MarkdownString(
        `Find all references for: ${target}` +
        (connectionId ? ` (connection: ${connectionId})` : '') +
        `\n\nMax results: ${maxResults}` +
        rangeInfo +
        filterInfo
      ),
    };

    return {
      invocationMessage: `Finding where-used for: ${target}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IWhereUsedParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { objectName, connectionId, objectType, searchTerm, line, character, maxResults = 50, includeSnippets = false, startIndex = 0, filter } = options.input;
    logTelemetry("tool_find_where_used_called", { connectionId });

    try {
      // connectionId is now mandatory
      const actualConnectionId = connectionId.toLowerCase();

      // First, search for the object to get its URI
      const searcher = getSearchService(actualConnectionId);
      const searchTypes = objectType ? [objectType] : undefined;
      const searchResults = await searcher.searchObjects(objectName, searchTypes, 1);
      
      if (!searchResults || searchResults.length === 0) {
        const typeInfo = objectType ? ` of type ${objectType}` : '';
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Could not find ABAP object: ${objectName}${typeInfo}. The object may not exist or may not be accessible.`)
        ]);
      }
      
      const objectInfo = searchResults[0];
      if (!objectInfo.uri) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Could not get URI for ABAP object: ${objectName}.`)
        ]);
      }

      // Get the client and object source for where-used analysis
      const { getClient } = await import('../../adt/conections');
      const client = getClient(actualConnectionId);
      
      // Get object source to determine the main URL and perform where-used search
      let mainUrl = objectInfo.uri;
      let objectSource = '';
      
      try {
        // Try to get source - use the same URI optimization as other tools
        const optimalUri = getOptimalObjectURI(objectInfo.type, objectInfo.uri);
        objectSource = await client.getObjectSource(optimalUri);
        mainUrl = optimalUri;
      } catch (sourceError) {
        // Fallback to original URI
        try {
          objectSource = await client.getObjectSource(objectInfo.uri);
          mainUrl = objectInfo.uri;
        } catch (fallbackError) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Could not access source for object: ${objectName}. Error: ${fallbackError}`)
          ]);
        }
      }

      // Determine search position - for where-used, we need a meaningful position
      let searchLine = line;
      let searchCharacter = character;
      
      // If searchTerm is provided, find it in the source
      if (searchTerm && objectSource) {
        const lines = objectSource.split('\n');
        let found = false;
        
        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          const termIndex = lineText.toUpperCase().indexOf(searchTerm.toUpperCase());
          if (termIndex >= 0) {
            searchLine = i + 1; // 1-based for ADT API
            searchCharacter = termIndex;
            found = true;
            break;
          }
        }
        
        if (!found) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Search term "${searchTerm}" not found in object ${objectName}.`)
          ]);
        }
      } else if (!searchLine) {
        // If no specific position provided, search for object declaration/definition
        if (objectSource) {
          const lines = objectSource.split('\n');
          
          // Look for common ABAP declaration patterns
          const declarationPatterns = [
            new RegExp(`\\b(class|interface|program|function|method)\\s+${objectName}\\b`, 'i'),
            new RegExp(`\\b${objectName}\\b.*\\s+(class|interface|type|data)`, 'i'),
            new RegExp(`^\\s*${objectName}\\b`, 'i') // Simple name match at line start
          ];
          
          for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            for (const pattern of declarationPatterns) {
              if (pattern.test(lineText)) {
                searchLine = i + 1;
                searchCharacter = lineText.indexOf(objectName.toLowerCase()) >= 0 ? 
                  lineText.toLowerCase().indexOf(objectName.toLowerCase()) : 0;
                break;
              }
            }
            if (searchLine) break;
          }
        }
        
        // Fallback to first line if no declaration found
        if (!searchLine) {
          searchLine = 1;
          searchCharacter = 0;
        }
      }

      // Perform where-used search using ADT API
      let references: any[] = [];
      try {
        references = await client.statelessClone.usageReferences(
          mainUrl,
          searchLine,
          searchCharacter
        );
      } catch (referencesError) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Where-used search failed for ${objectName}: ${referencesError}`)
        ]);
      }

      // Extract the actual keyword/symbol at the search position for display
      let actualKeyword = '';
      if (objectSource && searchLine && searchCharacter !== undefined) {
        const lines = objectSource.split('\n');
        if (searchLine > 0 && searchLine <= lines.length) {
          const lineText = lines[searchLine - 1]; // Convert to 0-based
          // Extract word at character position (simple word extraction)
          let start = searchCharacter;
          let end = searchCharacter;
          
          // Find word boundaries
          while (start > 0 && /[a-zA-Z0-9_]/.test(lineText[start - 1])) {
            start--;
          }
          while (end < lineText.length && /[a-zA-Z0-9_]/.test(lineText[end])) {
            end++;
          }
          
          actualKeyword = lineText.substring(start, end);
        }
      }

      if (!references || references.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`No references found for ${objectName}${searchTerm ? ` (${searchTerm})` : ''}.`)
        ]);
      }

      // Filter and group references
      const goodRefs = references.filter((ref: any) => {
        const rparts = ref.objectIdentifier?.split(";");
        return rparts && rparts[1] && rparts[0] === "ABAPFullName";
      });

      if (goodRefs.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`No valid references found for ${objectName}${searchTerm ? ` (${searchTerm})` : ''}.`)
        ]);
      }

      const totalRawReferences = goodRefs.length;

      // Apply filters if provided
      let filteredRefs = goodRefs;
      const filterStats = {
        byObjectName: 0,
        byObjectType: 0,
        bySystemExclusion: 0
      };

      if (filter) {
        // Filter by object name pattern
        if (filter.objectNamePattern) {
          const pattern = this.wildcardToRegex(filter.objectNamePattern);
          const beforeCount = filteredRefs.length;
          filteredRefs = filteredRefs.filter((ref: any) => {
            const rparts = ref.objectIdentifier?.split(";");
            const objName = rparts[1] || '';
            return pattern.test(objName);
          });
          filterStats.byObjectName = beforeCount - filteredRefs.length;
        }

        // Filter by object types
        if (filter.objectTypes && filter.objectTypes.length > 0) {
          const beforeCount = filteredRefs.length;
          filteredRefs = filteredRefs.filter((ref: any) => {
            const objType = ref['adtcore:type'] || '';
            return filter.objectTypes!.includes(objType);
          });
          filterStats.byObjectType = beforeCount - filteredRefs.length;
        }

        // Exclude SAP standard objects (not starting with Z or Y)
        if (filter.excludeSystemObjects) {
          const beforeCount = filteredRefs.length;
          filteredRefs = filteredRefs.filter((ref: any) => {
            const rparts = ref.objectIdentifier?.split(";");
            const objName = rparts[1] || '';
            return /^[ZY]/i.test(objName);
          });
          filterStats.bySystemExclusion = beforeCount - filteredRefs.length;
        }
      }

      if (filteredRefs.length === 0) {
        let filterMsg = `No references found after applying filters for ${objectName}.`;
        if (filter) {
          filterMsg += `\n\nFilters applied:`;
          if (filter.objectNamePattern) filterMsg += `\n• Object name pattern: ${filter.objectNamePattern}`;
          if (filter.objectTypes?.length) filterMsg += `\n• Object types: ${filter.objectTypes.join(', ')}`;
          if (filter.excludeSystemObjects) filterMsg += `\n• Exclude SAP standard objects`;
          filterMsg += `\n\nTotal references before filtering: ${totalRawReferences}`;
        }
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(filterMsg)
        ]);
      }

      // Apply pagination (startIndex)
      const paginatedRefs = filteredRefs.slice(startIndex, startIndex + maxResults);
      
      if (paginatedRefs.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No references found at index range ${startIndex}-${startIndex + maxResults}. ` +
            `Total filtered references available: ${filteredRefs.length}. ` +
            `Try a lower startIndex.`
          )
        ]);
      }

      let resultText = `**ABAP Where-Used Analysis**\n`;
      resultText += `Object: ${objectName}${objectType ? ` (${objectType})` : ''}\n`;
      
      // Show actual keyword found at position (when line/character provided OR searchTerm used)
      if (actualKeyword) {
        resultText += `**Analyzing symbol at position:** \`${actualKeyword}\` (Line ${searchLine}, Character ${searchCharacter})\n`;
      } else {
        if (searchTerm) resultText += `Search Term: ${searchTerm}\n`;
        resultText += `Position: Line ${searchLine}, Character ${searchCharacter}\n`;
      }
      
      resultText += `System: ${actualConnectionId}\n\n`;

      // Show filtering and pagination info
      if (filter || startIndex > 0) {
        resultText += `**Result Set Info:**\n`;
        resultText += `• Total references found: ${totalRawReferences}\n`;
        
        if (filter) {
          resultText += `• After filtering: ${filteredRefs.length}\n`;
          if (filter.objectNamePattern) resultText += `  - Object name pattern: ${filter.objectNamePattern} (filtered ${filterStats.byObjectName})\n`;
          if (filter.objectTypes?.length) resultText += `  - Object types: ${filter.objectTypes.join(', ')} (filtered ${filterStats.byObjectType})\n`;
          if (filter.excludeSystemObjects) resultText += `  - Exclude SAP standard (filtered ${filterStats.bySystemExclusion})\n`;
        }
        
        if (startIndex > 0 || filteredRefs.length > maxResults) {
          resultText += `• Showing: ${startIndex + 1} to ${Math.min(startIndex + paginatedRefs.length, filteredRefs.length)} (${paginatedRefs.length} results)\n`;
          if (startIndex + maxResults < filteredRefs.length) {
            const remaining = filteredRefs.length - (startIndex + maxResults);
            resultText += `• Remaining results: ${remaining} (use startIndex: ${startIndex + maxResults} to see next batch)\n`;
          }
        }
        
        resultText += `\n`;
      } else {
        resultText += `**Results:** ${paginatedRefs.length} of ${filteredRefs.length} references\n`;
        if (filteredRefs.length > maxResults) {
          resultText += `(showing first ${maxResults}, use startIndex to see more)\n`;
        }
        resultText += `\n`;
      }

      // Group references by object
      const groups = new Map<string, any[]>();
      for (const ref of paginatedRefs) {
        const rparts = ref.objectIdentifier.split(";");
        const fullName = rparts[1];
        if (!groups.has(fullName)) {
          groups.set(fullName, []);
        }
        groups.get(fullName)!.push(ref);
      }

      resultText += `**References by Object:**\n`;
      
      let refIndex = 1;
      let hasUnknownTypes = false;
      const allObjects = Array.from(groups.entries());
      
      // Show details for all objects (they're already paginated by maxResults/startIndex)
      for (const [fullName, refs] of allObjects) {
        resultText += `${refIndex}. **${fullName}** (${refs.length} reference${refs.length > 1 ? 's' : ''})\n`;
        
        for (const ref of refs) {
          const objType = ref['adtcore:type'] || 'Unknown';
          if (objType === 'Unknown') hasUnknownTypes = true;
          
          resultText += `   • Type: ${objType}\n`;
          resultText += `   • Name: ${ref['adtcore:name'] || 'Unknown'}\n`;
          if (ref['adtcore:packageName']) {
            resultText += `   • Package: ${ref['adtcore:packageName']}\n`;
          }
          if (ref['adtcore:description']) {
            resultText += `   • Description: ${ref['adtcore:description']}\n`;
          }
          resultText += `   • URI: \`${ref.uri || 'N/A'}\`\n`;
          resultText += `\n`;
        }
        
        refIndex++;
      }
      
      // Add tip about Unknown types
      if (hasUnknownTypes) {
        resultText += `\n💡 **Tip:** Some references show Type as "Unknown". You can determine the actual object type from the URI path:\n`;
        resultText += `   • URIs containing "/oo/classes/" → Class (CLAS/OC)\n`;
        resultText += `   • URIs containing "/programs/programs/" → Program (PROG/P)\n`;
        resultText += `   • URIs containing "/functions/groups/" → Function Module (FUGR/FF)\n`;
        resultText += `   • URIs containing "/oo/interfaces/" → Interface (INTF/OI)\n`;
        resultText += `   • Or use the URI with get_object_by_uri tool to retrieve the object and inspect its metadata\n\n`;
      }

      // Get usage snippets if requested - Copilot controls this via includeSnippets parameter
      if (includeSnippets) {
        try {
          resultText += `\n**Usage Snippets:**\n`;
          
          const snippets = await client.statelessClone.usageReferenceSnippets(paginatedRefs);
          
          let snippetIndex = 1;
          for (const s of snippets) {
            if (s.snippets && s.snippets.length > 0) {
              resultText += `${snippetIndex}. **${s.objectIdentifier}**\n`;
              
              for (const snippet of s.snippets.slice(0, 3)) { // Max 3 snippets per object
                if (snippet.uri && snippet.uri.start) {
                  resultText += `   Line ${snippet.uri.start.line}: \`${snippet.content || snippet.matches || 'No content'}\`\n`;
                }
              }
              resultText += `\n`;
              snippetIndex++;
            }
          }
        } catch (snippetError) {
          resultText += `\nCould not retrieve usage snippets: ${snippetError}\n`;
        }
      }

      // Summary statistics
      const uniqueObjects = groups.size;
      const totalReferences = paginatedRefs.length;
      
      resultText += `\n**Summary:**\n`;
      resultText += `• **Total References:** ${totalReferences}\n`;
      resultText += `• **Unique Objects:** ${uniqueObjects}\n`;
      resultText += `• **Avg References/Object:** ${Math.round(totalReferences / uniqueObjects)}\n`;
      
      if (filteredRefs.length > paginatedRefs.length) {
        resultText += `• **Truncated:** Showing ${paginatedRefs.length} of ${filteredRefs.length} filtered references\n`;
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      throw new Error(`Failed to find where-used references: ${String(error)}`);
    }
  }

  // Helper method to convert wildcard patterns to regex
  private wildcardToRegex(pattern: string): RegExp {
    // Escape special regex characters except * and ?
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // Convert wildcards: * -> .*, ? -> .
    const regex = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${regex}$`, 'i');
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerWhereUsedTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('find_where_used', new ABAPWhereUsedTool())
  );
}

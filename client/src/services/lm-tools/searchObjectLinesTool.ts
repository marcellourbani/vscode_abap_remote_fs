/**
 * ABAP Search Object Lines Tool
 * Search for text within ABAP object source code
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { getSearchService } from '../abapSearchService';
import { abapUri } from '../../adt/conections';
import { logTelemetry } from '../telemetry';
import { getOptimalObjectURI, resolveCorrectURI, getObjectEnhancements } from './shared';

// ============================================================================
// INTERFACE
// ============================================================================

export interface ISearchABAPObjectLinesParameters {
  objectName: string;
  searchTerm: string;
  contextLines?: number;
  connectionId?: string;
  isRegexp?: boolean;
  maxObjects?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getTableTypeFromDD(client: any, typeName: string): Promise<string> {
  const sql = `SELECT l~TYPENAME, l~ROWTYPE, l~ROWKIND, l~DATATYPE, l~LENG, l~DECIMALS, t~DDTEXT FROM DD40L AS l INNER JOIN DD40T AS t ON l~TYPENAME = t~TYPENAME WHERE l~TYPENAME = '${typeName.toUpperCase()}' AND l~AS4LOCAL = 'A' AND t~DDLANGUAGE = 'E' AND t~AS4LOCAL = 'A'`;
  
  const result = await client.runQuery(sql, 100, true);
  
  if (!result || !result.values || result.values.length === 0) {
    return '';
  }
  
  let structure = `Table Type from DD40L/DD40T:\n`;
  result.values.forEach((row: any) => {
    structure += `Type Name: ${row.TYPENAME}\n`;
    if (row.DDTEXT) structure += `Description: ${row.DDTEXT}\n`;
    structure += `Line Type (ROWTYPE): ${row.ROWTYPE}\n`;
    structure += `Row Kind: ${row.ROWKIND}\n`;
    if (row.DATATYPE) {
      structure += `Data Type: ${row.DATATYPE}`;
      if (row.LENG) structure += `(${row.LENG})`;
      if (row.DECIMALS) structure += ` DECIMALS ${row.DECIMALS}`;
      structure += `\n`;
    }
    structure += `\n💡 This is a table type that references line type ${row.ROWTYPE}. To see the actual fields, query the line type structure.`;
  });
  
  return structure;
}

async function getCompleteTableStructure(connectionId: string, objectName: string, objectUri: string): Promise<string> {
  try {
    const { getClient } = await import('../../adt/conections');
    const client = getClient(connectionId);
    
    const mainTableURI = getOptimalObjectURI('TABL/TA', objectUri);
    let mainStructure = '';
    
    try {
      mainStructure = await client.getObjectSource(mainTableURI);
    } catch (mainError) {
      const resolvedUri = await resolveCorrectURI(objectUri, connectionId);
      const finalUri = getOptimalObjectURI('TABL/TA', resolvedUri);
      try {
        mainStructure = await client.getObjectSource(finalUri);
      } catch (finalError) {
        return `Could not retrieve table structure for ${objectName}: ${finalError}`;
      }
    }
    
    let allAppendStructures = '';
    
    try {
      const enhancementResult = await getObjectEnhancements(objectUri, connectionId, true);
      if (enhancementResult.hasEnhancements) {
        for (const enhancement of enhancementResult.enhancements) {
          if (enhancement.code) {
            allAppendStructures += `\n${'='.repeat(60)}\n`;
            allAppendStructures += `APPEND STRUCTURE: ${enhancement.name}\n`;
            allAppendStructures += `${'='.repeat(60)}\n`;
            allAppendStructures += enhancement.code;
            allAppendStructures += `\n`;
          }
        }
      }
    } catch (appendError) {
      // Append structures are optional
    }
    
    let completeStructure = `Complete Table Structure for ${objectName}:\n`;
    completeStructure += `${'='.repeat(60)}\n`;
    completeStructure += `💡 SE11-like Table Access: Main table + ALL append structures\n`;
    completeStructure += `📊 Includes: ${mainStructure ? 'Main table structure' : 'No main structure'} + ${allAppendStructures ? 'All append structures' : 'No append structures'}\n`;
    completeStructure += `${'='.repeat(60)}\n\n`;
    
    if (mainStructure) {
      completeStructure += `MAIN TABLE STRUCTURE:\n`;
      completeStructure += `${'='.repeat(60)}\n`;
      completeStructure += mainStructure;
      completeStructure += `\n`;
    }
    
    if (allAppendStructures) {
      completeStructure += `\nAPPEND STRUCTURES:\n`;
      completeStructure += allAppendStructures;
    }
    
    return completeStructure;
    
  } catch (error) {
    return `Could not retrieve complete table structure for ${objectName}: ${error}`;
  }
}

// ============================================================================
// TOOL CLASS
// ============================================================================

export class SearchABAPObjectLinesTool implements vscode.LanguageModelTool<ISearchABAPObjectLinesParameters> {
  
  private searchInLine(line: string, searchTerm: string, isRegexp: boolean): boolean {
    if (isRegexp) {
      try {
        const regex = new RegExp(searchTerm, 'i');
        return regex.test(line);
      } catch (error) {
        return line.toUpperCase().includes(searchTerm.toUpperCase());
      }
    } else {
      return line.toUpperCase().includes(searchTerm.toUpperCase());
    }
  }
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchABAPObjectLinesParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, searchTerm, contextLines = 3, connectionId, isRegexp = false, maxObjects = 1 } = options.input;
    
    const confirmationMessages = {
      title: 'Search ABAP Object Lines',
      message: new vscode.MarkdownString(
        `Search for \`${searchTerm}\` in ABAP object: \`${objectName}\` (with ${contextLines} context lines)` +
        (isRegexp ? ' **[REGEX]**' : '') +
        (maxObjects > 1 ? ` **[MAX ${maxObjects} OBJECTS]**` : '') +
        (connectionId ? ` (connection: ${connectionId})` : '')
      ),
    };

    return {
      invocationMessage: maxObjects > 1 
        ? `Searching for "${searchTerm}" in up to ${maxObjects} objects matching ${objectName}`
        : `Searching for "${searchTerm}" in ${objectName}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ISearchABAPObjectLinesParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { objectName, searchTerm, contextLines = 3, connectionId, isRegexp = false, maxObjects = 1 } = options.input;
    logTelemetry("tool_search_abap_object_lines_called", { connectionId });
    
    if (connectionId) {
      connectionId = connectionId.toLowerCase();
    }

    if (maxObjects < 1 || maxObjects > 10) {
      maxObjects = Math.max(1, Math.min(10, maxObjects));
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
      
      const searcher = getSearchService(actualConnectionId);
      const searchResults = await searcher.searchObjects(objectName, undefined, maxObjects);
      
      if (!searchResults || searchResults.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Could not find ABAP object(s): ${objectName}.`)
        ]);
      }
      
      let allResultsText = '';
      let totalObjectsSearched = 0;
      let totalMatches = 0;
      let totalEnhancementMatches = 0;
      
      for (const objectInfo of searchResults) {
        totalObjectsSearched++;
        
        if (!objectInfo.uri) {
          allResultsText += `⚠️ **Object ${objectInfo.name}**: Could not get URI, skipping.\n\n`;
          continue;
        }
        
        let currentObjectResultText = '';
        
        try {
          if (objectInfo.type === 'TABL/TA' || objectInfo.type === 'TABL' || objectInfo.type === 'TABL/DT' || objectInfo.type === 'TABL/DS' ||
              objectInfo.type === 'TTYP/DA' || objectInfo.type === 'TTYP') {
            
            try {
              const { getClient } = await import('../../adt/conections');
              const client = getClient(actualConnectionId);
              
              let completeStructure = '';
              
              if (objectInfo.type === 'TTYP/DA' || objectInfo.type === 'TTYP') {
                const tableTypeInfo = await getTableTypeFromDD(client, objectInfo.name);
                if (tableTypeInfo) {
                  completeStructure = `Complete Structure for ${objectInfo.name}:\n` +
                    `${'='.repeat(60)}\n` +
                    `💡 DD Table Query: Table Type definition from DD40L/DD40T\n` +
                    `📊 Source: DD40L (Table Type definitions)\n` +
                    `${'='.repeat(60)}\n\n` +
                    tableTypeInfo;
                }
              } else {
                completeStructure = await getCompleteTableStructure(actualConnectionId, objectInfo.name, objectInfo.uri);
              }
              
              const lines = completeStructure.split('\n');
              const matches: Array<{lineNumber: number, line: string}> = [];
              
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (this.searchInLine(line, searchTerm, isRegexp)) {
                  matches.push({lineNumber: i, line: line});
                }
              }
              
              if (matches.length > 0) {
                currentObjectResultText += `\n## 📋 **${objectInfo.name}** (Complete Table Structure)\n\n`;
                
                for (const match of matches) {
                  const startLine = Math.max(0, match.lineNumber - contextLines);
                  const endLine = Math.min(lines.length - 1, match.lineNumber + contextLines);
                  
                  currentObjectResultText += `**Line ${match.lineNumber + 1}:**\n\`\`\`\n`;
                  
                  for (let i = startLine; i <= endLine; i++) {
                    const line = lines[i];
                    const prefix = i === match.lineNumber ? '> ' : '  ';
                    currentObjectResultText += `${prefix}${line}\n`;
                  }
                  
                  currentObjectResultText += '```\n\n';
                }
                
                currentObjectResultText += `• **Search covered:** Main table + ALL append structures\n` +
                  `• **Total structure lines:** ${lines.length}\n` +
                  `• **Custom field discovery:** ${searchTerm.toLowerCase().startsWith('z') || searchTerm.toLowerCase().startsWith('y') ? '✅ Custom field search enabled' : 'Standard search'}\n\n`;
                
                totalMatches += matches.length;
                allResultsText += currentObjectResultText;
              }
              
              continue;
              
            } catch (tableError) {
              // Fall through to standard search
            }
          }
          
          const { getClient } = await import('../../adt/conections');
          const client = getClient(actualConnectionId);
          
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
                const resolvedUri = await resolveCorrectURI(objectInfo.uri, actualConnectionId);
                const finalUri = getOptimalObjectURI(objectInfo.type, resolvedUri);
                
                try {
                  sourceContent = await client.getObjectSource(finalUri);
                  uriUsed = finalUri;
                } catch (finalError) {
                  allResultsText += `⚠️ **Object ${objectInfo.name}**: Could not get source content. Last error: ${finalError}\n\n`;
                  continue;
                }
              }
            } else {
              const resolvedUri = await resolveCorrectURI(objectInfo.uri, actualConnectionId);
              const finalUri = getOptimalObjectURI(objectInfo.type, resolvedUri);
              
              try {
                sourceContent = await client.getObjectSource(finalUri);
                uriUsed = finalUri;
              } catch (finalError) {
                allResultsText += `⚠️ **Object ${objectInfo.name}**: Could not get source content.\n\n`;
                continue;
              }
            }
          }
          
          if (!sourceContent) {
            allResultsText += `⚠️ **Object ${objectInfo.name}**: Source content is empty.\n\n`;
            continue;
          }
          
          const lines = sourceContent.split('\n');
          const matches: Array<{lineNumber: number, line: string}> = [];
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (this.searchInLine(line, searchTerm, isRegexp)) {
              matches.push({lineNumber: i, line: line});
            }
          }
          
          let enhancementMatches: Array<{
            enhancementName: string, 
            enhancementUri: string,
            lineNumber: number, 
            line: string,
            contextLines: string[]
          }> = [];
          try {
            const enhancementResult = await getObjectEnhancements(uriUsed, actualConnectionId, true);
            if (enhancementResult.hasEnhancements) {
              for (const enhancement of enhancementResult.enhancements) {
                if (enhancement.code) {
                  const enhLines = enhancement.code.split('\n');
                  for (let i = 0; i < enhLines.length; i++) {
                    const line = enhLines[i];
                    if (this.searchInLine(line, searchTerm, isRegexp)) {
                      const startCtx = Math.max(0, i - contextLines);
                      const endCtx = Math.min(enhLines.length - 1, i + contextLines);
                      const contextArray: string[] = [];
                      
                      for (let j = startCtx; j <= endCtx; j++) {
                        const prefix = j === i ? '> ' : '  ';
                        contextArray.push(`${prefix}${enhLines[j]}`);
                      }
                      
                      const enhancementUri = enhancement.uri;
                      
                      if (!enhancementUri) {
                        continue;
                      }
                      
                      enhancementMatches.push({
                        enhancementName: enhancement.name,
                        enhancementUri: enhancementUri,
                        lineNumber: i,
                        line: line,
                        contextLines: contextArray
                      });
                    }
                  }
                }
              }
            }
          } catch (enhSearchError) {
            // Enhancement search is optional
          }
          
          if (matches.length > 0 || enhancementMatches.length > 0) {
            currentObjectResultText += `\n## 📋 **${objectInfo.name}** (${objectInfo.type})\n\n`;
            
            if (matches.length > 0) {
              currentObjectResultText += `**📋 Base Source Matches (${matches.length}):**\n\n`;
              for (const match of matches) {
                const startLine = Math.max(0, match.lineNumber - contextLines);
                const endLine = Math.min(lines.length - 1, match.lineNumber + contextLines);
                
                currentObjectResultText += `**Line ${match.lineNumber + 1}:**\n\`\`\`abap\n`;
                
                for (let i = startLine; i <= endLine; i++) {
                  const line = lines[i];
                  const prefix = i === match.lineNumber ? '> ' : '  ';
                  currentObjectResultText += `${prefix}${line}\n`;
                }
                
                currentObjectResultText += '```\n\n';
              }
            }
            
            if (enhancementMatches.length > 0) {
              currentObjectResultText += `**🎯 Enhancement Matches (${enhancementMatches.length}):**\n\n`;
              for (const enhMatch of enhancementMatches) {
                currentObjectResultText += `**Enhancement ${enhMatch.enhancementName} - Line ${enhMatch.lineNumber + 1}:**\n\`\`\`abap\n`;
                currentObjectResultText += enhMatch.contextLines.join('\n');
                currentObjectResultText += '\n```\n\n';
              }
            }
            
            currentObjectResultText += `• **URI used:** \`${uriUsed}\`\n` +
              `• **Total lines in object:** ${lines.length}\n\n`;
            
            totalMatches += matches.length;
            totalEnhancementMatches += enhancementMatches.length;
            allResultsText += currentObjectResultText;
          }
          
        } catch (objectError) {
          allResultsText += `⚠️ **Object ${objectInfo.name}**: Error during search - ${objectError}\n\n`;
          continue;
        }
      }
      
      if (totalMatches === 0 && totalEnhancementMatches === 0) {
        let noMatchesMessage = `No matches found for "${searchTerm}" in ${totalObjectsSearched} object(s) matching: ${objectName}`;
        
        if (maxObjects > 1 && searchResults.length > 0) {
          noMatchesMessage += `\n\n**Objects searched:**\n`;
          for (const obj of searchResults.slice(0, totalObjectsSearched)) {
            noMatchesMessage += `• **${obj.name}** (${obj.type})\n`;
          }
        }
        
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(noMatchesMessage)
        ]);
      }
      
      const grandTotal = totalMatches + totalEnhancementMatches;
      
      let objectListSection = '';
      if (maxObjects > 1 && searchResults.length > 0) {
        objectListSection = `\n**📋 Objects searched:**\n`;
        for (const obj of searchResults.slice(0, totalObjectsSearched)) {
          objectListSection += `• **${obj.name}** (${obj.type})\n`;
        }
        objectListSection += '\n';
      }
      
      const resultHeader = maxObjects > 1 
        ? `Found **${grandTotal}** matches for **"${searchTerm}"** across **${totalObjectsSearched}** objects matching **${objectName}**:\n\n` +
          `• **Objects searched:** ${totalObjectsSearched}/${searchResults.length}\n` +
          `• **Base source matches:** ${totalMatches}\n` +
          `• **Enhancement matches:** ${totalEnhancementMatches}\n` +
          objectListSection
        : `Found **${grandTotal}** matches for **"${searchTerm}"** in **${objectName}**:\n\n` +
          `• **Base source matches:** ${totalMatches}\n` +
          `• **Enhancement matches:** ${totalEnhancementMatches}\n\n`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultHeader + allResultsText)
      ]);

    } catch (error) {
      throw new Error(`Failed to search lines in ABAP object: ${String(error)}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerSearchObjectLinesTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('search_abap_object_lines', new SearchABAPObjectLinesTool())
  );
}

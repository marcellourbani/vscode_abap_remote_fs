/**
 * ABAP Get Object Info Tool
 * Retrieve metadata and information about ABAP objects
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { getSearchService } from '../abapSearchService';
import { abapUri } from '../../adt/conections';
import { logTelemetry } from '../telemetry';
import { getOptimalObjectURI, getObjectEnhancements } from './shared';
import { getTableStructureFromDD, getAppendStructuresFromDD } from './getObjectLinesTool';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IGetABAPObjectInfoParameters {
  objectName: string;
  connectionId?: string;
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
    let appendStructuresList: Array<{name: string, fields: number}> = [];
    
    try {
      mainStructure = await client.getObjectSource(mainTableURI);
    } catch (mainError) {
      try {
        // Fallback to DD03M which includes main table + append structures automatically
        const tableFields = await getTableStructureFromDD(client, objectName);
        if (tableFields) {
          mainStructure = tableFields;
        } else {
          return `Could not retrieve table structure for ${objectName}`;
        }
      } catch (fallbackError) {
        return `Could not retrieve table structure for ${objectName}`;
      }
    }
    
    // ALWAYS query DD02L for append structures (works for both ADT and DD03M paths)
    appendStructuresList = await getAppendStructuresFromDD(client, objectName);
    
    let allAppendStructures = '';
    
    if (appendStructuresList.length > 0) {
      allAppendStructures += `\n\nALL APPEND STRUCTURES (${appendStructuresList.length}):\n`;
      allAppendStructures += `${'='.repeat(40)}\n`;
      for (const append of appendStructuresList) {
        allAppendStructures += `• ${append.name} (${append.fields} fields)\n`;
      }
    }
    
    let completeStructure = `Complete Table Structure for ${objectName}:\n`;
    completeStructure += `${'='.repeat(60)}\n`;
    completeStructure += `💡 SE11-like Table Access: Main table + ALL append structures\n`;
    completeStructure += `📊 Append Structures Found: ${appendStructuresList.length}\n`;
    completeStructure += `${'='.repeat(60)}\n\n`;
    
    if (mainStructure) {
      completeStructure += `MAIN TABLE STRUCTURE:\n`;
      completeStructure += `${'='.repeat(40)}\n`;
      completeStructure += mainStructure + '\n';
    }
    
    if (allAppendStructures) {
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

export class GetABAPObjectInfoTool implements vscode.LanguageModelTool<IGetABAPObjectInfoParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetABAPObjectInfoParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Get ABAP Object Info',
      message: new vscode.MarkdownString(
        `Get metadata information for ABAP object: \`${objectName}\`` +
        (connectionId ? ` (connection: ${connectionId})` : '')
      ),
    };

    return {
      invocationMessage: `Getting info for: ${objectName}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetABAPObjectInfoParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { objectName, connectionId } = options.input;
    logTelemetry("tool_get_abap_object_info_called", { connectionId });
    
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
      
      const searcher = getSearchService(actualConnectionId);
      const searchResults = await searcher.searchObjects(objectName, undefined, 1);
      
      if (!searchResults || searchResults.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Could not find ABAP object: ${objectName}. The object may not exist or may not be accessible.`)
        ]);
      }
      
      const objectInfo = searchResults[0];
      
      // Table/Structure/TableType-aware info
      if (objectInfo.type === 'TABL/TA' || objectInfo.type === 'TABL' || objectInfo.type === 'TABL/DT' || objectInfo.type === 'TABL/DS' ||
          objectInfo.type === 'TTYP/DA' || objectInfo.type === 'TTYP') {
        
        if (objectInfo.uri) {
          try {
            const { getClient } = await import('../../adt/conections');
            const client = getClient(actualConnectionId);
            
            let completeStructure = '';
            
            if (objectInfo.type === 'TTYP/DA' || objectInfo.type === 'TTYP') {
              const tableTypeInfo = await getTableTypeFromDD(client, objectName);
              if (tableTypeInfo) {
                completeStructure = `Complete Structure for ${objectName}:\n` +
                  `${'='.repeat(60)}\n` +
                  `💡 DD Table Query: Table Type definition from DD40L/DD40T\n` +
                  `📊 Source: DD40L (Table Type definitions)\n` +
                  `${'='.repeat(60)}\n\n` +
                  tableTypeInfo;
              }
            } else {
              completeStructure = await getCompleteTableStructure(actualConnectionId, objectName, objectInfo.uri);
            }
            
            const structureLines = completeStructure.split('\n');
            
            // Count append structures from the structure content
            let appendCount = 0;
            const appendMatches = completeStructure.match(/ALL APPEND STRUCTURES \((\d+)\):/);
            if (appendMatches) {
              appendCount = parseInt(appendMatches[1], 10);
            } else {
              // Fallback: count individual append structure markers
              const individualAppends = (completeStructure.match(/• [A-Z_]+ \(\d+ fields\)/g) || []).length;
              appendCount = individualAppends;
            }
            
            let mainTableLines = 0;
            let inMainSection = false;
            
            for (const line of structureLines) {
              if (line.includes('MAIN TABLE STRUCTURE:')) {
                inMainSection = true;
              } else if (line.includes('APPEND STRUCTURES')) {
                inMainSection = false;
              } else if (inMainSection && line.trim().length > 0) {
                mainTableLines++;
              }
            }
            
            const hasAppendStructures = appendCount > 0;
            
            const tableResultText = `**${objectName}** Enhanced Table Information:\n\n` +
              `• **Object Type:** ${objectInfo.type} (Database Table)\n` +
              `• **Description:** ${objectInfo.description || 'No description available'}\n` +
              `• **Package:** ${objectInfo.package || 'Unknown'}\n` +
              `• **System Type:** ${objectInfo.systemType}\n` +
              `• **Total Lines:** ${structureLines.length}\n` +
              `• **Append Structures:** ${appendCount}\n` +
              `• **Has Custom Fields/Append Structures:** ${hasAppendStructures ? '✅ Yes' : '❌ No'}\n` +
              `• **SE11-like Structure Access:** ✅ Available\n` +
              `• **URI:** \`${objectInfo.uri}\`\n\n` +
              `💡 **Enhanced Table Info:** This table ${hasAppendStructures ? `includes ${appendCount} custom append structure(s) with additional fields` : 'has no append structures'}. `;

            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(tableResultText)
            ]);
            
          } catch {
            // Continue with standard approach
          }
        }
      }
      
      // Standard object info
      let totalLines = 'Unknown';
      let uriUsed = 'Not determined';
      let enhancementInfo = '';
      
      if (objectInfo.uri) {
        const { getClient } = await import('../../adt/conections');
        const client = getClient(actualConnectionId);
        
        const optimalUri = getOptimalObjectURI(objectInfo.type, objectInfo.uri);
        
        try {
          const sourceContent = await client.getObjectSource(optimalUri);
          const lines = sourceContent.split('\n');
          totalLines = lines.length.toString();
          uriUsed = optimalUri;
        } catch {
          if (optimalUri !== objectInfo.uri) {
            try {
              const sourceContent = await client.getObjectSource(objectInfo.uri);
              const lines = sourceContent.split('\n');
              totalLines = lines.length.toString();
              uriUsed = objectInfo.uri;
            } catch {
              uriUsed = 'Access failed';
            }
          } else {
            uriUsed = 'Access failed';
          }
        }
        
        try {
          const enhancementResult = await getObjectEnhancements(optimalUri, actualConnectionId, false);
          if (enhancementResult.hasEnhancements) {
            enhancementInfo = `\n• **Enhancements:** ${enhancementResult.totalEnhancements} enhancement(s) found\n` +
              enhancementResult.enhancements.map(enh => 
                `  - ${enh.name} (line ${enh.startLine})`
              ).join('\n');
          } else {
            enhancementInfo = '\n• **Enhancements:** No enhancements found';
          }
        } catch {
          enhancementInfo = '\n• **Enhancements:** Could not check enhancements';
        }
      }

      const resultText = `**${objectName}** Information:\n\n` +
        `• **Object Type:** ${objectInfo.type}\n` +
        `• **Description:** ${objectInfo.description || 'No description available'}\n` +
        `• **Package:** ${objectInfo.package || 'Unknown'}\n` +
        `• **System Type:** ${objectInfo.systemType}\n` +
        `• **Total Lines:** ${totalLines}\n` +
        `• **URI:** \`${objectInfo.uri || 'Not available'}\`\n` +
        `• **URI Used:** \`${uriUsed}\`` +
        enhancementInfo;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      throw new Error(`Failed to get info for ABAP object: ${String(error)}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerGetObjectInfoTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('get_abap_object_info', new GetABAPObjectInfoTool())
  );
}

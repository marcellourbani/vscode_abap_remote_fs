/**
 * ABAP ATC (ABAP Test Cockpit) Tools
 * Run ATC analysis and access ATC decorations
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { getSearchService } from '../abapSearchService';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACES
// ============================================================================

export interface IRunATCAnalysisParameters {
  objectName?: string;
  objectType?: string;
  objectUri?: string;
  connectionId?: string;
  useActiveFile?: boolean;
  scope?: 'object' | 'package' | 'transport';
}

export interface IGetATCDecorationsParameters {
  fileUri?: string;
}

// ============================================================================
// TOOL CLASSES
// ============================================================================

/**
 * 🔍 RUN ATC ANALYSIS TOOL - Wrapper for existing ATC logic with AI integration
 */
export class RunATCAnalysisTool implements vscode.LanguageModelTool<IRunATCAnalysisParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IRunATCAnalysisParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, objectType, objectUri, connectionId, useActiveFile } = options.input;
    
    let target = 'active file';
    if (objectName) {
      target = objectType ? `${objectType} ${objectName}` : objectName;
    } else if (objectUri) {
      target = `object at ${objectUri}`;
    }
    
    const confirmationMessages = {
      title: 'Run ATC Analysis',
      message: new vscode.MarkdownString(
        `Run ABAP Test Cockpit analysis on: ${target}` +
        (connectionId ? ` (connection: ${connectionId})` : '') +
        '\n\nThis will update the ATC panel with visual highlights and return structured results for AI analysis.'
      ),
    };

    return {
      invocationMessage: `Running ATC analysis on ${target}...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IRunATCAnalysisParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { objectName, objectType, objectUri, connectionId, useActiveFile = true } = options.input;
    logTelemetry("tool_run_atc_analysis_called", { connectionId });
    
    if (connectionId) {
      connectionId = connectionId.toLowerCase();
    }

    try {
      let targetUri: vscode.Uri;
      let actualConnectionId = connectionId;
      
      if (objectUri) {
        if (!objectUri.startsWith('adt://')) {
          throw new Error('Object URI must be a valid ADT URI (adt://system/path)');
        }
        targetUri = vscode.Uri.parse(objectUri);
        actualConnectionId = actualConnectionId || targetUri.authority;
        
      } else if (objectName) {
        if (!actualConnectionId) {
          throw new Error('connectionId is required when specifying objectName');
        }
        
        const searcher = getSearchService(actualConnectionId);
        const searchResults = await searcher.searchObjects(objectName, objectType ? [objectType as any] : undefined, 1);
        
        if (!searchResults || searchResults.length === 0) {
          throw new Error(`Could not find ABAP object: ${objectName}${objectType ? ` (type: ${objectType})` : ''}`);
        }
        
        const objectInfo = searchResults[0];
        if (!objectInfo.uri) {
          throw new Error(`Could not get URI for ABAP object: ${objectName}`);
        }
        
        const { getOrCreateRoot } = await import('../../adt/conections');
        const root = await getOrCreateRoot(actualConnectionId);
        const { path } = (await root.findByAdtUri(objectInfo.uri, true)) || {};
        
        if (!path) {
          throw new Error(`Could not resolve workspace path for object ${objectName}`);
        }
        
        const workspaceUri = `adt://${actualConnectionId}${path}`;
        targetUri = vscode.Uri.parse(workspaceUri);
        
      } else if (useActiveFile) {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor) {
          throw new Error('No active editor and no object specified. Please open an ABAP file or provide objectName/objectUri.');
        }
        
        const { abapUri } = await import('../../adt/conections');
        if (!abapUri(activeEditor.document.uri)) {
          throw new Error('Active file is not an ABAP document. Please open an ABAP file or provide objectName/objectUri.');
        }
        
        targetUri = activeEditor.document.uri;
        actualConnectionId = actualConnectionId || targetUri.authority;
        
      } else {
        throw new Error('No target specified for ATC analysis. Provide objectName, objectUri, or set useActiveFile to true.');
      }

      const { atcProvider } = await import('../../views/abaptestcockpit');
      
      const existingEditor = window.visibleTextEditors.find(
        editor => editor.document.uri.toString() === targetUri.toString()
      );
      
      if (existingEditor) {
        try {
          const fileSystemContent = await vscode.workspace.fs.readFile(existingEditor.document.uri);
          const fileSystemText = Buffer.from(fileSystemContent).toString('utf8');
          const editorText = existingEditor.document.getText();
          const hasContentDifference = fileSystemText !== editorText;
          
          if (hasContentDifference) {
            const objectName = targetUri.path.split('/').pop() || 'object';
            const errorMessage = `**⚠️ Cannot run ATC analysis on ${objectName}**\n\n` +
              `The file has **unsaved changes** (including potential Copilot modifications). ` +
              `ATC analysis would run on the old server version, not your current changes, making results inaccurate.\n\n` +
              `**Please ask user to:**\n` +
              `1. **save the file** (Ctrl+S or click "Keep" if you have Copilot changes)\n` +
              `2. **Activate the object**\n` +
              `3. **Run ATC analysis again** for accurate results\n\n` +
              `This ensures ATC analyzes your actual current code, not the old version.`;
              
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(errorMessage)
            ]);
          }
        } catch {
          // Ignore fs errors
        }
      }

      await window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Running ABAP Test Cockpit" },
        async () => {
          try {
            if (!existingEditor) {
              const document = await vscode.workspace.openTextDocument(targetUri);
              await window.showTextDocument(document, { preserveFocus: true });
            }
          } catch {
            // Continue with ATC even if file opening fails
          }
          
          await atcProvider.runInspector(targetUri);
        }
      );
      
      const findings = atcProvider.findings();
      
      const structuredFindings = findings.map(finding => ({
        object: {
          name: finding.parent.object.name,
          type: finding.parent.object.type
        },
        finding: {
          messageTitle: finding.finding.messageTitle,
          checkTitle: finding.finding.checkTitle,
          priority: finding.finding.priority,
          priorityText: finding.finding.priority === 1 ? 'Error' : 
                       finding.finding.priority === 2 ? 'Warning' : 'Info',
          location: {
            uri: finding.uri,
            line: finding.start.line + 1,
            character: finding.start.character + 1
          },
          hasExemption: !!finding.finding.exemptionApproval,
          exemptionStatus: finding.finding.exemptionApproval || null
        }
      }));
      
      const totalFindings = structuredFindings.length;
      const errors = structuredFindings.filter(f => f.finding.priority === 1).length;
      const warnings = structuredFindings.filter(f => f.finding.priority === 2).length;
      const infos = structuredFindings.filter(f => f.finding.priority === 3).length;
      const exempted = structuredFindings.filter(f => f.finding.hasExemption).length;
      
      const findingsByObject = structuredFindings.reduce((acc, finding) => {
        const key = `${finding.object.type} ${finding.object.name}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(finding);
        return acc;
      }, {} as Record<string, any[]>);

      const resultText = `**🔍 ATC Analysis Complete** ✅\n\n` +
        `• **Target:** ${targetUri.toString()}\n` +
        `• **System:** ${actualConnectionId}\n` +
        `• **Total Findings:** ${totalFindings}\n` +
        `• **Errors:** ${errors} | **Warnings:** ${warnings} | **Info:** ${infos}\n` +
        `• **Exempted:** ${exempted}\n` +
        `• **Objects Analyzed:** ${Object.keys(findingsByObject).length}\n\n` +
        `**📋 Finding Summary:**\n` +
        Object.entries(findingsByObject).map(([objectKey, findings]) => 
          `• **${objectKey}**: ${findings.length} finding(s) ` +
          `(${findings.filter(f => f.finding.priority === 1).length} errors, ` +
          `${findings.filter(f => f.finding.priority === 2).length} warnings, ` +
          `${findings.filter(f => f.finding.priority === 3).length} info)`
        ).join('\n') +
        `\n\n**🎯 UI Updated:** Results displayed in ATC Finds panel with color-coded highlights\n` +
        `**📊 AI Analysis Ready:** Structured data available for intelligent assistance`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText),
        new vscode.LanguageModelTextPart(`\n**Structured Findings Data:**\n${JSON.stringify({
          summary: {
            totalFindings,
            errors,
            warnings, 
            infos,
            exempted,
            targetUri: targetUri.toString(),
            connectionId: actualConnectionId
          },
          findings: structuredFindings
        }, null, 2)}`)
      ]);

    } catch (error) {
      throw new Error(`Failed to run ATC analysis: ${String(error)}`);
    }
  }
}

/**
 * 🎨 GET ATC DECORATIONS TOOL - Access current visual decorations in editor
 */
export class GetATCDecorationsTool implements vscode.LanguageModelTool<IGetATCDecorationsParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetATCDecorationsParameters>,
    _token: vscode.CancellationToken
  ) {
    const { fileUri } = options.input;
    
    const target = fileUri ? `file: ${fileUri}` : 'all files with ATC decorations';
    
    const confirmationMessages = {
      title: 'Get ATC Decorations',
      message: new vscode.MarkdownString(
        `Access current ATC visual decorations for: ${target}\n\n` +
        'This will return the current state of error/warning/info highlights visible in the editor.'
      ),
    };

    return {
      invocationMessage: `Getting ATC decorations for ${target}...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetATCDecorationsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { fileUri } = options.input;
    const connectionId = fileUri ? vscode.Uri.parse(fileUri).authority : undefined;
    logTelemetry("tool_get_atc_decorations_called", { connectionId });

    try {
      const { getATCDecorations } = await import('../../views/abaptestcockpit/decorations');
      
      const decorationData = getATCDecorations(fileUri);
      
      let resultText = '';
      let findingsCount = 0;
      
      if (fileUri) {
        const fileData = decorationData as { fileUri: string; decorations: any[] };
        findingsCount = fileData.decorations.length;
        
        resultText = `**🎨 ATC Decorations for File** ✅\n\n` +
          `• **File:** ${fileUri}\n` +
          `• **Total Decorations:** ${findingsCount}\n\n`;
          
        if (findingsCount > 0) {
          const errors = fileData.decorations.filter(d => d.priority === 1).length;
          const warnings = fileData.decorations.filter(d => d.priority === 2).length;
          const infos = fileData.decorations.filter(d => d.priority === 3).length;
          const exempted = fileData.decorations.filter(d => d.hasExemption).length;
          
          resultText += `**📊 Breakdown:**\n` +
            `• **Errors:** ${errors} (red highlights)\n` +
            `• **Warnings:** ${warnings} (yellow highlights)\n` +
            `• **Info:** ${infos} (blue highlights)\n` +
            `• **Exempted:** ${exempted} (green highlights)\n\n` +
            `**🎯 Visible Decorations:**\n` +
            fileData.decorations.map(d => 
              `• **Line ${d.line}:** ${d.message} (${d.priorityText}) [${d.decorationType}]`
            ).join('\n');
        } else {
          resultText += `**✅ No decorations currently visible** - Clean code or no ATC analysis run yet.`;
        }
        
      } else {
        const allData = decorationData as { totalFiles: number; totalFindings: number; decorations: Record<string, any[]> };
        findingsCount = allData.totalFindings;
        
        resultText = `**🎨 All ATC Decorations** ✅\n\n` +
          `• **Files with Decorations:** ${allData.totalFiles}\n` +
          `• **Total Decorations:** ${allData.totalFindings}\n\n`;
          
        if (allData.totalFiles > 0) {
          resultText += `**📂 Files Overview:**\n` +
            Object.entries(allData.decorations).map(([uri, decorations]) => {
              const errors = decorations.filter(d => d.priority === 1).length;
              const warnings = decorations.filter(d => d.priority === 2).length;
              const infos = decorations.filter(d => d.priority === 3).length;
              return `• **${uri}**: ${decorations.length} decorations (${errors}E, ${warnings}W, ${infos}I)`;
            }).join('\n');
        } else {
          resultText += `**✅ No decorations in any files** - All code clean or no ATC analysis run yet.`;
        }
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText),
        new vscode.LanguageModelTextPart(`\n**Structured Decoration Data:**\n${JSON.stringify(decorationData, null, 2)}`)
      ]);

    } catch (error) {
      throw new Error(`Failed to get ATC decorations: ${String(error)}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerAtcTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('run_atc_analysis', new RunATCAnalysisTool())
  );
  context.subscriptions.push(
    vscode.lm.registerTool('get_atc_decorations', new GetATCDecorationsTool())
  );
}

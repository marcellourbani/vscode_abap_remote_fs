/**
 * Enhancement Decorations for VSCode Editor
 * Shows enhancement indicators like Eclipse with hover support
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../services/funMessenger';
import { logCommands } from '../services/abapCopilotLogger';
import { uriAbapFile } from '../adt/operations/AdtObjectFinder';

// Enhancement decoration types
let enhancementDecorationType: vscode.TextEditorDecorationType;

// Cache for enhancement data to avoid repeated API calls
const enhancementCache = new Map<string, any>();

// Track pending decoration update to cancel when editor changes
let pendingDecorationUpdate: AbortController | undefined;

/**
 * Initialize enhancement decorations
 */
export function initializeEnhancementDecorations(context: vscode.ExtensionContext) {
  // Create decoration type for enhancement indicators
  enhancementDecorationType = window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 107, 53, 0.15)',
    border: '1px solid rgba(255, 107, 53, 0.5)',
    after: {
      contentText: ' 🎯 ENH',
      color: '#FF6B35',
      fontWeight: 'bold',
      margin: '0 0 0 5px'
    },
    isWholeLine: false
  });
  
  // Clean up on extension deactivation
  context.subscriptions.push({
    dispose: () => {
      enhancementDecorationType?.dispose();
      enhancementCache.clear();
    }
  });
  
}

/**
 * Update enhancement decorations for the active editor
 */
export async function updateEnhancementDecorations(editor: vscode.TextEditor) {
  if (!editor || !enhancementDecorationType) {
    return;
  }
  
  // Only process ABAP files with adt:// scheme
  if (editor.document.languageId !== 'abap' || editor.document.uri.scheme !== 'adt') {
    // Silently skip non-ABAP files (output panels, settings, etc.)
    return;
  }
  
  // Cancel any pending decoration update
  if (pendingDecorationUpdate) {
    pendingDecorationUpdate.abort();
  }
  
  // Create new abort controller for this update
  pendingDecorationUpdate = new AbortController();
  const currentUpdate = pendingDecorationUpdate;
  
  try {
    const documentUri = editor.document.uri.toString();
    
    // Get connection ID from the ADT URI
    const connectionId = editor.document.uri.authority;
    if (!connectionId) {
      logCommands.warn('⚠️ No connection ID found in URI');
      return;
    }
    
    // Double-check URI scheme (shouldn't be needed but safety check)
    if (editor.document.uri.scheme !== 'adt') {
      return;
    }
    
    // Extract the object URI from the document URI using the existing ABAP file utilities
    let abapFile;
    try {
      abapFile = uriAbapFile(editor.document.uri);
    } catch (error) {
      // Log error only for adt:// URIs (ignore other schemes)
      if (editor.document.uri.scheme === 'adt') {
        logCommands.error(`❌ Error in uriAbapFile for ${documentUri}: ${error}`);
      }
      return;
    }
    
    if (!abapFile?.object) {
      // This is normal for newly opened files - cache not populated yet
      return;
    }
    
    // Load structure if not already loaded (required for contentsPath())
    if (!abapFile.object.structure) {
      await abapFile.object.loadStructure();
    }
    
    // Get the ADT URI from the ABAP object - this replaces manual path parsing
    const objectUri = abapFile.object.contentsPath();
    
        
    // Check cache first
    const cacheKey = `${connectionId}:${objectUri}`;
    let enhancementResult = enhancementCache.get(cacheKey);
    
    if (!enhancementResult) {
      // Get enhancement information (no code needed for decorations)
      const { getObjectEnhancements } = await import('../services/lm-tools/shared');
      enhancementResult = await getObjectEnhancements(objectUri, connectionId, false);
      
      // Cache the result for 60 minutes
      enhancementCache.set(cacheKey, enhancementResult);
      setTimeout(() => enhancementCache.delete(cacheKey), 60 * 60 * 1000);
    }
    
    if (!enhancementResult.hasEnhancements) {
      // Clear any existing decorations
      editor.setDecorations(enhancementDecorationType, []);
      return;
    }
    
    // Create decorations for each enhancement position
    const decorations: vscode.DecorationOptions[] = [];
    
    for (const enhancement of enhancementResult.enhancements) {
      // Convert SAP line numbers (0-based) to VSCode line numbers (0-based)
      const startLine = Math.max(0, enhancement.startLine);
      
      // Create decoration for the enhancement start line
      if (startLine < editor.document.lineCount) {
        const line = editor.document.lineAt(startLine);
        
        // Create markdown with command link
        const hoverMessage = new vscode.MarkdownString(
          `**🎯 Enhancement: ${enhancement.name}**\n\n` +
          `• **Type:** ${enhancement.type}\n` +
          `• **Line:** ${enhancement.startLine + 1}\n\n` +
          `[📝 Open Enhancement Source](command:abapfs.showEnhancementSource?${encodeURIComponent(JSON.stringify([
            enhancement.name,
            objectUri,
            connectionId
          ]))})`
        );
        hoverMessage.isTrusted = true; // Enable command links
        
        const decoration: vscode.DecorationOptions = {
          range: new vscode.Range(startLine, 0, startLine, line.text.length),
          hoverMessage: hoverMessage
        };
        decorations.push(decoration);
        
      }
    }
    
    // Check if this update was cancelled before applying decorations
    if (currentUpdate.signal.aborted) {
      logCommands.debug('Enhancement decoration update was cancelled (editor changed)');
      return;
    }
    
    // Check if editor is still the active one
    if (window.activeTextEditor !== editor) {
      logCommands.debug('Editor is no longer active, skipping decoration update');
      return;
    }
    
    // Apply decorations
    editor.setDecorations(enhancementDecorationType, decorations);
    
    
  } catch (error) {
    // Only log error if not aborted
    if (!currentUpdate.signal.aborted) {
      logCommands.error(`❌ Error updating enhancement decorations: ${error}`);
    }
    // Clear decorations on error (if editor still active)
    if (window.activeTextEditor === editor) {
      editor.setDecorations(enhancementDecorationType, []);
    }
  } finally {
    // Clear pending if this was the current one
    if (pendingDecorationUpdate === currentUpdate) {
      pendingDecorationUpdate = undefined;
    }
  }
}

/**
 * Clear enhancement decorations for an editor
 */
export function clearEnhancementDecorations(editor: vscode.TextEditor) {
  if (editor && enhancementDecorationType) {
    editor.setDecorations(enhancementDecorationType, []);
  }
}

/**
 * Command to open enhancement for editing
 */
export async function showEnhancementSource(enhancementName: string, objectUri: string, connectionId: string) {
  try {
    
    // Get enhancement data to retrieve the enhancement URI
    const { getObjectEnhancements } = await import('../services/lm-tools/shared');
    
    // Reconstruct the proper objectUri (similar to decoration function)
    const activeEditor = window.activeTextEditor;
    if (!activeEditor) {
      window.showErrorMessage('No active editor found');
      return;
    }
    
    const { uriAbapFile } = await import('../adt/operations/AdtObjectFinder');
    const abapFile = uriAbapFile(activeEditor.document.uri);
    if (!abapFile?.object) {
      window.showErrorMessage('Could not get ABAP object from active editor');
      return;
    }
    
    const properObjectUri = abapFile.object.contentsPath();
    
    // Get enhancement information including URI
    const enhancementResult = await getObjectEnhancements(properObjectUri, connectionId, false);
    
    const enhancement = enhancementResult.enhancements.find(e => e.name === enhancementName);
    if (!enhancement || !enhancement.uri) {
      window.showWarningMessage(`Could not find enhancement URI for: ${enhancementName}`);
      return;
    }
    
    
    // Convert the enhancement ADT URI to a VS Code workspace URI
    // Enhancement URI format: /sap/bc/adt/enhancements/enhoxhh/zxxx/source/main#start=78,0
    // Remove the #start fragment and /source/main suffix for opening
    const cleanEnhancementUri = enhancement.uri.split('#')[0].replace('/source/main', '');
    
    // Build the workspace URI similar to GetAbapObjectWorkspaceUriTool logic
    const { getOrCreateRoot } = await import('../adt/conections');
    const root = await getOrCreateRoot(connectionId);
    
    // Find the workspace path for this enhancement URI
    const { path } = (await root.findByAdtUri(cleanEnhancementUri, true)) || {};
    
    if (!path) {
      window.showErrorMessage(`Could not resolve workspace path for enhancement: ${enhancementName}`);
      return;
    }
    
    // Construct the workspace URI
    const workspaceUri = vscode.Uri.parse(`adt://${connectionId}${path}`);
    
    // Check if the document is already open to avoid refreshing it
    const existingEditor = window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === workspaceUri.toString()
    );
    
    if (existingEditor) {
      // Document is already open, just show it
      await window.showTextDocument(existingEditor.document, {
        preview: false,
        viewColumn: vscode.ViewColumn.Active
      });
    } else {
      // Open the enhancement in VS Code only if not already open
      const document = await vscode.workspace.openTextDocument(workspaceUri);
      await window.showTextDocument(document, {
        preview: false,
        viewColumn: vscode.ViewColumn.Active
      });
    }
    
    //window.showInformationMessage(`✅ Enhancement opened for editing: ${enhancementName}`);
    
  } catch (error) {
    logCommands.error(`❌ Error opening enhancement: ${error}`);
    window.showErrorMessage(`Failed to open enhancement: ${error}`);
  }
}

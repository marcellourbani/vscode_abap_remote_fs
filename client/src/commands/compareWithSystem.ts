/**
 * Compare ABAP object with same object in another SAP system
 * Right-click context menu: "ABAP FS: Compare With Other System"
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../services/funMessenger';
import { ADTSCHEME } from '../adt/conections';
import { connectedRoots, formatKey } from '../config';

/**
 * Compare current ABAP object with same object in another connected system
 */
export async function compareWithOtherSystem(uri?: vscode.Uri): Promise<void> {
  try {
    // Get the source URI (from context menu or active editor)
    let sourceUri: vscode.Uri | undefined = uri;
    
    if (!sourceUri) {
      const activeEditor = window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.scheme === ADTSCHEME) {
        sourceUri = activeEditor.document.uri;
      }
    }
    
    if (!sourceUri || sourceUri.scheme !== ADTSCHEME) {
      window.showWarningMessage('Please select an ABAP file to compare');
      return;
    }
    
    const currentSystem = formatKey(sourceUri.authority);
    
    // Get all connected systems except the current one
    const roots = connectedRoots();
    
    if (roots.size <= 1) {
      window.showWarningMessage('Connect to at least one other SAP system to compare.');
      return;
    }
    
    // Filter to only show systems that are different from current
    const otherSystems: vscode.QuickPickItem[] = [];
    
    for (const [systemId, folder] of roots.entries()) {
      if (systemId !== currentSystem) {
        otherSystems.push({
          label: folder.name,
          description: systemId.toUpperCase()
        });
      }
    }
    
    if (otherSystems.length === 0) {
      window.showWarningMessage('No other SAP systems connected. Connect to another system to compare.');
      return;
    }
    
    // Show quick pick to select target system
    const selected = await window.showQuickPick(otherSystems, {
      placeHolder: `Compare with which system? (current: ${currentSystem.toUpperCase()})`,
      title: 'ABAP FS: Compare With Other System'
    });
    
    if (!selected) {
      return; // User cancelled
    }
    
    const targetSystem = formatKey(selected.description || selected.label);
    
    // Build the target URI - same path, different authority
    const targetUri = sourceUri.with({ authority: targetSystem });
    const sourcePath = sourceUri.path;
    
    // Extract object name for the diff title
    const pathParts = sourceUri.path.split('/');
    const fileName = pathParts[pathParts.length - 1] || 'Unknown';
    const objectName = fileName.replace(/\.(prog|clas|fugr|intf|ddls)\.abap$/, '');
    const diffTitle = `${objectName}: ${currentSystem.toUpperCase()} ↔ ${targetSystem.toUpperCase()}`;
    
    // Newer systems: "Source Code Library", Older systems: "Source Library"
    
    // First, check if target file exists by trying to read it
    let finalTargetUri = targetUri;
    try {
      await vscode.workspace.fs.stat(targetUri);
      // File exists, use it
    } catch {
      // File doesn't exist, try alternate path
      if (sourcePath.includes('/Source Code Library/') || sourcePath.includes('/Source Library/')) {
        const alternatePath = sourcePath.includes('/Source Code Library/')
          ? sourcePath.replace('/Source Code Library/', '/Source Library/')
          : sourcePath.replace('/Source Library/', '/Source Code Library/');
        
        const alternateUri = sourceUri.with({ authority: targetSystem, path: alternatePath });
        
        try {
          await vscode.workspace.fs.stat(alternateUri);
          // Alternate exists, use it
          finalTargetUri = alternateUri;
        } catch {
          throw new Error(`Object "${objectName}" not found in ${targetSystem.toUpperCase()}. Tried both "Source Code Library" and "Source Library" paths.`);
        }
      } else {
        throw new Error(`Object "${objectName}" not found in ${targetSystem.toUpperCase()}.`);
      }
    }
    
    // Now open the diff with the correct URI
    await vscode.commands.executeCommand('vscode.diff', 
      sourceUri,        // Left side (current system)
      finalTargetUri,   // Right side (target system)  
      diffTitle         // Title for the diff editor
    );
    
  } catch (error) {
    window.showErrorMessage(`Failed to compare: ${error}`);
  }
}

/**
 * Register the compare command
 */
export function registerCompareWithSystemCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('abapfs.compareWithOtherSystem', compareWithOtherSystem)
  );
}

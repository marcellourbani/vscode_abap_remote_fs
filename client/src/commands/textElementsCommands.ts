import * as vscode from 'vscode';
import { funWindow as window } from '../services/funMessenger';
import { getClient, getRoot } from '../adt/conections';
import { getTextElementsSafe, updateTextElementsWithTransport, TextElement } from '../adt/textElements';
import { logCommands } from '../services/abapCopilotLogger';
import { session_types } from "abap-adt-api";
import { logTelemetry } from '../services/telemetry';
import { isAbapFile } from 'abapfs';

/**
 * Manage Text Elements Command
 * Opens a webview for managing text elements (read/create/edit/delete)
 * Can be called from command palette, context menu, or active editor
 */
export async function manageTextElementsCommand(uri?: vscode.Uri): Promise<void> {
  try {
    // Determine program name from context - ONLY from open ABAP files
    let objectName: string | undefined;
    let sourceUri: vscode.Uri | undefined;
    
    if (uri) {
      // Called from context menu or specific file
      if (uri.scheme !== 'adt') {
        window.showErrorMessage('Text Elements Manager only works with ABAP files. Please open an ABAP file first.');
        return;
      }
      sourceUri = uri;
    } else {
      // Called from command palette - get from active editor
      const activeEditor = window.activeTextEditor;
      if (!activeEditor || activeEditor.document.uri.scheme !== 'adt') {
        window.showErrorMessage('Text Elements Manager only works with ABAP files. Please open an ABAP file first.');
        return;
      }
      sourceUri = activeEditor.document.uri;
    }

    if (!sourceUri) {
      window.showErrorMessage('Could not determine ABAP file.');
      return;
    }

    // Check if this is an include FIRST - before extracting program name
    try {
      const root = getRoot(sourceUri.authority);
      const file = await root.getNodeAsync(sourceUri.path);
      
      if (isAbapFile(file) && file.object.type === 'PROG/I') {
        // This is an include - get main program
        const mainPrograms = await file.object.mainPrograms();
        
        if (mainPrograms && mainPrograms.length > 0) {
          const mainProg = mainPrograms[0];
          
          // Use adtcore:name directly - it's more reliable than parsing URIs
          const mainProgName = mainProg['adtcore:name'];
          
          if (mainProgName) {
            objectName = mainProgName + '.prog.abap';
          }
        }
      } else {
        // Not an include - extract from current URI
        objectName = extractProgramNameFromUri(sourceUri.toString()) || undefined;
      }
    } catch (error) {
      logCommands.error(`Error resolving object: ${error}`);
      // Fallback to extracting from current URI
      objectName = extractProgramNameFromUri(sourceUri.toString()) || undefined;
    }

    if (!objectName) {
      window.showErrorMessage('Could not determine program name from the current ABAP file.');
      return;
    }

    logTelemetry("command_text_elements_manager_called", { connectionId: sourceUri.authority })

    await showTextElementsEditor(objectName.trim(), sourceUri);
  } catch (error) {
    logCommands.error(`Error opening text elements manager: ${error}`);
    window.showErrorMessage(`Failed to open text elements manager: ${error}`);
  }
}

/**
 * Show text elements manager for a program
 */
async function showTextElementsEditor(programName: string, sourceUri: vscode.Uri): Promise<void> {
  // Get ADT connection - get active connection or ask user
  const activeEditor = window.activeTextEditor;
  let connectionId: string;
  
  if (activeEditor && activeEditor.document.uri.scheme === 'adt') {
    connectionId = activeEditor.document.uri.authority;
  } else {
    window.showErrorMessage('No ADT connection available. Please open an ABAP file first.');
    return;
  }
  
  const client = getClient(connectionId);
  if (!client) {
    window.showErrorMessage('No ADT connection available. Please connect to an SAP system first.');
    return;
  }

  // Show progress while loading
  await window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Loading text elements for ${programName}...`,
    cancellable: false
  }, async (progress) => {
    try {
      progress.report({ increment: 30, message: 'Fetching text elements...' });
      
      const result = await getTextElementsSafe(client, programName);
      
      progress.report({ increment: 70, message: 'Opening editor...' });
      
      // Create and show text elements manager webview
      await createTextElementsWebview(programName, result.textElements, connectionId, sourceUri);
      
    } catch (error) {
      // Check if it's a "Resource does not exist" error - fallback to SAP GUI for old systems
      const errorMessage = String(error);
      if (errorMessage.includes('Resource') && errorMessage.includes('does not exist')) {
        progress.report({ increment: 50, message: 'Falling back to SAP GUI...' });
        
        // Use existing logic to determine object type and build SAP GUI URL for text elements
        await openTextElementsInSapGui(programName, connectionId);
        
        window.showInformationMessage(
          `Text elements ADT API not available for this system. Opened text elements editor in SAP GUI instead.`
        );
      } else {
        throw error;
      }
    }
  });
}

/**
 * Open text elements editor in SAP GUI as fallback for old systems
 * Reuses existing SAP GUI infrastructure
 */
export async function openTextElementsInSapGui(programName: string, connectionId: string): Promise<void> {
  try {
    
    const { parseObjectName } = await import('../adt/textElements');
    const { SapGuiPanel } = await import('../views/sapgui/SapGuiPanel');
    const { getClient } = await import('../adt/conections');
    
    // Parse object name to determine type
    const objectInfo = parseObjectName(programName);
    
    // Map to SAP GUI object types
    let sapGuiObjectType: string;
    switch (objectInfo.type) {
      case 'CLASS':
        sapGuiObjectType = 'CLAS/OC';
        break;
      case 'FUNCTION_GROUP':
        sapGuiObjectType = 'FUGR/FF';
        break;
      case 'FUNCTION_MODULE':
        // Individual function modules use SE37 with the FM name directly
        sapGuiObjectType = 'FUNC/FM';
        break;
      case 'PROGRAM':
      default:
        sapGuiObjectType = 'PROG/P';
        break;
    }
       
    // Get extension URI (same as working embedded GUI)
    let extensionUri: vscode.Uri;
    try {
      const extension = vscode.extensions.getExtension('murbani.vscode-abap-remote-fs');
      if (extension) {
        extensionUri = extension.extensionUri;
      } else {
        const altExtension = vscode.extensions.getExtension('abap-copilot');
        if (altExtension) {
          extensionUri = altExtension.extensionUri;
        } else {
          extensionUri = vscode.Uri.file(__dirname);
        }
      }
    } catch (error) {
      extensionUri = vscode.Uri.file(__dirname);
    }
    
    // Create panel using the exact same working logic
    const panel = SapGuiPanel.createOrShow(
      extensionUri,
      getClient(connectionId),
      connectionId,
      objectInfo.cleanName,
      sapGuiObjectType
    );
    
    // Build text elements URL
    const baseUrl = await panel.buildWebGuiUrl();
    
    // For text elements, we need different approaches for different object types
    let textElementsUrl: string;
    
    if (sapGuiObjectType === 'CLAS/OC') {
      // For classes: Use SE24 (Class Builder) with class name prefilled
      const { RemoteManager } = await import('../config');
      const config = RemoteManager.get().byId(connectionId);
      if (!config) {
        throw new Error(`Connection configuration not found for ${connectionId}`);
      }
      
      let baseUrlForSE24 = config.url.replace(/\/sap\/bc\/adt.*$/, '');
      if (!baseUrlForSE24.startsWith('https://') && !baseUrlForSE24.startsWith('http://')) {
        baseUrlForSE24 = 'https://' + baseUrlForSE24;
      } else if (baseUrlForSE24.startsWith('http://')) {
        baseUrlForSE24 = baseUrlForSE24.replace('http://', 'https://');
      }
      
      // Use SE24 (Class Builder) with class name prefilled
      textElementsUrl = `${baseUrlForSE24}/sap/bc/gui/sap/its/webgui?` +
        `~transaction=SE24 SEOCLASS-CLSNAME=${objectInfo.cleanName}` +
        `&sap-client=${config.client}` +
        `&sap-language=${config.language || 'EN'}` +
        `&saml2=disabled`;
        
    } else if (sapGuiObjectType === 'FUGR/FF' || sapGuiObjectType === 'FUNC/FM') {
      // For function modules and function groups: SE37 with TEXT okcode
      textElementsUrl = baseUrl.replace('DYNP_OKCODE%3dWB_EXEC', 'DYNP_OKCODE%3dTEXT');
      
    } else {
      // For programs: SE38 with TEXT okcode works fine
      textElementsUrl = baseUrl.replace('DYNP_OKCODE%3dSTRT', 'DYNP_OKCODE%3dTEXT');
    }
    
    
    // Load the text elements URL directly
    panel.loadDirectWebGuiUrl(textElementsUrl);
        
  } catch (error) {
    logCommands.error(`❌ Error opening SAP GUI text elements: ${error}`);
    throw error;
  }
}

/**
 * Create and show text elements manager webview
 */
async function createTextElementsWebview(programName: string, textElements: TextElement[], connectionId: string, sourceUri: vscode.Uri): Promise<void> {
  const panel = window.createWebviewPanel(
    'textElementsManager',
    `Text Elements Manager - ${programName}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: []
    }
  );

  // Set webview HTML content
  panel.webview.html = getTextElementsWebviewContent(programName, textElements);

  // Handle messages from webview
  panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      // 🚫 DISABLED: Save functionality disabled due to lock handle issues
      
      case 'save':
        await handleSaveTextElements(programName, message.textElements, panel, connectionId, sourceUri);
        break;
      
      case 'refresh':
        await handleRefreshTextElements(programName, panel, connectionId);
        break;
      // 🚫 DISABLED: Add/Delete functionality disabled
      
      case 'add':
        // Add empty row - handled in webview
        break;
      case 'delete':
        // Delete row - handled in webview
        break;
      
    }
  });

  // Show the panel
  panel.reveal();
}

/**
 * Handle saving text elements from webview
 * 🚫 DISABLED: Save functionality disabled due to lock handle issues
 */

async function handleSaveTextElements(
  programName: string, 
  textElements: TextElement[], 
  panel: vscode.WebviewPanel,
  connectionId: string,
  sourceUri: vscode.Uri
): Promise<void> {
  try {
    // Get client using the connectionId from the original context - get original client, not clone
    const client = getClient(connectionId, false); // false = don't clone, get original client
    if (!client) {
      window.showErrorMessage(`No ADT connection available for ${connectionId}.`);
      return;
    }
    client.stateful = session_types.stateful;       

    await window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Saving text elements for ${programName}...`,
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 30, message: 'Validating...' });
      
      // Filter out empty text elements
      const validTextElements = textElements.filter(te => te.id && te.text);
      
      if (validTextElements.length === 0) {
        throw new Error('No valid text elements to save');
      }

      progress.report({ increment: 60, message: 'Saving to SAP system...' });
      //changed below line to not use lock manager version of function
      await updateTextElementsWithTransport(client, programName, validTextElements, sourceUri.toString());
      
      progress.report({ increment: 100, message: 'Saved successfully' });
    });

    window.showInformationMessage(`Text elements saved successfully for ${programName}`);
    
    // Send success message to webview
    panel.webview.postMessage({ command: 'saveSuccess' });
    
  } catch (error) {
    logCommands.error(`Error saving text elements: ${error}`);
    window.showErrorMessage(`Failed to save text elements: ${error}`);
    
    // Send error message to webview
    panel.webview.postMessage({ command: 'saveError', error: String(error) });
  }
}


/**
 * Handle refreshing text elements from webview
 */
async function handleRefreshTextElements(
  programName: string, 
  panel: vscode.WebviewPanel,
  connectionId: string
): Promise<void> {
  try {
    // Get client using the connectionId from the original context
    const client = getClient(connectionId);
    if (!client) {
      window.showErrorMessage(`No ADT connection available for ${connectionId}.`);
      panel.webview.postMessage({ command: 'refreshError', error: `No ADT connection available for ${connectionId}` });
      return;
    }

    // Reload text elements from SAP
    const result = await getTextElementsSafe(client, programName);
    
    // Send updated data to webview
    panel.webview.postMessage({
      command: 'refresh',
      textElements: result.textElements
    });
    
    
  } catch (error: any) {
    logCommands.error(`Error refreshing text elements: ${error}`);
    window.showErrorMessage(`Failed to refresh text elements: ${error.message}`);
    
    // Send error message to webview
    panel.webview.postMessage({ 
      command: 'refreshError', 
      error: error.message || String(error)
    });
  }
}

/**
 * Extract object name from ADT URI for programs, classes, and function groups
 * Handles URL-encoded namespace objects (e.g., %E2%88%95UGI4%E2%88%95 -> /UGI4/)
 * Also handles division slash (∕) normalization to forward slash (/)
 * 
 * Function Group URI patterns handled:
 * - .../Function Groups/FG_NAME/FG_NAME.fugr.abap (direct function group file)
 * - .../Function Groups/FG_NAME/Function Modules/MODULE_NAME.fugr.abap (function module in group)
 * - .../Function Groups/FG_NAME (function group folder without specific file)
 */
function extractProgramNameFromUri(uriString: string): string | null {
  try {
    // Class pattern: adt://system/path/to/Classes/CLASS_NAME/CLASS_NAME.clas.abap
    const classMatches = uriString.match(/\/Classes\/([^\/]+)\/[^\/]+\.clas\.abap/i);
    if (classMatches && classMatches[1]) {
      let decodedName = decodeURIComponent(classMatches[1]);
      // Normalize division slash (∕) to forward slash (/) for SAP compatibility
      decodedName = decodedName.replace(/∕/g, '/');
      return decodedName + '.clas.abap';  // Include extension for type detection
    }

    // Function Group pattern 1: adt://system/path/to/Function Groups/FG_NAME/FG_NAME.fugr.abap
    const fgMatches = uriString.match(/\/Function.*Groups?\/([^\/]+)\/[^\/]+\.fugr\.abap/i);
    if (fgMatches && fgMatches[1]) {
      let decodedName = decodeURIComponent(fgMatches[1]);
      // Normalize division slash (∕) to forward slash (/) for SAP compatibility
      decodedName = decodedName.replace(/∕/g, '/');
      return decodedName + '.fugr.abap';  // Include extension for type detection
    }

    // Function Group pattern 2: adt://system/path/to/Function Groups/FG_NAME/Function Modules/MODULE_NAME.fugr.abap
    const fgModuleMatches = uriString.match(/\/Function.*Groups?\/[^\/]+\/Function.*Modules?\/([^\/]+)\.fugr\.abap/i);
    if (fgModuleMatches && fgModuleMatches[1]) {
      let decodedName = decodeURIComponent(fgModuleMatches[1]);
      // For function modules, we want the actual function module name, not the function group
      // So we return it as .func.abap to distinguish from function groups
      decodedName = decodedName.replace(/∕/g, '/');
      return decodedName + '.func.abap';  // Use .func.abap to distinguish from function groups
    }

    // Program pattern: adt://system/path/to/Programs/PROGRAM_NAME/PROGRAM_NAME.prog.abap
    const progMatches = uriString.match(/\/Programs\/([^\/]+)\/[^\/]+\.prog\.abap/i);
    if (progMatches && progMatches[1]) {
      let decodedName = decodeURIComponent(progMatches[1]);
      // Normalize division slash (∕) to forward slash (/) for SAP compatibility
      decodedName = decodedName.replace(/∕/g, '/');
      return decodedName + '.prog.abap';  // Include extension for type detection
    }

    // Alternative patterns without extension
    const altClassMatches = uriString.match(/\/Classes\/([^\/\?]+)/i);
    if (altClassMatches && altClassMatches[1]) {
      let decodedName = decodeURIComponent(altClassMatches[1]);
      // Normalize division slash (∕) to forward slash (/) for SAP compatibility
      decodedName = decodedName.replace(/∕/g, '/');
      return decodedName.toUpperCase();
    }

    const altFgMatches = uriString.match(/\/Function.*Groups?\/([^\/\?]+)/i);
    if (altFgMatches && altFgMatches[1]) {
      let decodedName = decodeURIComponent(altFgMatches[1]);
      // Normalize division slash (∕) to forward slash (/) for SAP compatibility
      decodedName = decodedName.replace(/∕/g, '/');
      return decodedName.toUpperCase() + '.fugr.abap';  // Add extension for function group type detection
    }

    const altProgMatches = uriString.match(/\/Programs\/([^\/\?]+)/i);
    if (altProgMatches && altProgMatches[1]) {
      let decodedName = decodeURIComponent(altProgMatches[1]);
      // Normalize division slash (∕) to forward slash (/) for SAP compatibility
      decodedName = decodedName.replace(/∕/g, '/');
      return decodedName.toUpperCase();
    }

    return null;
  } catch (error) {
    logCommands.error(`Error extracting object name from URI: ${error}`);
    return null;
  }
}

/**
 * Generate HTML content for text elements webview
 */
function getTextElementsWebviewContent(programName: string, textElements: TextElement[]): string {
  const textElementsJson = JSON.stringify(textElements);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Text Elements - ${programName}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
        }
        .title {
            font-size: 18px;
            font-weight: bold;
        }
        .buttons {
            display: flex;
            gap: 10px;
        }
        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .btn.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 8px 12px;
            text-align: left;
        }
        th {
            background-color: var(--vscode-list-headerBackground);
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: var(--vscode-list-evenBackground);
        }
        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
            padding: 4px 8px;
            width: 100%;
            box-sizing: border-box;
        }
        input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .id-input {
            width: 80px;
        }
        .maxlength-input {
            width: 80px;
        }
        .delete-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }
        .delete-btn:hover {
            background-color: var(--vscode-errorBackground);
            color: var(--vscode-errorForeground);
        }
        .status {
            margin-top: 10px;
            padding: 8px;
            border-radius: 3px;
            display: none;
        }
        .status.success {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }
        .status.error {
            background-color: var(--vscode-testing-iconFailed);
            color: white;
        }
        .empty-message {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .program-info {
            background-color: var(--vscode-list-headerBackground);
            padding: 10px 15px;
            border-radius: 3px;
            margin-bottom: 15px;
            font-size: 12px;
        }
        .validation-error {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }
        .row-number {
            width: 40px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">� Text Elements Manager - ${programName}</div>
        <div class="buttons">
            <button class="btn secondary" onclick="refreshTextElements()">🔄 Refresh</button>
            <button class="btn secondary" onclick="addRow()">➕ Add Text Element</button> 
            <button class="btn" onclick="saveTextElements()">💾 Save & Activate</button>
        </div>
    </div>
    
    <div id="status" class="status"></div>
    
    <div class="program-info">
        <strong>Object:</strong> ${programName} | <strong>Text Elements:</strong> <span id="elementCount">${textElements.length}</span>
    </div>
    
    <div id="content">
        <table id="textElementsTable">
            <thead>
                <tr>
                    <th class="row-number">#</th>
                    <th>ID</th>
                    <th>Text</th>
                    <th>Max Length</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="tableBody">
                <!-- Rows will be populated by JavaScript -->
            </tbody>
        </table>
        
        <div id="emptyMessage" class="empty-message" style="display: none;">
            No text elements found in this object.
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let textElements = ${textElementsJson};
        
        function renderTable() {
            const tbody = document.getElementById('tableBody');
            const emptyMessage = document.getElementById('emptyMessage');
            
            if (textElements.length === 0) {
                tbody.innerHTML = '';
                emptyMessage.style.display = 'block';
                return;
            }
            
            emptyMessage.style.display = 'none';
            
            tbody.innerHTML = textElements.map((element, index) => \`
                <tr>
                    <td class="row-number">\${index + 1}</td>
                    <td>
                        <input type="text" class="id-input" value="\${element.id || ''}" 
                             onchange="updateElement(\${index}, 'id', this.value.toUpperCase())"
                             maxlength="8"
                             pattern="[A-Z0-9_]*"
                             title="1-8 characters, letters, numbers, underscore only"
                             placeholder="e.g., 001">
                    </td>
                    <td>
                        <input type="text" value="\${element.text || ''}" 
                             onchange="updateElement(\${index}, 'text', this.value)"
                             placeholder="Enter text content"> 
                    </td>
                    <td>
                        <input type="number" class="maxlength-input" value="\${element.maxLength || ''}" 
                             onchange="updateElement(\${index}, 'maxLength', parseInt(this.value))"
                             min="1" max="255"
                             placeholder="Auto"
                             title="Maximum length for this text element">
                    </td>
                    <td>
                        <button class="delete-btn" onclick="deleteRow(\${index})" title="Delete this text element">🗑️</button>
                    </td> 
                </tr>
            \`).join('');
        }
        
        // 🚫 DISABLED: Add row functionality disabled due to lock handle issues
        
        function addRow() {
            // Auto-generate next available ID
            const usedIds = new Set(textElements.map(te => te.id).filter(id => id));
            let nextId = '';
            
            // Find next available numeric ID (001, 002, etc.)
            for (let i = 1; i <= 999; i++) {
                const candidateId = i.toString().padStart(3, '0');
                if (!usedIds.has(candidateId)) {
                    nextId = candidateId;
                    break;
                }
            }
            
            textElements.push({ id: nextId, text: '', maxLength: undefined });
            renderTable();
            updateElementCount();
            
            // Focus on the new text input
            setTimeout(() => {
                const rows = document.querySelectorAll('#tableBody tr');
                const lastRow = rows[rows.length - 1];
                const textInput = lastRow.querySelector('input[type="text"]:nth-of-type(2)');
                if (textInput) textInput.focus();
            }, 100);
        }
        
        
        function refreshTextElements() {
            showStatus('success', 'Refreshing text elements...');
            vscode.postMessage({
                command: 'refresh'
            });
        }
        
        // 🚫 DISABLED: Delete row functionality disabled due to lock handle issues
        
        function deleteRow(index) {
            if (confirm(\`Delete text element '\${textElements[index].id}' - '\${textElements[index].text}'?\`)) {
                textElements.splice(index, 1);
                renderTable();
                updateElementCount();
            }
        }
        
        
        function updateElementCount() {
            document.getElementById('elementCount').textContent = textElements.length;
        }
        
        // 🚫 DISABLED: Update element functionality disabled due to lock handle issues
        
        function updateElement(index, field, value) {
            if (field === 'id') {
                value = value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
            }
            
            textElements[index][field] = value;
            
            // Auto-update maxLength based on text length if it's currently undefined/empty
            if (field === 'text' && value) {
                const currentMaxLength = textElements[index].maxLength;
                if (!currentMaxLength || currentMaxLength === '' || isNaN(currentMaxLength)) {
                    // Auto-calculate: at least text length + some buffer (minimum 10)
                    const autoLength = Math.max(value.length + 5, 10);
                    textElements[index].maxLength = autoLength;
                    
                    // Update the input field visually
                    const row = document.querySelectorAll('#tableBody tr')[index];
                    const maxLengthInput = row.querySelector('input[type="number"]');
                    if (maxLengthInput) {
                        maxLengthInput.value = autoLength;
                    }
                }
            }
        }
        
        
        // 🚫 DISABLED: Save functionality disabled due to lock handle issues
        
        function saveTextElements() {
            // Validate before saving
            const errors = [];
            const usedIds = new Set();
            
            textElements.forEach((element, index) => {
                if (!element.id) {
                    errors.push(\`Row \${index + 1}: ID is required\`);
                } else if (usedIds.has(element.id)) {
                    errors.push(\`Row \${index + 1}: Duplicate ID '\${element.id}'\`);
                } else {
                    usedIds.add(element.id);
                }
                
                if (!element.text) {
                    errors.push(\`Row \${index + 1}: Text is required\`);
                }
                
                if (element.maxLength && element.text && element.text.length > element.maxLength) {
                    errors.push(\`Row \${index + 1}: Text length (\${element.text.length}) exceeds max length (\${element.maxLength})\`);
                }
            });
            
            if (errors.length > 0) {
                showStatus('error', 'Validation errors:\\n' + errors.join('\\n'));
                return;
            }
            
            // Filter out empty rows
            const validElements = textElements.filter(te => te.id && te.text);
            
            if (validElements.length === 0) {
                showStatus('error', 'No valid text elements to save');
                return;
            }
            
            showStatus('success', 'Saving...');
            vscode.postMessage({
                command: 'save',
                textElements: validElements
            });
        }
        
        
        function showStatus(type, message) {
            const status = document.getElementById('status');
            status.className = 'status ' + type;
            status.textContent = message;
            status.style.display = 'block';
            
            if (type === 'success' && message !== 'Saving...') {
                setTimeout(() => {
                    status.style.display = 'none';
                }, 3000);
            }
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                // 🚫 DISABLED: Save-related message handlers disabled
                
                case 'saveSuccess':
                    showStatus('success', 'Text elements saved successfully!');
                    break;
                case 'saveError':
                    showStatus('error', 'Save failed: ' + message.error);
                    break;
                
                case 'refresh':
                    // Update textElements array and re-render
                    textElements = message.textElements || [];
                    renderTable();
                    updateElementCount();
                    showStatus('success', 'Text elements refreshed successfully!');
                    break;
                case 'refreshError':
                    showStatus('error', 'Refresh failed: ' + message.error);
                    break;
            }
        });
        
        // Initial render
        renderTable();
    </script>
</body>
</html>`;
}

/**
 * Diagram Webview Manager - For displaying Mermaid diagrams with zoom controls
 * Similar to WebviewManager but specialized for diagram viewing
 */

import * as vscode from 'vscode';
import { funWindow as window } from './funMessenger';
import { logCommands } from './abapCopilotLogger';

export interface DiagramViewResult {
  webviewId: string;
  action: 'created';
}

export class DiagramWebviewManager {
  private static instance: DiagramWebviewManager;
  private static isInitialized = false;
  private extensionUri: vscode.Uri;
  private webviews = new Map<string, vscode.WebviewPanel>();

  private constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  public static initialize(extensionUri: vscode.Uri): void {
    if (!DiagramWebviewManager.instance) {
      DiagramWebviewManager.instance = new DiagramWebviewManager(extensionUri);
      DiagramWebviewManager.isInitialized = true;
    }
  }

  public static getInstance(): DiagramWebviewManager {
    if (!DiagramWebviewManager.isInitialized) {
      throw new Error('DiagramWebviewManager not initialized. Call initialize() first in the extension activation.');
    }
    return DiagramWebviewManager.instance;
  }

  /**
   * Display a Mermaid diagram in a webview with zoom controls
   */
  public async displayDiagram(
    svg: string,
    diagramType: string,
    title: string = 'Mermaid Diagram'
  ): Promise<DiagramViewResult> {
    
    const webviewId = `diagram-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    

    // Create webview panel
    const panel = window.createWebviewPanel(
      'diagramViewer',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'client', 'dist', 'media'),
          vscode.Uri.joinPath(this.extensionUri, 'client', 'media')
        ],
        retainContextWhenHidden: true
      }
    );

    // Store webview reference
    this.webviews.set(webviewId, panel);

    // Set up message handler
    this.setupMessageHandler(panel, webviewId);

    // Generate HTML content
    panel.webview.html = this.getWebviewContent(panel.webview, svg, diagramType, title);

    // Handle disposal
    panel.onDidDispose(() => {
      this.webviews.delete(webviewId);
    });


    return {
      webviewId,
      action: 'created'
    };
  }

  private setupMessageHandler(panel: vscode.WebviewPanel, webviewId: string): void {
    panel.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.command) {
          case 'saveDiagram':
            await this.handleSaveDiagram(message.svg, message.filename);
            break;
          case 'log':
            //logCommands.info(`[DIAGRAM_WEBVIEW] ${webviewId}: ${message.message}`);
            break;
          default:
           // logCommands.warn(`[DIAGRAM_WEBVIEW] Unknown command: ${message.command}`);
        }
      } catch (error) {
        logCommands.error(`[DIAGRAM_WEBVIEW] Error handling message:`, error);
      }
    });
  }

  private async handleSaveDiagram(svg: string, filename: string): Promise<void> {
    try {
      const saveUri = await window.showSaveDialog({
        defaultUri: vscode.Uri.file(filename || `mermaid-diagram-${Date.now()}.svg`),
        filters: {
          'SVG Files': ['svg'],
          'All Files': ['*']
        },
        title: 'Save Mermaid Diagram'
      });

      if (saveUri) {
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(svg, 'utf8'));
        window.showInformationMessage(`✅ Diagram saved to: ${saveUri.fsPath}`);
        logCommands.info(`[DIAGRAM_WEBVIEW] Diagram saved to: ${saveUri.fsPath}`);
      }
    } catch (error) {
      logCommands.error('[DIAGRAM_WEBVIEW] Failed to save diagram:', error);
      window.showErrorMessage(`Failed to save diagram: ${error}`);
    }
  }

  private getWebviewContent(webview: vscode.Webview, svg: string, diagramType: string, title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }

        .diagram-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding: 15px;
            background-color: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }

        .diagram-title {
            font-size: 18px;
            font-weight: bold;
            margin: 0;
        }

        .diagram-info {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }

        .controls {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .control-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        }

        .control-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .save-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-weight: bold;
        }

        .zoom-level {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            min-width: 60px;
            text-align: center;
        }

        .diagram-container {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background-color: white;
            overflow: auto;
            height: calc(100vh - 140px);
            position: relative;
        }

        .diagram-viewer {
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100%;
            transform-origin: top left;
            transition: transform 0.2s ease;
        }

        .diagram-svg {
            max-width: none;
            height: auto;
        }
    </style>
</head>
<body>
    <div class="diagram-header">
        <div>
            <h1 class="diagram-title">${title}</h1>
            <div class="diagram-info">Type: ${diagramType}</div>
        </div>
        <div class="controls">
            <button class="control-btn" id="zoom-out">🔍−</button>
            <span class="zoom-level" id="zoom-level">200%</span>
            <button class="control-btn" id="zoom-in">🔍+</button>
            <button class="control-btn save-btn" id="save-btn">💾 Save to Desktop</button>
        </div>
    </div>

    <div class="diagram-container">
        <div class="diagram-viewer" id="diagram-viewer">
            ${svg}
        </div>
    </div>

    <script src="${webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'client', 'dist', 'media', 'diagramViewer.js'))}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    for (const panel of this.webviews.values()) {
      panel.dispose();
    }
    this.webviews.clear();
  }
}

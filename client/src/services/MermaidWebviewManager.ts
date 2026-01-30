/**
 * Mermaid Webview Manager - Headless Local Rendering Engine
 * 
 * This class creates invisible webview panels that act as secure, local
 * rendering engines for Mermaid diagrams. No external dependencies or CDNs.
 */

import * as vscode from 'vscode';
import { funWindow as window } from './funMessenger';
import { logCommands } from './abapCopilotLogger';
import { DiagramWebviewManager } from './DiagramWebviewManager';
//import * as path from 'path';

export interface MermaidRenderResult {
  svg: string;
  diagramType: string;
  success: boolean;
  error?: string;
}

export interface MermaidValidationResult {
  isValid: boolean;
  diagramType?: string;
  error?: string;
}

export class MermaidWebviewManager {
  private static instance: MermaidWebviewManager;
  private static isInitialized = false;
  private panel: vscode.WebviewPanel | null = null;
  private extensionUri: vscode.Uri;
  private pendingOperations = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  private constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  public static initialize(extensionUri: vscode.Uri): void {
    if (!MermaidWebviewManager.instance) {
      MermaidWebviewManager.instance = new MermaidWebviewManager(extensionUri);
      MermaidWebviewManager.isInitialized = true;
    }
  }

  public static getInstance(): MermaidWebviewManager {
    if (!MermaidWebviewManager.isInitialized) {
      throw new Error('MermaidWebviewManager not initialized. Call initialize() first in the extension activation.');
    }
    return MermaidWebviewManager.instance;
  }

  /**
   * Creates a new webview panel on-demand for a single operation.
   * This is the core of the "create-on-demand, dispose-after-use" pattern.
   */
  private async createOneTimeWebview(): Promise<vscode.WebviewPanel> {
    
    // Create webview panel that should be truly invisible
    const panel = window.createWebviewPanel(
      'mermaidRenderer',
      'Mermaid Renderer',
      // Use Active column but don't reveal it
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'media'),
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'media'),
          vscode.Uri.joinPath(this.extensionUri,'client', 'dist', 'media')
        ],
        // Remove retainContextWhenHidden since we dispose immediately
      }
    );


    // Set the HTML and wait for the ready signal.
    panel.webview.html = this.getWebviewContent(panel.webview);
    
    
    // The waitForReady promise is now tied to this specific panel instance.
    await this.waitForReady(panel);
    

    return panel;
  }

  private getWebviewContent(webview: vscode.Webview): string {
    // Get the local path to mermaid library
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'client', 'dist', 'media', 'mermaid.min.js')
    );

    // Log the extension URI and mermaid URI for debugging

    // Nonce for Content Security Policy
    const nonce = Date.now().toString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src vscode-resource: 'unsafe-inline'; style-src vscode-resource: 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mermaid Renderer</title>
    <style nonce="${nonce}">
        body { 
            margin: 0; 
            padding: 20px; 
            background: #1e1e1e; 
            font-family: Arial, sans-serif;
            font-size: 12px;
            line-height: 1.2;
        }
        #diagram { 
            display: block; 
            width: 100%; 
            height: auto; 
        }
        /* Minimal text improvements without interfering with Mermaid */
        svg text {
            font-family: Arial, sans-serif;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div id="diagram"></div>
    <script nonce="${nonce}" src="${mermaidUri}"></script>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Wait for mermaid to load with proper error handling
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds total
        
        function waitForMermaid() {
            attempts++;
            
            if (typeof mermaid !== 'undefined') {
                vscode.postMessage({ type: 'log', message: 'Mermaid library loaded successfully' });
                initializeMermaid();
            } else if (attempts < maxAttempts) {
                setTimeout(waitForMermaid, 100);
            } else {
                vscode.postMessage({ type: 'error', id: 'initialization-error', error: 'Mermaid library failed to load after 5 seconds' });
            }
        }
        
        function initializeMermaid() {
            try {
                vscode.postMessage({ type: 'log', message: 'Initializing Mermaid...' });
                vscode.postMessage({ type: 'log', message: 'Mermaid library found, initializing...' });
                
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'forest',
                    securityLevel: 'strict',  // ✅ SECURITY FIX: Changed from 'loose' to prevent XSS
                    fontFamily: 'Arial, sans-serif',
                    fontSize: 12,
                    flowchart: {
                        htmlLabels: false
                    }
                });

                vscode.postMessage({ type: 'log', message: 'Mermaid initialized, sending ready signal' });
                
                // Signal that we're ready
                vscode.postMessage({ type: 'ready' });

                // Handle messages from extension
                window.addEventListener('message', async (event) => {
                    vscode.postMessage({ type: 'log', message: 'Received message: ' + event.data.type });
                    
                    const { type, id, data } = event.data;

                    try {
                        switch (type) {
                            case 'render':
                                await handleRender(id, data.code, data.theme);
                                break;
                            case 'validate':
                                await handleValidate(id, data.code);
                                break;
                            case 'detectType':
                                await handleDetectType(id, data.code);
                                break;
                            default:
                                vscode.postMessage({
                                    type: 'error',
                                    id,
                                    error: 'Unknown operation type: ' + type
                                });
                        }
                    } catch (error) {
                        vscode.postMessage({
                            type: 'error',
                            id,
                            error: error.message || String(error)
                        });
                    }
                });
                
                // Handler functions
                async function handleRender(id, code, theme) {
                    try {
                        const element = document.getElementById('diagram');
                        element.innerHTML = '';
                        
                        const { svg } = await mermaid.render('temp-id', code);
                        
                        vscode.postMessage({
                            type: 'result',
                            id,
                            result: {
                                svg,
                                diagramType: 'auto-detected',
                                success: true
                            }
                        });
                    } catch (error) {
                        vscode.postMessage({
                            type: 'error',
                            id,
                            error: error.message || String(error)
                        });
                    }
                }
                
                async function handleValidate(id, code) {
                    try {
                        // Try to parse the diagram
                        await mermaid.parse(code);
                        
                        vscode.postMessage({
                            type: 'result',
                            id,
                            result: {
                                isValid: true,
                                diagramType: 'valid'
                            }
                        });
                    } catch (error) {
                        vscode.postMessage({
                            type: 'result',
                            id,
                            result: {
                                isValid: false,
                                error: error.message || String(error)
                            }
                        });
                    }
                }
                
                async function handleDetectType(id, code) {
                    try {
                        // Use mermaid's getDiagramFromText function for proper type detection
                        const diagramType = mermaid.detectType ? mermaid.detectType(code) : 'unknown';
                        
                        vscode.postMessage({
                            type: 'result',
                            id,
                            result: { diagramType }
                        });
                    } catch (error) {
                        vscode.postMessage({
                            type: 'error',
                            id,
                            error: error.message || String(error)
                        });
                    }
                }
            } catch (e) {
                vscode.postMessage({ type: 'error', id: 'initialization-error', error: e.message });
            }
        }
        
        // Start the initialization process
        waitForMermaid();
    </script>
</body>
</html>`;
  }

  private handleWebviewMessage(message: any, panelId: string): void {
    const { type, id, result, error } = message;

    // Handle log messages from webview
    if (type === 'log') {
      return;
    }

    // Use a composite key to handle multiple panels if ever needed, though we dispose immediately.
    const operationKey = `${panelId}-${id}`;
    const initKey = `ready-${panelId}`;

    // Handle initialization-specific messages
    if (type === 'ready' || type === 'error' && id === 'initialization-error') {
        const initPromise = this.pendingOperations.get(initKey);
        if (initPromise) {
            clearTimeout(initPromise.timeout);
            if (type === 'ready') {
                initPromise.resolve(undefined);
            } else {
                logCommands.error(`🧜‍♀️ Webview initialization failed: ${error}`);
                initPromise.reject(new Error(`Webview initialization failed: ${error}`));
            }
            this.pendingOperations.delete(initKey);
        }
        if (type === 'ready') return;
    }

    const operation = this.pendingOperations.get(operationKey);
    if (!operation) {
      return; // Operation timed out or doesn't exist
    }

    clearTimeout(operation.timeout);
    this.pendingOperations.delete(operationKey);

    if (error) {
     // logCommands.error(`🧜‍♀️ Operation error: ${error}`);
      operation.reject(new Error(error));
    } else {
      //logCommands.info(`🧜‍♀️ Operation completed successfully`);
      operation.resolve(result);
    }
  }

  private waitForReady(panel: vscode.WebviewPanel): Promise<void> {
    const panelId = Date.now().toString(); // Simple unique ID for this panel's lifetime
    const readyKey = `ready-${panelId}`;

    // Attach a temporary message listener
    const listener = panel.webview.onDidReceiveMessage((message) => {
        //logCommands.info(`🧜‍♀️ Received message from webview: ${JSON.stringify(message)}`);
        
        // Handle log messages
        if (message.type === 'log') {
            this.handleWebviewMessage(message, panelId);
            return;
        }
        
        // We only care about the ready/error signal for this specific panel
        if (message.type === 'ready' && this.pendingOperations.has(readyKey)) {
            this.handleWebviewMessage({ ...message, id: 'ready' }, panelId);
            listener.dispose(); // Clean up listener
        } else if (message.type === 'error' && message.id === 'initialization-error' && this.pendingOperations.has(readyKey)) {
            this.handleWebviewMessage(message, panelId);
            listener.dispose(); // Clean up listener
        }
    });

    // The promise is now for this specific panel
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOperations.delete(readyKey);
        listener.dispose();
        reject(new Error('Webview initialization timed out after 10 seconds.'));
      }, 10000);

      this.pendingOperations.set(readyKey, { 
          resolve: () => {
              clearTimeout(timeout);
              resolve();
          }, 
          reject: (err) => {
              clearTimeout(timeout);
              reject(err);
          }, 
          timeout 
      });
    });
  }

  private async executeOperation<T>(
    type: string,
    data: any,
    timeoutMs: number = 30000
  ): Promise<T> {
    let panel: vscode.WebviewPanel | undefined;
    try {
        panel = await this.createOneTimeWebview();
        const panelId = Date.now().toString(); // Simple unique ID
        const operationKey = `${panelId}-${panelId}`; // Use same ID for simplicity

        // Re-wire the message handler for this specific panel instance
        const listener = panel.webview.onDidReceiveMessage(message => {
            ////logCommands.info(`🧜‍♀️ Operation message: ${JSON.stringify(message)}`);
            
            // Handle log messages
            if (message.type === 'log') {
                this.handleWebviewMessage(message, panelId);
                return;
            }
            
            // Handle result and error messages
            if (message.type === 'result' || message.type === 'error') {
                this.handleWebviewMessage(message, panelId);
            }
        });

        const promise = new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingOperations.delete(operationKey);
                reject(new Error(`Operation ${type} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingOperations.set(operationKey, { resolve: resolve as (value: any) => void, reject, timeout });

            panel!.webview.postMessage({ type, id: panelId, data });
        });

        // Cleanup listener on dispose
        panel.onDidDispose(() => {
            listener.dispose();
        });

        return await promise;
    } finally {
        // CRITICAL: Always dispose of the panel after the operation.
        if (panel) {
            panel.dispose();
        }
    }
  }

  public async renderDiagram(
    code: string,
    theme: string = 'dark'
  ): Promise<MermaidRenderResult> {
    const result = await this.executeOperation<MermaidRenderResult>('render', { code, theme });
    
    // If successful, display in diagram viewer instead of saving immediately
    if (result.success && result.svg) {
      try {
        const diagramManager = DiagramWebviewManager.getInstance();
        await diagramManager.displayDiagram(
          result.svg,
          result.diagramType,
          `Mermaid Diagram - ${result.diagramType}`
        );
       // logCommands.info('✅ Diagram displayed in webview successfully');
      } catch (error) {
        logCommands.error('Failed to display diagram in webview:', error);
        // Continue with the original result even if webview display fails
      }
    }
    
    return result;
  }

  public async validateSyntax(code: string): Promise<MermaidValidationResult> {
    return this.executeOperation<MermaidValidationResult>('validate', { code });
  }

  public async detectDiagramType(code: string): Promise<{ diagramType: string }> {
    return this.executeOperation<{ diagramType: string }>('detectType', { code });
  }

  public dispose(): void {
    // No-op, as panels are now disposed immediately after use.
  }
}

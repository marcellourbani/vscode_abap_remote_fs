import * as vscode from 'vscode'
import { funWindow as window } from '../../services/funMessenger'
import { ADTClient } from "abap-adt-api"
import { log } from "../../lib"
import { RemoteManager } from "../../config"

/**
 * Manages embedded SAP GUI webview panels for ABAP execution
 * This provides Eclipse ADT-like functionality where you can run reports
 * and see the output directly in VS Code without external GUI windows
 */
export class SapGuiPanel {
    /**
     * Track the currently panel. Allow multiple panels for different reports
     */
    private static currentPanels: Map<string, SapGuiPanel> = new Map()

    public static readonly viewType = 'ABAPSapGui'

    private readonly _panel: vscode.WebviewPanel
    private readonly _extensionUri: vscode.Uri
    private _disposables: vscode.Disposable[] = []

    private _client: ADTClient
    private _connectionId: string
    private _objectName: string
    private _objectType: string
    
    // Flag to prevent duplicate execution when authenticated URL is already loaded
    private _authenticatedUrlLoaded: boolean = false

    /**
     * Creates or shows an embedded SAP GUI panel for executing ABAP objects
     */
    public static createOrShow(
        extensionUri: vscode.Uri, 
        client: ADTClient, 
        connectionId: string,
        objectName: string,
        objectType: string = 'PROG/P'
    ) {

        const column = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : undefined

        const panelKey = `${connectionId}-${objectName}`

        // If we already have a panel for this object, show it
        if (SapGuiPanel.currentPanels.has(panelKey)) {
            const panel = SapGuiPanel.currentPanels.get(panelKey)!
            panel._panel.reveal(column)
            return panel
        }

        // Otherwise, create a new panel
        const panel = window.createWebviewPanel(
            SapGuiPanel.viewType,
            `SAP GUI - ${objectName}`,
            column || vscode.ViewColumn.Beside, // Open beside current editor
            {
                enableScripts: true,
                enableForms: true,
                enableCommandUris: true,
                retainContextWhenHidden: true, // Keep state when hidden
                localResourceRoots: [extensionUri]
            }
        )

        const sapGuiPanel = new SapGuiPanel(panel, extensionUri, client, connectionId, objectName, objectType)
        SapGuiPanel.currentPanels.set(panelKey, sapGuiPanel)
        return sapGuiPanel
    }

    private constructor(
        panel: vscode.WebviewPanel, 
        extensionUri: vscode.Uri, 
        client: ADTClient, 
        connectionId: string,
        objectName: string,
        objectType: string
    ) {
        this._panel = panel
        this._client = client
        this._extensionUri = extensionUri
        this._connectionId = connectionId
        this._objectName = objectName
        this._objectType = objectType


        // Set the webview's initial html content
        this._update()

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'execute':
                        // If we already have an authenticated URL loaded, don't re-execute
                        if (this._authenticatedUrlLoaded) {
                            return
                        }
                        this.executeObject(message.parameters)
                        return
                    case 'refresh':
                        this.refreshExecution()
                        return
                    case 'refreshAuth':
                        this.refreshAuthentication()
                        return
                    case 'refreshTransaction':
                        this.refreshTransaction()
                        return
                    case 'webviewLog':
                        return
                    case 'webGuiLoaded':
                        return
                    case 'webGuiError':
                        log('❌ WEBVIEW: SAP GUI iframe failed to load')
                        window.showErrorMessage('Failed to load SAP GUI in WebView. Try refreshing or using external GUI.')
                        return
                    case 'webGuiLoaded':
                        return
                    case 'webGuiError':
                        window.showErrorMessage('Failed to load Direct WebGUI in WebView. Try refreshing or using external GUI.')
                        return

                    case 'webviewLog':
                        return
                }
            },
            null,
            this._disposables
        )
    }

    /**
     * � Build WebGUI URL using existing infrastructure
     * Made public for the new get_abap_object_url language tool
     */
    public async buildWebGuiUrl(): Promise<string> {
        const transactionInfo = SapGuiPanel.getTransactionInfo(this._objectType, this._objectName)
        const config = RemoteManager.get().byId(this._connectionId)
        
        if (!config) {
            throw new Error('Connection configuration not found')
        }
        
        // Build base URL
        let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, '')
        if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
            baseUrl = 'https://' + baseUrl
        } else if (baseUrl.startsWith('http://')) {
            baseUrl = baseUrl.replace('http://', 'https://')
        }
        
        // Generate WebGUI URL
        const cleanedObjectName = transactionInfo.sapGuiCommand.parameters[0].value
        const webguiUrl = `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
            `%7etransaction=%2a${transactionInfo.transaction}%20${transactionInfo.dynprofield}%3d${cleanedObjectName}%3bDYNP_OKCODE%3d${transactionInfo.okcode}` +
            `&sap-client=${config.client}` +
            `&sap-language=${config.language || 'EN'}` +
            `&saml2=disabled`
        
        return webguiUrl
    }

    /**
     * Execute ABAP object in embedded GUI (regular mode - no automation)
     * This is called when users manually trigger the embedded GUI
     */
    private async executeObject(parameters: any = {}) {
        try {
            this.showProgress('Loading SAP GUI for HTML...')
            
            // Reuse existing SAP GUI infrastructure
            const { runInSapGui } = await import('../../adt/sapgui/sapgui')
            const { RemoteManager } = await import('../../config')
            
            const originalConfig = RemoteManager.get().byId(this._connectionId)
            if (!originalConfig) {
                this.showError('Connection configuration not found')
                return
            }

            // Create a mutable copy of the configuration to avoid read-only property errors
            const config = JSON.parse(JSON.stringify(originalConfig))
            
            // Force embedded mode for our panel
            const originalGuiType = config.sapGui?.guiType
            
            // Ensure sapGui config exists with required properties for embedded mode
            if (!config.sapGui) {
                config.sapGui = {
                    disabled: false,
                    routerString: '',
                    messageServer: '',
                    messageServerPort: '',
                    group: '',
                    server: '',
                    systemNumber: '',
                    guiType: 'WEBGUI_UNSAFE_EMBEDDED'
                }
            } else {
                // Now we can safely modify the copy
                config.sapGui.guiType = 'WEBGUI_UNSAFE_EMBEDDED'
            }

            // Use existing runInSapGui logic but capture the URL instead of opening external browser
            const url = await this.generateSapGuiUrl(config)
            if (url) {
                this.showEmbeddedSapGui(url)
            } else {
                this.showError('Could not generate SAP GUI URL. Please check your connection settings.')
            }

        } catch (error) {
            //log('Failed to load SAP GUI: ' + (error instanceof Error ? error.message : String(error)))
            this.showError(`Failed to load SAP GUI: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * Load direct WebGUI URL (simple approach - no SSO ticket)
     * Uses the same authentication cookies that ADT client already has
     */
    public loadDirectWebGuiUrl(webguiUrl: string) {
        
        // Set flag to prevent duplicate executions
        this._authenticatedUrlLoaded = true
        
        this.showDirectWebGui(webguiUrl)
    }

    /**
     * Sanitize URL to prevent injection attacks
     */
    private sanitizeUrl(url: string): string {
        try {
            // Parse URL to validate structure and prevent injection
            const parsedUrl = new URL(url);
            // Only allow https and http protocols
            if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
                throw new Error('Invalid protocol');
            }
            return parsedUrl.toString();
        } catch (error) {
            throw new Error(`Invalid URL: ${error}`);
        }
    }

    /**
     * Show direct WebGUI using simple URL (no SSO ticket complexity)
     */
    private showDirectWebGui(webguiUrl: string) {
        
        // Sanitize URL to prevent injection
        const sanitizedUrl = this.sanitizeUrl(webguiUrl);
        
        const html = `
            <div class="execution-container">
                <div class="toolbar">
                    <button onclick="refreshWebGui()" title="🔄 Refresh this WebView">🔄 Refresh</button>
                </div>
                <iframe 
                    id="webguiFrame"
                    src="${sanitizedUrl}" 
                    width="100%" 
                    height="calc(100vh - 60px)"
                    frameborder="0"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation allow-downloads allow-modals"
                    title="SAP WebGUI - ${this._objectName}"
                    onload="handleWebGuiLoad()"
                    onerror="handleWebGuiError()"
                    style="border: 1px solid var(--vscode-panel-border); background: white;"
                    allowfullscreen
                    allow="credentials"
                ></iframe>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                function handleWebGuiLoad() {
                    vscode.postMessage({ command: 'webviewLog', message: '✅ Direct WebGUI iframe onload event fired' });
                    
                    // Debug iframe content after a delay
                    setTimeout(() => {
                        const iframe = document.getElementById('webguiFrame');
                        if (iframe) {
                            try {
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: WebGUI iframe dimensions: ' + iframe.offsetWidth + 'x' + iframe.offsetHeight });
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: WebGUI iframe src: ' + iframe.src });
                                
                                // Try to check if content loaded
                                try {
                                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                                    if (doc) {
                                        vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe document title: ' + doc.title });
                                        vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe document readyState: ' + doc.readyState });
                                    } else {
                                        vscode.postMessage({ command: 'webviewLog', message: '⚠️ DEBUG: Cannot access iframe content (likely CORS)' });
                                    }
                                } catch (e) {
                                    vscode.postMessage({ command: 'webviewLog', message: '⚠️ DEBUG: Error accessing iframe content: ' + e.message });
                                }
                            } catch (e) {
                                vscode.postMessage({ command: 'webviewLog', message: '❌ DEBUG: Error in iframe inspection: ' + e.message });
                            }
                        }
                    }, 3000);
                    
                    vscode.postMessage({ command: 'webGuiLoaded', url: '${sanitizedUrl}' });
                }
                
                function handleWebGuiError() {
                    vscode.postMessage({ command: 'webviewLog', message: '❌ Direct WebGUI iframe onerror event fired' });
                    vscode.postMessage({ command: 'webGuiError', url: '${sanitizedUrl}' });
                }
                
                function refreshWebGui() {
                    vscode.postMessage({ command: 'webviewLog', message: '🔄 Requesting transaction reload' });
                    vscode.postMessage({ command: 'refreshTransaction' });
                }
                
                // Function to reload iframe with new URL (called from refresh)
                function reloadIframe(newUrl) {
                    const iframe = document.getElementById('webguiFrame');
                    if (iframe) {
                        vscode.postMessage({ command: 'webviewLog', message: '🔄 Reloading iframe with URL: ' + newUrl });
                        iframe.src = newUrl + '&_refresh=' + Date.now(); // Add timestamp to force reload
                    }
                }
                
                // Listen for messages from VS Code
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'reloadIframe') {
                        reloadIframe(message.url);
                    }
                });
                
                // Log when iframe starts loading
                vscode.postMessage({ command: 'webviewLog', message: '🚀 Starting to load Direct WebGUI iframe: ' + '${sanitizedUrl}' });
            </script>
        `
        
        this.showResult(html)
       // log('✅ WEBVIEW: Direct WebGUI HTML rendered, waiting for iframe to load...')
    }

    /**
     * Show authenticated SAP GUI using WebView with proper cookie handling
     */
    private showAuthenticatedSapGui(authenticatedUrl: string) {
        
        const html = `
            <div class="execution-container">
                <div class="info-banner" style="background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 8px; margin: 4px 0; border-radius: 3px;">
                    <span style="font-weight: bold;">🔐 WebView SAP GUI</span> - 
                    <span>Authenticated session active</span>
                </div>
                <div class="toolbar">
                    <button onclick="refreshAuthentication()" title="🔄 Refresh authentication ticket">🔄 Refresh Auth</button>
                    <button onclick="refreshExecution()" title="🔄 Refresh this WebView">🔄 Refresh</button>
                    <button onclick="openInExternalGui()" title="🖥️ Open in native SAP GUI desktop application">�️ Native GUI</button>
                    <button onclick="openInBrowser()" title="🌐 Open in external web browser">🌐 Browser</button>
                </div>
                <iframe 
                    id="sapGuiFrame"
                    src="${authenticatedUrl}" 
                    width="100%" 
                    height="calc(100vh - 80px)"
                    frameborder="0"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation allow-downloads"
                    title="SAP GUI for HTML - ${this._objectName}"
                    onload="handleSapGuiLoad()"
                    onerror="handleSapGuiError()"
                    style="border: 1px solid var(--vscode-panel-border); background: white;"
                ></iframe>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                function handleSapGuiLoad() {
                    vscode.postMessage({ command: 'webviewLog', message: '✅ WebView SAP GUI iframe loaded successfully' });
                    
                    // Debug: Check if iframe has actual content
                    setTimeout(() => {
                        const iframe = document.getElementById('sapGuiFrame');
                        if (iframe) {
                            vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe dimensions: ' + iframe.offsetWidth + 'x' + iframe.offsetHeight });
                            try {
                                // Try to access iframe content (will fail for cross-origin)
                                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe document title: ' + iframeDoc.title });
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe document body length: ' + (iframeDoc.body ? iframeDoc.body.innerHTML.length : 'no body') });
                            } catch (e) {
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: Cannot access iframe content (cross-origin): ' + e.message });
                            }
                        }
                    }, 2000);
                    
                    vscode.postMessage({ command: 'sapGuiLoaded', url: '${authenticatedUrl}' });
                }
                
                function handleSapGuiError() {
                    console.error('❌ WebView SAP GUI iframe failed to load');
                    vscode.postMessage({ command: 'sapGuiError', url: '${authenticatedUrl}' });
                }
                
                function refreshAuthentication() {
                    console.//log('🔄 Requesting authentication refresh');
                    vscode.postMessage({ command: 'refreshAuth' });
                }
                
                function refreshExecution() {
                    console.//log('🔄 Requesting execution refresh');
                    vscode.postMessage({ command: 'refresh' });
                }
                
                function openInExternalGui() {
                    vscode.postMessage({ command: 'openInExternalGui' });
                }
                
                function openInBrowser() {
                    vscode.postMessage({ command: 'openInBrowser' });
                }
                
                // Log when iframe starts loading
                console.//log('🚀 Starting to load SAP GUI in WebView iframe:', '${authenticatedUrl}');
            </script>
        `
        
        this.showResult(html)
        //log('✅ WebView HTML rendered, waiting for iframe to load...')
    }

    /**
     * Refresh authentication by regenerating SSO ticket and reloading
     */
    /**
     * Refresh the transaction - regenerate the same WebGUI URL and reload it
     */
    private async refreshTransaction() {
        try {
            //log('🔄 Refreshing transaction for object: ' + this._objectName + ' (type: ' + this._objectType + ')')
            
            // Get config for URL building
            const config = RemoteManager.get().byId(this._connectionId)
            if (!config) {
                //log('❌ No config found for connection: ' + this._connectionId)
                return
            }
            
            // Build base URL
            let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, '')
            if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
                baseUrl = 'https://' + baseUrl
            } else if (baseUrl.startsWith('http://')) {
                baseUrl = baseUrl.replace('http://', 'https://')
            }
            
            // 🎯 USE CENTRALIZED transaction mapping
            const transactionInfo = SapGuiPanel.getTransactionInfo(this._objectType, this._objectName)
            
            // Rebuild the WebGUI URL using the cleaned object name from the transaction info
            const cleanedObjectName = transactionInfo.sapGuiCommand.parameters[0].value
            const webguiUrl = `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
                `%7etransaction=%2a${transactionInfo.transaction}%20${transactionInfo.dynprofield}%3d${cleanedObjectName}%3bDYNP_OKCODE%3d${transactionInfo.okcode}` +
                `&sap-client=${config.client}` +
                `&sap-language=${config.language || 'EN'}` +
                `&saml2=disabled`
            
            //log('🔄 Refreshing with URL: ' + webguiUrl)
            
            // Send message to WebView to reload iframe instead of recreating HTML
            this._panel.webview.postMessage({
                command: 'reloadIframe',
                url: webguiUrl
            })
            
        } catch (error) {
            //log('❌ Error refreshing transaction: ' + error)
            window.showErrorMessage('Failed to refresh transaction: ' + error)
        }
    }

    private async refreshAuthentication() {
        try {
            //log('🔄 Refreshing SAP GUI authentication...')
            this.showProgress('Refreshing authentication...')
            
            // Get fresh configuration and regenerate authenticated URL
            const { RemoteManager } = await import('../../config')
            const config = RemoteManager.get().byId(this._connectionId)
            if (!config) {
                throw new Error('Connection configuration not found')
            }

            // Generate new authenticated URL
            const url = await this.generateSapGuiUrl(config)
            if (url) {
                this.showAuthenticatedSapGui(url)
            } else {
                this.showError('Could not regenerate SAP GUI URL. Please check your connection.')
            }
            
        } catch (error) {
            this.showError(`Failed to refresh authentication: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * Generate SAP GUI URL using centralized transaction logic (no more duplication!)
     */
    private async generateSapGuiUrl(config: any): Promise<string | null> {
        try {
            // 🎯 USE CENTRALIZED transaction mapping - NO MORE DUPLICATION! 
            const transactionInfo = SapGuiPanel.getTransactionInfo(this._objectType, this._objectName)
            
            // Build base URL (same as working WebView logic)
            let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, '')
            if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
                baseUrl = 'https://' + baseUrl
            } else if (baseUrl.startsWith('http://')) {
                baseUrl = baseUrl.replace('http://', 'https://')
            }
            
            // Use centralized transaction info (same as working WebView)
            const cleanedObjectName = transactionInfo.sapGuiCommand.parameters[0].value
            const webguiUrl = `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
                `%7etransaction=%2a${transactionInfo.transaction}%20${transactionInfo.dynprofield}%3d${cleanedObjectName}%3bDYNP_OKCODE%3d${transactionInfo.okcode}` +
                `&sap-client=${config.client}` +
                `&sap-language=${config.language || 'EN'}` +
                `&saml2=disabled`
            
            return webguiUrl
            
        } catch (error) {
            console.error('Error generating SAP GUI URL:', error)
            return null
        }
    }

    /**
     * 🎯 CENTRALIZED transaction mapping utility - used by ALL methods
     * This eliminates code duplication and ensures consistency
     * 
     * ✅ Made PUBLIC STATIC so it can be used from commands.ts
     */
    public static getTransactionInfo(objectType: string, objectName: string): {
        transaction: string,
        dynprofield: string,
        okcode: string,
        sapGuiCommand: any
    } {
        
        // Clean up object name for classes - remove .main/.inc/.etc suffixes
        let cleanObjectName = objectName
        if (objectType === 'CLAS/OC' || objectType === 'CLAS/I') {
            cleanObjectName = objectName.split('.')[0] // ZCL_DEMO_ABAP.main → ZCL_DEMO_ABAP
        }
        
        let transaction: string
        let dynprofield: string
        let okcode: string

        switch (objectType) {
            case 'PROG/P':
                transaction = 'SE38'
                dynprofield = 'RS38M-PROGRAMM'
                okcode = 'STRT'
                break
            case 'FUGR/FF':
                transaction = 'SE37'
                dynprofield = 'RS38L-NAME'
                okcode = 'WB_EXEC'
                break
            case 'FUNC/FM':
                // Individual function module - use SE37 with function module name
                transaction = 'SE37'
                dynprofield = 'RS38L-NAME'
                okcode = 'WB_EXEC'
                break
            case 'CLAS/OC':
            case 'CLAS/I':  // Class include - treat same as class
                transaction = 'SE24'
                dynprofield = 'SEOCLASS-CLSNAME'
                okcode = 'WB_EXEC'
                break
            default:
                transaction = 'SE38'
                dynprofield = 'RS38M-PROGRAMM'
                okcode = 'STRT'
                break
        }

        const sapGuiCommand = {
            type: "Transaction" as const,
            command: `*${transaction}`,
            parameters: [
                { name: dynprofield, value: cleanObjectName },
                { name: "DYNP_OKCODE", value: okcode }
            ]
        }
        
        
        return { transaction, dynprofield, okcode, sapGuiCommand }
    }

    /**
     * Show embedded SAP GUI using iframe
     */
    private showEmbeddedSapGui(url: string) {
        const html = `
            <div class="execution-container">
                <div class="toolbar">
                    <button onclick="refreshExecution()" title="🔄 Refresh this WebView">🔄 Refresh</button>
                    <button onclick="openInExternalGui()" title="🖥️ Open in native SAP GUI desktop application">�️ Native GUI</button>
                    <button onclick="openInBrowser()" title="🌐 Open in external web browser">🌐 Browser</button>
                </div>
                <iframe 
                    src="${url}" 
                    width="100%" 
                    height="calc(100vh - 60px)"
                    frameborder="0"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
                    title="SAP GUI for HTML - ${this._objectName}"
                ></iframe>
            </div>
        `
        
        this.showResult(html)
    }

    /**
     * Show execution progress
     */
    private showProgress(message: string) {
        const html = `
            <div class="execution-container">
                <div class="progress">
                    <div class="spinner"></div>
                    <span>${message}</span>
                </div>
            </div>
        `
        this._panel.webview.html = this.getFullHtml(html)
    }

    /**
     * Show execution result
     */
    private showResult(resultHtml: string) {
        this._panel.webview.html = this.getFullHtml(resultHtml)
    }

    /**
     * Show error message
     */
    private showError(errorMessage: string) {
        const html = `
            <div class="execution-container">
                <div class="error">
                    <h3>Execution Error</h3>
                    <p>${errorMessage}</p>
                    <button onclick="refreshExecution()">🔄 Try Again</button>
                </div>
            </div>
        `
        this._panel.webview.html = this.getFullHtml(html)
    }

    /**
     * Refresh the current execution
     */
    private refreshExecution() {
        this.executeObject()
    }

    /**
     * Get simple HTML for WebView - no DOM manipulation
     */
    private getFullHtml(content: string): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>SAP GUI - ${this._objectName}</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        margin: 0;
                        padding: 10px;
                    }
                    .execution-container {
                        width: 100%;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }
                    .toolbar {
                        background-color: var(--vscode-panel-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding: 8px;
                        display: flex;
                        gap: 8px;
                    }
                    .toolbar button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 6px 12px;
                        border-radius: 3px;
                        cursor: pointer;
                    }
                    iframe {
                        border: none;
                        flex: 1;
                        width: 100%;
                        background-color: white;
                        min-height: 500px;
                    }
                </style>
            </head>
            <body>
                ${content}
                <script>
                    const vscode = acquireVsCodeApi();
                    function refreshExecution() {
                        vscode.postMessage({ command: 'refresh' });
                    }
                </script>
            </body>
            </html>
        `
    }

    private _update() {
        this.showProgress('Initializing SAP GUI for HTML...')
    }

    public dispose() {
        const panelKey = `${this._connectionId}-${this._objectName}`
        SapGuiPanel.currentPanels.delete(panelKey)

        // Clean up panel resources
        this._panel.dispose()

        // Clean up other disposables
        while (this._disposables.length) {
            const x = this._disposables.pop()
            if (x) {
                x.dispose()
            }
        }
        
    }
}

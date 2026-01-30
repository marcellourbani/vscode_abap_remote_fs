import * as vscode from 'vscode'
import { funWindow as window } from './funMessenger'
import { ADTClient } from "abap-adt-api"
import { log } from "../lib"

/**
 * Webview metadata stored in globalState
 */
interface WebviewMetadata {
    id: string;
    title: string;
    lastQuery: string;
    connectionId: string;
    created: number;
    lastAccessed: number;
}

/**
 * Row range specification for data queries
 */
export interface RowRange {
    start: number;
    end: number;
}

/**
 * Column sorting specification
 */
export interface SortColumn {
    column: string;
    direction: 'asc' | 'desc';
}

/**
 * Column filter specification
 */
export interface ColumnFilter {
    column: string;
    value: string;
}

/**
 * Manages dynamic data query webviews with persistence
 * Handles webview lifecycle, remote control, and state persistence
 */
export class WebviewManager {
    private static instance: WebviewManager;
    private readonly _context: vscode.ExtensionContext;
    private readonly _activeWebviews = new Map<string, vscode.WebviewPanel>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _graphNodeReferences = new Map<string, Map<string, any>>(); // webviewId -> nodeId -> UsageReference

    private constructor(context: vscode.ExtensionContext) {
        this._context = context;
        
        // Clean up orphaned metadata on startup
        this.cleanupOrphanedMetadata();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(context?: vscode.ExtensionContext): WebviewManager {
        if (!WebviewManager.instance) {
            if (!context) {
                throw new Error('WebviewManager requires context for initialization');
            }
            WebviewManager.instance = new WebviewManager(context);
        }
        return WebviewManager.instance;
    }

    /**
     * Generate unique webview ID
     */
    private generateWebviewId(): string {
        return `data-query-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Get all webview metadata from globalState
     */
    private getWebviewMetadata(): Record<string, WebviewMetadata> {
        return this._context.globalState.get('abap.dataQuery.webviews', {});
    }

    /**
     * Save webview metadata to globalState
     */
    private async saveWebviewMetadata(metadata: Record<string, WebviewMetadata>): Promise<void> {
        await this._context.globalState.update('abap.dataQuery.webviews', metadata);
    }

    /**
     * Clean up metadata for webviews that no longer exist
     * Also implements periodic cleanup to prevent memory bloat
     */
    private async cleanupOrphanedMetadata(): Promise<void> {
        const metadata = this.getWebviewMetadata();
        const activeIds = Array.from(this._activeWebviews.keys());
        let hasChanges = false;

        // Remove metadata for inactive webviews
        for (const id of Object.keys(metadata)) {
            if (!activeIds.includes(id)) {
                delete metadata[id];
                hasChanges = true;
            }
        }

        // Performance: Remove old metadata (older than 24 hours)
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        for (const [id, meta] of Object.entries(metadata)) {
            if (meta.lastAccessed < oneDayAgo) {
                delete metadata[id];
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await this.saveWebviewMetadata(metadata);
        }
        
        // Limit total active webviews to prevent memory issues
        if (this._activeWebviews.size > 20) {
            const sortedWebviews = Array.from(this._activeWebviews.entries())
                .map(([id, panel]) => ({ id, panel, lastAccessed: metadata[id]?.lastAccessed || 0 }))
                .sort((a, b) => a.lastAccessed - b.lastAccessed);
            
            // Close oldest webviews beyond limit
            const toClose = sortedWebviews.slice(0, this._activeWebviews.size - 10);
            for (const { panel } of toClose) {
                panel.dispose();
            }
        }
    }

    /**
     * Create or update a data query webview
     */
    public async createOrUpdateWebview(
        client: ADTClient | { columns: any[]; values: any[] },
        sql: string,
        connectionId: string,
        webviewId?: string,
        title?: string,
        maxRows?: number,
        rowRange?: RowRange,
        sortColumns?: SortColumn[],
        filters?: ColumnFilter[],
        resetSorting?: boolean,
        resetFilters?: boolean
    ): Promise<{ webviewId: string; data?: any; state?: any }> {
        
        // Detect if we're dealing with direct data input
        const isDirectData = !('runQuery' in client);
        const directData = isDirectData ? client as { columns: any[]; values: any[] } : null;
        const actualClient = isDirectData ? null : client as ADTClient;
        
        // Only require connectionId for SQL queries, not direct data
        if (!isDirectData) {
            connectionId = connectionId.toLowerCase();
        }
                
        let targetId = webviewId;
        let panel: vscode.WebviewPanel;

        if (targetId && this._activeWebviews.has(targetId)) {
            // Update existing webview
            panel = this._activeWebviews.get(targetId)!;
            
            // Update title if provided
            if (title) {
                panel.title = title;
            }
            
        } else {
            // Create new webview
            targetId = this.generateWebviewId();
            
            const column = window.activeTextEditor
                ? window.activeTextEditor.viewColumn
                : undefined;

            panel = window.createWebviewPanel(
                'ABAPDataQuery',
                title || `Data Query ${targetId.split('-')[2]}`,
                column || vscode.ViewColumn.One,
                this.getWebviewOptions()
            );

            this._activeWebviews.set(targetId, panel);
            
            // Set up disposal handler
            panel.onDidDispose(() => {
                this._activeWebviews.delete(targetId!);
                this.removeWebviewMetadata(targetId!);
            }, null, this._disposables);

            // Set up message handler
            panel.webview.onDidReceiveMessage(
                async (message) => this.handleWebviewMessage(message, targetId!),
                null,
                this._disposables
            );

        }

        // Update metadata
        await this.updateWebviewMetadata(targetId, title || panel.title, sql, connectionId || 'direct');

        // Set webview content
        panel.webview.html = this.generateWebviewHTML(panel.webview, targetId, title);

        // Get data: either execute SQL query or use provided data
        try {
            let result;
            
            if (isDirectData) {
                // Use provided data directly - no query execution needed
                result = directData!;
            } else {
                // Execute SQL query
                try {
                    result = await this.executeQuery(actualClient!, sql, maxRows);
                } catch (queryError) {
                    // Clean up webview if query fails (webview was already created)
                    this.closeWebview(targetId);
                    throw queryError;
                }
            }
            
            // Send original data to webview (no manual filtering/sorting)
            panel.webview.postMessage({
                command: 'queryResult',
                data: {
                    result: result,
                    hasMore: false,
                    top: maxRows || 1000,
                    mode: isDirectData ? 'data' : 'sql',
                    sql: isDirectData ? 'DATA_INPUT' : sql,
                    webviewId: targetId
                }
            });

            // Then apply Tabulator operations if specified
            if (resetSorting || resetFilters) {
                // Send reset commands to Tabulator
                if (resetSorting) {
                    panel.webview.postMessage({
                        command: 'clearSorting',
                        data: {}
                    });
                }
                if (resetFilters) {
                    panel.webview.postMessage({
                        command: 'clearFilters', 
                        data: {}
                    });
                }
            }

            if (sortColumns && sortColumns.length > 0) {
                panel.webview.postMessage({
                    command: 'applySorting',
                    data: { sortColumns }
                });
            }

            if (filters && filters.length > 0) {
                panel.webview.postMessage({
                    command: 'applyFilters',
                    data: { filters }
                });
            }

           // log(`[WEBVIEW_MANAGER] Query executed successfully for webview: ${targetId}`);
            
            const state = {
                totalRows: result.values?.length || 0,
                returnedRows: result.values?.length || 0, // Tabulator handles filtering, so we return total
                appliedSorting: sortColumns || [],
                appliedFilters: filters || []
            };
            
            return { 
                webviewId: targetId, 
                data: rowRange ? this.extractRowRange(result, rowRange) : result,
                state
            };

        } catch (error: any) {
            const errorMsg = error?.localizedMessage || error?.message || String(error);
            // Don't try to send error to webview - it may be disposed already
          //  log(`[WEBVIEW_MANAGER] Query failed for webview ${targetId}: ${errorMsg}`);
            throw new Error(errorMsg);
        }
    }

    /**
     * Manipulate existing webview using Tabulator's built-in filtering/sorting
     */
    public async manipulateWebview(
        webviewId: string,
        rowRange?: RowRange,
        sortColumns?: SortColumn[],
        filters?: ColumnFilter[],
        resetSorting?: boolean,
        resetFilters?: boolean
    ): Promise<{ webviewId: string; data?: any; state?: any }> {
        const panel = this._activeWebviews.get(webviewId);
        if (!panel) {
            throw new Error(`Webview ${webviewId} not found`);
        }

        try {
            // Send reset commands to Tabulator if requested
            if (resetSorting) {
                panel.webview.postMessage({
                    command: 'clearSorting',
                    data: {}
                });
            }
            
            if (resetFilters) {
                panel.webview.postMessage({
                    command: 'clearFilters',
                    data: {}
                });
            }

            // Apply new sorting via Tabulator
            if (sortColumns && sortColumns.length > 0) {
                panel.webview.postMessage({
                    command: 'applySorting',
                    data: { sortColumns }
                });
            }

            // Apply new filters via Tabulator
            if (filters && filters.length > 0) {
                panel.webview.postMessage({
                    command: 'applyFilters',
                    data: { filters }
                });
            }

           // log(`[WEBVIEW_MANAGER] Webview ${webviewId} manipulated via Tabulator successfully`);
            
            // Get current state from Tabulator to report accurate state
            const currentData = await this.getWebviewData(webviewId);
            
            // For row range requests, get specific range
            let data: any = null;
            if (rowRange) {
                data = await this.getWebviewData(webviewId, rowRange);
            }
            
            const state = {
                totalRows: currentData?.totalRows || 0,
                returnedRows: data?.values?.length || currentData?.values?.length || 0,
                appliedSorting: currentData?.currentSorts || [],
                appliedFilters: currentData?.currentFilters || []
            };
            
            return { 
                webviewId, 
                data,
                state
            };

        } catch (error: any) {
            const errorMsg = error?.localizedMessage || error?.message || String(error);
            panel.webview.postMessage({ command: 'error', data: errorMsg });
           // log(`[WEBVIEW_MANAGER] Manipulation failed for webview ${webviewId}: ${errorMsg}`);
            throw error;
        }
    }

    /**
     * Get data from existing webview (for row ranges)
     */
    public async getWebviewData(
        webviewId: string,
        rowRange?: RowRange
    ): Promise<any> {
        const panel = this._activeWebviews.get(webviewId);
        if (!panel) {
            throw new Error(`Webview ${webviewId} not found`);
        }

        // Request data from webview
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for webview data'));
            }, 10000);

            const messageHandler = panel.webview.onDidReceiveMessage((message) => {
                if (message.command === 'webviewData') {
                    clearTimeout(timeout);
                    messageHandler.dispose();
                    
                    let data = message.data;
                    if (rowRange && data.values) {
                        const start = Math.max(0, rowRange.start);
                        const end = Math.min(data.values.length, rowRange.end);
                        data = {
                            ...data,
                            values: data.values.slice(start, end)
                        };
                    }
                    
                    resolve(data);
                }
            });

            // Request data
            panel.webview.postMessage({
                command: 'getWebviewData',
                data: { rowRange }
            });
        });
    }

    /**
     * List all active webviews
     */
    public listActiveWebviews(): { id: string; title: string; lastQuery: string }[] {
        const metadata = this.getWebviewMetadata();
        return Array.from(this._activeWebviews.keys()).map(id => ({
            id,
            title: metadata[id]?.title || 'Unknown',
            lastQuery: metadata[id]?.lastQuery || 'Unknown'
        }));
    }

    /**
     * Close specific webview
     */
    public closeWebview(webviewId: string): void {
        const panel = this._activeWebviews.get(webviewId);
        if (panel) {
            panel.dispose(); // This will trigger the disposal handler
        }
    }

    /**
     * Close all webviews
     */
    public closeAllWebviews(): void {
        for (const panel of this._activeWebviews.values()) {
            panel.dispose();
        }
    }

    /**
     * Validate SQL query for security (prevent dangerous operations)
     */
    private validateSQL(sql: string): void {
        if (!sql || typeof sql !== 'string') {
            throw new Error('SQL query must be a non-empty string');
        }

        // Convert to uppercase for checking
        const upperSQL = sql.toUpperCase().trim();
        
        // Block dangerous SQL operations (but allow SELECT, WITH)
        const dangerousPatterns = [
            /\bDROP\s+/i,
            /\bDELETE\s+(?!.*\bFROM\s+@)/i, // Allow DELETE in subqueries but not standalone
            /\bINSERT\s+/i,
            /\bUPDATE\s+/i,
            /\bALTER\s+/i,
            /\bCREATE\s+/i,
            /\bTRUNCATE\s+/i,
            /;\s*(?!$)/i, // Multiple statements (except trailing semicolon)
            /--/i, // SQL comments
            /\/\*/i, // Block comments
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(upperSQL)) {
                throw new Error(`SQL query contains dangerous operation: ${pattern.source}`);
            }
        }

        // Ensure it's a SELECT or WITH statement
        if (!upperSQL.startsWith('SELECT') && !upperSQL.startsWith('WITH')) {
            throw new Error('Only SELECT and WITH statements are allowed');
        }
    }

    /**
     * Execute SQL query using ADT client
     */
    private async executeQuery(client: ADTClient, sql: string, maxRows?: number): Promise<any> {
        // Validate SQL for security
        this.validateSQL(sql);
        
        const actualLimit = maxRows || 1000;
       // log(`[WEBVIEW_MANAGER] Executing validated SQL: ${sql} (limit: ${actualLimit})`);
        
        const result = await client.runQuery(sql, actualLimit + 1, true);
        const hasMore = (result.values?.length || 0) > actualLimit;
        if (hasMore) {
            result.values = result.values.slice(0, actualLimit);
        }
        
        return result;
    }

    /**
     * Extract row range from data (used for internal mode)
     */
    private extractRowRange(data: any, rowRange: RowRange): any {
        if (!rowRange || !data.values) {
            return data;
        }
        
        const start = Math.max(0, rowRange.start);
        const end = Math.min(data.values.length, rowRange.end);
        
        return {
            ...data,
            values: data.values.slice(start, end)
        };
    }

    /**
     * Update webview metadata
     */
    private async updateWebviewMetadata(
        id: string, 
        title: string, 
        query: string, 
        connectionId: string
    ): Promise<void> {
        const metadata = this.getWebviewMetadata();
        const now = Date.now();
        
        metadata[id] = {
            id,
            title,
            lastQuery: query,
            connectionId,
            created: metadata[id]?.created || now,
            lastAccessed: now
        };
        
        await this.saveWebviewMetadata(metadata);
    }

    /**
     * Remove webview metadata
     */
    private async removeWebviewMetadata(id: string): Promise<void> {
        const metadata = this.getWebviewMetadata();
        delete metadata[id];
        await this.saveWebviewMetadata(metadata);
        //log(`[WEBVIEW_MANAGER] Removed metadata for webview: ${id}`);
    }

    /**
     * Handle messages from webview
     */
    private async handleWebviewMessage(
        message: any, 
        webviewId: string
    ): Promise<void> {
        const panel = this._activeWebviews.get(webviewId);
        if (!panel) return;

        try {
            switch (message.command) {
                case 'exportCSV': {
                    const { columns, rows, defaultName } = message;
                    const headers: string[] = columns.map((c: any) => c.title || c.field || c.name);
                    const fields: string[] = columns.map((c: any) => c.field || c.name);
                    const csvEscape = (v: any) => {
                        const s = v == null ? '' : String(v);
                        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
                    };
                    const lines: string[] = [];
                    lines.push(headers.map(csvEscape).join(','));
                    for (const r of rows) lines.push(fields.map(f => csvEscape((r as any)[f])).join(','));
                    const data = Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8');
                    const uri = await window.showSaveDialog({
                        defaultUri: vscode.Uri.file(`${defaultName || 'data'}-${webviewId}.csv`),
                        filters: { 'CSV': ['csv'] }
                    });
                    if (!uri) return;
                    await vscode.workspace.fs.writeFile(uri, data);
                    break;
                }
                case 'getWebviewData': {
                    // This is handled by the promise in getWebviewData method
                    break;
                }
                default:
                  //  log(`[WEBVIEW_MANAGER] Unknown message command: ${message.command}`);
            }
        } catch (error: any) {
            const errorMsg = error?.localizedMessage || error?.message || String(error);
            panel.webview.postMessage({ command: 'error', data: errorMsg });
          //  log(`[WEBVIEW_MANAGER] Message handling error: ${errorMsg}`);
        }
    }

    /**
     * Get webview options
     */
    private getWebviewOptions(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
        return {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media'),
                vscode.Uri.joinPath(this._context.extensionUri, 'client', 'media')
            ]
        };
    }

    /**
     * Generate webview HTML content
     */
    private generateWebviewHTML(webview: vscode.Webview, webviewId: string, title?: string): string {
        // Local paths to resources
        const scriptPath = vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media', 'dataQuery.js');
        const cssPath = vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media', 'editor.css');
        const tabulatorCssPath = vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media', 'tabulator_bootstrap4.min.css');
        const tabulatorJsPath = vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media', 'tabulator.min.js');

        // Convert to webview URIs
        const scriptUri = webview.asWebviewUri(scriptPath);
        const cssUri = webview.asWebviewUri(cssPath);
        const tabulatorCssUri = webview.asWebviewUri(tabulatorCssPath);
        const tabulatorJsUri = webview.asWebviewUri(tabulatorJsPath);

        const cspSource = webview.cspSource;

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; script-src ${cspSource}; style-src ${cspSource}; font-src ${cspSource}; object-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${cssUri}" rel="stylesheet">
                <link href="${tabulatorCssUri}" rel="stylesheet">
                <script type="text/javascript" src="${tabulatorJsUri}"></script>
                <title>${title || `Data Query - ${webviewId}`}</title>
            </head>
            <body>
                <div class="adb-root">
                    <div class="adb-toolbar">
                        <div class="adb-object">
                            <strong>${title || 'Data Query View'}</strong>
                        </div>
                        <div class="adb-actions">
                            <button id="adb-export-csv">Export CSV</button>
                            <button id="adb-copy-rows" title="Copy selected rows to clipboard">Copy Rows</button>
                        </div>
                    </div>

                    <div id="result-table"></div>
                    <div id="adb-busy" class="adb-busy" style="display:none;">
                        <div class="adb-spinner"></div>
                        <span>Loading data…</span>
                    </div>
                </div>
                <script>
                    window.webviewId = '${webviewId}';
                </script>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    /**
     * Show dependency graph visualization
     */
    public async showDependencyGraph(
        connectionId: string,
        objectName: string,
        objectType: string,
        graphData: any,
        objectUri: string
    ): Promise<void> {
        const webviewId = `dep-graph-${objectName}-${Date.now()}`;
        const title = `Dependency Graph: ${objectName}`;

        const column = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : undefined;

        const panel = window.createWebviewPanel(
            'ABAPDependencyGraph',
            title,
            column || vscode.ViewColumn.One,
            this.getWebviewOptions()
        );

        this._activeWebviews.set(webviewId, panel);

        // Set up disposal handler
        panel.onDidDispose(() => {
            this._activeWebviews.delete(webviewId);
        }, null, this._disposables);

        // Set up message handler for graph interactions
        panel.webview.onDidReceiveMessage(
            async (message) => this.handleGraphMessage(message, connectionId, panel),
            null,
            this._disposables
        );

        // Set webview HTML
        panel.webview.html = this.generateDependencyGraphHTML(panel.webview, title);

        // Get available object types from graph
        const availableTypes = Array.from(new Set(graphData.nodes.map((n: any) => n.type))).sort();
        const availableUsageTypes = Array.from(new Set(graphData.edges.map((e: any) => e.usageType).filter((t: any) => t))).sort();

        // Wait for webview to be ready, then send initial data
        const sendInitData = () => {
            panel.webview.postMessage({
                command: 'init',
                connectionId,
                rootObjectName: objectName,
                rootObjectType: objectType,
                rootObjectUri: objectUri,
                graphData,
                availableTypes,
                availableUsageTypes
            });
        };
        
        // Try sending immediately (usually works)
        setTimeout(sendInitData, 100);
        
        // Also send when webview signals ready (backup)
        const readyDisposable = panel.webview.onDidReceiveMessage((msg) => {
            if (msg.command === 'ready') {
                sendInitData();
                readyDisposable.dispose();
            }
        });
    }

    /**
     * Handle messages from dependency graph webview
     */
    private async handleGraphMessage(
        message: any,
        connectionId: string,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const { getClient } = await import('../adt/conections');
            const { fetchWhereUsedData, buildGraphData, mergeGraphData, applyFilters } = await import('./dependencyGraph');

            switch (message.command) {
                case 'ready':
                    // Webview is ready
                    break;

                case 'log':
                    // Handle log messages from webview
                    if (message.log) {
                        log(`[DependencyGraph WebView] ${message.log}`);
                    }
                    break;

                case 'openObject':
                    // Open ABAP object in editor at the exact usage location
                    try {
                        const { AdtObjectFinder } = await import('../adt/operations/AdtObjectFinder');
                        const { getClient } = await import('../adt/conections');
                        const finder = new AdtObjectFinder(connectionId);
                        const client = getClient(connectionId.toLowerCase());
                        let adtUri = message.uri || message.objectUri || message.adtUri;
                        let snippetLine = message.line;
                        let snippetColumn = message.column;
                        
                        // If no line/column provided, try to fetch snippet on-demand
                        if ((!snippetLine || snippetLine === 0) && message.objectIdentifier) {
                            try {
                                // Reconstruct reference object from node data
                                const snippets = await client.statelessClone.usageReferenceSnippets([{
                                    uri: adtUri || message.objectName,
                                    objectIdentifier: message.objectIdentifier,
                                    parentUri: message.parentUri || '',
                                    isResult: false,
                                    canHaveChildren: message.canExpand || false,
                                    usageInformation: message.usageInformation || '',
                                    'adtcore:responsible': message.responsible || '',
                                    'adtcore:name': message.objectName,
                                    'adtcore:type': message.objectType,
                                    packageRef: { 
                                        'adtcore:uri': message.packageUri || '', 
                                        'adtcore:name': message.package || '' 
                                    }
                                }]);
                                
                               
                                if (snippets && snippets.length > 0 && snippets[0].snippets && snippets[0].snippets.length > 0) {
                                    const firstSnippet = snippets[0].snippets[0];
                                    if (firstSnippet.uri && firstSnippet.uri.start) {
                                        snippetLine = firstSnippet.uri.start.line;
                                        snippetColumn = firstSnippet.uri.start.column;
                                    }
                                } else {
                                }
                            } catch (snippetError) {
                                // Continue without snippet - will open at default position
                            }
                        }
                        
                        // If URI provided, use it directly
                        if (adtUri && adtUri.startsWith('/sap/bc/adt')) {
                            // Use the FULL URI including hash fragment - AdtObjectFinder finds the method/component
                            const { uri, start } = await finder.vscodeUriFromAdt(`adt://${connectionId}${adtUri}`);
                            
                            let position: vscode.Position | undefined = start;
                            
                            // If we have snippet line/column
                            if (snippetLine !== undefined && snippetLine > 0) {
                                // Check if hash indicates a method/component (has type=CLAS/OM or type=CLAS/OI and name=)
                                // NOT just #start=1,0 which is a simple position marker
                                const isMethodComponent = adtUri.includes('#type=CLAS') && adtUri.includes(';name=');
                                
                                if (isMethodComponent && start && start.line > 0) {
                                    // Snippet line is RELATIVE to the method start
                                    // Add snippet line to method start position
                                    position = new vscode.Position(
                                        start.line + snippetLine - 1, // -1 because snippet line 1 = method start line
                                        snippetColumn || message.character || 0
                                    );
                                } else {
                                    // For regular objects (class file, include, program), snippet line is absolute
                                    position = new vscode.Position(snippetLine - 1, snippetColumn || message.character || 0);
                                }
                            }
                            
                            await window.showTextDocument(uri, position ? { selection: new vscode.Range(position, position) } : undefined);
                        } else {
                            // Fallback: search by name/type
                            const { getSearchService } = await import('./abapSearchService');
                            const searcher = getSearchService(connectionId.toLowerCase());
                            
                            // For function modules (FUGR/FF), search as FUNC type
                            // For methods (CLAS/OM), search as CLAS to open the class file
                            let searchType = message.objectType;
                            let searchName = message.objectName;
                            if (message.objectType === 'FUGR/FF') {
                                searchType = 'FUNC/FM';
                            } else if (message.objectType === 'CLAS/OM') {
                                // Extract class name from method identifier (format: CLASSNAME======CM...)
                                const className = message.objectName.split('=')[0];
                                searchName = className;
                                searchType = 'CLAS/OC';
                            }
                            
                            const results = await searcher.searchObjects(searchName, [searchType], 1);
                            if (!results || results.length === 0 || !results[0].uri) throw new Error('Object not found');
                            adtUri = results[0].uri;
                            
                            const { uri, start } = await finder.vscodeUriFromAdt(`adt://${connectionId}${adtUri}`);
                            await window.showTextDocument(uri, start ? { selection: new vscode.Range(start, start) } : undefined);
                        }
                    } catch (error) {
                        const { log } = await import('../lib');
                        log(`[DependencyGraph] openObject: error: ${error}`);
                        window.showErrorMessage(`Failed to open object: ${error}`);
                    }
                    break;

                case 'expandNode':
                    // Fetch dependencies for a node and merge into graph
                    panel.webview.postMessage({ command: 'busy', message: `Fetching dependencies for ${message.objectName}...` });
                    
                    try {
                        // If URI is provided, use it directly (more reliable)
                        let objectUri = message.uri;
                        
                        if (!objectUri || !objectUri.startsWith('/sap/bc/adt')) {
                            // Fallback: search for object
                            const { getSearchService } = await import('./abapSearchService');
                            const searcher = getSearchService(connectionId.toLowerCase());
                            
                            // Try with the original type first
                            let results = await searcher.searchObjects(message.objectName, [message.objectType], 1);
                            
                            // If not found and it's FUGR/FF, try FUNC/FM
                            if ((!results || results.length === 0) && message.objectType === 'FUGR/FF') {
                                results = await searcher.searchObjects(message.objectName, ['FUNC/FM'], 1);
                            }
                            
                            if (!results || results.length === 0 || !results[0].uri) {
                                throw new Error(`Object not found: ${message.objectName} (${message.objectType})`);
                            }
                            
                            objectUri = results[0].uri;
                        }
                        
                        // Fetch where-used data WITHOUT line/character to get object-level dependencies
                        // (not symbol-level which would create a different node ID)
                        const references = await fetchWhereUsedData(objectUri, connectionId);
                        
                        // Build graph data using the SAME name/type as the expanded node
                        // Don't let symbol extraction change it!
                        const newGraphData = buildGraphData(message.objectName, message.objectType, references, true);
                        
                        // Mark which node was expanded
                        panel.webview.postMessage({
                            command: 'updateGraph',
                            graphData: newGraphData,
                            expandedNodeId: `${message.objectName}::${message.objectType}`
                        });
                    } catch (error) {
                        panel.webview.postMessage({
                            command: 'error',
                            error: `Failed to expand node: ${error}`
                        });
                    }
                    break;

                case 'applyFilters':
                    // Apply filters to graph
                    // This would require storing graph state in extension or retrieving from webview
                    // For simplicity, let webview handle filtering client-side
                    break;

                case 'exportImage':
                    // Save exported SVG image
                    try {
                        const imageData = message.imageData;
                        // Remove data URL prefix if present
                        let svgContent = imageData;
                        if (svgContent.startsWith('data:image/svg+xml;base64,')) {
                            svgContent = Buffer.from(svgContent.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf-8');
                        } else if (svgContent.startsWith('data:image/svg+xml;utf8,')) {
                            svgContent = decodeURIComponent(svgContent.replace('data:image/svg+xml;utf8,', ''));
                        }
                        const uri = await window.showSaveDialog({
                            defaultUri: vscode.Uri.file(`dependency-graph-${Date.now()}.svg`),
                            filters: { 'SVG Images': ['svg'] }
                        });
                        if (uri) {
                            await vscode.workspace.fs.writeFile(uri, Buffer.from(svgContent, 'utf-8'));
                            window.showInformationMessage(`Graph exported to ${uri.fsPath}`);
                        }
                    } catch (error) {
                        window.showErrorMessage(`Failed to export SVG: ${error}`);
                    }
                    break;
            }
        } catch (error: any) {
            const errorMsg = error?.localizedMessage || error?.message || String(error);
            panel.webview.postMessage({ command: 'error', data: errorMsg });
        }
    }

    /**
     * Generate dependency graph webview HTML
     */
    private generateDependencyGraphHTML(webview: vscode.Webview, title: string): string {
        // Local paths to resources
        const scriptPath = vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media', 'dependencyGraph.js');
        const cssPath = vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media', 'editor.css');
        const cytoscapeJsPath = vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media', 'cytoscape.min.js');
        const cytoscapeSvgPath = vscode.Uri.joinPath(this._context.extensionUri, 'client', 'dist', 'media', 'cytoscape-svg.min.js');

        // Convert to webview URIs
        const scriptUri = webview.asWebviewUri(scriptPath);
        const cssUri = webview.asWebviewUri(cssPath);
        const cytoscapeJsUri = webview.asWebviewUri(cytoscapeJsPath);
        const cytoscapeSvgUri = webview.asWebviewUri(cytoscapeSvgPath);

        const cspSource = webview.cspSource;

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; object-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${cssUri}" rel="stylesheet">
                <title>${title}</title>
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        overflow: hidden;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .graph-container {
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                    }
                    .graph-toolbar {
                        padding: 8px 12px;
                        background-color: var(--vscode-editorWidget-background);
                        border-bottom: 1px solid var(--vscode-editorWidget-border);
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        flex-wrap: wrap;
                    }
                    .toolbar-section {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .toolbar-divider {
                        width: 1px;
                        height: 20px;
                        background-color: var(--vscode-editorWidget-border);
                    }
                    button {
                        padding: 4px 12px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 2px;
                        cursor: pointer;
                        font-size: 12px;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    select {
                        padding: 4px 8px;
                        background-color: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        border-radius: 2px;
                        font-size: 12px;
                    }
                    label {
                        font-size: 12px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    }
                    #cy-graph {
                        flex: 1;
                        background-color: var(--vscode-editor-background);
                        position: relative;
                    }
                    #graph-busy {
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background-color: var(--vscode-editorWidget-background);
                        padding: 20px;
                        border-radius: 4px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                        font-size: 14px;
                    }
                    #stats-text {
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                    }
                    .filters-panel {
                        padding: 8px;
                        background-color: var(--vscode-editorWidget-background);
                        border-left: 1px solid var(--vscode-editorWidget-border);
                        overflow-y: auto;
                        max-width: 250px;
                        font-size: 12px;
                    }
                    .filter-group {
                        margin-bottom: 12px;
                    }
                    .filter-group h4 {
                        margin: 0 0 8px 0;
                        font-size: 12px;
                        font-weight: 600;
                    }
                    #type-filters-container {
                        max-height: 200px;
                        overflow-y: auto;
                    }
                    .graph-main {
                        display: flex;
                        flex: 1;
                        overflow: hidden;
                    }
                    .filter-label {
                        display: block;
                        margin: 4px 0;
                    }
                    .graph-tooltip {
                        position: absolute;
                        background: var(--vscode-editorHoverWidget-background);
                        border: 1px solid var(--vscode-editorHoverWidget-border);
                        border-radius: 4px;
                        padding: 8px;
                        font-size: 12px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                        z-index: 1000;
                        display: none;
                        max-width: 250px;
                        pointer-events: none;
                    }
                    .graph-context-menu {
                        position: fixed;
                        background: var(--vscode-menu-background);
                        border: 1px solid var(--vscode-menu-border);
                        border-radius: 4px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                        z-index: 10000;
                        min-width: 180px;
                    }
                    .graph-menu-item {
                        padding: 8px 12px;
                        cursor: pointer;
                        font-size: 13px;
                        color: var(--vscode-menu-foreground);
                    }
                    .graph-menu-item.hover {
                        background: var(--vscode-menu-selectionBackground);
                        color: var(--vscode-menu-selectionForeground);
                    }
                </style>
            </head>
            <body>
                <div class="graph-container">
                    <div class="graph-toolbar">
                        <div class="toolbar-section">
                            <strong>${title}</strong>
                        </div>
                        <div class="toolbar-divider"></div>
                        <div class="toolbar-section">
                            <button id="fit-graph" title="Fit graph to view">Fit</button>
                            <button id="reset-filters" title="Reset all filters">Reset Filters</button>
                            <button id="export-graph" title="Export as SVG">Export SVG</button>
                        </div>
                        <div class="toolbar-divider"></div>
                        <div class="toolbar-section">
                            <label>
                                Layout:
                                <select id="layout-select">
                                    <option value="cose">Force-directed</option>
                                    <option value="circle">Circle</option>
                                    <option value="concentric">Concentric</option>
                                    <option value="grid">Grid</option>
                                    <option value="breadthfirst">Breadth-first</option>
                                </select>
                            </label>
                        </div>
                        <div class="toolbar-divider"></div>
                        <div class="toolbar-section">
                            <span id="stats-text">Loading...</span>
                        </div>
                    </div>
                    <div class="graph-main">
                        <div id="cy-graph"></div>
                        <div class="filters-panel">
                            <div class="filter-group">
                                <h4>Object Filters</h4>
                                <label>
                                    <input type="checkbox" id="filter-custom-only">
                                    Custom Only (Z*/Y*)
                                </label>
                                <label>
                                    <input type="checkbox" id="filter-standard-only">
                                    Standard Only
                                </label>
                            </div>
                            <div class="filter-group">
                                <h4>Object Types</h4>
                                <div id="type-filters-container"></div>
                            </div>
                            <div class="filter-group">
                                <h4>Usage Types</h4>
                                <div id="usage-filters-container"></div>
                            </div>
                        </div>
                    </div>
                    <div id="graph-busy" style="display:none;">Loading...</div>
                </div>
                <script src="${cytoscapeJsUri}"></script>
                <script src="${cytoscapeSvgUri}"></script>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    /**
     * Dispose of the manager
     */
    public dispose(): void {
        this.closeAllWebviews();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

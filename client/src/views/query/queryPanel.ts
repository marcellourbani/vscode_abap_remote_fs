import * as vscode from 'vscode'
import { funWindow as window } from '../../services/funMessenger'
import { ADTClient } from "abap-adt-api"
import { log } from "../../lib"

/**
 * SQL Security Validator
 */
class SQLValidator {
    static validate(sql: string): void {
        if (!sql || typeof sql !== 'string') {
            throw new Error('SQL query must be a non-empty string');
        }

        const upperSQL = sql.toUpperCase().trim();
        
        // Block dangerous SQL operations
        const dangerousPatterns = [
            /\bDROP\s+/i,
            /\bDELETE\s+(?!.*\bFROM\s+@)/i,
            /\bINSERT\s+/i,
            /\bUPDATE\s+/i,
            /\bALTER\s+/i,
            /\bCREATE\s+/i,
            /\bTRUNCATE\s+/i,
            /;\s*(?!$)/i, // Multiple statements
            /--/i, // SQL comments
            /\/\*/i, // Block comments
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(upperSQL)) {
                throw new Error(`SQL query contains dangerous operation`);
            }
        }

        // Ensure it's a SELECT or WITH statement
        if (!upperSQL.startsWith('SELECT') && !upperSQL.startsWith('WITH')) {
            throw new Error('Only SELECT and WITH statements are allowed');
        }
    }
}
/**
 * Manages cat coding webview panels
 */
export class QueryPanel {
    /**
     * Track the currently panel. Only allow a single panel to exist at a time.
     */
    public static readonly viewType = 'ABAPQuery';

    private readonly _panel: vscode.WebviewPanel
    private readonly _extensionUri: vscode.Uri
    private _disposables: vscode.Disposable[] = [];

    private _client: ADTClient
    private _table: string

    public static createOrShow(extensionUri: vscode.Uri, client: ADTClient, table: string) {
        const column = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : undefined

    // Allow multiple panels; don't reuse a singleton

        // Otherwise, create a new panel.
        const panel = window.createWebviewPanel(
            QueryPanel.viewType,
            'Query',
            column || vscode.ViewColumn.One,
            getWebviewOptions(extensionUri),
        )

    new QueryPanel(panel, extensionUri, client, table)
    }


    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: ADTClient, table: string) {
        this._panel = panel
        this._client = client
        this._extensionUri = extensionUri
        this._table = table
        // Set the webview's initial html content
        this._update()

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    // this._update();
                }
            },
            null,
            this._disposables
        )

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                try {
                    switch (message.command) {
                        case 'execute': { // legacy free-SQL
                            const resp = await client.runQuery(message.query, message.rowCount)
                            this.showResult(JSON.stringify(resp))
                            return
                        }
            case 'searchObjects': {
                            const { term, types, max } = message
                            const base = Array.isArray(types) && types.length ? types : ['TABL', 'VIEW', 'DDLS']
                const wanted: string[] = base.includes('ALL') ? ['TABL', 'VIEW', 'DDLS'] : base
                            const cap = typeof max === 'number' && max > 0 ? max : 20
                const all: any[] = []
                            const typeVariants = (t: string) => {
                                switch (t) {
                    case 'TABL': return ['TABL/DT'] // tables only, exclude structures/TA
                                    case 'VIEW': return ['VIEW', 'VIEW/V']
                                    case 'DDLS': return ['DDLS', 'DDLS/DF']
                                    default: return [t]
                                }
                            }
                            for (const t of wanted) {
                                const variants = typeVariants(t)
                                try {
                                    for (const vt of variants) {
                                        const part = await client.searchObject(term, vt, cap)
                                        for (const r of part) {
                                            const type = r["adtcore:type"]
                                            // Only allow the exact types we requested, not just anything starting with the prefix
                                            if (variants.includes(type)) {
                                                all.push({ name: r["adtcore:name"], type, description: r["adtcore:description"] || '' })
                                            }
                                        }
                                    }
                                } catch (e) {
                                    // ignore per-type errors and continue
                                }
                            }
                // de-duplicate by name+type
                const uniq = new Map<string, any>()
                for (const it of all) uniq.set(`${it.name}|${it.type}`, it)
                this._panel.webview.postMessage({ command: 'objects', data: Array.from(uniq.values()) })
                            return
                        }
                        case 'exportCSV': {
                            const { columns, rows, defaultName } = message
                            const headers: string[] = columns.map((c: any) => c.title || c.field || c.name)
                            const fields: string[] = columns.map((c: any) => c.field || c.name)
                            const csvEscape = (v: any) => {
                                const s = v == null ? '' : String(v)
                                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
                            }
                            const lines: string[] = []
                            lines.push(headers.map(csvEscape).join(','))
                            for (const r of rows) lines.push(fields.map(f => csvEscape((r as any)[f])).join(','))
                            const data = Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8')
                            const uri = await window.showSaveDialog({
                                defaultUri: vscode.Uri.file((defaultName || 'data') + '.csv'),
                                filters: { 'CSV': ['csv'] }
                            })
                            if (!uri) return
                            await vscode.workspace.fs.writeFile(uri, data)
                            return
                        }
                        case 'loadFields': {
                            const { entity } = message // { name, kind }
                            const top = 1
                            const meta = await client.tableContents(entity.name, top, true)
                            const cols = meta.columns || []
                            this._panel.webview.postMessage({ command: 'fields', data: { entity, columns: cols } })
                            return
                        }
                        case 'runCriteria': {
                            const { entity, where, top, columns } = message
                            const limit = typeof top === 'number' && top > 0 ? top : 200
                            const sanitized = (where || '').replace(/^\s*where\s+/i, '')
                            const list = Array.isArray(columns) && columns.length
                                ? columns.map((c: string) => c.trim().toUpperCase()).filter(Boolean).join(', ')
                                : '*'
                            const sql = `select ${list} from ${entity.name}${sanitized ? ' where ' + sanitized : ''}`
                            // URL-encode % characters in LIKE queries for ADT compatibility
                           // const encodedSql = sql.replace(/%/g, '%25')
                            const resp = await client.runQuery(sql, limit + 1, true)
                            const hasMore = (resp.values?.length || 0) > limit
                            if (hasMore) resp.values = resp.values.slice(0, limit)
                            this._panel.webview.postMessage({ command: 'queryResult', data: { result: resp, hasMore, top: limit, mode: 'criteria', where: sanitized, entity } })
                            return
                        }
                        case 'runSQL': {
                            const { sql, top } = message
                            
                            // Validate SQL for security
                            try {
                                SQLValidator.validate(sql);
                            } catch (error) {
                                this._panel.webview.postMessage({ 
                                    command: 'error', 
                                    data: `SQL Security Error: ${error instanceof Error ? error.message : String(error)}` 
                                });
                                return;
                            }
                            
                            const limit = typeof top === 'number' && top > 0 ? top : 200
                            // URL-encode % characters in LIKE queries for ADT compatibility
                          //  const encodedSql = sql.replace(/%/g, '%25')
                            const resp = await client.runQuery(sql, limit + 1, true)
                            const hasMore = (resp.values?.length || 0) > limit
                            if (hasMore) resp.values = resp.values.slice(0, limit)
                            this._panel.webview.postMessage({ command: 'queryResult', data: { result: resp, hasMore, top: limit, mode: 'sql', sql } })
                            return
                        }
                        case 'loadMore': {
                            const { mode, entity, where, sql, nextTop, columns } = message
                            const limit = typeof nextTop === 'number' && nextTop > 0 ? nextTop : 500
                            
                            // Validate SQL if in SQL mode
                            if (mode === 'sql') {
                                try {
                                    SQLValidator.validate(sql);
                                } catch (error) {
                                    this._panel.webview.postMessage({ 
                                        command: 'error', 
                                        data: `SQL Security Error: ${error instanceof Error ? error.message : String(error)}` 
                                    });
                                    return;
                                }
                            }
                            
                            const resp = mode === 'sql'
                                ? await client.runQuery(sql, limit + 1, true)
                                : await client.runQuery(`select ${Array.isArray(columns)&&columns.length?columns.map((c:string)=>c.trim().toUpperCase()).filter(Boolean).join(', '):'*'} from ${entity.name}${where ? ' where ' + where : ''}`, limit + 1, true)
                            const hasMore = (resp.values?.length || 0) > limit
                            if (hasMore) resp.values = resp.values.slice(0, limit)
                            this._panel.webview.postMessage({ command: 'queryResult', data: { result: resp, hasMore, top: limit, mode, where, sql, entity } })
                            return
                        }
                        case 'getShowPrefs': {
                            const { table } = message
                            const result = await readShowPrefs()
                            const fields = result[(table || '').toUpperCase()] || []
                            this._panel.webview.postMessage({ command: 'showPrefs', data: { table, fields } })
                            return
                        }
                        case 'setShowPrefs': {
                            const { table, fields } = message as { table: string, fields: string[] }
                            const key = (table || '').toUpperCase()
                            const all = await readShowPrefs()
                            all[key] = Array.isArray(fields) ? fields.map(f => f.toUpperCase()) : []
                            await writeShowPrefs(all)
                            return
                        }
                    }
                } catch (error: any) {
                    const msg = error?.localizedMessage || error?.message || String(error)
                    this.showError(msg)
                }
            },
            null,
            this._disposables
        )
    }

    public setTable(table: string) {
        this._table = table
        this._update()
    }

    public showResult(data: string) {
        // Send a message to the webview webview.
        // You can send any JSON serializable data.
        this._panel.webview.postMessage({ command: 'result', data: data })
    }

    public showError(errorMsg: string) {
        // Send a message to the webview webview.
        // You can send any JSON serializable data.
        try {
            this._panel.webview.postMessage({ command: 'error', data: errorMsg })
        } catch (disposalError) {
            // If webview is disposed, log the original error and show it as a VS Code notification
            log(`[QUERY_PANEL] Cannot show error in webview (disposed): ${errorMsg}`)
            window.showErrorMessage(`SQL Error: ${errorMsg}`)
        }
    }

    public dispose() {
        // Clean up our resources
        this._panel.dispose()

        while (this._disposables.length) {
            const x = this._disposables.pop()
            if (x) {
                x.dispose()
            }
        }
    }

    private _update() {
        const webview = this._panel.webview

    // Vary the webview's content based on where it is located in the editor.
    this._panel.title = "Data Browser"
        this._panel.webview.html = this._getHtmlForWebview(webview, this._table)
    }

    private _getHtmlForWebview(webview: vscode.Webview, tableName: string) {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'client', 'dist', 'media', 'query.js')

        // And the uri we use to load this script in the webview
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk)

        // Local path to css styles
        //const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'client/media', 'reset.css');
        const stylesPathMainPath = vscode.Uri.joinPath(this._extensionUri, 'client', 'dist', 'media', 'editor.css')

        // Local path to Tabulator files - using a lighter theme
        const tabulatorCssPath = vscode.Uri.joinPath(this._extensionUri, 'client', 'dist', 'media', 'tabulator_bootstrap4.min.css')
        const tabulatorJsPath = vscode.Uri.joinPath(this._extensionUri, 'client', 'dist', 'media', 'tabulator.min.js')

        // Uri to load styles and scripts into webview
        //const stylesResetUri = webview.asWebviewUri(styleResetPath);
        const stylesMainUri = webview.asWebviewUri(stylesPathMainPath)
        const tabulatorCssUri = webview.asWebviewUri(tabulatorCssPath)
        const tabulatorJsUri = webview.asWebviewUri(tabulatorJsPath)

    // CSP to allow local extension resources
    const cspSource = webview.cspSource

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${stylesMainUri}" rel="stylesheet">
                <link href="${tabulatorCssUri}" rel="stylesheet">
                <script type="text/javascript" src="${tabulatorJsUri}"></script>
                <title>ABAP Data Browser</title>
            </head>
            <body>
                <div class="adb-root">
                    <div class="adb-toolbar">
                        <div class="adb-object">
                            <label>Object</label>
                            <input id="adb-object-input" type="text" placeholder="Enter table/view/CDS name" value="${tableName || ''}" />
                            <select id="adb-object-type">
                                <option value="ALL">All</option>
                                <option value="TABL">Table</option>
                                <option value="VIEW">View</option>
                                <option value="DDLS">CDS</option>
                            </select>
                            <div id="adb-search-results" class="adb-search-results"></div>
                        </div>
                        <div class="adb-actions">
                            <label>Rows</label>
                            <input id="adb-rowCount" value="200" />
                            <button id="adb-execute">Search</button>
                            <button id="adb-toggle-sql">SQL Mode</button>
                            <button id="adb-toggle-fields">Hide Selection Fields</button>
                            <button id="adb-view-sql" title="Preview generated SQL">Show SQL Query</button>
                        </div>
                        <div class="adb-actions-row2">
                            <button id="adb-copy-rows" title="Copy selected rows to clipboard">Copy Rows</button>
                        </div>
                    </div>

                    <div id="adb-panels">
                        <div id="adb-fields-header" class="adb-fields-header">
                            <label>Filter fields</label>
                            <input id="adb-field-filter" placeholder="type to filter fields by name/description" />
                            <span class="adb-fields-pager">
                                <button id="adb-fields-prev">◀</button>
                                <span id="adb-fields-page">1</span>
                                <button id="adb-fields-next">▶</button>
                            </span>
                        </div>
                        <div id="adb-criteria-panel" class="adb-panel"></div>
                        <div style="display:flex;align-items:center;gap:12px;padding:8px;border-bottom:1px solid var(--vscode-editorWidget-border);">
                            <label style="display:flex;align-items:center;gap:6px;">Technical Field Names<input id="adb-tech-names" type="checkbox"/></label>
                            <button id="adb-export-csv">Export CSV</button>
                        </div>
                        <div id="adb-sql-panel" class="adb-panel" style="display:none;">
                            <textarea id="adb-sql" spellcheck="false" class="adb-sqlbox" placeholder="SELECT * FROM <entity> WHERE ..."></textarea>
                        </div>
                    </div>

                    <div id="result-table"></div>
                    <div id="adb-busy" class="adb-busy" style="display:none;"><div class="adb-spinner"></div><span>Searching…</span></div>
                    <div id="adb-sql-modal" style="display:none; position:fixed; inset:0; background: rgba(0,0,0,0.35); align-items:center; justify-content:center;">
                        <div style="background:#fff; max-width:80vw; max-height:80vh; width:80vw; height:80vh; display:flex; flex-direction:column; border:1px solid #ccc; box-shadow:0 4px 16px rgba(0,0,0,0.2);">
                            <div style="padding:8px; border-bottom:1px solid #eee; display:flex; gap:8px; align-items:center;">
                                <strong style="flex:1;">Generated SQL</strong>
                                <button id="adb-sql-copy" title="Copy to clipboard">Copy</button>
                                <button id="adb-sql-open" title="Open in SQL Mode">Open in SQL Mode</button>
                                <button id="adb-sql-close">Close</button>
                            </div>
                            <pre id="adb-sql-text" style="margin:0; padding:12px; overflow:auto; white-space:pre-wrap; font-family: Consolas, monospace; font-size:12px;"></pre>
                        </div>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`
    }
}

// Simple JSON persistence for Show preferences in a separate file
async function prefsFileUri(): Promise<vscode.Uri> {
    // Prefer local user profile for cross-workspace safety; only use workspace folder if it's a real file workspace
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length) {
        const root = folders[0].uri
        if (root.scheme === 'file') {
            const dir = vscode.Uri.joinPath(root, '.vscode')
            try { await vscode.workspace.fs.createDirectory(dir) } catch {}
            return vscode.Uri.joinPath(dir, 'abap-data-browser.json')
        }
    }
    // fallback to user profile
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const base = vscode.Uri.file(home)
    const dir = vscode.Uri.joinPath(base, '.abap-data-browser')
    try { await vscode.workspace.fs.createDirectory(dir) } catch {}
    return vscode.Uri.joinPath(dir, 'prefs.json')
}

async function readShowPrefs(): Promise<Record<string, string[]>> {
    try {
        const uri = await prefsFileUri()
        const data = await vscode.workspace.fs.readFile(uri)
        const txt = new TextDecoder().decode(data)
        const obj = JSON.parse(txt)
        return obj && typeof obj === 'object' ? obj : {}
    } catch {
        return {}
    }
}

async function writeShowPrefs(all: Record<string, string[]>) {
    const uri = await prefsFileUri()
    const txt = JSON.stringify(all, null, 2)
    const buf = new TextEncoder().encode(txt)
    await vscode.workspace.fs.writeFile(uri, buf)
}

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,
        retainContextWhenHidden: true,

        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [
            vscode.Uri.joinPath(extensionUri,'client', 'dist', 'media'),
            vscode.Uri.joinPath(extensionUri,'client', 'media')
        ]
    }
}

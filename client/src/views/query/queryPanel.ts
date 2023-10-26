import * as vscode from 'vscode'
import { ADTClient } from "abap-adt-api"
/**
 * Manages cat coding webview panels
 */
export class QueryPanel {
    /**
     * Track the currently panel. Only allow a single panel to exist at a time.
     */
    public static currentPanel: QueryPanel | undefined

    public static readonly viewType = 'ABAPQuery';

    private readonly _panel: vscode.WebviewPanel
    private readonly _extensionUri: vscode.Uri
    private _disposables: vscode.Disposable[] = [];

    private _client: ADTClient
    private _table: string

    public static createOrShow(extensionUri: vscode.Uri, client: ADTClient, table: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined

        // If we already have a panel, show it.
        if (QueryPanel.currentPanel) {
            if (table) QueryPanel.currentPanel.setTable(table)
            QueryPanel.currentPanel._panel.reveal(column)
            return
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            QueryPanel.viewType,
            'Query',
            column || vscode.ViewColumn.One,
            getWebviewOptions(extensionUri),
        )

        QueryPanel.currentPanel = new QueryPanel(panel, extensionUri, client, table)
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
            message => {
                switch (message.command) {
                    case 'execute':
                        client.runQuery(message.query, message.rowCount).then(resp => {
                            this.showResult(JSON.stringify(resp))
                        }).catch(error => {
                            this.showError(error.localizedMessage)
                        }
                        )
                        return
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
        this._panel.webview.postMessage({ command: 'error', data: errorMsg })
    }

    public dispose() {
        QueryPanel.currentPanel = undefined

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
        this._panel.title = "Query"
        this._panel.webview.html = this._getHtmlForWebview(webview, this._table)
    }

    private _getHtmlForWebview(webview: vscode.Webview, tableName: string) {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'client/media', 'query.js')

        // And the uri we use to load this script in the webview
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk)

        // Local path to css styles
        //const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'client/media', 'reset.css');
        const stylesPathMainPath = vscode.Uri.joinPath(this._extensionUri, 'client/media', 'editor.css')

        // Uri to load styles into webview
        //const stylesResetUri = webview.asWebviewUri(styleResetPath);
        const stylesMainUri = webview.asWebviewUri(stylesPathMainPath)

        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce()

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                
                <link href="${stylesMainUri}" rel="stylesheet">
                <link href="https://unpkg.com/tabulator-tables@4.1.4/dist/css/tabulator_midnight.min.css" rel="stylesheet">
                <script type="text/javascript" src="https://unpkg.com/tabulator-tables@4.1.4/dist/js/tabulator.min.js"></script>
		
				<title>ABAP Query</title>
			</head>
            <body>
                <h1 >Query</h1>
                <div style="display: flex; width: 100%; height:10em">
                    <textarea id="query" style="width: 80%; height: 100%;">select * from ${tableName} </textarea>
                    <div style="width: 18%; height: 100%;display: grid; padding-left: 10">
                        <label for="rowCount"> 
                          Rows <input id="rowCount" value="200">
                        </label>
                        <button id="execute" style="width: 100%; height: 100%;">Execute</button>
                    </div>
                </div>
                <div id="result-table"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`
    }
}

function getNonce() {
    let text = ''
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
}

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,
        retainContextWhenHidden: true,

        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'client/media')]
    }
}
import { CancellationToken, ExtensionContext, Webview, WebviewView, WebviewViewProvider, WebviewViewResolveContext } from "vscode"
import { getClient } from "../../adt/conections"

export interface DocumentationItem {
    url: string,
    connId: string
}

export class ATCDocumentation implements WebviewViewProvider {
    public static readonly viewType = 'abapfs.views.atcdocs'
    private static instance: ATCDocumentation | undefined
    public static get() {
        if (!ATCDocumentation.instance) {
            ATCDocumentation.instance = new ATCDocumentation()
        }
        return ATCDocumentation.instance
    }
    private view: WebviewView | undefined
    private documentation: DocumentationItem | undefined
    async resolveWebviewView(webviewView: WebviewView, context: WebviewViewResolveContext<unknown>, token: CancellationToken) {
        this.view = webviewView

        webviewView.webview.options = {
            enableScripts: true,
        }
        webviewView.webview.html = await this.getHtmlForWebview()
    }
    public async showDocumentation(documentation: DocumentationItem) {
        this.documentation = documentation
        if (this.view) {
            this.view.webview.html = await this.getHtmlForWebview()
        }
    }
    private async getHtmlForWebview(): Promise<string> {
        if (!this.documentation) return `<body>No document selected</body>`
        const client = getClient(this.documentation.connId)
        const doc = await client.httpClient.request(this.documentation.url)
        return doc.body
    }
}
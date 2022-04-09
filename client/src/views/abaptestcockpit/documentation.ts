import { CancellationToken, ExtensionContext, Uri, Webview, WebviewView, WebviewViewProvider, WebviewViewResolveContext } from "vscode"
import { getClient } from "../../adt/conections"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { injectUrlHandler } from "../utilities"

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
    async resolveWebviewView(panel: WebviewView, context: WebviewViewResolveContext<unknown>, token: CancellationToken) {
        this.view = panel

        panel.webview.options = {
            enableScripts: true
        }
        panel.webview.html = await this.getHtmlForWebview()
        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case "click":
                    if (!this.documentation) return
                    const client = getClient(this.documentation.connId)
                    const url = Uri.parse(message.uri)
                    if (url.scheme.toLowerCase() === "adt") {
                        new AdtObjectFinder(this.documentation.connId).displayAdtUri(message.uri)
                    }
                    else {
                        const text = await client.httpClient.request(`${url.path}?${url.query}`)
                        panel.webview.html = injectUrlHandler(text.body)
                    }
            }
        }, undefined)
    }
    public async showDocumentation(documentation: DocumentationItem) {
        this.documentation = documentation
        if (this.view) {
            this.view.webview.html = await this.getHtmlForWebview()
        }
    }
    private async getHtmlForWebview(): Promise<string> {
        if (this.documentation) {
            const client = getClient(this.documentation.connId)
            const doc = await client.httpClient.request(this.documentation.url)
            return injectUrlHandler(doc.body)
        }
        return `<body>No document selected</body>`
    }
}
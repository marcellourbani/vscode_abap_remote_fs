import { CancellationToken, commands, Uri, WebviewView, WebviewViewProvider, WebviewViewResolveContext } from "vscode"
import { getClient } from "../../adt/conections"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { AbapFsCommands, command } from "../../commands"
import { History } from "../history"
import { injectUrlHandler } from "../utilities"

export interface DocumentationItem {
    url: string,
    connId: string
}

export class ATCDocumentation implements WebviewViewProvider {
    public static readonly viewType = 'abapfs.views.atcdocs'
    private history = new History<DocumentationItem>()
    private static instance: ATCDocumentation | undefined
    public static get() {
        if (!ATCDocumentation.instance) {
            ATCDocumentation.instance = new ATCDocumentation()
        }
        return ATCDocumentation.instance
    }
    private view: WebviewView | undefined
    private get documentation() {
        return this.history.current
    }
    private async navigateTo(uri: string) {
        if (!this.documentation || !this.view) return
        const url = Uri.parse(uri)
        if (url.scheme.toLowerCase() === "adt") {
            new AdtObjectFinder(this.documentation.connId).displayAdtUri(uri)
        }
        else {
            this.history.append({ connId: this.documentation.connId, url: `${url.path}?${url.query}` })
            await this.getHtmlForWebview()
        }
    }
    async resolveWebviewView(panel: WebviewView, context: WebviewViewResolveContext<unknown>, token: CancellationToken) {
        this.view = panel

        panel.webview.options = {
            enableScripts: true
        }
        await this.getHtmlForWebview()
        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case "click":
                    this.navigateTo(message.uri)
            }
        }, undefined)
    }
    public async showDocumentation(documentation: DocumentationItem) {
        this.history = new History(documentation)
        return this.getHtmlForWebview()
    }
    private async getHtmlForWebview(): Promise<void> {
        if (!this.view) return
        commands.executeCommand("setContext", "abapfs:atcdoc:navigation:next", this.history.hasNext)
        commands.executeCommand("setContext", "abapfs:atcdoc:navigation:back", this.history.hasPrevious)
        if (this.documentation) {
            const client = getClient(this.documentation.connId)
            const doc = await client.httpClient.request(this.documentation.url)
            this.view.webview.html = injectUrlHandler(doc.body)
        }
        else this.view.webview.html = `<body>No document selected</body>`
    }

    @command(AbapFsCommands.atcDocHistoryBack)
    private static async back() {
        const instance = ATCDocumentation.get()
        instance.history.back()
        if (instance.view) await instance.getHtmlForWebview()

    }
    @command(AbapFsCommands.atcDocHistoryForward)
    private static async forward() {
        const instance = ATCDocumentation.get()
        instance.history.forward()
        if (instance.view) await instance.getHtmlForWebview()

    }
}
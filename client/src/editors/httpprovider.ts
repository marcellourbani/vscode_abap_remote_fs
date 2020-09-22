import { CustomTextEditorProvider, WebviewPanel, TextDocument, Webview, Uri, ExtensionContext, window } from "vscode";
import path from "path";
import { parseHTTP } from "./httpparser";

export class HttpProvider implements CustomTextEditorProvider {
    constructor(private context: ExtensionContext) { }
    public static register(context: ExtensionContext) {
        const provider = new HttpProvider(context)
        return window.registerCustomEditorProvider("abapfs.http", provider)
    }

    resolveCustomTextEditor(doc: TextDocument, panel: WebviewPanel) {
        panel.webview.options = { enableScripts: true, enableCommandUris: true }
        panel.webview.html = this.toHtml(panel.webview, doc.getText())
    }

    private toHtml(webview: Webview, source: string) {

        const styleUri = webview.asWebviewUri(
            Uri.file(
                path.join(this.context.extensionPath, "client/media", "editor.css")
            )
        )
        const service = parseHTTP(source)
        const field = (name: string, value: string) => `<tr><td><strong>${name}</strong></td><td>${value}</td></tr>`
        const tbody = field("Handler Class", service.handlerClass) +
            field("Author", service.author) +
            field("Url", service.url)

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
        <title>HTTP service</title>
        <link href="${styleUri}" rel="stylesheet" />
        <script>
        const vscode = acquireVsCodeApi();
        function send(event,url){
            event.preventDefault();
            vscode.postMessage({type:"doc",url});
        }
        </script></head>
        <body>
        <h1>${service.name} ${service.text}</h1>
        <table><tbody>${tbody}</tbody></table>
        </body></html>`
    }

}

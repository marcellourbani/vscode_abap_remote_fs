import * as vscode from "vscode"
import * as path from "path"
import { ReplPanel } from "./replPanel"
import { log } from "../lib"

const REPL_DISCLAIMER_ACCEPTED_KEY = "abapfs.replDisclaimerAccepted"

async function showReplDisclaimer(context: vscode.ExtensionContext): Promise<boolean> {
  if (context.globalState.get<boolean>(REPL_DISCLAIMER_ACCEPTED_KEY)) {
    return true
  }

  const panel = vscode.window.createWebviewPanel(
    "abapReplDisclaimer",
    "ABAP REPL - Important Notice",
    vscode.ViewColumn.One,
    { enableScripts: true }
  )

  return new Promise<boolean>(resolve => {
    let resolved = false
    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 24px; color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #1e1e1e); }
  h1 { color: var(--vscode-editorWarning-foreground, #cca700); margin-bottom: 16px; }
  .warning { background: var(--vscode-inputValidation-warningBackground, #352a05); border: 1px solid var(--vscode-inputValidation-warningBorder, #9d8050); border-radius: 6px; padding: 16px; margin-bottom: 20px; }
  ul { padding-left: 20px; line-height: 1.8; }
  .buttons { margin-top: 24px; display: flex; gap: 12px; }
  button { padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
  .btn-agree { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
  .btn-agree:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  .btn-agree-always { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); }
  .btn-agree-always:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .btn-cancel { background: transparent; color: var(--vscode-foreground, #ccc); border: 1px solid var(--vscode-input-border, #555); }
</style>
</head>
<body>
  <h1>⚠️ ABAP REPL - How It Works</h1>
  <div class="warning">
    <p>The ABAP REPL feature executes code snippets on your SAP system. Please understand what happens each time you run a snippet:</p>
    <ul>
      <li><strong>A temporary ABAP report is created</strong> on the SAP system using <code>INSERT REPORT</code></li>
      <li><strong>The report is compiled and executed</strong> via <code>GENERATE REPORT</code> + <code>SUBMIT</code></li>
      <li><strong>The output is captured</strong> and returned to VS Code</li>
      <li><strong>The temporary report is deleted</strong> immediately after execution</li>
    </ul>
    <p>This means <strong>real ABAP code runs on your SAP system</strong> every time you execute a snippet. The class <code>ZCL_ABAP_REPL</code> must be installed on the target system for this to work.</p>
    <p>This feature is <strong>disabled on production systems</strong> and requires <code>S_DEVELOP</code> authorization.</p>
  </div>
  <div class="buttons">
    <button class="btn-agree" onclick="post('agree')">I Agree</button>
    <button class="btn-agree-always" onclick="post('agree-always')">I Agree — Don't Show Again</button>
    <button class="btn-cancel" onclick="post('cancel')">Cancel</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function post(action) { vscode.postMessage({ action }); }
  </script>
</body>
</html>`

    panel.webview.onDidReceiveMessage(msg => {
      if (resolved) return
      resolved = true
      if (msg.action === "agree-always") {
        context.globalState.update(REPL_DISCLAIMER_ACCEPTED_KEY, true)
        panel.dispose()
        resolve(true)
      } else if (msg.action === "agree") {
        panel.dispose()
        resolve(true)
      } else {
        panel.dispose()
        resolve(false)
      }
    })

    panel.onDidDispose(() => {
      if (!resolved) {
        resolved = true
        resolve(false)
      }
    })
  })
}

export function registerAbapRepl(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.executeAbapCode", async () => {
      const accepted = await showReplDisclaimer(context)
      if (accepted) {
        ReplPanel.create(context.extensionUri)
      }
    }),
    vscode.commands.registerCommand("abapfs.abapReplSetupGuide", () => {
      const uri = vscode.Uri.file(
        path.join(context.extensionUri.fsPath, "client", "dist", "media", "REPL_SETUP_GUIDE.md")
      )
      vscode.commands.executeCommand("markdown.showPreview", uri)
    })
  )
  log("ABAP REPL commands registered")
}

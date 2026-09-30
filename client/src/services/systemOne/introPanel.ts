import { randomBytes } from "crypto"
import * as vscode from "vscode"
import { availableEngines, readEnvironment } from "./backend"

const VIEW_TYPE = "abapfs.decisionModels"

/**
 * Explains the two decision engines and how to enable one. Shown when neither is
 * configured, so the first thing a user meets is the choice rather than an error.
 */
export function openIntroPanel(): void {
  if (IntroPanel.instance) {
    IntroPanel.instance.reveal()
    return
  }
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, "Jev and Laya", vscode.ViewColumn.One, {
    enableScripts: false,
    retainContextWhenHidden: true
  })
  IntroPanel.instance = panel
  panel.onDidDispose(() => {
    IntroPanel.instance = undefined
  })
  panel.webview.html = html(availableEngines(readEnvironment()))
}

class IntroPanel {
  static instance?: vscode.WebviewPanel
}

function html(configured: readonly string[]): string {
  const nonce = randomBytes(16).toString("base64")
  const jevReady = configured.includes("jev")
  const layaReady = configured.includes("laya")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jev and Laya</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.6 var(--vscode-font-family); }
    main { max-width: 860px; margin: 0 auto; padding: 28px 32px 56px; }
    h1 { margin: 0 0 4px; font-size: 26px; }
    h2 { margin: 28px 0 8px; font-size: 18px; }
    .lead { margin: 0 0 24px; color: var(--vscode-descriptionForeground); }
    .card { padding: 18px 20px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); margin-bottom: 16px; }
    .card h2 { margin-top: 0; }
    .badge { display: inline-block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: 10px; margin-left: 8px; vertical-align: middle; }
    .badge.on { color: var(--vscode-testing-iconPassed); border: 1px solid var(--vscode-testing-iconPassed); }
    .badge.off { color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); }
    ul { margin: 8px 0; padding-left: 22px; }
    li { margin: 4px 0; }
    code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }
    pre { padding: 12px 14px; background: var(--vscode-textCodeBlock-background); border-radius: 4px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    a { color: var(--vscode-textLink-foreground); }
    .note { padding: 12px 14px; border-left: 4px solid var(--vscode-notificationsWarningIcon-foreground); background: var(--vscode-textBlockQuote-background); font-size: 13px; }
  </style>
</head>
<body>
<main>
  <h1>Jev and Laya</h1>
  <p class="lead">Both answer a question about text with a probability instead of writing a reply. ABAP FS can use either one. Neither is required, and no ABAP FS feature calls them on its own.</p>

  <section class="card">
    <h2>Jev<span class="badge ${jevReady ? "on" : "off"}">${jevReady ? "configured" : "not configured"}</span></h2>
    <p>A hosted service from TypeSafe. You sign up, get an API key, and it works immediately with nothing to install.</p>
    <ul>
      <li>Nothing to run or maintain locally.</li>
      <li>Handles questions with many options well.</li>
      <li>Your text is sent to TypeSafe, and usage is billed by them.</li>
    </ul>
    <p>Set an API key, then restart VS Code:</p>
    <pre>$env:TYPESAFE_API_KEY = "your-key"</pre>
    <p><a href="https://typesafe.ai">typesafe.ai</a></p>
  </section>

  <section class="card">
    <h2>Laya<span class="badge ${layaReady ? "on" : "off"}">${layaReady ? "configured" : "not configured"}</span></h2>
    <p>An open-source model you run yourself. It is free and your text never leaves the machine you run it on, which is what makes it usable where SAP source code cannot be sent to a third party.</p>
    <ul>
      <li>You install and run it, and keep it running.</li>
      <li>Free, with no per-request cost.</li>
      <li>Weaker out of the box, especially on yes/no questions and on questions with more than about twenty options. Its authors describe it as a base to fine-tune rather than something to trust unmodified.</li>
      <li>Slower on a machine without a GPU, where one question can take a second or more.</li>
    </ul>
    <p>Install and start the server, then point ABAP FS at it and restart VS Code:</p>
    <pre>pip install "laya[serve]"
laya-serve

$env:LAYA_BASE_URL = "http://127.0.0.1:8000"</pre>
    <p>If you protect the server with a bearer token, also set <code>LAYA_API_KEY</code> to the same value.</p>
    <p><a href="https://github.com/NandhaKishorM/laya">github.com/NandhaKishorM/laya</a></p>
  </section>

  <h2>Which one</h2>
  <p>If you only want to try the idea, Jev takes minutes and gives better answers. If your organization will not allow SAP code to leave the network, Laya is the option that can work at all. Configuring both is fine: each gets its own command, and you can keep both panels open to compare answers.</p>

  <p class="note">Environment variables are read when VS Code starts. After setting one, close every VS Code window and open it again from the same environment, or the command will stay hidden.</p>
</main>
</body>
</html>`
}

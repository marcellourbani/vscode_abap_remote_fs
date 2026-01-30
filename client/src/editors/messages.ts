import {
  CustomTextEditorProvider,
  TextDocument,
  WebviewPanel,
  CancellationToken,
  ExtensionContext,
  window,
  Webview,
  Uri,
  ViewColumn,
  Range,
  WorkspaceEdit,
  workspace
} from "vscode"
import { XMLParser } from "fast-xml-parser"
import { decode } from "html-entities"
import path from "path"
import { getClient } from "../adt/conections"

const parser = new XMLParser({
  parseAttributeValue: true,
  ignoreAttributes: false
})
const xmlNode = (xml: any, ...xmlpath: string[]) => {
  xmlpath = xmlpath.flatMap(x => x.split("/")).filter(x => x)
  let cur = xml
  for (const p of xmlpath) cur = cur && cur[p]
  return cur
}

const xmlArray = (xml: any, ...xmlpath: string[]) => {
  const target = xmlNode(xml, ...xmlpath)
  if (!target) return []
  return Array.isArray(target) ? target : [target]
}

/**
 * Extract the message class name from the XML source
 */
const getMessageClassName = (source: string): string => {
  const raw = parser.parse(source)
  const messageClass = xmlNode(raw, "mc:messageClass")
  // Try adtcore:name attribute first, then fall back to parsing from links
  const name = messageClass?.["@_adtcore:name"]
  if (name) return name
  
  // Fallback: try to extract from existing message links
  const linkMatch = source.match(/\/messageclass\/([^/]+)\/messages/i)
  if (linkMatch) return linkMatch[1]
  
  return 'UNKNOWN'
}

const parseMessages = (source: string) => {
  const raw = parser.parse(source)
  const rawMessages = xmlArray(raw, "mc:messageClass", "mc:messages")
  return rawMessages.map(m => {
    const link = xmlArray(m, "atom:link").find(
      l =>
        l["@_rel"] ===
        "http://www.sap.com/adt/relations/messageclasses/messages/longtext"
    )?.[" @_href"]
    
    // Ensure message number is always 3 digits (zero-padded)
    const msgno = String(m["@_mc:msgno"]).padStart(3, '0')
    
    return {
      number: msgno,
      text: decode(m["@_mc:msgtext"]),
      selfexplainatory: m["@_mc:selfexplainatory"],
      link
    }
  })
}

export class MessagesProvider implements CustomTextEditorProvider {
  public static register(context: ExtensionContext) {
    const provider = new MessagesProvider(context)
    return window.registerCustomEditorProvider("abapfs.msagn", provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  }
  constructor(private context: ExtensionContext) { }
  resolveCustomTextEditor(
    document: TextDocument,
    panel: WebviewPanel,
    token: CancellationToken
  ) {
    panel.webview.options = { enableScripts: true, enableCommandUris: true }
    
    // Function to update webview content
    const updateWebview = () => {
      panel.webview.html = this.toHtml(panel.webview, document.getText())
    }
    
    // Initial render
    updateWebview()
    
    // Listen for document changes
    const changeDocumentSubscription = workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview()
      }
    })
    
    // Handle messages from webview
    panel.webview.onDidReceiveMessage(async message => {
      switch (message?.type) {
        case "doc":
          if (message?.url) {
            const client = getClient(document.uri.authority)
            const contents = await client.httpClient.request(message.url)
            window.createWebviewPanel(
              "LONGTEXT",
              "ABAP message long text",
              ViewColumn.Beside
            ).webview.html = contents.body
          }
          break
          
        case "requestEdit":
          // Request from webview to show edit dialog
          if (typeof message.number !== 'undefined' && typeof message.currentText !== 'undefined') {
            const newText = await window.showInputBox({
              prompt: `Edit message ${message.number}`,
              value: message.currentText,
              validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                  return 'Message text cannot be empty'
                }
                if (value.length > 72) {
                  return 'Message text should not exceed 72 characters'
                }
                return null
              }
            })
            
            if (newText && newText !== message.currentText) {
              this.updateMessageText(document, message.number, newText)
            }
          }
          break
          
        case "edit":
          // Handle message text edit (direct from webview - deprecated)
          if (typeof message.number !== 'undefined' && typeof message.text !== 'undefined') {
            this.updateMessageText(document, message.number, message.text)
          }
          break
          
        case "add":
          // Handle adding new message
          this.addNewMessage(document)
          break
          
        case "delete":
          // Handle deleting a message
          if (typeof message.number !== 'undefined') {
            this.deleteMessage(document, message.number)
          }
          break
          
        case "openXml":
          // Open raw XML editor beside the table view
          window.showTextDocument(document, ViewColumn.Beside)
          break
      }
    })
    
    // Clean up on dispose
    panel.onDidDispose(() => {
      changeDocumentSubscription.dispose()
    })
  }
  
  /**
   * Add a new message to the XML document
   */
  private async addNewMessage(document: TextDocument) {
    const docText = document.getText()
    
    // Get existing messages to find the next available number
    const messages = parseMessages(docText)
    const existingNumbers = messages.map(m => parseInt(m.number)).filter(n => !isNaN(n))
    
    // Check if there are any deleted messages - if so, find the first gap or next number after all messages
    const deletedMessagesPattern = /<mc:deletedmessages[^>]*mc:msgno="(\d+)"/g
    const deletedNumbers = new Set<number>()
    let match
    while ((match = deletedMessagesPattern.exec(docText)) !== null) {
      deletedNumbers.add(parseInt(match[1]))
    }
    
    // Find next available number that's not in existing messages or deleted messages
    let nextNumber = 1
    while (existingNumbers.includes(nextNumber) || deletedNumbers.has(nextNumber)) {
      nextNumber++
    }
    
    const paddedNumber = String(nextNumber).padStart(3, '0')
    
    // Ask user for message text
    const messageText = await window.showInputBox({
      prompt: `Enter text for message ${paddedNumber}`,
      placeHolder: 'Message text',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Message text cannot be empty'
        }
        if (value.length > 72) {
          return 'Message text should not exceed 72 characters'
        }
        return null
      }
    })
    
    if (!messageText) {
      return // User cancelled
    }
    
    const text = document.getText()
    
    // Get the message class name dynamically from the document
    const messageClassName = getMessageClassName(text)
    const messageClassNameUpper = messageClassName.toUpperCase()
    const messageClassNameLower = messageClassName.toLowerCase()
    
    // Create the new message XML entry (matching SAP's format with all attributes)
    const newMessageXml = `<mc:messages mc:msgno="${paddedNumber}" mc:msgtext="${messageText}" mc:selfexplainatory="false" mc:documented="false" mc:lastchangedby="" mc:lastmodified="" adtcore:name="">\n` +
      `  <atom:link href="/sap/bc/adt/vit/docu/object_type/NA/object_name/${messageClassNameUpper}${paddedNumber}" rel="http://www.sap.com/adt/relations/longtext" xmlns:atom="http://www.w3.org/2005/Atom"/>\n` +
      `  <atom:link href="/sap/bc/adt/messageclass/${messageClassNameLower}/messages/${paddedNumber}" rel="http://www.sap.com/adt/relations/messageclasses/messages" xmlns:atom="http://www.w3.org/2005/Atom"/>\n` +
      `</mc:messages>\n\n`
    
    let insertPosition: number
    
    // IMPORTANT: New messages must come BEFORE any deletedmessages!
    // SAP expects: <mc:messages>...</mc:messages> then <mc:deletedmessages>...</mc:deletedmessages>
    
    // First, try to find the FIRST <mc:deletedmessages> tag
    const firstDeletedMatch = text.match(/<mc:deletedmessages/)
    
    if (firstDeletedMatch && firstDeletedMatch.index !== undefined) {
      // Insert BEFORE the first deletedmessages tag
      insertPosition = firstDeletedMatch.index
    } else {
      // No deleted messages - try to find the LAST closing </mc:messages> tag
      const messagesPattern = /<\/mc:messages>/g
      let lastMatch
      let match
      while ((match = messagesPattern.exec(text)) !== null) {
        lastMatch = match
      }
      
      if (lastMatch && lastMatch.index !== undefined) {
        // Insert AFTER the last normal message closing tag
        insertPosition = lastMatch.index + lastMatch[0].length
      } else {
        // No messages exist - insert before </mc:messageClass>
        const messageClassClosing = text.indexOf('</mc:messageClass>')
        if (messageClassClosing === -1) {
          window.showErrorMessage('Could not find valid location to insert message in XML')
          return
        }
        insertPosition = messageClassClosing
      }
    }
    
    const updatedText = text.substring(0, insertPosition) + newMessageXml + text.substring(insertPosition)
    
    // Apply the edit
    const fullRange = new Range(
      document.positionAt(0),
      document.positionAt(text.length)
    )
    
    const workspaceEdit = new WorkspaceEdit()
    workspaceEdit.replace(document.uri, fullRange, updatedText)
    await workspace.applyEdit(workspaceEdit)
    
    window.showInformationMessage(`✅ Message ${paddedNumber} added successfully`)
  }
  
  /**
   * Update message text in the XML document
   */
  private async updateMessageText(document: TextDocument, msgNumber: string, newMessageText: string) {
    const text = document.getText()
    
    // Find the message in the XML text using regex
    // Match: mc:msgtext="..." where the message has mc:msgno="XXX" nearby
    const msgPattern = /(mc:msgtext=")([^"]*)(")/g
    
    let replacementCount = 0
    const updatedText = text.replace(msgPattern, (match, prefix, oldText, suffix, offset) => {
      // Get the context before this match to find the message number
      const contextBefore = text.substring(Math.max(0, offset - 200), offset)
      
      // Check if this is the right message number
      if (contextBefore.includes(`mc:msgno="${msgNumber}"`)) {
        replacementCount++
        return `${prefix}${newMessageText}${suffix}`
      }
      return match
    })
    
    if (replacementCount === 0) {
      window.showErrorMessage(`Could not find message ${msgNumber} in XML`)
      return
    }
    
    // Apply the edit
    const fullRange = new Range(
      document.positionAt(0),
      document.positionAt(text.length)
    )
    
    const workspaceEdit = new WorkspaceEdit()
    workspaceEdit.replace(document.uri, fullRange, updatedText)
    await workspace.applyEdit(workspaceEdit)
    
    window.showInformationMessage(`✅ Message ${msgNumber} updated`)
  }
  
  /**
   * Delete a message from the XML document
   */
  private async deleteMessage(document: TextDocument, msgNumber: string) {
    // Confirm deletion
    const confirmation = await window.showWarningMessage(
      `Delete message ${msgNumber}?`,
      { modal: true },
      'Delete'
    )
    
    if (confirmation !== 'Delete') {
      return // User cancelled
    }
    
    const text = document.getText()
    
    // Transform <mc:messages> to <mc:deletedmessages> for SAP deletion
    // Step 1: Replace opening tag
    const openingTagPattern = new RegExp(
      `<mc:messages([^>]*mc:msgno="${msgNumber}"[^>]*)>`,
      'g'
    )
    
    let updatedText = text.replace(openingTagPattern, '<mc:deletedmessages$1>')
    
    if (updatedText === text) {
      window.showErrorMessage(`Could not find message ${msgNumber} in XML`)
      return
    }
    
    // Step 2: Replace the closing tag for this specific message
    // Find the first </mc:messages> after our transformed opening tag
    const openingIndex = updatedText.indexOf('<mc:deletedmessages')
    if (openingIndex !== -1) {
      const afterOpening = updatedText.substring(openingIndex)
      const closingMatch = afterOpening.match(/<\/mc:messages>/)
      
      if (closingMatch && closingMatch.index !== undefined) {
        const closingIndex = openingIndex + closingMatch.index
        updatedText = updatedText.substring(0, closingIndex) + 
                      '</mc:deletedmessages>' + 
                      updatedText.substring(closingIndex + '</mc:messages>'.length)
      }
    }
    
    // Apply the edit
    const fullRange = new Range(
      document.positionAt(0),
      document.positionAt(text.length)
    )
    
    const workspaceEdit = new WorkspaceEdit()
    workspaceEdit.replace(document.uri, fullRange, updatedText)
    await workspace.applyEdit(workspaceEdit)
    
    window.showInformationMessage(`✅ Message ${msgNumber} deleted`)
  }
  
  private toHtml(webview: Webview, source: string) {
    const header = `<tr><th>number</th><th>text</th><th>self explainatory</th><th>actions</th></tr>`
    const messages = parseMessages(source)
    const body = messages
      .map(m => {
        const escapedText = m.text.replace(/'/g, "\\'").replace(/"/g, '&quot;')
        const mainline = m.link
          ? `<a href=${m.link} onclick="send(event,'${m.link}')">${m.text}</a>`
          : `<span class="editable-text" ondblclick="editMessage('${m.number}', '${escapedText}')">${m.text}</span>`
        
        return `<tr data-msg="${m.number}">
          <td class="number">${m.number}</td>
          <td class="message-text">${mainline}</td>
          <td class="flag">${m.selfexplainatory ? "\u2713" : ""}</td>
          <td class="actions">
            <button onclick="editMessage('${m.number}', '${escapedText}')" title="Edit message text">✏️</button>
            <button onclick="deleteMessage('${m.number}')" title="Delete message">🗑️</button>
          </td>
          </tr>`
      })
      .join("\n")

    const styleUri = webview.asWebviewUri(
      Uri.file(
        path.join(this.context.extensionPath, "client/media", "editor.css")
      )
    )

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
    <title>Message Class</title>
    <link href="${styleUri}" rel="stylesheet" />
    <style>
      .editable-text {
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 3px;
      }
      .editable-text:hover {
        background-color: var(--vscode-list-hoverBackground);
      }
      .actions button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 8px;
        cursor: pointer;
        border-radius: 3px;
        font-size: 12px;
      }
      .actions button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .toolbar {
        padding: 10px;
        border-bottom: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
      }
      .toolbar button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 6px 12px;
        cursor: pointer;
        border-radius: 3px;
        margin-right: 8px;
      }
      .toolbar button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      td.message-text {
        max-width: 500px;
      }
    </style>
    <script>
    const vscode = acquireVsCodeApi();
    
    function send(event, url) {
        event.preventDefault();
        vscode.postMessage({type:"doc", url});
    }
    
    function editMessage(msgNumber, currentText) {
        // Send request to VS Code to show input box
        vscode.postMessage({
            type: 'requestEdit',
            number: msgNumber,
            currentText: currentText
        });
    }
    
    function deleteMessage(msgNumber) {
        // Send delete request to VS Code
        vscode.postMessage({
            type: 'delete',
            number: msgNumber
        });
    }
    
    function openXmlEditor() {
        vscode.postMessage({type: 'openXml'});
    }
    
    function addNewMessage() {
        vscode.postMessage({type: 'add'});
    }
    </script></head>
    <body>
    <div class="toolbar">
      <button onclick="addNewMessage()">➕ Add Message</button>
      <button onclick="openXmlEditor()">📝 Open XML Editor</button>
      <span style="color: var(--vscode-descriptionForeground); margin-left: 10px;">
        💡 Double-click message text or use ✏️ button to edit
      </span>
    </div>
    <table><thead>${header}</thead>
    <tbody>${body}</tbody>
    </table></body></html>`
  }
}

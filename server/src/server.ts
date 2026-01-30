import { Methods } from "vscode-abap-remote-fs-sharedapi"
import {
  TextDocuments,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CodeActionKind,
  InitializeResult,
  TextDocumentSyncKind
} from "vscode-languageserver"
import { connection, log } from "./clientManager"
import { syntaxCheck } from "./syntaxcheck"
import { completion } from "./completion"
import { findDefinition, findReferences, cancelSearch } from "./references"
import { documentSymbols } from "./symbols"
import { formatDocument } from "./documentformatter"
import { codeActionHandler } from "./codeActions"
import { updateInclude } from "./objectManager"
import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import { renameHandler } from "./rename"
export const documents = new TextDocuments(TextDocument)

let hasConfigurationCapability: boolean = false
let hasWorkspaceFolderCapability: boolean = false
let hasLiteral: boolean = false

export const ADTSCHEME = "adt"

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities

  // Does the client support the `workspace/configuration` request?
  // If not, we will fall back using global settings
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  )
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  )

  hasLiteral = !!(
    capabilities.textDocument &&
    capabilities.textDocument.codeAction &&
    capabilities.textDocument.codeAction.codeActionLiteralSupport
  )

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      // Tell the client that the server supports code completion
      completionProvider: {
        resolveProvider: true
      },
      definitionProvider: true,
      renameProvider: true,
      implementationProvider: {
        documentSelector: [{ scheme: ADTSCHEME, language: "abap" }]
      },
      referencesProvider: true,
      documentSymbolProvider: true,
      documentFormattingProvider: true
    }
  }

  if (hasLiteral)
    result.capabilities.codeActionProvider = {
      codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorExtract]
    }
  return result
})

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    )
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(event => {
      log("Workspace folder change event received.")
    })
  }
})

connection.onCompletion(completion)
connection.onCompletionResolve((c: CompletionItem) => c)
// Eclipse ADT style: Ctrl+Click goes to implementation first, then declaration
connection.onDefinition(findDefinition.bind(null, true))  // Swapped: now shows implementation
connection.onImplementation(findDefinition.bind(null, false))  // Swapped: now shows declaration
connection.onReferences(findReferences)
connection.onDocumentSymbol(documentSymbols)
connection.onDocumentFormatting(formatDocument)
documents.onDidOpen(e => setTimeout(() => syntaxCheck(e.document), 500))
documents.onDidChangeContent(change => syntaxCheck(change.document))
documents.onDidSave(e => {
  syntaxCheck(e.document)
  // Cross-file syntax refresh for include <-> program relationships
  // Check for "Includes" or "Programs" in the workspace path (case-insensitive, URL-encoded)
  const uri = e.document.uri.toLowerCase()
  const isInclude = uri.includes('/includes/') || uri.includes('%2fincludes%2f')
  const isProgram = !isInclude && (uri.includes('/programs/') || uri.includes('%2fprograms%2f'))
  
  // Delay to ensure SAP has processed the save before checking related files
  setTimeout(() => {
    if (isInclude) {
      // Include saved: re-check all open programs
      for (const doc of documents.all()) {
        const docUri = doc.uri.toLowerCase()
        const docIsProgram = !docUri.includes('/includes/') && !docUri.includes('%2fincludes%2f') &&
                            (docUri.includes('/programs/') || docUri.includes('%2fprograms%2f'))
        if (doc.uri !== e.document.uri && docIsProgram) {
          syntaxCheck(doc)
        }
      }
    } else if (isProgram) {
      // Program saved: re-check all open includes
      for (const doc of documents.all()) {
        const docUri = doc.uri.toLowerCase()
        const docIsInclude = docUri.includes('/includes/') || docUri.includes('%2fincludes%2f')
        if (doc.uri !== e.document.uri && docIsInclude) {
          syntaxCheck(doc)
        }
      }
    }
  }, 2000)
})
connection.onCodeAction(codeActionHandler)
connection.onRenameRequest(renameHandler)
// custom APIs exposed to the client
connection.onRequest(Methods.cancelSearch, cancelSearch)
connection.onRequest(Methods.updateMainProgram, updateInclude)
connection.onRequest(Methods.triggerSyntaxCheck, (uri: string) => {
  const doc = documents.get(uri)
  if (doc) syntaxCheck(doc)
})

documents.listen(connection)
connection.listen()


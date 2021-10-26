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
      codeActionKinds: [CodeActionKind.QuickFix]
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
connection.onDefinition(findDefinition.bind(null, false))
connection.onImplementation(findDefinition.bind(null, true))
connection.onReferences(findReferences)
connection.onDocumentSymbol(documentSymbols)
connection.onDocumentFormatting(formatDocument)
documents.onDidChangeContent(change => syntaxCheck(change.document))
connection.onCodeAction(codeActionHandler)
connection.onRenameRequest(renameHandler)
// custom APIs exposed to the client
connection.onRequest(Methods.cancelSearch, cancelSearch)
connection.onRequest(Methods.updateMainProgram, updateInclude)

documents.listen(connection)
connection.listen()


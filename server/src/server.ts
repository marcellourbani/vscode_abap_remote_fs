import {
  TextDocuments,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem
} from "vscode-languageserver"
import { connection, log } from "./clientManager"
import { syntaxCheck } from "./syntaxcheck"
import { completion } from "./completion"
import { findDefinition, findReferences } from "./references"
import { documentSymbols } from "./symbols"

const documents: TextDocuments = new TextDocuments()

let hasConfigurationCapability: boolean = false
let hasWorkspaceFolderCapability: boolean = false

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

  return {
    capabilities: {
      textDocumentSync: documents.syncKind,
      // Tell the client that the server supports code completion
      completionProvider: {
        resolveProvider: true
      },
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true
    }
  }
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
connection.onDefinition(findDefinition)
connection.onReferences(findReferences)
connection.onDocumentSymbol(documentSymbols)
documents.onDidChangeContent(change => syntaxCheck(change.document))

documents.listen(connection)
connection.listen()

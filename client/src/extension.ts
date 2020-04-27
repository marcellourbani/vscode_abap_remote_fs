import { TransportsProvider } from "./views/transports"
import { FavouritesProvider } from "./views/favourites"
import { FsProvider } from "./fs/FsProvider"
import {
  window,
  commands,
  workspace,
  ExtensionContext,
  languages
} from "vscode"
import {
  activeTextEditorChangedListener,
  documentChangedListener,
  documentClosedListener,
  documentOpenListener,
  documentWillSave
} from "./listeners"
import { log } from "./lib"
import { client, LanguageCommands } from "./langClient"
import { registerRevisionModel } from "./scm/abaprevision"
import { AbapRevisionLensP } from "./scm/abaprevisionlens"
import { IncludeLensP } from "./adt/operations/IncludeLens"
import { ClassHierarchyLensProvider } from "./adt/classhierarchy"
import { registerCommands } from "./commands"
import { abapGitProvider } from "./views/abapgit"
import { loadTokens, clearTokens } from "./oauth"
import { registerAbapGit } from "./scm/abapGit"
import { AbapFsApi, api } from "./api"
import { ADTSCHEME, restoreLocks, disconnect, hasLocks } from "./adt/conections"
export let context: ExtensionContext

export async function activate(ctx: ExtensionContext): Promise<AbapFsApi> {
  context = ctx
  const startTime = new Date().getTime()
  log("activating ABAPfs...")
  loadTokens()
  clearTokens()
  const sub = context.subscriptions
  // register the filesystem type
  sub.push(
    workspace.registerFileSystemProvider(ADTSCHEME, FsProvider.get(), {
      isCaseSensitive: true
    })
  )

  // change document listener, for locking (and possibly validation in future)
  sub.push(workspace.onDidChangeTextDocument(documentChangedListener))
  sub.push(workspace.onWillSaveTextDocument(documentWillSave))
  // opened document listener, for main program
  sub.push(workspace.onDidOpenTextDocument(documentOpenListener))
  // closed document listener, for locking
  sub.push(workspace.onDidCloseTextDocument(documentClosedListener))
  // Editor changed listener, updates context and icons
  sub.push(window.onDidChangeActiveTextEditor(activeTextEditorChangedListener))

  registerRevisionModel(context)

  const fav = FavouritesProvider.get()
  fav.storagePath = context.globalStoragePath
  sub.push(window.registerTreeDataProvider("abapfs.favorites", fav))
  sub.push(
    window.registerTreeDataProvider(
      "abapfs.transports",
      TransportsProvider.get()
    )
  )
  sub.push(window.registerTreeDataProvider("abapfs.abapgit", abapGitProvider))
  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      ClassHierarchyLensProvider.get()
    )
  )
  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      AbapRevisionLensP.get()
    )
  )

  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      IncludeLensP.get()
    )
  )

  LanguageCommands.start(context)

  commands.executeCommand("setContext", "abapfs:extensionActive", true)
  restoreLocks()
  registerAbapGit(context)

  registerCommands(context)
  const elapsed = new Date().getTime() - startTime
  log(`Activated,pid=${process.pid}, activation time(ms):${elapsed}`)
  return api
}

// this method is called when your extension is deactivated
// it's important to kill these sessions as there might be an open process on the abap side
// most commonly because of locked sources.
// Locks will not be released until either explicitly closed or the session is terminates
// an open session can leave sources locked without any UI able to release them (except SM12 and the like)
export async function deactivate() {
  if (hasLocks())
    window.showInformationMessage(
      "Locks will be dropped now. If the relevant editors are still open they will be restored later"
    )
  commands.executeCommand("setContext", "abapfs:extensionActive", false)
  await Promise.all([client && client.stop(), disconnect()])
}

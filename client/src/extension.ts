import { FavouritesProvider } from "./views/favourites"
import { FsProvider } from "./fs/FsProvider"
import { window, commands, workspace, ExtensionContext } from "vscode"
import {
  activeTextEditorChangedListener,
  documentChangedListener,
  documentClosedListener,
  documentOpenListener
} from "./listeners"
import {
  connectAdtServer,
  activateCurrent,
  searchAdtObject,
  createAdtObject,
  executeAbap,
  addFavourite,
  deleteFavourite,
  runAbapUnit
} from "./commands"
import { disconnect, ADTSCHEME, lockedFiles } from "./adt/AdtServer"
import { log } from "./logger"
import { client, startLanguageClient } from "./langClient"
import { restoreLocks } from "./adt/operations/LockManager"
// import { restoreOpenfilePaths } from "./adt/operations/AdtObjectFinder"

export function activate(context: ExtensionContext) {
  const abapFS = new FsProvider()
  const sub = context.subscriptions
  // register the filesystem type
  sub.push(
    workspace.registerFileSystemProvider(ADTSCHEME, abapFS, {
      isCaseSensitive: true
    })
  )

  // change document listener, for locking (and possibly validation in future)
  sub.push(workspace.onDidChangeTextDocument(documentChangedListener))
  // opened document listener, for main program
  sub.push(workspace.onDidOpenTextDocument(documentOpenListener))
  // closed document listener, for locking
  sub.push(workspace.onDidCloseTextDocument(documentClosedListener))
  // Editor changed listener, updates context and icons
  sub.push(window.onDidChangeActiveTextEditor(activeTextEditorChangedListener))

  // connect command
  sub.push(commands.registerCommand("abapfs.connect", connectAdtServer))

  // activate command
  sub.push(commands.registerCommand("abapfs.activate", activateCurrent))

  // search command
  sub.push(commands.registerCommand("abapfs.search", searchAdtObject))

  // create command
  sub.push(commands.registerCommand("abapfs.create", createAdtObject))

  // execute Abap command
  sub.push(commands.registerCommand("abapfs.execute", executeAbap))

  // add favourite
  sub.push(commands.registerCommand("abapfs.addfavourite", addFavourite))

  // delete favourite
  sub.push(commands.registerCommand("abapfs.deletefavourite", deleteFavourite))

  // run unit tests
  sub.push(commands.registerCommand("abapfs.unittest", runAbapUnit))

  const fav = FavouritesProvider.get()
  fav.storagePath = context.globalStoragePath
  sub.push(window.registerTreeDataProvider("abapfs.favorites", fav))

  startLanguageClient(context)

  commands.executeCommand("setContext", "abapfs:extensionActive", true)
  restoreLocks()

  log(`Activated,pid=${process.pid}`)
}

// this method is called when your extension is deactivated
// it's important to kill these sessions as there might be an open process on the abap side
// most commonly because of locked sources.
// Locks will not be released until either explicitly closed or the session is terminates
// an open session can leave sources locked without any UI able to release them (except SM12 and the like)
export async function deactivate() {
  const locks = lockedFiles()

  if (locks.length > 0)
    window.showInformationMessage(
      "Locks will be dropped now. If the relevant editors are still open they will be restored later"
    )
  commands.executeCommand("setContext", "abapfs:extensionActive", false)
  await Promise.all([client && client.stop(), disconnect()])
}

import { workspace, Uri, window, commands, ProgressLocation } from "vscode"
import { fromUri, AdtServer, ADTSCHEME } from "./adt/AdtServer"
import { selectRemote, pickAdtRoot, createClient } from "./config"
import { log } from "./logger"
import { FavouritesProvider, FavItem } from "./views/favourites"
import { uriToNodePath } from "./adt/abap/AbapObjectUtilities"
import { findEditor } from "./langClient"
import { showHideActivate } from "./listeners"
import { abapUnit } from "./adt/operations/UnitTestRunner"

export async function connectAdtServer(selector: any) {
  const connectionID = selector && selector.connection
  const remote = await selectRemote(connectionID)
  if (!remote) return
  const client = createClient(remote)

  log(`Connecting to server ${remote.name}`)

  try {
    await client.login() // if connection raises an exception don't mount any folder

    workspace.updateWorkspaceFolders(0, 0, {
      uri: Uri.parse("adt://" + remote.name),
      name: remote.name + "(ABAP)"
    })

    log(`Connected to server ${remote.name}`)
  } catch (e) {
    window.showErrorMessage(
      `Failed to connect to ${remote.name}:${e.toString()}`
    )
  }
}

export async function activateCurrent(selector: Uri) {
  try {
    const server = fromUri(selector)
    if (!server)
      throw Error("ABAP connection not found for" + uriToNodePath.toString())
    const editor = findEditor(selector.toString())
    await window.withProgress(
      { location: ProgressLocation.Window, title: "Activating..." },
      async () => {
        const obj = await server.findAbapObject(selector)
        // if editor is dirty, save before activate
        if (editor && editor.document.isDirty) {
          await editor.document.save()
          await obj.loadMetadata(server.client)
        } else if (!obj.structure) await obj.loadMetadata(server.client)
        await server.activate(obj)
        if (editor === window.activeTextEditor) {
          await obj.loadMetadata(server.client)
          await showHideActivate(editor, obj)
        }
      }
    )
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}

function openObject(server: AdtServer, uri: string) {
  return window.withProgress(
    { location: ProgressLocation.Window, title: "Opening..." },
    async () => {
      const path = await server.objectFinder.findObjectPath(uri)
      if (path.length === 0) throw new Error("Object not found")
      const nodePath = await server.objectFinder.locateObject(path)
      if (!nodePath) throw new Error("Object not found in workspace")
      if (nodePath) await server.objectFinder.displayNode(nodePath)
      return nodePath
    }
  )
}

export async function searchAdtObject(uri: Uri | undefined) {
  // find the adt relevant namespace roots, and let the user pick one if needed
  const root = await pickAdtRoot(uri)
  if (!root) return
  try {
    const server = fromUri(root.uri)
    if (!server) throw new Error("Fatal error: invalid server connection") // this should NEVER happen!
    const object = await server.objectFinder.findObject()
    if (!object) return // user cancelled
    // found, show progressbar as opening might take a while
    await openObject(server, object.uri)
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}

export async function createAdtObject(uri: Uri | undefined) {
  try {
    // find the adt relevant namespace roots, and let the user pick one if needed
    const root = await pickAdtRoot(uri)
    const server = root && fromUri(root.uri)
    if (!server) return
    const obj = await server.creator.createObject(uri)
    if (!obj) return // user aborted
    log(`Created object ${obj.type} ${obj.name}`)

    const nodePath = await openObject(server, obj.path)
    if (nodePath) {
      server.objectFinder.displayNode(nodePath)
      try {
        await commands.executeCommand(
          "workbench.files.action.refreshFilesExplorer"
        )
        log("workspace refreshed")
      } catch (e) {
        log("error refreshing workspace")
      }
    }
  } catch (e) {
    log("Exception in createAdtObject:", e.stack)
    window.showErrorMessage(e.toString())
  }
}

export async function executeAbap() {
  try {
    log("Execute ABAP")
    if (!window.activeTextEditor) return
    const uri = window.activeTextEditor.document.uri
    const root = await pickAdtRoot(uri)
    await window.withProgress(
      { location: ProgressLocation.Window, title: "Opening SAPGui..." },
      async () => {
        const server = root && fromUri(root.uri)
        if (!server) return
        const object = await server.findAbapObject(uri)
        const cmd = object.getExecutionCommand()
        if (cmd) {
          log("Running " + JSON.stringify(cmd))
          server.sapGui.checkConfig()
          const ticket = await server.getReentranceTicket()
          await server.sapGui.startGui(cmd, ticket)
        }
      }
    )
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}
export async function addFavourite(uri: Uri | undefined) {
  // find the adt relevant namespace roots, and let the user pick one if needed
  if (uri) FavouritesProvider.get().addFavourite(uri)
}

export async function deleteFavourite(node: FavItem) {
  FavouritesProvider.get().deleteFavourite(node)
}

export async function runAbapUnit() {
  try {
    log("Execute ABAP Unit tests")
    if (!window.activeTextEditor) return
    const uri = window.activeTextEditor.document.uri
    if (uri.scheme !== ADTSCHEME) return
    await window.withProgress(
      { location: ProgressLocation.Window, title: "Running ABAP UNIT" },
      () => abapUnit(uri)
    )
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}

import { workspace, Uri, window, commands, ProgressLocation } from "vscode"
import { fromUri, AdtServer, ADTSCHEME } from "./adt/AdtServer"
import { selectMissingRemote, pickAdtRoot, createClient } from "./config"
import { log } from "./logger"
import { FavouritesProvider, FavItem } from "./views/favourites"
import { findEditor } from "./langClient"
import { showHideActivate } from "./listeners"
import { abapUnit } from "./adt/operations/UnitTestRunner"
import { isClassInclude } from "./adt/abap/AbapClassInclude"

export const abapcmds: Array<{
  name: string
  target: (...x: any[]) => any
}> = []

export const command = (name: string) => (target: any, propertyKey: string) => {
  const func = target[propertyKey]
  abapcmds.push({ name, target: func.bind(target) })
}

function currentUri() {
  if (!window.activeTextEditor) return
  const uri = window.activeTextEditor.document.uri
  if (uri.scheme !== ADTSCHEME) return
  return uri
}
function current() {
  const uri = currentUri()
  if (!uri) return
  const server = fromUri(uri)
  if (!server) return
  return { uri, server }
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

export class AdtCommands {
  @command("abapfs.connect")
  private static async connectAdtServer(selector: any) {
    let name = ""
    try {
      const connectionID = selector && selector.connection
      const { remote, userCancel } = await selectMissingRemote(connectionID)
      if (!remote)
        if (!userCancel)
          throw Error("No remote configuration available in settings")
        else return
      name = remote.name
      const client = createClient(remote)

      log(`Connecting to server ${remote.name}`)

      await client.login() // if connection raises an exception don't mount any folder

      workspace.updateWorkspaceFolders(0, 0, {
        uri: Uri.parse("adt://" + remote.name),
        name: remote.name + "(ABAP)"
      })

      log(`Connected to server ${remote.name}`)
    } catch (e) {
      window.showErrorMessage(`Failed to connect to ${name}:${e.toString()}`)
      if (e.response) log(e.response.body)
    }
  }
  @command("abapfs.activate")
  private static async activateCurrent(selector: Uri) {
    try {
      const uri = selector || currentUri()
      const server = fromUri(uri)
      if (!server) throw Error("ABAP connection not found for" + uri.toString())
      const editor = findEditor(uri.toString())
      await window.withProgress(
        { location: ProgressLocation.Window, title: "Activating..." },
        async () => {
          const obj = await server.findAbapObject(uri)
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

  @command("abapfs.search")
  private static async searchAdtObject(uri: Uri | undefined) {
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

  @command("abapfs.create")
  private static async createAdtObject(uri: Uri | undefined) {
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

  @command("abapfs.execute")
  private static async executeAbap() {
    try {
      log("Execute ABAP")
      const uri = currentUri()
      if (!uri) return
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

  @command("abapfs.addfavourite")
  private static addFavourite(uri: Uri | undefined) {
    // find the adt relevant namespace roots, and let the user pick one if needed
    if (uri) FavouritesProvider.get().addFavourite(uri)
  }

  @command("abapfs.deletefavourite")
  private static deleteFavourite(node: FavItem) {
    FavouritesProvider.get().deleteFavourite(node)
  }

  @command("abapfs.unittest")
  private static async runAbapUnit() {
    try {
      log("Execute ABAP Unit tests")
      const uri = currentUri()
      if (!uri) return
      await window.withProgress(
        { location: ProgressLocation.Window, title: "Running ABAP UNIT" },
        () => abapUnit(uri)
      )
    } catch (e) {
      window.showErrorMessage(e.toString())
    }
  }

  @command("abapfs.createtestinclude")
  private static createTestInclude(uri?: Uri) {
    if (uri) {
      if (uri.scheme !== ADTSCHEME) return
      return this.createTI(fromUri(uri), uri)
    }
    const cur = current()
    if (!cur) return
    return this.createTI(cur.server, cur.uri)
  }

  private static async createTI(server: AdtServer, uri: Uri) {
    const obj = await server.findAbapObject(uri)
    // only makes sense for classes
    if (!isClassInclude(obj)) return
    if (!obj.parent) return
    const m = server.lockManager
    let lockId = m.isLocked(obj) && m.getLockId(obj)
    let lock
    if (!lockId) {
      lock = await m.lock(obj)
      lockId = (lock && lock.LOCK_HANDLE) || ""
    }
    if (lockId) server.client.createTestInclude(obj.parent.name, lockId)
    // If I created the lock I remove it. Possible race condition here...
    if (lock) await m.unlock(obj)
    await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
  }
}

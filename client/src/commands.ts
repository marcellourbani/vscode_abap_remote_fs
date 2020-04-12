import { PACKAGE } from "./adt/operations/AdtObjectCreator"
import {
  workspace,
  Uri,
  window,
  commands,
  ProgressLocation,
  ExtensionContext
} from "vscode"
import {
  fromUri,
  AdtServer,
  ADTSCHEME,
  getOrCreateServer
} from "./adt/AdtServer"
import { pickAdtRoot, RemoteManager } from "./config"
import { log } from "./lib"
import { FavouritesProvider, FavItem } from "./views/favourites"
import { findEditor } from "./langClient"
import { showHideActivate } from "./listeners"
import { abapUnit } from "./adt/operations/UnitTestRunner"
import { isClassInclude } from "./adt/abap/AbapClassInclude"
import { selectTransport } from "./adt/AdtTransports"
import { LockManager } from "./adt/operations/LockManager"
import { IncludeLensP } from "./adt/operations/IncludeLens"
import { runInSapGui } from "./adt/sapgui/sapgui"
import { isAbapNode } from "./fs/AbapNode"
import { storeTokens } from "./oauth"
import { showAbapDoc } from "./views/help"

const abapcmds: {
  name: string
  func: (...x: any[]) => any
  target: any
}[] = []

export const command = (name: string) => (target: any, propertyKey: string) => {
  const func = target[propertyKey]
  abapcmds.push({ name, target, func })
}

export const registerCommands = (context: ExtensionContext) => {
  for (const cmd of abapcmds)
    context.subscriptions.push(
      commands.registerCommand(cmd.name, cmd.func.bind(cmd.target))
    )
}

export const AbapFsCommands = {
  connect: "abapfs.connect",
  activate: "abapfs.activate",
  search: "abapfs.search",
  create: "abapfs.create",
  execute: "abapfs.execute",
  unittest: "abapfs.unittest",
  createtestinclude: "abapfs.createtestinclude",
  quickfix: "abapfs.quickfix",
  changeInclude: "abapfs:changeInclude",
  showDocumentation: "abapfs.showdocu",
  showObject: "abapfs.showObject",
  clearPassword: "abapfs.clearPassword",
  addfavourite: "abapfs.addfavourite",
  deletefavourite: "abapfs.deletefavourite",
  // classes
  refreshHierarchy: "abapfs.refreshHierarchy",
  pickObject: "abapfs.pickObject",
  // revisions
  clearScmGroup: "abapfs.clearScmGroup",
  openrevstate: "abapfs.openrevstate",
  opendiff: "abapfs.opendiff",
  opendiffNormalized: "abapfs.opendiffNormalized",
  changequickdiff: "abapfs.changequickdiff",
  remotediff: "abapfs.remotediff",
  comparediff: "abapfs.comparediff",
  // transports
  transportObjectDiff: "abapfs.transportObjectDiff",
  openTransportObject: "abapfs.openTransportObject",
  deleteTransport: "abapfs.deleteTransport",
  refreshtransports: "abapfs.refreshtransports",
  releaseTransport: "abapfs.releaseTransport",
  transportOwner: "abapfs.transportOwner",
  transportAddUser: "abapfs.transportAddUser",
  transportRevision: "abapfs.transportRevision",
  transportUser: "abapfs.transportUser",
  transportCopyNumber: "abapfs.transportCopyNumber",
  transportOpenGui: "abapfs.transportOpenGui",
  // abapgit
  agitRefreshRepos: "abapfs.refreshrepos",
  agitReveal: "abapfs.revealPackage",
  agitOpenRepo: "abapfs.openRepo",
  agitPull: "abapfs.pullRepo",
  agitCreate: "abapfs.createRepo",
  agitUnlink: "abapfs.unlinkRepo",
  agitAddScm: "abapfs.registerSCM",
  agitRefresh: "abapfs.refreshAbapGit",
  agitPullScm: "abapfs.pullAbapGit",
  agitPush: "abapfs.pushAbapGit",
  agitAdd: "abapfs.addAbapGit",
  agitRemove: "abapfs.removeAbapGit",
  agitresetPwd: "abapfs.resetAbapGitPwd",
  agitBranch: "abapfs.switchBranch"
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

export function openObject(server: AdtServer, uri: string) {
  return window.withProgress(
    { location: ProgressLocation.Window, title: "Opening..." },
    async () => {
      const path = await server.objectFinder.findObjectPath(uri)
      if (path.length === 0) throw new Error("Object not found")
      const nodePath = await server.objectFinder.locateObject(path)
      if (!nodePath) throw new Error("Object not found in workspace")
      if (
        isAbapNode(nodePath.node) &&
        nodePath.node.abapObject.type === PACKAGE
      ) {
        await commands.executeCommand(
          "revealInExplorer",
          server.createUri(nodePath.path)
        )
        return // Packages can't be opened perhaps could reveal it
      } else if (nodePath) await server.objectFinder.displayNode(nodePath)
      return nodePath
    }
  )
}

export class AdtCommands {
  @command(AbapFsCommands.showDocumentation)
  private static async showAbapDoc() {
    return showAbapDoc()
  }

  @command(AbapFsCommands.changeInclude)
  private static async changeMain(uri: Uri) {
    const provider = IncludeLensP.get()
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    if (!obj) return
    const main = await provider.selectMain(obj, server.client, uri)
    if (!main) return
    provider.setInclude(uri, main)
  }

  @command(AbapFsCommands.connect)
  private static async connectAdtServer(selector: any) {
    let name = ""
    try {
      const connectionID = selector && selector.connection
      const manager = RemoteManager.get()
      const { remote, userCancel } = await manager.selectConnection(
        connectionID
      )
      if (!remote)
        if (!userCancel)
          throw Error("No remote configuration available in settings")
        else return
      name = remote.name

      log(`Connecting to server ${remote.name}`)
      // this might involve asking for a password...
      await getOrCreateServer(remote.name) // if connection raises an exception don't mount any folder

      await storeTokens()

      workspace.updateWorkspaceFolders(0, 0, {
        uri: Uri.parse("adt://" + remote.name),
        name: remote.name + "(ABAP)"
      })

      log(`Connected to server ${remote.name}`)
    } catch (e) {
      if (e.response) log(e.response.body)
      const isMissing = (e: any) =>
        !!`${e}`.match("name.*org.freedesktop.secrets")
      const message = isMissing(e)
        ? `Password storage not supported. Please install gnome-keyring or add a password to the connection`
        : `Failed to connect to ${name}:${e.toString()}`
      return window.showErrorMessage(message)
    }
  }
  @command(AbapFsCommands.activate)
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
            const saved = await editor.document.save()
            if (saved) await obj.loadMetadata(server.client)
            else return
          } else if (!obj.structure) await obj.loadMetadata(server.client)
          await server.activator.activate(obj, uri)
          if (editor === window.activeTextEditor) {
            await obj.loadMetadata(server.client)
            await showHideActivate(editor)
          }
        }
      )
    } catch (e) {
      return window.showErrorMessage(e.toString())
    }
  }

  @command(AbapFsCommands.search)
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
      return window.showErrorMessage(e.toString())
    }
  }

  @command(AbapFsCommands.create)
  private static async createAdtObject(uri: Uri | undefined) {
    try {
      // find the adt relevant namespace roots, and let the user pick one if needed
      const root = await pickAdtRoot(uri)
      const server = root && fromUri(root.uri)
      if (!server) return
      const obj = await server.creator.createObject(uri)
      if (!obj) return // user aborted
      log(`Created object ${obj.type} ${obj.name}`)

      // if (obj.type === PACKAGE) {
      //   commands.executeCommand("workbench.files.action.refreshFilesExplorer")
      //   return // Packages can't be opened perhaps could reveal it?
      // }
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
      return window.showErrorMessage(e.toString())
    }
  }

  @command(AbapFsCommands.execute)
  private static async executeAbap() {
    try {
      log("Execute ABAP")
      const uri = currentUri()
      if (!uri) return
      const root = await pickAdtRoot(uri)
      const server = root && fromUri(root.uri)
      if (!server) return
      await runInSapGui(server, async () => {
        const object = await server.findAbapObject(uri)
        return object.getExecutionCommand()
      })
    } catch (e) {
      return window.showErrorMessage(e.toString())
    }
  }

  @command(AbapFsCommands.addfavourite)
  private static addFavourite(uri: Uri | undefined) {
    // find the adt relevant namespace roots, and let the user pick one if needed
    if (uri) FavouritesProvider.get().addFavourite(uri)
  }

  @command(AbapFsCommands.deletefavourite)
  private static deleteFavourite(node: FavItem) {
    FavouritesProvider.get().deleteFavourite(node)
  }

  @command(AbapFsCommands.unittest)
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
      return window.showErrorMessage(e.toString())
    }
  }

  @command(AbapFsCommands.createtestinclude)
  private static createTestInclude(uri?: Uri) {
    if (uri) {
      if (uri.scheme !== ADTSCHEME) return
      return this.createTI(fromUri(uri), uri)
    }
    const cur = current()
    if (!cur) return
    return this.createTI(cur.server, cur.uri)
  }

  @command(AbapFsCommands.clearPassword)
  public static async clearPasswordCmd(connectionId?: string) {
    return RemoteManager.get().clearPasswordCmd(connectionId)
  }

  private static async createTI(server: AdtServer, uri: Uri) {
    const obj = await server.findAbapObject(uri)
    // only makes sense for classes
    if (!isClassInclude(obj)) return
    if (!obj.parent) return
    const m = LockManager.get()
    let lockId = m.getLockId(uri)
    let lock
    if (!lockId) {
      lock = await m.lock(uri)
      lockId = (lock && lock.LOCK_HANDLE) || ""
    }
    if (!lockId) {
      throw new Error(`Can't acquire a lock for ${obj.name}`)
    }
    try {
      let created
      // check if I already have one
      if (obj.parent.hasInclude("testclasses")) {
        window.showInformationMessage("Test include already exists")
      } else {
        if (!obj.structure) await obj.loadMetadata(server.client)
        const transport = await selectTransport(
          obj.getContentsUri(),
          "",
          server.client,
          true
        )
        if (transport.cancelled) return
        const parentName = obj.parent.name
        await server.runInSession(client =>
          client.createTestInclude(parentName, lockId, transport.transport)
        )
        created = true
      }
      // If I created the lock I remove it. Possible race condition here...
      if (lock) await m.unlock(uri)
      if (created) {
        if (window.activeTextEditor)
          showHideActivate(window.activeTextEditor, true)
        commands.executeCommand("workbench.files.action.refreshFilesExplorer")
      }
    } catch (e) {
      if (lock) await m.unlock(uri)
      log(e.toString())
      window.showErrorMessage(`Error creating class include`)
    }
  }
}

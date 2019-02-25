import { workspace, Uri, window, commands } from "vscode"
import { fromUri } from "./adt/AdtServer"
import { selectRemote, pickAdtRoot, createClient } from "./config"
import { log } from "./logger"

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
    const obj = await server.findAbapObject(selector)
    if (!obj.structure) await obj.loadMetadata(server.client)
    await server.activate(obj)
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
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
    const path = await server.objectFinder.findObjectPath(object.uri)
    if (path.length === 0) throw new Error("Object not found")
    const nodePath = await server.objectFinder.locateObject(path)
    if (!nodePath) throw new Error("Object not found in workspace")
    if (nodePath) server.objectFinder.displayNode(nodePath)
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
    const path = await server.objectFinder.findObjectPath(obj.path)
    const nodePath = await server.objectFinder.locateObject(path)
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
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}

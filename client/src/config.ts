import { ClientConfiguration } from "vscode-abap-remote-fs-sharedapi"
import { window, workspace, QuickPickItem, WorkspaceFolder, Uri } from "vscode"
import { ADTClient, createSSLConfig } from "abap-adt-api"
import { ADTSCHEME } from "./adt/AdtServer"
import { readFileSync } from "fs"
import { createProxy, MethodCall } from "method-call-logger"
// keytar depends on a native module shipped in vscode
// this loads only the type definitions
import * as keytarType from "keytar"
import { log } from "./logger"
import { Client, ApiResponse } from "@elastic/elasticsearch"

export interface RemoteConfig extends ClientConfiguration {
  sapGui: {
    disabled: boolean
    routerString: string
    // load balancing
    messageServer: string
    messageServerPort: string
    group: string
    // individual server
    server: string
    systemNumber: string
  }
}

export const formatKey = (raw: string) => raw.toLowerCase()
const connectedRoots = () => {
  const rootmap = new Map<string, WorkspaceFolder>()
  const roots = (workspace.workspaceFolders || []).filter(
    r => r.uri.scheme === ADTSCHEME
  )
  for (const r of roots) rootmap.set(formatKey(r.uri.authority), r)
  return rootmap
}

// get the module from vscode. This is not an official API, might break at some point
// this is required because keytar includes a binary we can't include
// see https://github.com/microsoft/vscode/issues/68738
function getCodeModule<T>(moduleName: string): T | undefined {
  // adapted from https://github.com/Microsoft/vscode-pull-request-github/blob/master/src/authentication/keychain.ts
  // I guess we use eval to load the embedded module at runtime
  // rather than allowing webpack to bundle it
  // tslint:disable-next-line: no-eval
  const vscodeRequire = eval("require")
  try {
    return vscodeRequire(moduleName)
  } catch (err) {
    return undefined
  }
}

const config = (name: string, remote: RemoteConfig) => {
  const conf = { url: "", ...remote, name, valid: true }
  conf.valid = !!(remote.url && remote.username && remote.password)
  if (conf.customCA && !conf.customCA.match(/-----BEGIN CERTIFICATE-----/gi))
    try {
      conf.customCA = readFileSync(conf.customCA).toString()
    } catch (e) {
      delete conf.customCA
    }
  return conf
}

async function selectRemoteInt(remotes: RemoteConfig[]) {
  if (remotes.length <= 1) return { remote: remotes[0], userCancel: false }

  const selection = await window.showQuickPick(
    remotes.map(remote => ({
      label: remote.name,
      description: remote.name,
      remote
    })),
    {
      placeHolder: "Please choose an ABAP system"
    }
  )
  return { remote: selection && selection.remote, userCancel: !selection }
}

interface RootItem extends QuickPickItem {
  root: WorkspaceFolder
}

export async function pickAdtRoot(uri?: Uri) {
  const roots = connectedRoots()
  if (roots.size === 0)
    throw new Error("No ABAP filesystem mounted in current workspace")

  if (roots.size === 1) return [...roots.values()][0] // no need to pick if only one root is mounted
  if (uri) {
    const root = roots.get(formatKey(uri.authority))
    if (root) return root
  }

  const item = await window.showQuickPick(
    [...roots.values()].map(root => {
      return { label: root.name, root } as RootItem
    })
  )
  if (item) return item.root
}

export function createClient(conf: RemoteConfig) {
  const sslconf = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  const client = new ADTClient(
    conf.url,
    conf.username,
    conf.password,
    conf.client,
    conf.language,
    sslconf
  )
  let id = 10000000
  const index = `abapfs_${conf.name
    .replace(/[\\\/\*\?\"<>\|\s,#]/g, "_")
    .toLowerCase()}`
  const isFailed = (resp: ApiResponse<any, any>) =>
    !resp.statusCode || resp.statusCode >= 300
  const logAndRethrow = (e: Error) => {
    log(JSON.stringify(e))
    throw e
  }
  const toDocument = (call: MethodCall) => {
    const {
      methodName,
      callType,
      start,
      duration,
      failed,
      resolvedPromise,
      ...callDetails
    } = call
    return {
      methodName,
      callType,
      start,
      duration,
      failed,
      resolvedPromise,
      callDetails
    }
  }
  const elastic = new Client({ node: "http://localhost:9200" })

  const ns = (async () => {
    let res
    const body = {
      mappings: {
        properties: {
          methodName: { type: "keyword" },
          callType: { type: "keyword" },
          start: { type: "long" },
          duration: { type: "long" },
          failed: { type: "boolean" },
          resolvedPromise: { type: "boolean" },
          callDetails: { type: "nested", dynamic: false }
        }
      }
    }
    try {
      res = await elastic.indices.delete({ index })
    } catch (error) {
      log(error.message)
    }
    res = await elastic.indices.exists({ index })
    if (isFailed(res))
      res = await elastic.indices.create({
        index,
        body
      })
    return res
  })()

  const cb = (call: MethodCall) => {
    if (call.resolvedPromise)
      ns.then(async resp => {
        if (isFailed(resp)) log(JSON.stringify(resp))
        try {
          const result = await elastic.create({
            id: `${id++}`,
            index,
            body: toDocument(call)
          })
          log(JSON.stringify(result))
        } catch (error) {
          log(error.message)
        }
      })
  }

  const clone = createProxy(client.statelessClone, cb)

  return createProxy(client, cb, {
    resolvePromises: true,
    getterOverride: new Map([["statelessClone", () => clone]])
  })
}

const failKeytarCheck = () => Error("Error accessing system secure store")
export class RemoteManager {
  private static instance: RemoteManager
  private connections = new Map<string, RemoteConfig>()
  private keytar: typeof keytarType | undefined

  private constructor() {
    this.keytar = getCodeModule<typeof keytarType>("keytar")
  }
  public static get = () =>
    RemoteManager.instance || (RemoteManager.instance = new RemoteManager())
  public byId(connectionId: string): RemoteConfig | undefined {
    connectionId = formatKey(connectionId)
    return this.connections.get(connectionId)
  }

  public async byIdAsync(
    connectionId: string
  ): Promise<RemoteConfig | undefined> {
    connectionId = formatKey(connectionId)
    let conn = this.connections.get(connectionId)
    if (!conn) {
      conn = this.remoteList().find(r => formatKey(r.name) === connectionId)
      if (!conn) return
      if (!conn.password) {
        conn.password = await this.getPassword(connectionId, conn.username)
      }
      this.connections.set(connectionId, conn)
    }
    return conn
  }

  private remoteList(): RemoteConfig[] {
    const userConfig = workspace.getConfiguration("abapfs")
    const remote = userConfig.remote
    if (!remote) throw new Error("No destination configured")
    return Object.keys(remote).map(name =>
      config(name, remote[name] as RemoteConfig)
    )
  }

  public async selectConnection(
    connectionId?: string,
    filter?: boolean | ((r: RemoteConfig) => boolean)
  ) {
    let remotes = this.remoteList()
    if (filter) {
      if (typeof filter === "boolean") {
        const roots = connectedRoots()
        filter = r => !roots.has(formatKey(r.name))
      }
      remotes = remotes.filter(filter)
    }
    let remote
    if (connectionId) {
      connectionId = formatKey(connectionId)
      remote = remotes.find(r => connectionId === formatKey(r.name))
    }
    if (!remote) {
      const selected = await selectRemoteInt(remotes)
      if (selected.userCancel) return selected
      remote = selected.remote
    }
    if (remote && !remote.password)
      remote.password = await this.getPassword(
        formatKey(remote.name),
        remote.username
      )

    return { remote, userCancel: false }
  }

  public async savePassword(
    connectionId: string,
    userName: string,
    password: string
  ) {
    if (!this.keytar) throw failKeytarCheck()
    connectionId = formatKey(connectionId)
    const result = await this.keytar.setPassword(
      `vscode.abapfs.${connectionId}`,
      userName,
      password
    )
    const conn = this.byId(connectionId)
    if (conn) conn.password = password
    return result
  }

  public clearPassword(connectionId: string, userName: string) {
    if (!this.keytar) throw failKeytarCheck()
    return this.keytar.deletePassword(
      `vscode.abapfs.${formatKey(connectionId)}`,
      userName
    )
  }

  public async getPassword(connectionId: string, userName: string) {
    if (!this.keytar) throw failKeytarCheck()
    const key = `vscode.abapfs.${formatKey(connectionId)}`
    const password = await this.keytar.getPassword(key, userName)
    return password || ""
  }

  private async pickConnectionId() {
    const root = await pickAdtRoot()
    if (!root) return
    return formatKey(root.uri.authority)
  }

  public async askPassword(connectionId: string) {
    const conn = this.byId(connectionId)
    if (!conn) return
    const prompt = `Enter password for ${conn.username} on ${connectionId}`
    const password = await window.showInputBox({ prompt, password: true })
    return password
  }

  // @command(AbapFsCommands.clearPassword)
  public async clearPasswordCmd(connectionId?: string) {
    if (!connectionId) {
      const { remote, userCancel } = await this.selectConnection()
      if (userCancel || !remote) return
      connectionId = remote.name
    }
    if (!connectionId) return
    connectionId = formatKey(connectionId)
    const conn = this.remoteList().find(r => connectionId === formatKey(r.name))
    if (!conn) return // no connection found, should never happen
    return this.clearPassword(connectionId, conn.username)
  }
}

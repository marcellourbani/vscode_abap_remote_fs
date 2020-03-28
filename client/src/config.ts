import { Token } from "client-oauth2"
import {
  ClientConfiguration,
  clientTraceUrl,
  httpTraceUrl,
  SOURCE_CLIENT
} from "vscode-abap-remote-fs-sharedapi"
import { window, workspace, QuickPickItem, WorkspaceFolder, Uri } from "vscode"
import { ADTClient, createSSLConfig } from "abap-adt-api"
import { ADTSCHEME } from "./adt/AdtServer"
import { readFileSync } from "fs"
import { createProxy } from "method-call-logger"
import { mongoApiLogger, mongoHttpLogger } from "./helpers/mongoClient"
import { cfCodeGrant, loginServer } from "abap_cloud_platform"
import { delay } from "./helpers/functions"
import { getToken, setToken } from "./grantManager"
import { PasswordVault } from "./helpers/externalmodules"
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

function loggedProxy(client: ADTClient, conf: RemoteConfig) {
  if (!clientTraceUrl(conf)) return client
  const logger = mongoApiLogger(conf.name, SOURCE_CLIENT, false)
  const cloneLogger = mongoApiLogger(conf.name, SOURCE_CLIENT, true)
  if (!(logger && cloneLogger)) return client

  const clone = createProxy(client.statelessClone, cloneLogger)

  return createProxy(client, logger, {
    resolvePromises: true,
    getterOverride: new Map([["statelessClone", () => clone]])
  })
}
const httpLogger = (conf: RemoteConfig) => {
  const mongoUrl = httpTraceUrl(conf)
  if (!mongoUrl) return undefined
  return mongoHttpLogger(conf.name, SOURCE_CLIENT)
}

const pendingGrants = new Map<string, Promise<Token>>()
export const futureToken = async (connId: string) => {
  const oldGrant = getToken(connId)
  if (oldGrant) return oldGrant.accessToken
  const pending = pendingGrants.get(connId)
  if (pending) return pending.then(t => t.accessToken)
}
function createOauthLogin(conf: RemoteConfig) {
  if (!conf.oauth) return
  const { clientId, clientSecret, loginUrl } = conf.oauth
  return async () => {
    const connId = formatKey(conf.name)
    const oldGrant = getToken(connId)
    if (oldGrant) return Promise.resolve(oldGrant.accessToken)

    const server = loginServer()
    const grant = cfCodeGrant(loginUrl, clientId, clientSecret, server)
    const timeout = delay(60000).then(() => {
      server.server.close()
      throw new Error("User logon timed out")
    })
    const pendingGrant = Promise.race([grant, timeout])
    pendingGrants.set(formatKey(connId), pendingGrant)
    const result = await pendingGrant
    if (result) setToken(connId, result)
    pendingGrants.delete(formatKey(connId))
    return result.accessToken
  }
}

export function createClient(conf: RemoteConfig) {
  const sslconf = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  sslconf.debugCallback = httpLogger(conf)
  const password = createOauthLogin(conf) || conf.password
  const client = new ADTClient(
    conf.url,
    conf.username,
    password,
    conf.client,
    conf.language,
    sslconf
  )
  return loggedProxy(client, conf)
}

export class RemoteManager {
  private static instance: RemoteManager
  private connections = new Map<string, RemoteConfig>()
  private vault: PasswordVault

  private constructor() {
    this.vault = new PasswordVault()
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
    connectionId = formatKey(connectionId)
    const result = await this.vault.setPassword(
      `vscode.abapfs.${connectionId}`,
      userName,
      password
    )
    const conn = this.byId(connectionId)
    if (conn) conn.password = password
    return result
  }

  public clearPassword(connectionId: string, userName: string) {
    return this.vault.deletePassword(
      `vscode.abapfs.${formatKey(connectionId)}`,
      userName
    )
  }

  public async getPassword(connectionId: string, userName: string) {
    const key = `vscode.abapfs.${formatKey(connectionId)}`
    const password = await this.vault.getPassword(key, userName)
    return password || ""
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

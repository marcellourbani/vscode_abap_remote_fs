import {
  ClientConfiguration,
  clientTraceUrl,
  httpTraceUrl,
  SOURCE_CLIENT
} from "vscode-abap-remote-fs-sharedapi"
import { window, workspace, QuickPickItem, WorkspaceFolder, Uri, ConfigurationTarget } from "vscode"
import { ADTClient, createSSLConfig } from "abap-adt-api"
import { readFileSync } from "fs"
import { createProxy } from "method-call-logger"
import { mongoApiLogger, mongoHttpLogger, PasswordVault } from "./lib"
import { oauthLogin } from "./oauth"
import { ADTSCHEME } from "./adt/conections"

const CONFIGROOT = "abapfs"
const REMOTE = "remote"

export interface RemoteConfig extends ClientConfiguration {
  sapGui?: {
    disabled: boolean
    routerString: string
    // load balancing
    messageServer: string
    messageServerPort: string
    group: string
    // individual server
    server: string
    systemNumber: string
    useWebGui: "VSCODE" | "Browser"
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

const targetRemotes = (target: ConfigurationTarget) => {
  const remotes = workspace.getConfiguration(CONFIGROOT).inspect(REMOTE)
  const select = () => {
    switch (target) {
      case ConfigurationTarget.Global:
        return remotes?.globalValue || {}
      case ConfigurationTarget.Workspace:
        return remotes?.workspaceValue || {}
      case ConfigurationTarget.WorkspaceFolder:
        return remotes?.workspaceFolderValue || {}
    }
  }
  return select() as Record<"string", RemoteConfig>
}
export const validateNewConfigId = (target: ConfigurationTarget) => {
  const remotes = workspace.getConfiguration(CONFIGROOT)?.[REMOTE] || {}
  const keys = Object.keys(targetRemotes(target)).map(formatKey)
  return (key: string) => {
    if (key.length < 3) return "Connection name must be at least 3 characters long"
    if (!key.match(/^[\w\d-_]+$/i)) return "Unexpected character. Only letters, numbers, - and _ are allowed"
    if (keys.find(k => k === formatKey(key))) return "Key already in use"
  }
}

export const saveNewRemote = async (cfg: ClientConfiguration, target: ConfigurationTarget) => {
  const validation = validateNewConfigId(target)(cfg.name)
  if (validation) throw new Error(validation)
  const currentConfig = workspace.getConfiguration(CONFIGROOT)
  const remotes = { ...targetRemotes(target), [cfg.name]: cfg }
  return currentConfig.update(REMOTE, remotes, target)
}

const config = (name: string, remote: RemoteConfig) => {
  const conf = { ...remote, name, valid: true }
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
      placeHolder: "Please choose an ABAP system",
      ignoreFocusOut: true
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
    }),
    { ignoreFocusOut: true }
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

export function createClient(conf: RemoteConfig) {
  const sslconf = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  sslconf.debugCallback = httpLogger(conf)
  const password = oauthLogin(conf) || conf.password
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
      conn.name = connectionId
      this.connections.set(connectionId, conn)
    }
    return conn
  }

  private remoteList(): RemoteConfig[] {
    const userConfig = workspace.getConfiguration(CONFIGROOT)
    const remote = userConfig[REMOTE]
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
    const password = await window.showInputBox({
      prompt,
      password: true,
      ignoreFocusOut: true
    })
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
    return this.clearPassword(
      connectionId,
      conn.oauth?.clientId || conn.username
    )
  }
}

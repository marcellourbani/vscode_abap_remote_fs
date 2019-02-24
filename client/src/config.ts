import { ClientConfiguration } from "../sharedtypes"
import { window, workspace, QuickPickItem, WorkspaceFolder, Uri } from "vscode"
import { ADTClient, createSSLConfig } from "abap-adt-api"
import { ADTSCHEME } from "./adt/AdtServer"
import { readFileSync } from "fs"

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

export function getRemoteList(): RemoteConfig[] {
  const userConfig = workspace.getConfiguration("abapfs")
  const remote = userConfig.remote
  if (!remote) throw new Error("No destination configured")
  return Object.keys(remote).map(name =>
    config(name, remote[name] as RemoteConfig)
  )
}
export async function selectRemote(
  connection: string
): Promise<RemoteConfig | undefined> {
  let remotes = getRemoteList()
  if (!remotes) throw new Error("No ABAP system configured yet")
  const wsf = (workspace.workspaceFolders || []).reduce(
    (acc, curr: WorkspaceFolder) => {
      acc.add(curr.uri.authority)
      return acc
    },
    new Set<string>()
  )
  remotes = remotes.filter(r => !wsf.has(r.name.toLowerCase()))
  const found = connection && remotes.find(x => x.name === connection)

  if (found) return found
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
  if (selection) return selection.remote
}

interface RootItem extends QuickPickItem {
  root: WorkspaceFolder
}
export async function pickAdtRoot(uri?: Uri) {
  const roots = (
    (workspace.workspaceFolders && workspace.workspaceFolders) ||
    []
  ).filter(r => r.uri.scheme === ADTSCHEME)
  if (roots.length === 0)
    throw new Error("No ABAP filesystem mounted in current workspace")

  if (roots.length === 1) return roots[0] // no need to pick if only one root is mounted
  if (uri) {
    const root = roots.find(r => r.uri.authority === uri.authority)
    if (root) return root
  }

  const item = await window.showQuickPick(
    roots.map(root => {
      return { label: root.name, root } as RootItem
    })
  )
  if (item) return item.root
}

export function createClient(conf: RemoteConfig) {
  const sslconf = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  return new ADTClient(
    conf.url,
    conf.username,
    conf.password,
    conf.client,
    conf.language,
    sslconf
  )
}

export function configFromId(connectionId: string) {
  return getRemoteList().filter(
    cfg => cfg.name.toLowerCase() === connectionId.toLowerCase()
  )[0]
}

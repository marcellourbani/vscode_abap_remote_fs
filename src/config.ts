import * as vscode from "vscode"
export interface RemoteConfig {
  name: string
  url: string
  username: string
  password: string
}

const config = (name: string, remote: RemoteConfig) => {
  const conf = { url: "", ...remote, name, valid: true }
  conf.valid = !!(remote.url && remote.username && remote.password)
  return conf
}

export function getRemoteList(): RemoteConfig[] {
  const userConfig = vscode.workspace.getConfiguration("abapfs")
  const remote = userConfig.remote
  if (!remote) throw new Error("No destination configured")
  return Object.keys(remote).map(name =>
    config(name, remote[name] as RemoteConfig)
  )
}

import * as vscode from "vscode"

const config = (name: string, remote: any) => {
  const conf = { url: "", ...remote, name, valid: true }
  conf.valid = !!(remote.url && remote.username && remote.password)
  return conf
}

export function getRemoteList() {
  const userConfig = vscode.workspace.getConfiguration("abapfs")
  const remote = userConfig.remote
  return Object.keys(remote).map(name => config(name, remote[name]))
}

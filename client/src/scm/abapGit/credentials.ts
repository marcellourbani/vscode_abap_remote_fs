import { ScmData } from "./scm"
import { getServer } from "../../adt/AdtServer"
import { window, Memento } from "vscode"
import { PasswordVault, createStore } from "../../lib"
import { none, some } from "fp-ts/lib/Option"
import { context } from "../../extension"

let uStore: Memento
const getUserStore = () => {
  if (!uStore) uStore = createStore("abapGitRepoUsers", context.globalState)
  return uStore
}
const getDefaultUser = (data: ScmData) =>
  data.credentials?.user || getUserStore().get(data.repo.url)

const setDefaultUser = (data: ScmData, user: string) =>
  getUserStore().update(data.repo.url, user)

const pwdService = (gitScm: ScmData) => `vscode.abapgit${gitScm.repo.url}`
export async function repoCredentials(data: ScmData) {
  if (!data.credentials || !data.loaded) {
    const server = getServer(data.connId)
    const info = await server.client.gitExternalRepoInfo(data.repo.url)
    if (info.access_mode === "PUBLIC") data.credentials = data.credentials || {}
    else {
      const user = await window.showInputBox({
        placeHolder: `username for ${data.repo.url}`,
        value: getDefaultUser(data)
      })
      if (!user) return none
      setDefaultUser(data, user)
      const vault = new PasswordVault()
      let oldPass = ""
      if (!data.credentials?.password)
        oldPass = (await vault.getPassword(pwdService(data), user)) || ""
      const password = await window.showInputBox({
        password: true,
        placeHolder: "Password",
        value: oldPass || data.credentials?.password
      })
      if (!password) return none
      data.credentials = { user, password }
      if (password !== oldPass)
        vault.setPassword(pwdService(data), user, password)
    }
  }

  return some(data.credentials)
}

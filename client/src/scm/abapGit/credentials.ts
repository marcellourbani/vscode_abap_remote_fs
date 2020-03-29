import { ScmData } from "./scm"
import { getServer } from "../../adt/AdtServer"
import { window, Memento } from "vscode"
import { PasswordVault, createStore } from "../../lib"
import { none, some } from "fp-ts/lib/Option"
import { context } from "../../extension"
import { ADTClient } from "abap-adt-api"

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
const isPrivate = async (data: ScmData, client: ADTClient) =>
  client
    .gitExternalRepoInfo(data.repo.url)
    .then(i => i.access_mode === "PRIVATE")

export async function repoCredentials(data: ScmData, forPush = false) {
  if (!data.credentials || !data.credentials?.password) {
    const server = getServer(data.connId)
    const defUser = getDefaultUser(data)
    if (forPush || (await isPrivate(data, server.client))) {
      const vault = new PasswordVault()
      let oldPass = ""
      if (defUser)
        oldPass = (await vault.getPassword(pwdService(data), defUser)) || ""
      if (defUser && oldPass)
        data.credentials = { user: defUser, password: oldPass }
      else {
        const user = await window.showInputBox({
          placeHolder: `username for ${data.repo.url}`,
          value: defUser
        })
        if (!user) return none
        setDefaultUser(data, user)

        oldPass = (await vault.getPassword(pwdService(data), user)) || ""
        const password = await window.showInputBox({
          password: true,
          placeHolder: "Password",
          value: oldPass
        })
        if (!password) return none
        data.credentials = { user, password }
        if (password !== oldPass)
          vault.setPassword(pwdService(data), user, password)
      }
    } else data.credentials = { user: defUser }
  }

  return some(data.credentials)
}

export const deletePassword = (data: ScmData) => {
  if (!data.credentials?.user) return
  const vault = new PasswordVault()
  return vault.deletePassword(pwdService(data), data.credentials.user)
}

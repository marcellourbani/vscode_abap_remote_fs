import { ScmData } from "./scm"
import { getServer } from "../../adt/AdtServer"
import { window } from "vscode"
import { PasswordVault } from "../../lib"

const pwdService = (gitScm: ScmData) => `vscode.abapgit${gitScm.repo.url}`
export async function repoCredentials(gitScm: ScmData) {
  if (!gitScm.credentials || !gitScm.loaded) {
    const server = getServer(gitScm.connId)
    const info = await server.client.gitExternalRepoInfo(gitScm.repo.url)
    if (info.access_mode === "PUBLIC")
      gitScm.credentials = gitScm.credentials || {}
    else {
      const user = await window.showInputBox({
        placeHolder: `username for ${gitScm.repo.url}`,
        value: gitScm.credentials?.user
      })
      if (!user) return {}
      const vault = new PasswordVault()
      let oldPass = ""
      if (!gitScm.credentials?.password)
        oldPass = (await vault.getPassword(pwdService(gitScm), user)) || ""
      const password = await window.showInputBox({
        password: true,
        placeHolder: "Password",
        value: oldPass || gitScm.credentials?.password
      })
      if (!password) return {}
      gitScm.credentials = { user, password }
      if (password !== oldPass)
        vault.setPassword(pwdService(gitScm), user, password)
    }
  }

  return gitScm.credentials
}

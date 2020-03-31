import { ScmData, ScmCredentials } from "./scm"
import { getServer } from "../../adt/AdtServer"
import { window, Memento } from "vscode"
import {
  PasswordVault,
  createStore,
  chainTaskTransformers,
  fieldReplacer,
  createTaskTransformer,
  inputBox
} from "../../lib"
import { none, some, fromEither, Option, isSome } from "fp-ts/lib/Option"
import { context } from "../../extension"
import { ADTClient, GitRepo } from "abap-adt-api"

let uStore: Memento
const getUserStore = () => {
  if (!uStore) uStore = createStore("abapGitRepoUsers", context.globalState)
  return uStore
}
export const getDefaultUser = (repoUrl: string) =>
  `${getUserStore().get(repoUrl) || ""}`

const setDefaultUser = (repoUrl: string) => (cred: ScmCredentials) => {
  getUserStore().update(repoUrl, cred.user)
  return cred
}

const pwdService = (repoUrl: string) => `vscode.abapgit${repoUrl}`
const isPrivate = async (data: ScmData, client: ADTClient) =>
  client
    .gitExternalRepoInfo(data.repo.url)
    .then(i => i.access_mode === "PRIVATE")

const validateInput = (x: string) => (x ? null : "Field is mandatory")
const mandInbox = (prompt: string) => inputBox({ prompt, validateInput })

export async function repoCredentials(repoUrl: string) {
  const cred: ScmCredentials = { user: getDefaultUser(repoUrl), password: "" }
  const vault = new PasswordVault()
  const pwdFromVault = async (x: ScmCredentials) => {
    if (x.user)
      x.password = (await vault.getPassword(pwdService(repoUrl), x.user)) || ""
    return x
  }
  const savePwd = (x: ScmCredentials) => {
    vault.setPassword(pwdService(repoUrl), x.user, x.password)
    return x
  }
  const getUser = mandInbox(`Username for ${repoUrl}`)
  const getPassword = mandInbox(`Password for ${repoUrl}`)
  const task = chainTaskTransformers<ScmCredentials>(
    fieldReplacer("user", getUser, x => !x.user),
    createTaskTransformer(setDefaultUser(repoUrl)),
    createTaskTransformer(pwdFromVault),
    fieldReplacer("password", getPassword, x => !x.password),
    createTaskTransformer(savePwd)
  )(cred)

  return fromEither(await task())
}

export async function dataCredentials(
  data: ScmData,
  forPush = false
): Promise<Option<ScmCredentials>> {
  if (!data.credentials || !data.credentials?.password) {
    const server = getServer(data.connId)
    if (forPush || (await isPrivate(data, server.client))) {
      const cred = await repoCredentials(data.repo.url)
      if (isSome(cred)) data.credentials = cred.value
      return cred
    } else
      data.credentials = { user: getDefaultUser(data.repo.url), password: "" }
  }

  return some(data.credentials)
}

export const deletePassword = (data: ScmData) => {
  if (!data.credentials?.user) return
  const vault = new PasswordVault()
  return vault.deletePassword(pwdService(data.repo.url), data.credentials.user)
}

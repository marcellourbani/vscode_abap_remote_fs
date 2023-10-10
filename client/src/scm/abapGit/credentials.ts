import { ScmData, ScmCredentials } from "./scm"
import { Memento } from "vscode"
import {
  PasswordVault,
  createStore,
  chainTaskTransformers,
  fieldReplacer,
  createTaskTransformer,
  inputBox
} from "../../lib"
import { some, fromEither, Option, isSome } from "fp-ts/lib/Option"
import { context } from "../../extension"
import { ADTClient, GitRepo } from "abap-adt-api"
import { getClient } from "../../adt/conections"

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

export const deleteDefaultUser = (repoUrl: string) => getUserStore().update(repoUrl, "")

const pwdService = (repoUrl: string) => `vscode.abapgit${repoUrl}`
const isPrivate = async (data: ScmData, client: ADTClient) =>
  client
    .gitExternalRepoInfo(data.repo.url)
    .then(i => i.access_mode === "PRIVATE")

const validateInput = (x: string) => (x ? null : "Field is mandatory")
const mandInbox = (prompt: string, password = false) =>
  inputBox({ prompt, validateInput, password })

export async function repoCredentials(repoUrl: string) {
  const cred: ScmCredentials = { user: getDefaultUser(repoUrl), password: "" }
  const vault = PasswordVault.get()
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
  const getPassword = mandInbox(`Password for ${repoUrl}`, true)
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
    const client = getClient(data.connId)
    if (forPush || (await isPrivate(data, client))) {
      const cred = await repoCredentials(data.repo.url)
      if (isSome(cred)) data.credentials = cred.value
      return cred
    } else
      data.credentials = { user: getDefaultUser(data.repo.url), password: "" }
  }

  return some(data.credentials)
}

export const deletePassword = (repo: GitRepo, user: string) => {
  const vault = PasswordVault.get()
  return vault.deletePassword(pwdService(repo.url), user)
}

export const listPasswords = (repo: GitRepo) => {
  const vault = PasswordVault.get()
  return vault.accounts(pwdService(repo.url))
}

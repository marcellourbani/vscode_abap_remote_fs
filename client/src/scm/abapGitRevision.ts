import {
  cache,
  Cache,
  btoa,
  atob,
  mapGet,
  ArrayToMap
} from "../helpers/functions"
import { GitRepo, GitStagingObject, ADTClient } from "abap-adt-api"
import {
  scm,
  SourceControl,
  SourceControlResourceGroup,
  SourceControlResourceState,
  Uri,
  Command,
  TextDocumentContentProvider,
  workspace,
  window,
  ExtensionContext,
  Memento
} from "vscode"
import { GitStagingFile } from "abap-adt-api/build/api"
import { getServer, getOrCreateServer } from "../adt/AdtServer"
import { AbapFsCommands, command } from "../commands"
import { link } from "fs"
import { PasswordVault } from "../helpers/externalmodules"

const GITSCHEME = "ABAPGIT"
const STAGED = "staged"
const UNSTAGED = "unstaged"
const IGNORED = "ignored"
const REPOSSTORAGEKEY = "abapGitRepos"

interface AbapGitScm {
  scm: SourceControl
  connId: string
  repo: GitRepo
  groups: Cache<string, SourceControlResourceGroup>
  loaded: boolean
  credentials?: { user?: string; password?: string }
}

interface StoredRepo {
  connId: string
  repoKey: string
  user?: string
}

const scmKey = (connId: string, repoKey: string) =>
  `abapGit_${connId}_${repoKey}`

const createScm = (connId: string, repo: GitRepo): AbapGitScm => {
  const gscm = scm.createSourceControl(
    `abapGit_${connId}_${repo.sapPackage}`,
    `abapGit ${connId} ${repo.sapPackage}`
  )
  gscm.inputBox.placeholder = `Message ${repo.branch_name}`
  const groups = cache((groupKey: string) => {
    const group = gscm.createResourceGroup(groupKey, groupKey)
    group.hideWhenEmpty = true
    return group
  })
  const loaded = false
  const rec: AbapGitScm = { scm: gscm, connId, repo, groups, loaded }
  rec.scm.statusBarCommands = [
    {
      command: AbapFsCommands.agitRefresh,
      arguments: [rec],
      title: "refresh"
    }
  ]
  return rec
}

const scms = new Map<string, AbapGitScm>()

const gitUrl = (
  connId: string,
  repo: GitRepo,
  path: string,
  file: GitStagingFile
) => {
  const query = btoa(JSON.stringify({ key: repo.key, path }))
  return Uri.parse(`${GITSCHEME}://${connId}${file.path}${file.name}?${query}`)
}

const resourceState = (
  connId: string,
  repo: GitRepo,
  file: GitStagingFile
): SourceControlResourceState => {
  const resourceUri = Uri.parse(`${file.path}${file.name}`)
  const local = file.links.find(l => l.rel.match(/localversion/))
  const remote = file.links.find(l => l.rel.match(/remoteversion/))
  let cmd: Command | undefined
  if (remote && local)
    cmd = {
      title: "Show changes",
      command: "vscode.diff",
      arguments: [
        gitUrl(connId, repo, remote.href, file),
        gitUrl(connId, repo, local.href, file),
        `abapGit#${repo.sapPackage} ${file.name} ↔ Local changes`
      ]
    }
  const state = { resourceUri, command: cmd }
  return state
}
const pwdService = (gitScm: AbapGitScm) => `vscode.abapgit${gitScm.repo.url}`
async function repoCredentials(gitScm: AbapGitScm) {
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

async function refresh(gitScm: AbapGitScm) {
  const server = getServer(gitScm.connId)
  const { user, password } = await repoCredentials(gitScm)
  const staging = await server.client.stageRepo(gitScm.repo, user, password)
  const mapState = (key: string, objs: GitStagingObject[]) => {
    const group = gitScm.groups.get(key)
    const state: SourceControlResourceState[] = []
    for (const obj of objs)
      for (const file of obj.abapGitFiles)
        state.push(resourceState(gitScm.connId, gitScm.repo, file))
    group.resourceStates = state
  }
  mapState(STAGED, staging.staged)
  mapState(UNSTAGED, staging.unstaged)
  mapState(IGNORED, staging.ignored)
  gitScm.loaded = true
}

class GitDocProvider implements TextDocumentContentProvider {
  async provideTextDocumentContent(uri: Uri) {
    if (uri.scheme !== GITSCHEME)
      throw new Error(`Unexpected URI scheme ${uri.scheme}`)
    const { key = "", path = "" } = JSON.parse(atob(uri.query))

    const gitScm = scms.get(scmKey(uri.authority, key))
    if (!key || !path || !gitScm) throw new Error(`Invalid URL`)
    const server = getServer(uri.authority)
    if (!server) throw new Error(`No active connection for ${uri.authority}`)
    const { user, password } = gitScm.credentials || {}
    return server.client.getObjectSource(path, user, password)
  }

  @command(AbapFsCommands.agitRefresh)
  private static async refresh(gitScm: AbapGitScm) {
    if (gitScm) return refresh(gitScm)
    else for (const grepo of scms.values()) await refresh(grepo)
  }
}

const connRepos = async (connId: string) =>
  getOrCreateServer(connId).then(server =>
    server.client.gitRepos().then(ArrayToMap("key"))
  )

const loadRepos = async (stored: StoredRepo[]) => {
  const repos = new Map<string, Promise<Map<string, GitRepo>>>()
  for (const s of stored) {
    const repM = await mapGet(repos, s.connId, async () => connRepos(s.connId))
    const repo = repM.get(s.repoKey)
    if (repo) {
      const gr = await addRepo(s.connId, repo)
      if (s.user) gr.credentials = { user: s.user }
    }
  }
}

const saveRepos = () => {
  if (storage) {
    return storage.update(
      REPOSSTORAGEKEY,
      [...scms.values()].map(
        (s): StoredRepo => ({
          connId: s.connId,
          repoKey: s.repo.key,
          user: s.credentials?.user
        })
      )
    )
  }
}
workspace.registerTextDocumentContentProvider(GITSCHEME, new GitDocProvider())

let storage: Memento

export async function addRepo(connId: string, repo: GitRepo, update = false) {
  const gitScm = mapGet(scms, scmKey(connId, repo.key), () =>
    createScm(connId, repo)
  )
  gitScm.groups.get(STAGED)
  gitScm.groups.get(UNSTAGED)
  gitScm.groups.get(IGNORED)
  if (update && !gitScm.loaded) await refresh(gitScm).then(saveRepos)
  return gitScm
}

export async function registerAbapGit(context: ExtensionContext) {
  storage = context.workspaceState
  loadRepos(storage.get(REPOSSTORAGEKEY, []))
}

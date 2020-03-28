import { cache, Cache, btoa, atob } from "./../helpers/functions"
import { GitRepo, GitStagingObject } from "abap-adt-api"
import {
  scm,
  SourceControl,
  SourceControlResourceGroup,
  SourceControlResourceState,
  Uri,
  Command,
  TextDocumentContentProvider,
  workspace
} from "vscode"
import { GitStagingFile } from "abap-adt-api/build/api"
import { getServer } from "../adt/AdtServer"
import { AbapFsCommands, command } from "../commands"

const GITSCHEME = "ABAPGIT"
const STAGED = "staged"
const UNSTAGED = "unstaged"
const IGNORED = "ignored"

interface GitScmKey {
  connId: string
  repo: GitRepo
}
interface AbapGitScm {
  scm: SourceControl
  connId: string
  repo: GitRepo
  groups: Cache<string, SourceControlResourceGroup>
  loaded: boolean
}
const createScmKey = (connId: string, repo: GitRepo): GitScmKey => ({
  connId,
  repo
})
const formatScmKey = (key: GitScmKey) => `abapGit_${key.connId}_${key.repo.key}`

const createScm = (key: GitScmKey): AbapGitScm => {
  const { connId, repo } = key
  const gscm = scm.createSourceControl(
    `abapGit_${key.connId}`,
    `abapGit ${key.repo.sapPackage}`
  )
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

const scms = cache(createScm, formatScmKey)
const gitUrl = (connId: string, path: string, file: GitStagingFile) =>
  Uri.parse(`${GITSCHEME}://${connId}${file.path}${file.name}?${btoa(path)}`)

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
        gitUrl(connId, remote.href, file),
        gitUrl(connId, local.href, file),
        `abapGit#${repo.sapPackage} ${file.name} ↔ Local changes`
      ]
    }
  const state = { resourceUri, command: cmd }
  return state
}

async function refresh(gitScm: AbapGitScm) {
  const server = getServer(gitScm.connId)
  // user, pwd?
  const staging = await server.client.stageRepo(gitScm.repo)
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
    const server = getServer(uri.authority)
    if (!server) throw new Error(`No active connection for ${uri.authority}`)
    const path = atob(uri.query)
    return server.client.getObjectSource(path)
  }

  @command(AbapFsCommands.agitRefresh)
  private static refresh(gitScm: AbapGitScm) {
    return refresh(gitScm)
  }
}

workspace.registerTextDocumentContentProvider(GITSCHEME, new GitDocProvider())

export function addRepo(connId: string, repo: GitRepo, update = false) {
  const gitScm = scms.get(createScmKey(connId, repo))
  gitScm.groups.get(STAGED)
  gitScm.groups.get(UNSTAGED)
  gitScm.groups.get(IGNORED)
  if (update && !gitScm.loaded) return refresh(gitScm)
}

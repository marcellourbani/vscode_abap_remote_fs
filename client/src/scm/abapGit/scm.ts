import {
  SourceControl,
  SourceControlResourceGroup,
  SourceControlResourceState,
  Uri,
  Command,
  Memento,
  scm,
  ExtensionContext
} from "vscode"
import { GitRepo, GitStagingObject, GitStagingFile } from "abap-adt-api"
import { Cache, mapGet, cache, ArrayToMap } from "../../lib"
import { getServer, getOrCreateServer } from "../../adt/AdtServer"
import { repoCredentials } from "./credentials"
import { gitUrl } from "./documentProvider"
import { AbapFsCommands, command } from "../../commands"

const STAGED = "staged"
const UNSTAGED = "unstaged"
const IGNORED = "ignored"
const REPOSSTORAGEKEY = "abapGitRepos"

export interface ScmData {
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
const scms = new Map<string, ScmData>()

export const scmKey = (connId: string, repoKey: string) =>
  `abapGit_${connId}_${repoKey}`

export const scmData = (key: string) => scms.get(key)

const resourceState = (
  data: ScmData,
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
        gitUrl(data, remote.href, file),
        gitUrl(data, local.href, file),
        `abapGit#${data.repo.sapPackage} ${file.name} ↔ Local changes`
      ]
    }
  const state = { resourceUri, command: cmd }
  return state
}

async function refresh(gitScm: ScmData) {
  const server = getServer(gitScm.connId)
  const { user, password } = await repoCredentials(gitScm)
  const staging = await server.client.stageRepo(gitScm.repo, user, password)
  const mapState = (key: string, objs: GitStagingObject[]) => {
    const group = gitScm.groups.get(key)
    const state: SourceControlResourceState[] = []
    for (const obj of objs)
      for (const file of obj.abapGitFiles)
        state.push(resourceState(gitScm, file))
    group.resourceStates = state
  }
  mapState(STAGED, staging.staged)
  mapState(UNSTAGED, staging.unstaged)
  mapState(IGNORED, staging.ignored)
  gitScm.loaded = true
}

const createScm = (connId: string, repo: GitRepo): ScmData => {
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
  const rec: ScmData = { scm: gscm, connId, repo, groups, loaded }
  rec.scm.statusBarCommands = [
    {
      command: AbapFsCommands.agitBranch,
      arguments: [rec],
      title: repo.branch_name
    }
  ]
  return rec
}

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

const connRepos = async (connId: string) =>
  getOrCreateServer(connId).then(server =>
    server.client.gitRepos().then(ArrayToMap("key"))
  )

const loadRepos = async () => {
  const stored: StoredRepo[] = storage.get(REPOSSTORAGEKEY, [])
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

let storage: Memento

class GitCommands {
  @command(AbapFsCommands.agitRefresh)
  private static async refreshCmd(gitScm: ScmData) {
    if (gitScm) return refresh(gitScm)
    else for (const grepo of scms.values()) await refresh(grepo)
  }
  @command(AbapFsCommands.agitPush)
  private static async pushCmd(gitScm: ScmData) {
    // tslint:disable-next-line:no-console
    console.log(gitScm)
  }
  @command(AbapFsCommands.agitPullScm)
  private static async pullCmd(gitScm: ScmData) {
    // tslint:disable-next-line:no-console
    console.log(gitScm)
  }
  @command(AbapFsCommands.agitresetPwd)
  private static async resetCmd(gitScm: ScmData) {
    gitScm = gitScm || (scms.size === 1 && scms.values().next())
    // tslint:disable-next-line:no-console
    console.log(gitScm)
  }
}
export function registerAbapGit(context: ExtensionContext) {
  storage = context.workspaceState
  loadRepos()
}

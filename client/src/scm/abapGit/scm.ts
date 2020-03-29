import {
  SourceControl,
  SourceControlResourceGroup,
  SourceControlResourceState,
  Uri,
  Command,
  scm
} from "vscode"
import { GitRepo, GitStagingObject, GitStagingFile } from "abap-adt-api"
import { Cache, mapGet, cache } from "../../lib"
import { getServer } from "../../adt/AdtServer"
import { repoCredentials } from "./credentials"
import { gitUrl } from "./documentProvider"
import { AbapFsCommands, command } from "../../commands"
import { isNone, fromNullable, Option, some } from "fp-ts/lib/Option"
import { saveRepos } from "./storage"

const STAGED = "staged"
const UNSTAGED = "unstaged"
const IGNORED = "ignored"

export interface ScmData {
  scm: SourceControl
  connId: string
  repo: GitRepo
  groups: Cache<string, SourceControlResourceGroup>
  loaded: boolean
  credentials?: { user?: string; password?: string }
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

async function refresh(data: Option<ScmData>) {
  if (isNone(data)) return
  const server = getServer(data.value.connId)
  const credentials = await repoCredentials(data.value)
  if (isNone(credentials)) return
  const { user, password } = await credentials.value
  const staging = await server.client.stageRepo(data.value.repo, user, password)
  const mapState = (key: string, objs: GitStagingObject[]) => {
    const group = data.value.groups.get(key)
    const state: SourceControlResourceState[] = []
    for (const obj of objs)
      for (const file of obj.abapGitFiles)
        state.push(resourceState(data.value, file))
    group.resourceStates = state
  }
  mapState(STAGED, staging.staged)
  mapState(UNSTAGED, staging.unstaged)
  mapState(IGNORED, staging.ignored)
  data.value.loaded = true
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
  if (update && !gitScm.loaded)
    await refresh(some(gitScm)).then(() => saveRepos(scms))
  return gitScm
}

const findSc = (sc: SourceControl) => {
  const candidates = [...scms.values()]
  const found = sc ? candidates.find(s => s.scm === sc) : candidates[0]
  return fromNullable(found)
}

class GitCommands {
  @command(AbapFsCommands.agitRefresh)
  private static async refreshCmd(sc: SourceControl) {
    return refresh(findSc(sc))
  }
  @command(AbapFsCommands.agitPush)
  private static async pushCmd(gitScm: SourceControl) {
    // tslint:disable-next-line:no-console
    console.log(gitScm)
  }
  @command(AbapFsCommands.agitPullScm)
  private static async pullCmd(gitScm: SourceControl) {
    // tslint:disable-next-line:no-console
    console.log(gitScm)
  }
  @command(AbapFsCommands.agitAdd)
  private static async addCmd(gitScm: SourceControl) {
    // tslint:disable-next-line:no-console
    console.log(gitScm)
  }
  @command(AbapFsCommands.agitRemove)
  private static async removeCmd(gitScm: SourceControl) {
    // tslint:disable-next-line:no-console
    console.log(gitScm)
  }
  @command(AbapFsCommands.agitresetPwd)
  private static async resetCmd() {
    // console.log(gitScm)
  }
}

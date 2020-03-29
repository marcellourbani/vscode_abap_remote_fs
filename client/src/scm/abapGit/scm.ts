import {
  SourceControl,
  SourceControlResourceGroup,
  SourceControlResourceState,
  Uri,
  Command,
  scm
} from "vscode"
import {
  GitRepo,
  GitStagingObject,
  GitStagingFile,
  GitStaging
} from "abap-adt-api"
import { Cache, mapGet, cache, log } from "../../lib"
import { getServer } from "../../adt/AdtServer"
import { repoCredentials } from "./credentials"
import { gitUrl } from "./documentProvider"
import { AbapFsCommands, command } from "../../commands"
import { isNone, fromNullable, Option, some } from "fp-ts/lib/Option"
import { saveRepos } from "./storage"

const STAGED = "staged"
const UNSTAGED = "unstaged"
const IGNORED = "ignored"
const GDESC: { [key: string]: string } = {
  staged: "STAGED CHANGES",
  unstaged: "CHANGES",
  ignored: "IGNORED"
}

export interface ScmData {
  scm: SourceControl
  connId: string
  repo: GitRepo
  groups: Cache<string, SourceControlResourceGroup>
  notNew: boolean
  staging?: GitStaging
  credentials?: { user?: string; password?: string }
}
interface AgResState extends SourceControlResourceState {
  data: ScmData
}
const isAgResState = (x: any): x is AgResState =>
  !!(x?.data?.connId && x.resourceUri)

const scms = new Map<string, ScmData>()

export const scmKey = (connId: string, repoKey: string) =>
  `abapGit_${connId}_${repoKey}`

export const scmData = (key: string) => scms.get(key)

const resourceState = (data: ScmData, file: GitStagingFile): AgResState => {
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
  const state = { resourceUri, command: cmd, data }
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
  data.value.notNew = true
  data.value.staging = staging
}

const createScm = (connId: string, repo: GitRepo): ScmData => {
  const gscm = scm.createSourceControl(
    `abapGit_${connId}_${repo.sapPackage}`,
    `abapGit ${connId} ${repo.sapPackage}`
  )
  gscm.inputBox.placeholder = `Message ${repo.branch_name}`
  const groups = cache((groupKey: string) => {
    const group = gscm.createResourceGroup(groupKey, GDESC[groupKey])
    group.hideWhenEmpty = true
    return group
  })
  const loaded = false
  const rec: ScmData = { scm: gscm, connId, repo, groups, notNew: loaded }
  rec.scm.statusBarCommands = [
    {
      command: AbapFsCommands.agitBranch,
      arguments: [rec],
      title: repo.branch_name
    }
  ]
  return rec
}

export async function addRepo(connId: string, repo: GitRepo, addnew = false) {
  const gitScm = mapGet(scms, scmKey(connId, repo.key), () =>
    createScm(connId, repo)
  )
  gitScm.groups.get(STAGED)
  gitScm.groups.get(UNSTAGED)
  gitScm.groups.get(IGNORED)
  if (!addnew) gitScm.notNew = true
  if (addnew && !gitScm.notNew)
    await refresh(some(gitScm)).then(() => saveRepos(scms))
  return gitScm
}

const fromSC = (sc: SourceControl) => {
  const candidates = [...scms.values()]
  const found = sc ? candidates.find(s => s.scm === sc) : candidates[0]
  return fromNullable(found)
}
const fromData = (group: SourceControlResourceGroup) =>
  [...scms.values()].find(s => [...s.groups].includes(group))

const transfer = (
  source: SourceControlResourceGroup,
  target: SourceControlResourceGroup,
  items: SourceControlResourceState[]
) => {
  target.resourceStates = [...target.resourceStates, ...items]
  source.resourceStates = source.resourceStates.filter(x => !items.includes(x))
}

class GitCommands {
  @command(AbapFsCommands.agitRefresh)
  private static async refreshCmd(sc: SourceControl) {
    return refresh(fromSC(sc))
  }
  @command(AbapFsCommands.agitPush)
  private static async pushCmd(sc: SourceControl) {
    log("not yet implemented...")
  }
  @command(AbapFsCommands.agitPullScm)
  private static async pullCmd(gitScm: SourceControl) {
    log("not yet implemented...")
  }

  @command(AbapFsCommands.agitAdd)
  private static async addCmd(
    ...args: AgResState[] | SourceControlResourceGroup[]
  ) {
    const unstaged = args[0]
    if (isAgResState(unstaged)) {
      const data = unstaged.data
      const states = args as AgResState[]
      transfer(data.groups.get(UNSTAGED), data.groups.get(STAGED), states)
    } else {
      const data = fromData(unstaged)
      if (data)
        transfer(unstaged, data.groups.get(STAGED), unstaged.resourceStates)
    }
  }

  @command(AbapFsCommands.agitRemove)
  private static async removeCmd(
    ...args: AgResState[] | SourceControlResourceGroup[]
  ) {
    const staged = args[0]
    if (isAgResState(staged)) {
      const data = staged.data
      const states = args as AgResState[]
      transfer(data.groups.get(STAGED), data.groups.get(UNSTAGED), states)
    } else {
      const data = fromData(staged)
      if (data)
        transfer(staged, data.groups.get(UNSTAGED), staged.resourceStates)
    }
  }

  @command(AbapFsCommands.agitresetPwd)
  private static async resetCmd() {
    log("not yet implemented...")
  }
}

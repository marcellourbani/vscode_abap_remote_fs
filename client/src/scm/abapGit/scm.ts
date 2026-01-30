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
import { Cache, mapGet, cache } from "../../lib"
import { dataCredentials } from "./credentials"
import { gitUrl } from "./documentProvider"
import { AbapFsCommands } from "../../commands"
import { isNone, fromNullable, Option, some } from "fp-ts/lib/Option"
import { saveRepos } from "./storage"
import { getClient } from "../../adt/conections"

export const STAGED = "staged"
export const UNSTAGED = "unstaged"
export const IGNORED = "ignored"
const GDESC: { [key: string]: string } = {
  staged: "STAGED CHANGES",
  unstaged: "CHANGES",
  ignored: "Changed on remote"
}

export interface ScmCredentials {
  user: string
  password: string
}
export interface AgResState extends SourceControlResourceState {
  data: ScmData
  originalGroupId: string
}

export interface AgResGroup extends SourceControlResourceGroup {
  resourceStates: AgResState[]
}

export interface ScmData {
  scm: SourceControl
  connId: string
  repo: GitRepo
  groups: Cache<string, SourceControlResourceGroup>
  notNew: boolean
  staging?: GitStaging
  credentials?: ScmCredentials
}
export const isAgResState = (x: any): x is AgResState =>
  !!(x?.data?.connId && x.resourceUri)

const scms = new Map<string, ScmData>()

export const scmKey = (connId: string, repoKey: string) =>
  `abapGit_${connId}_${repoKey}`

export const scmData = (key: string) => scms.get(key)
export const fileUri = (file: GitStagingFile) =>
  Uri.parse(`${file.path}${encodeURIComponent(file.name)}`)

const resourceState = (
  data: ScmData,
  file: GitStagingFile,
  originalGroupId: string
): AgResState => {
  const resourceUri = fileUri(file)
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
  const state = { resourceUri, command: cmd, data, originalGroupId }
  return state
}

export async function refresh(data: ScmData) {
  const client = getClient(data.connId)
  const credentials = await dataCredentials(data)
  if (isNone(credentials)) return
  const { user, password } = await credentials.value
  const staging = await client.stageRepo(data.repo, user, password)
  const repo = (await client.gitRepos()).find(r => r.key === data.repo.key)
  if (repo) data.repo = repo
  const mapState = (key: string, objs: GitStagingObject[]) => {
    const group = data.groups.get(key)
    const state: SourceControlResourceState[] = []
    for (const obj of objs)
      for (const file of obj.abapGitFiles)
        state.push(resourceState(data, file, key))
    group.resourceStates = state
  }
  mapState(STAGED, staging.staged)
  mapState(UNSTAGED, staging.unstaged)
  mapState(IGNORED, staging.ignored)
  data.notNew = true
  data.staging = staging
  setStatusCommand(data)
}

export const setStatusCommand = (data: ScmData) => {
  data.scm.statusBarCommands = [
    {
      command: AbapFsCommands.agitBranch,
      arguments: [data],
      title: data.repo.branch_name.replace(/^\/?refs\/heads\//, "")
    }
  ]
}

const createScm = (connId: string, repo: GitRepo): ScmData => {
  const gscm = scm.createSourceControl(
    `abapGit_${connId}_${repo.sapPackage}`,
    `abapGit ${connId} ${repo.sapPackage}`
  )
  gscm.inputBox.placeholder = `Message ${repo.branch_name}`
  const groups = cache((groupKey: string) => {
    const group = gscm.createResourceGroup(groupKey, GDESC[groupKey] || "")
    group.hideWhenEmpty = true
    return group
  })
  const loaded = false
  const data: ScmData = { scm: gscm, connId, repo, groups, notNew: loaded }
  setStatusCommand(data)
  return data
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
    await refresh(gitScm).then(() => saveRepos(scms))
  return gitScm
}

export const fromSC = (sc: SourceControl) => {
  const candidates = [...scms.values()]
  const found = sc ? candidates.find(s => s.scm === sc) : candidates[0]
  return fromNullable(found)
}

export const fromGroup = (group: SourceControlResourceGroup) =>
  [...scms.values()].find(s => [...s.groups].includes(group))

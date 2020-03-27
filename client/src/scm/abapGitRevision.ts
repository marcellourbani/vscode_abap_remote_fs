import { cache, Cache } from "./../helpers/functions"
import { GitRepo, GitStaging, GitStagingObject } from "abap-adt-api"
import {
  scm,
  SourceControl,
  SourceControlResourceGroup,
  SourceControlResourceState
} from "vscode"

interface GitScmKey {
  connId: string
  repo: GitRepo
}
interface AbapGitScm {
  scm: SourceControl
  connId: string
  repo: GitRepo
  groups: Cache<string, SourceControlResourceGroup>
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
  const groups = cache((groupKey: string) =>
    gscm.createResourceGroup(groupKey, groupKey)
  )
  return { scm: gscm, connId, repo, groups }
}

const scms = cache(createScm, formatScmKey)

export function addRepo(connId: string, repo: GitRepo, staging: GitStaging) {
  const sr = scms.get(createScmKey(connId, repo))
  const mapState = (key: string, objs: GitStagingObject[]) => {
    const group = sr.groups.get(key)
    const state: SourceControlResourceState[] = []
    for (const obj of objs) for (const file of obj.abapGitFiles) state.push()
  }
  mapState("staged", staging.staged)
  mapState("unstaged", staging.unstaged)
}

import { Memento, ExtensionContext } from "vscode"
import { GitRepo } from "abap-adt-api"
import { mapGet, ArrayToMap } from "../../lib"
import { addRepo } from "."
import { ScmData } from "./scm"
import { getOrCreateClient } from "../../adt/conections"

const REPOSSTORAGEKEY = "abapGitRepos"

interface StoredRepo {
  connId: string
  repoKey: string
  user?: string
}

let storage: Memento

const connRepos = async (connId: string) =>
  getOrCreateClient(connId).then(client =>
    client.gitRepos().then(ArrayToMap("key"))
  )

const loadRepos = async () => {
  const stored: StoredRepo[] = storage.get(REPOSSTORAGEKEY, [])
  const repos = new Map<string, Promise<Map<string, GitRepo>>>()
  for (const s of stored) {
    const repM = await mapGet(repos, s.connId, async () => connRepos(s.connId))
    const repo = repM.get(s.repoKey)
    if (repo) {
      const gr = await addRepo(s.connId, repo)
      if (s.user) gr.credentials = { user: s.user, password: "" }
    }
  }
}

export const saveRepos = (scms: Map<string, ScmData>) => {
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

export function registerAbapGit(context: ExtensionContext) {
  storage = context.workspaceState
  loadRepos()
}

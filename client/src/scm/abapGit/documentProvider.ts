import { type TextDocumentContentProvider, Uri, workspace } from "vscode"
import { scmKey, scmData, type ScmData } from "./scm"
import { atob, btoa } from "../../lib"
import { type GitStagingFile } from "abap-adt-api"
import { getClient } from "../../adt/conections"
const GITSCHEME = "ABAPGIT"

class GitDocProvider implements TextDocumentContentProvider {
  async provideTextDocumentContent(uri: Uri) {
    if (uri.scheme !== GITSCHEME) throw new Error(`Unexpected URI scheme ${uri.scheme}`)
    const { key = "", path = "" } = JSON.parse(atob(uri.query)) as {
      path: string
      key: string
    }

    const gitScm = scmData(scmKey(uri.authority, key))
    if (!key || !path || !gitScm) throw new Error(`Invalid URL`)
    const client = getClient(uri.authority)
    const { user, password } = gitScm.credentials || {}
    return client.getObjectSource(path.replace(/#/g, "%23"), {
      gitUser: user,
      gitPassword: password
    })
  }
}

export const registerGitDocProvider = () =>
  workspace.registerTextDocumentContentProvider(GITSCHEME, new GitDocProvider())

export const gitUrl = (data: ScmData, path: string, file: GitStagingFile) => {
  const query = btoa(JSON.stringify({ key: data.repo.key, path }))
  return Uri.parse(`${GITSCHEME}://${data.connId}?${query}`)
}

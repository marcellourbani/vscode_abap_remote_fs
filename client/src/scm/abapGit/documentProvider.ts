import { TextDocumentContentProvider, Uri, workspace } from "vscode"
import { getServer } from "../../adt/AdtServer"
import { scmKey, scmData, ScmData } from "./scm"
import { atob, btoa } from "../../lib"
import { GitStagingFile } from "abap-adt-api"
const GITSCHEME = "ABAPGIT"

class GitDocProvider implements TextDocumentContentProvider {
  async provideTextDocumentContent(uri: Uri) {
    if (uri.scheme !== GITSCHEME)
      throw new Error(`Unexpected URI scheme ${uri.scheme}`)
    const { key = "", path = "" } = JSON.parse(atob(uri.query)) as {
      path: string
      key: string
    }

    const gitScm = scmData(scmKey(uri.authority, key))
    if (!key || !path || !gitScm) throw new Error(`Invalid URL`)
    const server = getServer(uri.authority)
    if (!server) throw new Error(`No active connection for ${uri.authority}`)
    // by now I can take for granted that login happened
    const { user, password } = gitScm.credentials || {}
    return server.client.getObjectSource(
      path.replace(/#/g, "%23"),
      user,
      password
    )
  }
}

workspace.registerTextDocumentContentProvider(GITSCHEME, new GitDocProvider())

export const gitUrl = (data: ScmData, path: string, file: GitStagingFile) => {
  const query = btoa(JSON.stringify({ key: data.repo.key, path }))
  return Uri.parse(`${GITSCHEME}://${data.connId}?${query}`)
}

import { isRight } from "fp-ts/lib/Either"
import {
  TreeDataProvider,
  TreeItem,
  workspace,
  EventEmitter,
  TreeItemCollapsibleState,
  window,
  ProgressLocation,
  commands,
  env,
  Uri,
} from "vscode"
import { GitRepo, ADTClient, objectPath } from "abap-adt-api"
import { v1 } from "uuid"
import { command, AbapFsCommands } from "../commands"
import { PACKAGE } from "../adt/operations/AdtObjectCreator"
import { selectTransport } from "../adt/AdtTransports"
import {
  chainTaskTransformers,
  dependFieldReplacer,
  log,
  createTaskTransformer,
  caughtToString
} from "../lib"
import { quickPick } from "../lib"
import { addRepo, repoCredentials } from "../scm/abapGit"
import { isNone, none, isSome } from "fp-ts/lib/Option"
import { getClient, ADTSCHEME, getOrCreateClient } from "../adt/conections"
import { AdtObjectFinder, createUri } from "../adt/operations/AdtObjectFinder"

const confirm = "Confirm"
interface AbapGitItem extends TreeItem {
  tag: "repo"
  repo: GitRepo
}

interface ServerItem extends TreeItem {
  tag: "server"
  connId: string
  children: AbapGitItem[]
}

interface NoGitItem extends TreeItem {
  tag: "nogit"
  connId: string
}

const isServerItem = (item: TreeItem): item is ServerItem =>
  (item as any).tag === "server"

export const confirmPull = (pkg: string) =>
  window
    .showInformationMessage(
      `Pull package ${pkg} from git? Uncommitted changes will be overwritten`,
      confirm,
      "Cancel"
    )
    .then(r => r === confirm)

export const packageUri = async (client: ADTClient, name: string) => {
  const cancreate = await client.collectionFeatureDetails(
    "/sap/bc/adt/packages"
  )
  return cancreate
    ? objectPath(PACKAGE, name)
    : `/sap/bc/adt/vit/wb/object_type/devck/object_name/${encodeURIComponent(
      name
    )}`
}

class AbapGit {
  public unlink(repo: GitRepo, client: ADTClient) {
    return client.gitUnlinkRepo(repo.key)
  }
  private async getServerItem(connId: string) {
    const repos = await getClient(connId).gitRepos()
    const item: ServerItem = {
      tag: "server",
      connId,
      id: v1(),
      contextValue: "system",
      collapsibleState: TreeItemCollapsibleState.Expanded,
      label: connId,
      children: repos.map(repo => this.gitItem(repo))
    }
    return item
  }
  private getNoGitItem(connId: string): NoGitItem {
    const uri = 'https://github.com/abapGit/ADT_Backend'
    return {
      tag: "nogit",
      connId,
      id: v1(),
      label: `${connId} ADT plugin not installed`,
      description: `click to open ${uri}`,
      tooltip: `click to open ${uri}`,
      collapsibleState: TreeItemCollapsibleState.None,
      command: {
        command: "vscode.open",
        title: "Open backend link",
        arguments: [Uri.parse(uri)],
      }
    }
  }

  private gitItem(repo: GitRepo): AbapGitItem {
    const canpush = !!repo.links.find(l => l.type === "push_link")
    const contextValue = canpush ? "repository_push" : "repository"
    return {
      tag: "repo",
      repo,
      id: v1(),
      label: repo.sapPackage,
      contextValue,
      description: repo.url,
      collapsibleState: TreeItemCollapsibleState.None
    }
  }
  public async getGitEnabledServers(): Promise<[ServerItem[], NoGitItem[]]> {
    const servers: ServerItem[] = []
    const nogits: NoGitItem[] = []
    const folders = (workspace.workspaceFolders || []).filter(
      f => f.uri.scheme === ADTSCHEME
    )
    for (const f of folders) {
      const connId = f.uri.authority
      await getOrCreateClient(connId)
      try {
        if (await getClient(connId).featureDetails("abapGit Repositories"))
          servers.push(await this.getServerItem(connId))
        else nogits.push(this.getNoGitItem(connId))
      } catch (error) {
        window.showErrorMessage(`Failed to load git repositories for ${connId}: ${error}`)
      }
    }
    return [servers, nogits]
  }
  public async getRemoteInfo(
    repoUrl: string,
    client: ADTClient,
    user = "",
    password = ""
  ) {
    const remote = await client.gitExternalRepoInfo(repoUrl, user, password)
    return remote
  }
}

interface RepoAccess {
  user: string
  password: string
  branch: string
  cancelled: boolean
}

// tslint:disable-next-line: max-classes-per-file
class AbapGitProvider implements TreeDataProvider<TreeItem> {
  private git = new AbapGit()
  private children: (ServerItem | NoGitItem)[] = []
  private emitter = new EventEmitter<TreeItem | null>()
  private loaded = false
  private static instance: AbapGitProvider
  public onDidChangeTreeData = this.emitter.event
  private get gitChildren(): ServerItem[] {
    return this.children.filter(isServerItem)
  }

  public static get() {
    if (!this.instance) this.instance = new AbapGitProvider()
    return this.instance
  }

  public async refresh() {
    this.loaded = true
    const [servers, nogit] = await this.git.getGitEnabledServers()
    this.children = [...servers, ...nogit]
    this.emitter.fire(null)
  }

  public getTreeItem(element: TreeItem): TreeItem {
    return element
  }
  public async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!this.loaded) await this.refresh()
    if (!element) return this.children
    if (isServerItem(element)) return element.children
    return []
  }

  private async reveal(repoItem: AbapGitItem) {
    const pkg = repoItem.repo.sapPackage
    const server = this.repoServer(repoItem)
    const candidates = await getClient(server.connId).searchObject(pkg, "DEVC")
    const found = candidates.find(c => c["adtcore:name"] === pkg)
    if (!found) return

    const finder = await new AdtObjectFinder(server.connId)
    const uri = await finder.vscodeUri(found["adtcore:uri"], false)
    commands.executeCommand("revealInExplorer", Uri.parse(uri))
  }

  private openRepo(repoItem: AbapGitItem) {
    env.openExternal(Uri.parse(repoItem.repo.url))
  }

  private addScm(repoItem: AbapGitItem) {
    const connId = this.repoServer(repoItem).connId
    addRepo(connId, repoItem.repo, true)
  }

  private async pull(repoItem: AbapGitItem) {
    if (!(await confirmPull(repoItem.repo.sapPackage))) return
    const client = getClient(this.repoServer(repoItem).connId)

    const uri = await packageUri(client, repoItem.repo.sapPackage)
    const transport = await selectTransport(
      uri,
      repoItem.repo.sapPackage,
      client
    )
    if (transport.cancelled) return
    const ri = await this.getRemoteInfo(repoItem.repo.url, client)
    if (!ri) return
    return await window.withProgress(
      {
        location: ProgressLocation.Window,
        title: `Pulling repo ${repoItem.repo.sapPackage}`
      },
      async () => {
        const result = await client.gitPullRepo(
          repoItem.repo.key,
          ri.branch,
          transport.transport,
          ri.user,
          ri.password
        )
        commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        return result
      }
    )
  }

  private async unLink(repoItem: AbapGitItem) {
    const answer = await window.showInformationMessage(
      `Detach package ${repoItem.repo.sapPackage} from abapGit repo? All objects will be unaffected`,
      confirm,
      "Cancel"
    )
    if (answer !== confirm) return
    const server = this.repoServer(repoItem)
    await this.git.unlink(repoItem.repo, getClient(server.connId))
    await this.refresh()
  }

  private repoServer(repoItem: AbapGitItem) {
    const hasRepo = (s: ServerItem) =>
      !!s.children.find(r => r.id === repoItem.id)
    const server = this.gitChildren.find(hasRepo)
    if (!server)
      throw new Error(
        `No server connection found for package ${repoItem.repo.sapPackage}`
      )
    return server
  }

  private async getRemoteInfo(repoUrl: string, client: ADTClient) {
    const access: RepoAccess = {
      branch: "",
      user: "",
      password: "",
      cancelled: false
    }
    try {
      const ri = await this.git.getRemoteInfo(repoUrl, client)
      const isPrivate = ri.access_mode === "PRIVATE"
      const getBranches = (x: RepoAccess) => async () => {
        const branches = isPrivate ? (await this.git.getRemoteInfo(repoUrl, client, x.user, x.password)).branches
          : ri.branches
        return branches.map(b => b.name)
      }

      const placeHolder = "select branch"
      const replaceBranch = dependFieldReplacer<RepoAccess>("branch", x =>
        quickPick(getBranches(x), { placeHolder })
      )

      const newAccess = await chainTaskTransformers<RepoAccess>(
        createTaskTransformer(async x => {
          if (!isPrivate) return x
          const cred = await repoCredentials(repoUrl)
          if (isNone(cred)) throw none
          if (isSome(cred)) x = { ...x, ...cred.value }
          return x
        }),
        replaceBranch
      )(access)()
      if (isRight(newAccess)) return newAccess.right
    } catch (e) {
      log(caughtToString(e))
    }
    return access
  }

  private async createRepoInternal(item: ServerItem, client: ADTClient, pkgname: string, repoUrl: string, repoaccess: RepoAccess, transport: string) {
    const result = await client.gitCreateRepo(
      pkgname,
      repoUrl,
      repoaccess.branch,
      transport,
      repoaccess.user,
      repoaccess.password
    )
    await Promise.all([
      this.refresh()
    ]).finally(() => commands.executeCommand("workbench.files.action.refreshFilesExplorer"))
    const created = this.gitChildren
      .find(i => i.connId === item.connId)
      ?.children.find(r => r.repo.url === repoUrl)
    if (created) this.reveal(created)
    return result

  }

  private async createRepo(item: ServerItem) {
    try {
      const pkg = await new AdtObjectFinder(item.connId).findObject(
        "Select package",
        PACKAGE
      )
      if (!pkg) return
      const repoUrl = await window.showInputBox({
        prompt: "Repository URL",
        ignoreFocusOut: true
      })
      if (!repoUrl) return

      const client = getClient(item.connId)

      const repoaccess = await this.getRemoteInfo(repoUrl, client)

      const transport = await selectTransport(
        objectPath(PACKAGE, pkg.name),
        pkg.name,
        client
      )
      if (transport.cancelled) return
      if (!(await confirmPull(pkg.name))) return
      return await this.createRepoInternal(item, client, pkg.name, repoUrl, repoaccess, transport.transport)

    } catch (error) {
      window.showErrorMessage(`Error creating or pulling repository: ${caughtToString(error)}`)
      this.refresh()
    }
  }

  @command(AbapFsCommands.agitRefreshRepos)
  private static refreshCommand() {
    return AbapGitProvider.get().refresh()
  }
  @command(AbapFsCommands.agitCreate)
  private static createCommand(item: ServerItem) {
    return AbapGitProvider.get().createRepo(item)
  }
  @command(AbapFsCommands.agitUnlink)
  private static unLinkCommand(repoItem: AbapGitItem) {
    return AbapGitProvider.get().unLink(repoItem)
  }
  @command(AbapFsCommands.agitPull)
  private static pullCommand(repoItem: AbapGitItem) {
    return AbapGitProvider.get().pull(repoItem)
  }
  @command(AbapFsCommands.agitReveal)
  private static revealCommand(repoItem: AbapGitItem) {
    return AbapGitProvider.get().reveal(repoItem)
  }
  @command(AbapFsCommands.agitOpenRepo)
  private static openRepoCommand(repoItem: AbapGitItem) {
    return AbapGitProvider.get().openRepo(repoItem)
  }
  @command(AbapFsCommands.agitAddScm)
  private static addScmCommand(repoItem: AbapGitItem) {
    return AbapGitProvider.get().addScm(repoItem)
  }
}

export const abapGitProvider = AbapGitProvider.get()
workspace.onDidChangeWorkspaceFolders(() => {
  abapGitProvider.refresh()
})

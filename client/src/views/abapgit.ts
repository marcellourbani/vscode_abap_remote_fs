import { isRight } from "fp-ts/lib/Either"
import { AdtServer } from "./../adt/AdtServer"
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
  Uri
} from "vscode"
import { GitRepo, ADTClient, objectPath, GitExternalInfo } from "abap-adt-api"
import { ADTSCHEME, getOrCreateServer } from "../adt/AdtServer"
import { v1 } from "uuid"
import { command, AbapFsCommands } from "../commands"
import { PACKAGE } from "../adt/operations/AdtObjectCreator"
import { selectTransport } from "../adt/AdtTransports"
import {
  chainTaskTransformers,
  fieldReplacer,
  dependFieldReplacer,
  log,
  createTaskTransformer
} from "../lib"
import { simpleInputBox, quickPick } from "../lib"
import { addRepo, repoCredentials } from "../scm/abapGit"
import { isNone, none, isSome } from "fp-ts/lib/Option"

const confirm = "Confirm"
interface AbapGitItem extends TreeItem {
  repo: GitRepo
}

interface ServerItem extends TreeItem {
  server: AdtServer
  children: AbapGitItem[]
}

const isServerItem = (item: TreeItem): item is ServerItem =>
  !!(item as any).server

export const confirmPull = (pkg: string) =>
  window
    .showInformationMessage(
      `Pull package ${pkg} from git? Uncommitted changes will be overwritten`,
      confirm,
      "Cancel"
    )
    .then(r => r === confirm)

class AbapGit {
  public unlink(repo: GitRepo, client: ADTClient) {
    return client.gitUnlinkRepo(repo.key)
  }
  private async getServerItem(server: AdtServer) {
    const repos = await server.client.gitRepos()
    const item: ServerItem = {
      server,
      id: v1(),
      contextValue: "system",
      collapsibleState: TreeItemCollapsibleState.Expanded,
      label: server.connectionId,
      children: repos.map(repo => this.gitItem(repo))
    }
    return item
  }

  private gitItem(repo: GitRepo): AbapGitItem {
    const canpush = !!repo.links.find(l => l.type === "push_link")
    const contextValue = canpush ? "repository_push" : "repository"
    return {
      repo,
      id: v1(),
      label: repo.sapPackage,
      contextValue,
      description: repo.url,
      collapsibleState: TreeItemCollapsibleState.None
    }
  }
  public async getGitEnabledServers() {
    const servers: ServerItem[] = []
    const folders = (workspace.workspaceFolders || []).filter(
      f => f.uri.scheme === ADTSCHEME
    )
    for (const f of folders) {
      const server = await getOrCreateServer(f.uri.authority)
      if (await server.client.featureDetails("abapGit Repositories"))
        servers.push(await this.getServerItem(server))
    }
    return servers
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
  private children: ServerItem[] = []
  private emitter = new EventEmitter<TreeItem>()
  private loaded = false
  private static instance: AbapGitProvider
  public onDidChangeTreeData = this.emitter.event

  public static get() {
    if (!this.instance) this.instance = new AbapGitProvider()
    return this.instance
  }

  public async refresh() {
    this.loaded = true
    this.children = await this.git.getGitEnabledServers()
    this.emitter.fire()
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
    const candidates = await server.server.client.searchObject(pkg, "DEVC")
    const found = candidates.find(c => c["adtcore:name"] === pkg)
    if (!found) return
    const steps = await server.server.objectFinder.findObjectPath(
      found?.["adtcore:uri"]
    )
    const path = await server.server.objectFinder.locateObject(steps)
    if (!path) return
    commands.executeCommand(
      "revealInExplorer",
      server.server.createUri(path.path)
    )
  }

  private openRepo(repoItem: AbapGitItem) {
    env.openExternal(Uri.parse(repoItem.repo.url))
  }

  private addScm(repoItem: AbapGitItem) {
    const server = this.repoServer(repoItem).server.connectionId
    addRepo(server, repoItem.repo, true)
  }

  private async pull(repoItem: AbapGitItem) {
    if (await confirmPull(repoItem.repo.sapPackage)) return
    const server = this.repoServer(repoItem)
    const transport = await selectTransport(
      objectPath(PACKAGE, repoItem.repo.sapPackage),
      repoItem.repo.sapPackage,
      server.server.client
    )
    if (transport.cancelled) return
    const ri = await this.getRemoteInfo(repoItem.repo.url, server.server.client)
    if (!ri) return
    return await window.withProgress(
      {
        location: ProgressLocation.Window,
        title: `Pulling repo ${repoItem.repo.sapPackage}`
      },
      async () => {
        const result = await server.server.client.gitPullRepo(
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
    await this.git.unlink(repoItem.repo, server.server.client)
    await this.refresh()
  }

  private repoServer(repoItem: AbapGitItem) {
    const hasRepo = (s: ServerItem) =>
      !!s.children.find(r => r.id === repoItem.id)
    const server = this.children.find(hasRepo)
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
      if (ri.access_mode === "PRIVATE") {
        const getBranches = (x: RepoAccess) => async () =>
          (
            await this.git.getRemoteInfo(repoUrl, client, x.user, x.password)
          ).branches.map(b => b.name)

        const placeHolder = "select branch"
        const replaceBranch = dependFieldReplacer<RepoAccess>("branch", x =>
          quickPick(getBranches(x), { placeHolder })
        )

        const newAccess = await chainTaskTransformers<RepoAccess>(
          createTaskTransformer(async x => {
            const cred = await repoCredentials(repoUrl)
            if (isNone(cred)) throw none
            if (isSome(cred)) x = { ...x, ...cred.value }
            return x
          }),
          replaceBranch
        )(access)()
        if (isRight(newAccess)) return newAccess.right
      } else access.branch = ri && ri.branches[0] && ri.branches[0].name
    } catch (e) {
      log(e.toString())
    }
    return access
  }

  private async createRepo(item: ServerItem) {
    const pkg = await item.server.objectFinder.findObject(
      "Select package",
      PACKAGE
    )
    if (!pkg) return
    const repoUrl = await window.showInputBox({ prompt: "Repository URL" })
    if (!repoUrl) return

    const repoaccess = await this.getRemoteInfo(repoUrl, item.server.client)

    const transport = await selectTransport(
      objectPath(PACKAGE, pkg.name),
      pkg.name,
      item.server.client
    )
    if (transport.cancelled) return
    if (!(await confirmPull(pkg.name))) return
    return await window.withProgress(
      {
        location: ProgressLocation.Window,
        title: `Linking and pulling package ${pkg.name}`
      },
      async () => {
        const result = await item.server.client.gitCreateRepo(
          pkg.name,
          repoUrl,
          repoaccess.branch,
          transport.transport,
          repoaccess.user,
          repoaccess.password
        )
        await Promise.all([
          this.refresh(),
          commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        ])
        const created = this.children
          .find(i => i.server.connectionId === item.server.connectionId)
          ?.children.find(r => r.repo.url === repoUrl)
        if (created) this.reveal(created)
        return result
      }
    )
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

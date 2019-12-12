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
  commands
} from "vscode"
import { GitRepo, ADTClient, objectPath, GitExternalInfo } from "abap-adt-api"
import { ADTSCHEME, getOrCreateServer } from "../adt/AdtServer"
import { v1 } from "uuid"
import { command, AbapFsCommands } from "../commands"
import { PACKAGE } from "../adt/operations/AdtObjectCreator"
import { selectTransport } from "../adt/AdtTransports"
import { log } from "../helpers/logger"
import {
  chainTaskTransformers,
  fieldReplacer,
  dependFieldReplacer
} from "../helpers/functions"
import { simpleInputBox, quickPick } from "../helpers/vscodefunctions"

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
    return {
      repo,
      id: v1(),
      label: repo.sapPackage,
      contextValue: "repository",
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

  private confirmPull(pkg: string) {
    return window.showInformationMessage(
      `Pull package ${pkg} from git? Uncommitted changes will be overwritten`,
      confirm,
      "Cancel"
    )
  }

  private async pull(repoItem: AbapGitItem) {
    if ((await this.confirmPull(repoItem.repo.sapPackage)) !== confirm) return
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
        //
        const inputUser = simpleInputBox("user")
        const inputPwd = simpleInputBox("password", "", true)

        const getBranches = (x: RepoAccess) => async () =>
          (
            await this.git.getRemoteInfo(repoUrl, client, x.user, x.password)
          ).branches.map(b => b.name)
        const placeHolder = "select branch"
        const replaceBranch = dependFieldReplacer<RepoAccess>("branch", x =>
          quickPick(getBranches(x), { placeHolder })
        )

        const newAccess = await chainTaskTransformers<RepoAccess>(
          fieldReplacer("user", inputUser),
          fieldReplacer("password", inputPwd),
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
    if ((await this.confirmPull(pkg.name)) !== confirm) return
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
        commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        this.refresh()
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
}

export const abapGitProvider = AbapGitProvider.get()
workspace.onDidChangeWorkspaceFolders(() => {
  abapGitProvider.refresh()
})

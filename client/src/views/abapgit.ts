import { AdtServer } from "./../adt/AdtServer"
import {
  TreeDataProvider,
  TreeItem,
  workspace,
  EventEmitter,
  TreeItemCollapsibleState,
  window
} from "vscode"
import { GitRepo, ADTClient } from "abap-adt-api"
import { ADTSCHEME, getOrCreateServer } from "../adt/AdtServer"
import { v1 } from "uuid"
import { command, AbapFsCommands } from "../commands"
const REPO = "repo"
interface AbapGitItem extends TreeItem {
  repo: GitRepo
}

interface ServerItem extends TreeItem {
  client: ADTClient
  children: AbapGitItem[]
}
const isServerItem = (item: TreeItem): item is ServerItem =>
  !!(item as any).client

class AbapGit {
  public unlink(repo: GitRepo, client: ADTClient) {
    return client.gitUnlinkRepo(repo.key)
  }
  private async getServerItem(server: AdtServer) {
    const repos = await server.client.gitRepos()
    const item: ServerItem = {
      client: server.client,
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

  private pull(repoItem: AbapGitItem) {
    throw new Error("Method not implemented.")
  }

  private async unLink(repoItem: AbapGitItem) {
    const confirm = "Confirm"
    const answer = await window.showInformationMessage(
      `Detach package ${repoItem.repo.sapPackage} from abapGit repo? All objects will be unaffected`,
      confirm,
      "Cancel"
    )
    if (answer !== confirm) return
    const server = this.repoServer(repoItem)
    await this.git.unlink(repoItem.repo, server.client)
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

  @command(AbapFsCommands.agitRefreshRepos)
  private static refreshCommand() {
    return AbapGitProvider.get().refresh()
  }
  @command(AbapFsCommands.agitCreate)
  private static createCommand() {
    return AbapGitProvider.get().refresh()
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

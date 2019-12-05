import { AdtServer } from "./../adt/AdtServer"
import {
  TreeDataProvider,
  TreeItem,
  workspace,
  EventEmitter,
  commands,
  TreeItemCollapsibleState
} from "vscode"
import { GitRepo, ADTClient } from "abap-adt-api"
import { ADTSCHEME, getOrCreateServer } from "../adt/AdtServer"
import { v1 } from "uuid"

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
  private async getServerItem(server: AdtServer) {
    const repos = await server.client.gitRepos()
    const item: ServerItem = {
      client: server.client,
      id: v1(),
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
  public onDidChangeTreeData = this.emitter.event

  public async refresh() {
    this.children = await this.git.getGitEnabledServers()
    this.emitter.fire()
  }

  public getTreeItem(element: TreeItem): TreeItem {
    return element
  }
  public async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) return this.children
    if (isServerItem(element)) return element.children
    return []
  }
}

export const abapGitProvider = new AbapGitProvider()
abapGitProvider.refresh()
workspace.onDidChangeWorkspaceFolders(() => {
  abapGitProvider.refresh()
})

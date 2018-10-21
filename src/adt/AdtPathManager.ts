import { AdtNode } from "./AdtNode"
import { adtPathResolver } from "./adtPathResolver"
import { AdtConnectionManager } from "./AdtConnectionManager"
import { Response } from "request"
import { getNodeStructureTreeContent, ObjectNode } from "./AdtParser"
import { Uri } from "vscode"

export class AdtPathManager {
  getDirectory(uri: Uri): AdtNode {
    throw new Error("Method not implemented.")
  }
  private _cache: Map<string, AdtNode> = new Map()
  private _manager = AdtConnectionManager.getManager()

  parse(uri: Uri, response: Response): any {
    return getNodeStructureTreeContent(response.body).then(
      (children: ObjectNode[]) => {
        const node = new AdtNode(uri)
        node.setChildrenFromTreeContent(children)
        return node
      }
    )
  }
  fetchFileOrDir(url: Uri): Promise<AdtNode> {
    let path = adtPathResolver(url)
    if (path.isRoot) {
      let root = this._cache.get(url.toString())
      if (!root) {
        root = new AdtNode(url, path.connectionName)
        this._cache.set(url.toString(), root)
        const firstChild = new AdtNode(
          url.with({
            path: url.path + "repository/nodestructure"
          })
        )
        root.entries.set(firstChild.name, firstChild)
      }
      return new Promise(resolve => resolve(root))
    }
    return new Promise((resolve, reject) => {
      if (path) {
        let key = path!.connectionName + path!.path
        let response = this._cache.get(key)
        if (response) {
          resolve(response)
        } else {
          this._manager.findConn(path.connectionName).then(conn => {
            conn
              .request(path!.path, path!.method)
              .then(response => {
                return this.parse(url, response)
              })
              .then(file => {
                this._cache.set(key, file)
                resolve(file)
              })
          })
        }
      } else {
        reject()
      }
    })
  }
}

import { AdtNode } from "./AdtNode"
import { adtPathResolver, AdtPath } from "./adtPathResolver"
import { AdtConnectionManager } from "./AdtConnectionManager"
import { Response } from "request"
import { getNodeStructureTreeContent, ObjectNode } from "./AdtParser"

export class AdtPathManager {
  private _cache: Map<string, AdtNode> = new Map()
  private _manager = AdtConnectionManager.getManager()
  parse(path: AdtPath, response: Response): any {
    return getNodeStructureTreeContent(response.body).then(
      (children: ObjectNode[]) => {
        const node = new AdtNode(path.url)
        node.setChildrenFromTreeContent(children)
        return node
      }
    )
  }
  fetchDirectory(url: string): Promise<AdtNode> {
    let path = adtPathResolver(url)
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
                return this.parse(path!, response)
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

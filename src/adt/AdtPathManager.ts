import { AdtNode } from "./AdtNode"
import { AdtConnectionManager } from "./AdtConnectionManager"
import { Response } from "request"
import { getNodeStructureTreeContent, ObjectNode } from "./AdtParser"
import { Uri, FileType } from "vscode"

const asPromise = (x: AdtNode) => new Promise<AdtNode>(resolve => resolve(x))
const isValid = (uri: Uri) => uri.path.match(/\/sap\/bc\/adt\/.*\//i)

const getMethod = (uri: Uri): string => {
  return "POST"
}
const key = (uri: Uri) => uri.authority + uri.path

export class AdtPathManager {
  getDirectory(uri: Uri): AdtNode | undefined {
    return this.getDirCached(uri)
  }
  private _dircache: Map<string, AdtNode> = new Map()
  private _manager = AdtConnectionManager.getManager()

  private actualUri(original: Uri): Uri {
    if (!isValid(original)) throw new Error("Not found")
    return original
  }

  parse(uri: Uri, response: Response): Promise<AdtNode> {
    return getNodeStructureTreeContent(response.body).then(
      (children: ObjectNode[]) => {
        const node = new AdtNode(uri)
        node.setChildrenFromTreeContent(children)
        return node
      }
    )
  }
  getDirCached(url: Uri) {
    return this._dircache.get(key(url))
  }
  setDirCached(url: Uri, directory: AdtNode): void {
    this._dircache.set(key(url), directory)
  }
  fetchFileOrDir(url: Uri): Promise<AdtNode> {
    url = this.actualUri(url)
    const cached = this.getDirCached(url)
    if (cached) return asPromise(cached)

    return new Promise((resolve, reject) => {
      this._manager.findConn(url.authority).then(conn => {
        conn
          .request(url.path, getMethod(url))
          .then(response => {
            return this.parse(url, response)
          })
          .then(file => {
            if (file.type === FileType.Directory) {
              this.setDirCached(url, file)
            }
            resolve(file)
          })
      })
    })
  }
}

import { Uri, FileSystemError } from "vscode"
import { AdtConnection } from "../adt/AdtConnection"
import { pick } from "../functions"
import { parseNode, NodeStructure } from "../adt/AdtNodeStructParser"
import { parsetoPromise } from "../adt/AdtParserBase"
import { parseObject } from "../adt/AdtObjectParser"

export const XML_EXTENSION = ".XML"
export const SAPGUIONLY = "Objects of this type are only supported in SAPGUI"
export type AbapNodeComponentByType = {
  name: string
  type: string
  objects: Array<AbapObject>
}
export type AbapNodeComponentByCategory = {
  name: string
  category: string
  types: Array<AbapNodeComponentByType>
}

export class AbapObject {
  readonly type: string
  readonly name: string
  readonly techName: string
  readonly path: string
  readonly expandable: boolean
  protected sapguiOnly: boolean

  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: string
  ) {
    this.name = name
    this.type = type
    this.path = path
    this.expandable = !!expandable
    this.techName = techName || name
    this.sapguiOnly = !!path.match(/\/sap\/bc\/adt\/vit/)
  }

  isLeaf() {
    return !this.expandable
  }
  vsName(): string {
    return this.name.replace(/\//g, "／") + this.getExtension()
  }

  getContents(connection: AdtConnection): Promise<string> {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName())
    if (this.sapguiOnly) return Promise.resolve(SAPGUIONLY)
    const mainUri = Uri.parse("adt://" + connection.name).with({
      path: this.path
    })
    //bit of heuristics: assume we're already dealing with a source file
    // if source/main is part of the url
    if (this.path.match(/\/source\/main/))
      return connection.request(mainUri, "GET").then(pick("body"))

    const follow = this.followLinkGen(mainUri)

    return connection
      .request(mainUri, "GET")
      .then(pick("body"))
      .then(parsetoPromise())
      .then(parseObject)
      .then(o => {
        let actualUri
        let query = o.header["adtcore:version"]
          ? `version=${o.header["adtcore:version"]}`
          : ""
        o.links.some(link => {
          return (
            link.type &&
            link.type.match(/text/i) &&
            (actualUri = follow(link.href).with({ query }))
          )
        })
        if (actualUri)
          return connection.request(actualUri, "GET").then(pick("body"))
        else return SAPGUIONLY
      })
  }

  getExtension(): any {
    if (!this.isLeaf()) return ""
    return this.sapguiOnly ? ".txt" : ".abap"
  }
  getChildren(connection: AdtConnection): Promise<NodeStructure> {
    if (this.isLeaf()) throw FileSystemError.FileNotADirectory(this.vsName())
    const nodeUri = this.getNodeUri(connection)

    return connection
      .request(nodeUri, "POST")
      .then(pick("body"))
      .then(parseNode)
      .then(this.filterNodeStructure.bind(this))
  }

  protected getNodeUri(connection: AdtConnection): Uri {
    const techName = this.techName.match(/^=/) ? this.name : this.techName
    return Uri.parse("adt://dummy/sap/bc/adt/repository/nodestructure").with({
      authority: connection.name,
      query: `parent_name=${encodeURIComponent(
        this.name
      )}&parent_tech_name=${encodeURIComponent(
        techName
      )}&parent_type=${encodeURIComponent(
        this.type
      )}&withShortDescriptions=true`
    })
  }
  //exclude those visible only in SAPGUI, except whitelisted
  protected filterNodeStructure(nodest: NodeStructure): NodeStructure {
    if (this.type === "DEVC/K") return nodest
    const nodes = nodest.nodes.filter(x => this.whiteListed(x.OBJECT_TYPE))
    return {
      ...nodest,
      nodes
    }
  }

  protected whiteListed(OBJECT_TYPE: string): boolean {
    return !!OBJECT_TYPE.match(/^....\/(.|(FF))$/)
  }

  protected followLinkGen(base: Uri): any {
    return (relPath: string): Uri => {
      let path
      if (relPath.match(/^\//)) path = relPath
      else if (relPath.match(/^\.\//)) {
        path =
          base.path.replace(/\/([^\/]*)$/, "/") + relPath.replace(/\.\//, "")
      } else {
        const sep = base.path.match(/\/$/) ? "" : "/"
        path = base.path + sep + relPath.replace(/\.\//, "")
      }
      return base.with({ path })
    }
  }
}

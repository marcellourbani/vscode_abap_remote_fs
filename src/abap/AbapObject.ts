import { Uri, FileSystemError } from "vscode"
import { AdtConnection } from "../adt/AdtConnection"
import { pick } from "../functions"
import {
  parseNode,
  NodeStructure,
  ObjectNode
} from "../adt/AdtNodeStructParser"
import { parsetoPromise } from "../adt/AdtParserBase"
import {
  parseObject,
  firstTextLink,
  objectVersion
} from "../adt/AdtObjectParser"
import { aggregateNodes } from "./AbapObjectUtilities"
import { adtLockParser } from "../adt/AdtLockParser"

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

  protected getUri(connection: AdtConnection) {
    return Uri.parse("adt://" + connection.name).with({
      path: this.path
    })
  }

  async setContents(
    connection: AdtConnection,
    contents: Uint8Array
  ): Promise<void> {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName())
    if (this.sapguiOnly)
      throw FileSystemError.FileNotFound(
        `${this.name} can only be edited in SAPGUI`
      )
    let baseUri = await this.getFileUri(connection)
    baseUri = baseUri.with({ path: baseUri.path.replace(/\?.*/, "") })

    const lockRecord = await connection
      .request(
        baseUri.with({ query: "_action=LOCK&accessMode=MODIFY" }),
        "POST",
        { headers: { "X-sap-adt-sessiontype": "stateful" } }
      )
      .then(pick("body"))
      .then(parsetoPromise() as any)
      .then(adtLockParser)

    const lock = encodeURI(lockRecord.LOCK_HANDLE)
    console.log(lock, lockRecord)

    await connection.request(
      baseUri.with({ query: `lockHandle=${lock}` }),
      "PUT",
      { body: contents }
    )

    await connection.request(
      baseUri.with({ query: `_action=UNLOCK&lockHandle=${lock}` }),
      "POST"
    )
  }
  async getFileUri(connection: AdtConnection): Promise<Uri> {
    const mainUri = this.getUri(connection)

    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName())
    if (this.sapguiOnly)
      throw FileSystemError.Unavailable(this.vsName() + SAPGUIONLY)
    //bit of heuristics: assume we're already dealing with a source file
    // if source/main is part of the url. Won't get an XML file with the original anyway
    // same for class includes
    if (
      this.path.match(/\/source\/main/) ||
      this.path.match(/\/includes\/[a-zA-Z]+$/)
    )
      return mainUri.with({ path: this.path })

    const objectRecord = await connection
      .request(mainUri, "GET")
      .then(pick("body"))
      .then(parsetoPromise())
      .then(parseObject)
    const link = firstTextLink(objectRecord.links)

    if (link) {
      const query = objectVersion(objectRecord.header)
      return this.followLinkGen(mainUri)(link.href).with({ query })
    }
    return Promise.reject(
      FileSystemError.Unavailable(this.vsName() + SAPGUIONLY)
    )
  }

  async getContents(connection: AdtConnection): Promise<string> {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName())
    if (this.sapguiOnly) return Promise.resolve(SAPGUIONLY)
    const uri = await this.getFileUri(connection)

    return connection.request(uri, "GET").then(pick("body"))
  }

  getExtension(): any {
    if (!this.isLeaf()) return ""
    return this.sapguiOnly ? ".txt" : ".abap"
  }

  getChildren(
    connection: AdtConnection
  ): Promise<Array<AbapNodeComponentByCategory>> {
    if (this.isLeaf()) throw FileSystemError.FileNotADirectory(this.vsName())
    const nodeUri = this.getNodeUri(connection)

    return connection
      .request(nodeUri, "POST")
      .then(pick("body"))
      .then(parseNode)
      .then(this.filterNodeStructure.bind(this))
      .then(aggregateNodes)
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

  protected followLinkGen(base: Uri) {
    return (relPath: string): Uri => {
      if (!relPath) return base
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
  protected selfLeafNode(): ObjectNode {
    return {
      OBJECT_NAME: this.name,
      OBJECT_TYPE: this.type,
      OBJECT_URI: this.path,
      OBJECT_VIT_URI: this.path,
      EXPANDABLE: "",
      TECH_NAME: this.techName
    }
  }
}

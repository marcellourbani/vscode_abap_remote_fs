import { Uri, FileSystemError } from "vscode"
import { AdtConnection } from "../adt/AdtConnection"
import { pick, followLink } from "../functions"
import {
  parseNode,
  NodeStructure,
  ObjectNode
} from "../adt/AdtNodeStructParser"
import { parsetoPromise, getNode } from "../adt/AdtParserBase"
import { parseObject, firstTextLink } from "../adt/AdtObjectParser"
import { aggregateNodes } from "./AbapObjectUtilities"
import { adtLockParser } from "../adt/AdtLockParser"
import { request } from "https"

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
export interface AbapMetaData {
  sourcePath: string
  createdAt: number
  changedAt: number
  version: string
  masterLanguage?: string
  masterSystem?: string
}
interface MainProgram {
  "adtcore:uri": string
  "adtcore:type": string
  "adtcore:name": string
}

export class AbapObject {
  readonly type: string
  readonly name: string
  readonly techName: string
  readonly path: string
  readonly expandable: boolean
  metaData?: AbapMetaData
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
    this.sapguiOnly = !!path.match(
      "(/sap/bc/adt/vit)|(/sap/bc/adt/ddic/domains/)|(/sap/bc/adt/ddic/dataelements/)"
    )
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
  async activate(
    connection: AdtConnection,
    mainInclude?: string
  ): Promise<string> {
    const uri = this.getUri(connection).with({
      path: "/sap/bc/adt/activation",
      query: "method=activate&preauditRequested=true"
    })
    const incl = mainInclude ? `?context=${encodeURI(mainInclude)}` : ""
    const payload =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
      `<adtcore:objectReference adtcore:uri="${
        this.path
      }${incl}" adtcore:name="${this.name}"/>` +
      `</adtcore:objectReferences>`

    const response = await connection.request(uri, "POST", { body: payload })
    if (response.body) {
      //activation error(s)
      const messages = (await parsetoPromise(
        getNode("chkl:messages/msg/shortText/txt")
      )(response.body)) as string[]

      return messages[0]
    }
    return ""
  }
  async getMainPrograms(connection: AdtConnection): Promise<MainProgram[]> {
    const response = await connection.request(
      followLink(this.getUri(connection), "mainprograms"),
      "GET"
    )
    const parsed: any = await parsetoPromise()(response.body)
    return parsed["adtcore:objectReferences"]["adtcore:objectReference"].map(
      (link: any) => link["$"]
    )
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
    let contentUri = this.getContentsUri(connection)

    const lockRecord = await connection
      .request(
        contentUri.with({ query: "_action=LOCK&accessMode=MODIFY" }),
        "POST",
        { headers: { "X-sap-adt-sessiontype": "stateful" } }
      )
      .then(pick("body"))
      .then(parsetoPromise() as any)
      .then(adtLockParser)

    const lock = encodeURI(lockRecord.LOCK_HANDLE)

    await connection.request(
      contentUri.with({ query: `lockHandle=${lock}` }),
      "PUT",
      { body: contents }
    )

    await connection.request(
      contentUri.with({ query: `_action=UNLOCK&lockHandle=${lock}` }),
      "POST"
    )
  }

  async loadMetadata(connection: AdtConnection): Promise<AbapObject> {
    if (this.name) {
      const mainUri = this.getUri(connection)
      const meta = await connection
        .request(mainUri, "GET")
        .then(pick("body"))
        .then(parsetoPromise())
        .then(parseObject)
      const link = firstTextLink(meta.links)
      const sourcePath = link ? link.href : ""
      this.metaData = {
        createdAt: Date.parse(meta.header["adtcore:createdAt"]),
        changedAt: Date.parse(meta.header["adtcore:createdAt"]),
        version: meta.header["adtcore:version"],
        masterLanguage: meta.header["adtcore:masterLanguage"],
        masterSystem: meta.header["adtcore:masterSystem"],
        sourcePath
      }
    }
    return this
  }
  getContentsUri(connection: AdtConnection): Uri {
    if (!this.metaData) throw FileSystemError.FileNotFound(this.path)
    // baseUri = baseUri.with({ path: baseUri.path.replace(/\?.*/, "") })
    return followLink(this.getUri(connection), this.metaData.sourcePath).with({
      query: `version=${this.metaData.version}`
    })
  }

  async getContents(connection: AdtConnection): Promise<string> {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName())
    if (this.sapguiOnly || !this.metaData || !this.metaData.sourcePath)
      return SAPGUIONLY

    return connection
      .request(this.getContentsUri(connection), "GET")
      .then(pick("body"))
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

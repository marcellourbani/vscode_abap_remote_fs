import { Uri, FileSystemError } from "vscode"
import { AdtConnection } from "../AdtConnection"
import { pick, followLink } from "../../functions"
import {
  parseNode,
  NodeStructure,
  ObjectNode
} from "../parsers/AdtNodeStructParser"
import { parseToPromise, getNode } from "../parsers/AdtParserBase"
import { aggregateNodes, objectTypeExtension } from "./AbapObjectUtilities"
import { SapGuiCommand } from "../sapgui/sapgui"
import { ADTClient, AbapObjectStructure } from "abap-adt-api"
import { isString } from "util"
import { NodeParents } from "abap-adt-api/build/api"

const TYPEID = Symbol()
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
export enum TransportStatus {
  UNKNOWN,
  REQUIRED,
  LOCAL
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
  transport: TransportStatus | string = TransportStatus.UNKNOWN
  structure?: AbapObjectStructure
  protected sapguiOnly: boolean
  private get _typeId() {
    return TYPEID
  }

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
  static isAbapObject(x: any): x is AbapObject {
    return (<AbapObject>x)._typeId === TYPEID
  }

  isLeaf() {
    return !this.expandable
  }
  get vsName(): string {
    return this.name.replace(/\//g, "／") + this.getExtension()
  }

  getExecutionCommand(): SapGuiCommand | undefined {
    return
  }

  getUri(connection: AdtConnection) {
    return Uri.parse("adt://" + connection.name).with({
      path: this.path
    })
  }
  async activate(client: ADTClient, mainInclude?: string): Promise<string> {
    const result = await client.activate(this.name, this.path, mainInclude)
    const m = result.messages[0]
    return (m && m.shortText) || ""
  }

  async getMainPrograms(connection: AdtConnection): Promise<MainProgram[]> {
    const response = await connection.request(
      followLink(this.getUri(connection), "mainprograms"),
      "GET"
    )
    const parsed: any = await parseToPromise()(response.body)
    return parsed["adtcore:objectReferences"]["adtcore:objectReference"].map(
      (link: any) => link["$"]
    )
  }

  getLockTarget(): AbapObject {
    return this
  }

  canBeWritten() {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName)
    if (this.sapguiOnly)
      throw FileSystemError.FileNotFound(
        `${this.name} can only be edited in SAPGUI`
      )
  }

  async setContents(
    client: ADTClient,
    contents: Uint8Array,
    lockId: string
  ): Promise<void> {
    this.canBeWritten()
    const contentUri = this.getContentsUri()
    const transport = isString(this.transport) ? this.transport : undefined

    await client.setObjectSource(
      contentUri,
      contents.toString(),
      lockId,
      transport
    )
  }

  async loadMetadata(client: ADTClient): Promise<AbapObject> {
    if (this.name) {
      this.structure = await client.objectStructure(this.path)
    }
    return this
  }

  getContentsUri(): string {
    if (!this.structure) throw FileSystemError.FileNotFound(this.path)
    const include = ADTClient.mainInclude(this.structure)
    return include
  }

  async getContents(client: ADTClient): Promise<string> {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName)
    const url = this.structure && ADTClient.mainInclude(this.structure)
    if (this.sapguiOnly || !url) return SAPGUIONLY

    return client.getObjectSource(url)
  }

  getExtension(): string {
    if (!this.isLeaf()) return ""
    return this.sapguiOnly ? ".txt" : objectTypeExtension(this) + ".abap"
  }

  getActivationSubject(): AbapObject {
    return this
  }

  async getChildren(
    client: ADTClient
  ): Promise<Array<AbapNodeComponentByCategory>> {
    if (this.isLeaf()) throw FileSystemError.FileNotADirectory(this.vsName)

    const nodes = await client.nodeContents({
      parent_name: this.name,
      parent_tech_name: this.techName,
      parent_type: this.type as NodeParents
    })

    const filtered = this.filterNodeStructure(nodes)
    const components = aggregateNodes(filtered, this.type)

    return components
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
      )}&user_name=${encodeURIComponent(
        connection.username.toUpperCase()
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
export class AbapXmlObject extends AbapObject {
  getExtension(): string {
    if (!this.isLeaf()) return ""
    return this.sapguiOnly ? ".txt" : ".xml"
  }
}
export class AbapSimpleObject extends AbapObject {
  isLeaf() {
    return true
  }
}
export const isAbapObject = AbapObject.isAbapObject

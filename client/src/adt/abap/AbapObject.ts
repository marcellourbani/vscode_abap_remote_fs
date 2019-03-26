import { FileSystemError } from "vscode"
import { ArrayToMap } from "../../functions"
import { aggregateNodes, objectTypeExtension } from "./AbapObjectUtilities"
import { SapGuiCommand } from "../sapgui/sapgui"
import {
  ADTClient,
  AbapObjectStructure,
  Node,
  NodeCategory,
  NodeObjectType
} from "abap-adt-api"
import { isString } from "util"
import { isNodeParent } from "abap-adt-api"
import { PACKAGE } from "../operations/AdtObjectCreator"

const TYPEID = Symbol()
export const XML_EXTENSION = ".XML"
export const SAPGUIONLY = "Objects of this type are only supported in SAPGUI"
export interface AbapNodeComponentByType {
  name: string
  type: string
  objects: AbapObject[]
}

export interface NodeStructureMapped {
  nodes: Node[]
  categories: Map<string, NodeCategory>
  objectTypes: Map<string, NodeObjectType>
}
export interface AbapNodeComponentByCategory {
  name: string
  category: string
  types: AbapNodeComponentByType[]
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

export class AbapObject {
  public static isAbapObject(x: any): x is AbapObject {
    return (x as AbapObject)._typeId === TYPEID
  }
  public readonly type: string
  public readonly name: string
  public readonly techName: string
  public readonly path: string
  public get expandable() {
    return this.pExpandable
  }
  public get key() {
    return `${this.type} ${this.name}`
  }
  public transport: TransportStatus | string = TransportStatus.UNKNOWN
  public structure?: AbapObjectStructure

  protected pExpandable: boolean
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
    this.pExpandable = !!expandable && type === PACKAGE
    this.techName = techName || name
    this.sapguiOnly = !!path.match(
      "(/sap/bc/adt/vit)|(/sap/bc/adt/ddic/domains/)|(/sap/bc/adt/ddic/dataelements/)"
    )
  }

  public isLeaf() {
    return !this.expandable
  }
  get vsName(): string {
    if (this.name) return this.name.replace(/\//g, "／") + this.getExtension()
    return ""
  }

  public getExecutionCommand(): SapGuiCommand | undefined {
    return
  }

  public async activate(
    client: ADTClient,
    mainInclude?: string
  ): Promise<string> {
    const result = await client.activate(this.name, this.path, mainInclude)
    const m = result.messages[0]
    return (m && m.shortText) || ""
  }

  public async getMainPrograms(client: ADTClient) {
    return client.mainPrograms(this.path)
  }

  public getLockTarget(): AbapObject {
    return this
  }

  public canBeWritten() {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName)
    if (this.sapguiOnly)
      throw FileSystemError.FileNotFound(
        `${this.name} can only be edited in SAPGUI`
      )
  }

  public async setContents(
    client: ADTClient,
    contents: Uint8Array,
    lockId: string
  ): Promise<void> {
    this.canBeWritten()
    // contents URL depends on metadata
    if (!this.structure) await this.loadMetadata(client)
    const contentUri = this.getContentsUri()
    const transport = isString(this.transport) ? this.transport : undefined

    await client.setObjectSource(
      contentUri,
      contents.toString(),
      lockId,
      transport
    )
  }

  public async loadMetadata(client: ADTClient): Promise<AbapObject> {
    if (this.name && !this.sapguiOnly) {
      // hack for some objects which return source/main in the package entry
      this.structure = await client.objectStructure(
        this.path.replace(/\/source\/main$/, "")
      )
    }
    return this
  }

  public getContentsUri(): string {
    if (!this.structure) throw FileSystemError.FileNotFound(this.path)
    const include = ADTClient.mainInclude(this.structure)
    return include
  }

  public async getContents(client: ADTClient): Promise<string> {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName)
    const url = this.sapguiOnly ? "" : this.getContentsUri()
    if (!url) return SAPGUIONLY

    return client.getObjectSource(url)
  }

  public getExtension(): string {
    if (!this.isLeaf()) return ""
    return this.sapguiOnly ? ".txt" : objectTypeExtension(this) + ".abap"
  }

  public getActivationSubject(): AbapObject {
    return this
  }

  public async getChildren(
    client: ADTClient
  ): Promise<AbapNodeComponentByCategory[]> {
    if (this.isLeaf() || !isNodeParent(this.type))
      throw FileSystemError.FileNotADirectory(this.vsName)

    const adtnodes = await client.nodeContents(this.type, this.name)
    const nodes = {
      nodes: adtnodes.nodes,
      categories: ArrayToMap("CATEGORY")(adtnodes.categories),
      objectTypes: ArrayToMap("OBJECT_TYPE")(adtnodes.objectTypes)
    }
    const filtered = this.filterNodeStructure(nodes)
    const components = aggregateNodes(filtered, this.type)

    return components
  }

  // exclude those visible only in SAPGUI, except whitelisted
  protected filterNodeStructure(
    nodest: NodeStructureMapped
  ): NodeStructureMapped {
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

  protected selfLeafNode(): Node {
    return {
      OBJECT_NAME: this.name,
      OBJECT_TYPE: this.type,
      OBJECT_URI: this.path,
      OBJECT_VIT_URI: this.path,
      EXPANDABLE: "",
      TECH_NAME: this.techName
    }
  }

  private get _typeId() {
    return TYPEID
  }
}
// tslint:disable:max-classes-per-file
export class AbapXmlObject extends AbapObject {
  public getExtension(): string {
    if (!this.isLeaf()) return ""
    return this.sapguiOnly ? ".txt" : ".xml"
  }
}
export class AbapSimpleObject extends AbapObject {
  public isLeaf() {
    return true
  }
}
export const isAbapObject = AbapObject.isAbapObject

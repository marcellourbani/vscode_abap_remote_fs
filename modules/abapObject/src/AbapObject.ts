import {
  AbapObjectStructure,
  MainInclude,
  NodeStructure,
  isNodeParent
} from "abap-adt-api"
import { AbapObjectService } from "./AOService"
import { ObjectErrors } from "./AOError"
const SAPGUIONLY = "Objects of this type are only supported in SAPGUI"
const NSSLASH = "\u2215" // used to be hardcoded as "／", aka "\uFF0F"
const convertSlash = (x: string) => x && x.replace(/\//g, NSSLASH)

const objectTag = Symbol("abapObject")

export interface AbapObject {
  readonly [objectTag]: true
  /** unique object ID, usually type and name */
  readonly key: string
  /** as defined in ADT, i.e. PROG/P for programs */
  readonly type: string
  /** the raw object name */
  readonly name: string
  /** Object technical name, i.e. main, testclasses,... */
  readonly techName: string
  /** object path in ADT, used to retrieve metadata or source */
  readonly path: string
  /** the path for read and write operations */
  contentsPath(): string
  /** true if the object has children, i.e. class */
  readonly expandable: boolean
  /** Object structure i.e. activation flag, last change data,... */
  readonly structure?: AbapObjectStructure
  /** sanitized name usable in a filesystem. i.e. replace / with some other character */
  readonly fsName: string
  /** the object to lock when editing. i.e. the function group of a function */
  readonly lockObject: AbapObject
  /** user who created the object. Only available after loading the metadata */
  readonly createdBy: string
  /** time of creation. Only available after loading the metadata */
  readonly createdAt: Date | undefined
  /** user who last changed the object. Only available after loading the metadata */
  readonly changedBy: string
  /** time of last change. Only available after loading the metadata */
  readonly changedAt: Date | undefined
  /** reads the main objects available for this object */
  mainPrograms: () => Promise<MainInclude[]>
  /** whether we are able to write it */
  readonly canBeWritten: boolean
  /** loads/updates the object metadata */
  loadStructure: () => Promise<AbapObjectStructure>
  write: (contents: string, lockId: string, transport: string) => Promise<void>
  read: () => Promise<string>
  childComponents: () => Promise<NodeStructure>
}
// tslint:disable:callable-types
export interface AbapObjectConstructor {
  new (
    type: string,
    name: string,
    path: string,
    expandable: boolean,
    techName: string,
    client: AbapObjectService
  ): AbapObject
}
export const isAbapObject = (x: any): x is AbapObject => !!x?.[objectTag]

export class AbapObjectBase implements AbapObject {
  readonly [objectTag]: true
  constructor(
    readonly type: string,
    readonly name: string,
    readonly path: string,
    readonly expandable: boolean,
    readonly techName: string,
    protected readonly client: AbapObjectService
  ) {
    this.supported =
      this.type !== "IWSV" &&
      !path.match(
        "(/sap/bc/adt/vit)|(/sap/bc/adt/ddic/domains/)|(/sap/bc/adt/ddic/dataelements/)"
      )
  }
  structure?: AbapObjectStructure
  protected readonly supported: boolean

  get canBeWritten() {
    return this.supported && !this.expandable
  }
  get key() {
    return `${this.type} ${this.name}`
  }
  get extension(): string {
    return this.expandable ? "" : this.supported ? ".abap" : ".txt"
  }
  get fsName() {
    return `${convertSlash(this.name)}${this.extension}`
  }
  get lockObject() {
    return this
  }
  get createdBy() {
    return this.structure?.metaData["adtcore:responsible"] || ""
  }
  get createdAt() {
    const ts = this.structure?.metaData["adtcore:createdAt"]
    return ts ? new Date(ts) : undefined
  }
  get changedBy() {
    return this.structure?.metaData["adtcore:changedBy"] || ""
  }
  get changedAt() {
    const ts = this.structure?.metaData["adtcore:changedAt"]
    return ts ? new Date(ts) : undefined
  }
  contentsPath() {
    if (this.expandable) throw ObjectErrors.notLeaf(this)
    // if (!this.structure &&) throw ObjectErrors.notLoaded(this)
    // return ADTClient.mainInclude(this.structure, false)
    if (!this.supported) throw ObjectErrors.NotSupported(this)
    return this.path
  }

  async mainPrograms() {
    if (!this.supported) throw ObjectErrors.NotSupported(this)
    if (this.expandable) throw ObjectErrors.notLeaf(this)
    return this.client.mainPrograms(this.path)
  }

  async loadStructure(): Promise<AbapObjectStructure> {
    if (!this.expandable || !this.name) throw ObjectErrors.noStructure(this)
    this.structure = await this.client.objectStructure(
      this.path.replace(/\/source\/main$/, "")
    )
    return this.structure
  }

  async write(contents: string, lockId: string, transport: string) {
    if (this.expandable) throw ObjectErrors.notLeaf(this)
    if (!this.supported) throw ObjectErrors.NotSupported(this)
    await this.client.setObjectSource(
      this.contentsPath(),
      contents,
      lockId,
      transport
    )
  }
  async read() {
    if (this.expandable) throw ObjectErrors.notLeaf(this)
    if (!this.supported) return SAPGUIONLY
    return this.client.getObjectSource(this.contentsPath())
  }
  async childComponents(): Promise<NodeStructure> {
    if (!this.expandable) throw ObjectErrors.isLeaf(this)
    if (!isNodeParent(this.type)) throw ObjectErrors.NotSupported(this)
    return await this.client.nodeContents(this.type, this.name)
  }
}

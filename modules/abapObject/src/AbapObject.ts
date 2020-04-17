import {
  AbapObjectStructure,
  MainInclude,
  NodeStructure,
  ADTClient,
  isNodeParent
} from "abap-adt-api"
const SAPGUIONLY = "Objects of this type are only supported in SAPGUI"
const NSSLASH = "\u2215" // used to be hardcoded as "／", aka "\uFF0F"
const convertSlash = (x: string) => x && x.replace(/\//g, NSSLASH)

const objectTag = Symbol("abapObject")
const errorTag = Symbol("abapObjectError")

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
  readonly contentsPath: string
  /** true if the object has children, i.e. class */
  readonly expandable: boolean
  /** Object structure i.e. activation flag, last change data,... */
  readonly structure?: AbapObjectStructure
  /** can we edit the sources using the path above? */
  readonly isLeaf: boolean
  /** sanitized name usable in a filesystem. i.e. replace / with some other character */
  readonly fsName: string
  /** the object to lock when editing. i.e. the function group of a function */
  readonly lockObject: AbapObject
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

export const isAbapObject = (x: any): x is AbapObject => !!x?.[objectTag]

export interface AbapObjectError extends Error {
  [errorTag]: true
  sourceObject: AbapObject
}

export const isAbapObjectError = (x: any): x is AbapObject => !!x?.[errorTag]

export function abapError(sourceObject: AbapObject, message: string) {
  return { ...new Error(message), sourceObject, [errorTag]: true }
}

export class AbapObjectBase implements AbapObject {
  readonly [objectTag]: true
  constructor(
    readonly type: string,
    readonly name: string,
    readonly path: string,
    readonly expandable: boolean,
    readonly techName: string,
    readonly client: ADTClient
  ) {
    this.isLeaf =
      this.type !== "IWSV" &&
      !path.match(
        "(/sap/bc/adt/vit)|(/sap/bc/adt/ddic/domains/)|(/sap/bc/adt/ddic/dataelements/)"
      )
  }
  structure?: AbapObjectStructure
  readonly isLeaf: boolean

  get canBeWritten() {
    return this.isLeaf && !this.expandable
  }
  get key() {
    return `${this.type} ${this.name}`
  }
  get extension() {
    return this.isLeaf ? ".abap" : ".txt"
  }
  get fsName() {
    return `${convertSlash(this.name)}.${this.extension}`
  }
  get lockObject() {
    return this
  }

  get contentsPath() {
    if (this.expandable)
      throw abapError(
        this,
        `${this.type} is a folder object and has no contents`
      )
    if (!this.structure)
      throw abapError(this, `Object structure not loaded yet`)
    return ADTClient.mainInclude(this.structure, false)
  }

  mainPrograms = async () => {
    return this.client.mainPrograms(this.path)
  }

  async loadStructure(): Promise<AbapObjectStructure> {
    if (!this.isLeaf || !this.name)
      throw abapError(this, `Unable to retrieve structure of ${this.key}`)
    // hack for some objects which return source/main in the package entry
    this.structure = await this.client.objectStructure(
      this.path.replace(/\/source\/main$/, "")
    )
    return this.structure
  }

  async write(contents: string, lockId: string, transport: string) {
    if (!this.canBeWritten)
      throw abapError(this, `Object ${this.key} i not writeable`)
    await this.client.setObjectSource(
      this.contentsPath,
      contents,
      lockId,
      transport
    )
  }
  async read() {
    const url = this.isLeaf && this.contentsPath
    if (!url) return SAPGUIONLY
    return this.client.getObjectSource(url)
  }
  async childComponents(): Promise<NodeStructure> {
    if (this.isLeaf || !isNodeParent(this.type))
      throw abapError(this, `Unable to retrieve child objects of ${this.key}`)

    return await this.client.nodeContents(this.type, this.name)
  }
}

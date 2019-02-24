import {
  CreatableType,
  CreatableTypeIds,
  GroupTypeIds,
  isGroupType,
  NewObjectOptions,
  NonGroupTypeIds,
  objectPath,
  ObjectType,
  parentTypeId,
  ParentTypeIds,
  ValidateOptions
} from "abap-adt-api"
import { CreatableTypes } from "abap-adt-api"
import { Uri, window } from "vscode"
import { AbapNode, isAbapNode } from "../../fs/AbapNode"
import { abapObjectFromNode } from "../abap/AbapObjectUtilities"
import { AdtServer } from "../AdtServer"
import { selectTransport } from "../AdtTransports"
import { fieldOrder } from "../../functions"
import { MySearchResult } from "./AdtObjectFinder"

export const PACKAGE = "DEVC/K"
type details =
  | {
      options: NewObjectOptions
      devclass: string
    }
  | undefined

export async function selectObjectType(
  parentType?: string
): Promise<CreatableType | undefined> {
  const rawtypes = [...CreatableTypes.values()].sort(fieldOrder("label"))
  const types = parentType
    ? rawtypes.filter(t => parentTypeId(t.typeId) === parentType)
    : rawtypes
  return window.showQuickPick(types || rawtypes)
}

export class AdtObjectCreator {
  private types?: ObjectType[]

  constructor(private server: AdtServer) {}

  public async getObjectTypes(uri: Uri): Promise<ObjectType[]> {
    if (!this.types) this.types = await this.server.client.loadTypes()
    const parent = this.server.findNode(uri)
    let otype = parent && isAbapNode(parent) && parent.abapObject.type
    if (otype === PACKAGE) otype = ""
    return this.types!.filter(x => x.PARENT_OBJECT_TYPE === otype)
  }

  /**
   * Creates an ABAP object asking the user for unknown details
   * Tries to guess object type and parent/package from URI
   *
   * @param uri Creates an ABAP object
   */
  public async createObject(uri: Uri | undefined) {
    const objDetails = await this.getObjectDetails(uri)
    if (!objDetails) return
    const { options, devclass } = objDetails
    await this.validateObject(options)
    const transport = await selectTransport(
      objectPath(options.objtype, options.name, options.parentName),
      devclass,
      this.server.client,
      true
    )
    if (transport.cancelled) return
    options.transport = transport.transport
    await this.server.client.statelessClone.createObject(options)

    const obj = abapObjectFromNode({
      EXPANDABLE: "",
      OBJECT_NAME: options.name,
      OBJECT_TYPE: options.objtype,
      OBJECT_URI: objectPath(options),
      OBJECT_VIT_URI: "",
      TECH_NAME: options.name
    })
    await obj.loadMetadata(this.server.client)
    return obj
  }
  public guessParentByType(hierarchy: AbapNode[], type: ParentTypeIds): string {
    // find latest package parent
    const pn = hierarchy.find(n => isAbapNode(n) && n.abapObject.type === type)
    // return package name or blank string
    return (pn && isAbapNode(pn) && pn.abapObject.name) || ""
  }

  private getHierarchy(uri: Uri | undefined): AbapNode[] {
    if (uri)
      try {
        return this.server.findNodeHierarchy(uri)
      } catch (e) {
        // ignore
      }
    return []
  }

  private async guessOrSelectObjectType(
    hierarchy: AbapNode[]
  ): Promise<CreatableType | undefined> {
    const base = hierarchy[0]
    // if I picked the root node,a direct descendent or a package just ask the user to select any object type
    // if not, for abap nodes pick child objetc types (if any)
    // for non-abap nodes if it's an object type guess the type from the children
    if (hierarchy.length > 2)
      if (isAbapNode(base)) return selectObjectType(base.abapObject.type)
      else {
        const child = [...base]
          .map(c => c[1])
          .find(c => isAbapNode(c) && c.abapObject.type !== PACKAGE)
        if (child && isAbapNode(child)) {
          const typeid = child.abapObject.type as CreatableTypeIds
          const guessed = CreatableTypes.get(typeid)
          if (guessed) return guessed
        }
      }
    // default...
    return selectObjectType()
  }

  private async validateObject(objDetails: NewObjectOptions) {
    let validateOptions: ValidateOptions
    if (isGroupType(objDetails.objtype))
      validateOptions = {
        description: objDetails.description,
        fugrname: objDetails.parentName,
        objname: objDetails.name,
        objtype: objDetails.objtype as GroupTypeIds
      }
    else
      validateOptions = {
        description: objDetails.description,
        objname: objDetails.name,
        objtype: objDetails.objtype as NonGroupTypeIds,
        packagename: objDetails.parentName
      }
    return this.server.client.validateNewObject(validateOptions)
  }
  private async getObjectDetails(uri: Uri | undefined): Promise<details> {
    const hierarchy = this.getHierarchy(uri)
    let devclass: string = this.guessParentByType(hierarchy, PACKAGE)
    const objType = await this.guessOrSelectObjectType(hierarchy)
    // user didn't pick one...
    if (!objType) return
    const name = await this.askName(objType.typeId)
    if (!name) return
    const description = await this.askInput("description", false)
    if (!description) return
    const responsible = this.server.client.username.toUpperCase()
    const parentType = parentTypeId(objType.typeId)
    let parentName
    if (parentType !== PACKAGE) {
      parentName = this.guessParentByType(hierarchy, "FUGR/F")
      if (!parentName) {
        const parent = await this.server.objectFinder.findObject(
          "Select parent",
          parentType
        )
        if (!parent) return
        parentName = parent.name
        devclass = await this.findPackage(parent)
      }
      if (!parentName) return
    }

    if (!devclass) {
      const packageResult = await this.server.objectFinder.findObject(
        "Select package",
        PACKAGE
      )
      if (!packageResult) return
      devclass = packageResult.name
    }
    if (parentType === PACKAGE) parentName = devclass
    if (!devclass || !parentName) return
    return {
      devclass,
      options: {
        description,
        name: this.fixName(name, objType.typeId, parentName),
        objtype: objType.typeId,
        parentName,
        parentPath: objectPath(parentType, parentName, ""),
        responsible
      }
    }
  }
  private async findPackage(parent: MySearchResult) {
    if (parent.packageName) return parent.packageName
    const path = await this.server.objectFinder.findObjectPath(parent.uri)
    if (path.length > 1 && path[path.length - 2]["adtcore:type"] === PACKAGE)
      return path[path.length - 2]["adtcore:name"]
    return ""
  }
  private fixName(name: string, typeId: string, parentName: string): string {
    if (typeId !== "FUGR/I") return name
    const parts = parentName.split("/")

    return parts.length < 3
      ? `L${parentName}${name}`
      : `/${parts[1]}/L${parts[2]}${name}`
  }
  private askName(objType: CreatableTypeIds) {
    if (objType === "FUGR/I")
      return this.askInput("suffix", true, (s: string) =>
        s.match(/^[A-Za-z]\w\w$/) ? "" : "Suffix must be 3 character long"
      )

    return this.askInput("name")
  }

  private async askInput(
    prompt: string,
    uppercase: boolean = true,
    validateInput = (s: string) => ""
  ): Promise<string> {
    const res = (await window.showInputBox({ prompt, validateInput })) || ""
    return uppercase ? res.toUpperCase() : res
  }
}

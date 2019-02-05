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
import { PACKAGE, selectObjectType } from "./AdtObjectTypes"

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
    const hierarchy = this.getHierarchy(uri)
    let devclass: string = this.guessParentByType(hierarchy, PACKAGE)
    const objType = await this.guessOrSelectObjectType(hierarchy)
    // user didn't pick one...
    if (!objType) return
    const name = await this.askInput("name")
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
        devclass = parent.packageName
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
    const objDetails: NewObjectOptions = {
      description,
      name,
      objtype: objType.typeId,
      parentName,
      parentPath: objectPath(parentType, parentName, ""),
      responsible
    }
    await this.validateObject(objDetails)
    objDetails.transport = await this.selectTransport(objDetails, devclass)

    await this.server.client.statelessClone.createObject(objDetails)

    const obj = abapObjectFromNode({
      EXPANDABLE: "",
      OBJECT_NAME: objDetails.name,
      OBJECT_TYPE: objDetails.objtype,
      OBJECT_URI: objectPath(objDetails),
      OBJECT_VIT_URI: "",
      TECH_NAME: objDetails.name
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

  /**
   * Finds or ask the user to select/create a transport for an object.
   * Returns an empty string for local objects
   *
   * @param objType Object type
   * @param objDetails Object name, description,...
   */
  private async selectTransport(
    objDetails: NewObjectOptions,
    devClass: string
  ): Promise<string> {
    return selectTransport(
      objectPath(objDetails.objtype, objDetails.name, objDetails.parentName),
      devClass,
      this.server.client
    )
  }

  private async askInput(
    prompt: string,
    uppercase: boolean = true
  ): Promise<string> {
    const res = (await window.showInputBox({ prompt })) || ""
    return uppercase ? res.toUpperCase() : res
  }
}

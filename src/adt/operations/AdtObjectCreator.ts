import {
  CreatableType,
  GroupTypeIds,
  isGroupType,
  ObjectType
} from "abap-adt-api"
import {
  CreatableTypeIds,
  NewObjectOptions,
  NonGroupTypeIds,
  ValidateOptions
} from "abap-adt-api/build/api"
import { CreatableTypes } from "abap-adt-api/build/api"
import { Uri, window } from "vscode"
import { AbapNode, isAbapNode } from "../../fs/AbapNode"
import { abapObjectFromNode } from "../abap/AbapObjectUtilities"
import { AdtServer } from "../AdtServer"
import { selectTransport } from "../AdtTransports"
import { NewObjectConfig, PACKAGE, selectObjectType } from "./AdtObjectTypes"

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
  async createObject(uri: Uri | undefined) {
    const hierarchy = this.getHierarchy(uri)
    let devclass: string = this.guessParentByType(hierarchy, PACKAGE)
    const objType = await this.guessOrSelectObjectType(hierarchy)
    //user didn't pick one...
    if (!objType) return
    const name = await this.askInput("name")
    if (!name) return
    const description = await this.askInput("description", false)
    if (!description) return
    const responsible = this.server.connection.username.toUpperCase()
    let parentName
    if (objType.parentType === PACKAGE) parentName = devclass
    else {
      parentName = this.guessParentByType(hierarchy, objType.parentType)
      if (!parentName) {
        const parent = await this.server.objectFinder.findObject(
          "Select parent",
          objType.parentType
        )
        if (!parent) return
        parentName = parent.name
        devclass = parent.packageName
      }
    }
    if (!parentName) return

    if (!devclass) {
      const packageResult = await this.server.objectFinder.findObject(
        "Select package",
        "DEVC/K"
      )
      if (!packageResult) return
      devclass = packageResult.name
    }
    if (!devclass) return
    if (objType.parentType === PACKAGE) parentName = devclass
    const objDetails: NewObjectConfig = {
      description,
      devclass,
      parentName: parentName || "",
      name,
      responsible
    }
    const valresult = await this.validateObject(objType, objDetails)
    const err =
      valresult.length > 0 && valresult.find(x => x.SEVERITY === "ERROR")
    if (err) throw new Error(err.SHORT_TEXT)

    const trnumber = await this.selectTransport(objType, objDetails)

    await this.create(objType, objDetails, trnumber) //exceptions will bubble up
    const obj = abapObjectFromNode(objType.objNode(objDetails))
    await obj.loadMetadata(this.server.client)
    return (objDetails)
  }
  guessParentByType(hierarchy: AbapNode[], type: string): string {
    //find latest package parent
    const pn = hierarchy.find(n => isAbapNode(n) && n.abapObject.type === type)
    //return package name or blank string
    return (pn && isAbapNode(pn) && pn.abapObject.name) || ""
  }

  private getHierarchy(uri: Uri | undefined): AbapNode[] {
    if (uri)
      try {
        return this.server.findNodeHierarchy(uri)
      } catch (e) {}
    return []
  }

  private async guessOrSelectObjectType(
    hierarchy: AbapNode[]
  ): Promise<CreatableType | undefined> {
    const base = hierarchy[0]
    //if I picked the root node,a direct descendent or a package just ask the user to select any object type
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
    //default...
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
    objType: CreatableObjectType,
    objDetails: NewObjectConfig
  ): Promise<string> {
    return selectTransport(
      objType.getPath(objDetails.),
      objDetails.devclass,
      this.server.client
    )
  }
  /**
   * Creates an ABAP object
   *
   * @param objType Object type descriptor
   * @param objDetails Object details (name, description, package,...)
   * @param request Transport request
   */
  private async create(
    objType: CreatableType,
    objDetails: NewObjectConfig,
    request: string
  ) {
    const conn = await this.server.connection.getStatelessClone()
    const uri = conn
      .createUri(objType.getBasePath(objDetails))
      .with({ query: request && `corrNr=${request}` })
    let body = objType.getCreatePayload(objDetails)
    let response = await conn.request(uri, "POST", {
      body,
      headers: { "Content-Type": "application/*" }
    })
    return response
  }
  private async askInput(
    prompt: string,
    uppercase: boolean = true
  ): Promise<string> {
    const res = (await window.showInputBox({ prompt })) || ""
    return uppercase ? res.toUpperCase() : res
  }
}

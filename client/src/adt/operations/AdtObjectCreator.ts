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
  ValidateOptions,
  PackageTypeId,
  PackageSpecificData,
  hasPackageOptions,
  NewPackageOptions,
  PackageTypes,
  isPackageType
} from "abap-adt-api"
import { CreatableTypes } from "abap-adt-api"
import { Uri, window } from "vscode"
import { selectTransport } from "../AdtTransports"
import { fieldOrder } from "../../lib"
import { MySearchResult, AdtObjectFinder } from "./AdtObjectFinder"
import {
  getClient,
  getRoot,
  uriRoot,
  pathSequence,
  createUri
} from "../conections"
import { isAbapStat, AbapStat, isAbapFolder, isFolder } from "abapfs"
import { fromNode } from "abapobject"

export const PACKAGE = "DEVC/K"
export const TMPPACKAGE = "$TMP"
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
  return window.showQuickPick(types.length > 0 ? types : rawtypes, {
    ignoreFocusOut: true
  })
}

export class AdtObjectCreator {
  private types?: ObjectType[]

  constructor(private connId: string) {}

  public async getObjectTypes(uri: Uri): Promise<ObjectType[]> {
    if (!this.types) this.types = await getClient(this.connId).loadTypes()
    const parent = getRoot(this.connId).getNode(uri.path)
    let otype = parent && isAbapStat(parent) && parent.object.type
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
    const layer = hasPackageOptions(options) ? options.transportLayer : ""
    const transport = await selectTransport(
      objectPath(options.objtype, options.name, options.parentName),
      devclass,
      getClient(this.connId),
      true,
      undefined,
      layer
    )
    if (transport.cancelled) return
    options.transport = transport.transport
    await getClient(this.connId).createObject(options)

    const obj = fromNode(
      {
        EXPANDABLE: "",
        OBJECT_NAME: options.name,
        OBJECT_TYPE: options.objtype,
        OBJECT_URI: objectPath(options),
        OBJECT_VIT_URI: "",
        TECH_NAME: options.name
      },
      undefined,
      getRoot(this.connId).service
    )
    await obj.loadStructure()
    return obj
  }
  public guessParentByType(hierarchy: AbapStat[], type: ParentTypeIds): string {
    return hierarchy.find(n => n.object.type === type)?.object.name || ""
  }

  private async guessOrSelectObjectType(
    hierarchy: AbapStat[]
  ): Promise<CreatableType | undefined> {
    const base = hierarchy[0]
    // if I picked the root node,a direct descendent or a package just ask the user to select any object type
    // if not, for abap nodes pick child objetc types (if any)
    // for non-abap nodes if it's an object type guess the type from the children
    if (hierarchy.length > 2)
      if (base.object.type.match(/FUGR\/F/))
        return selectObjectType(base.object.type)
      else {
        const child = isFolder(base)
          ? [...base]
              .map(c => c.file)
              .find(c => isAbapStat(c) && c.object.type !== PACKAGE)
          : base
        if (child && isAbapStat(child)) {
          const typeid = child.object.type as CreatableTypeIds
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
    else if (objDetails.objtype === PACKAGE && hasPackageOptions(objDetails)) {
      validateOptions = {
        description: objDetails.description,
        objname: objDetails.name,
        objtype: objDetails.objtype as PackageTypeId,
        packagename: objDetails.parentName,
        swcomp: objDetails.swcomp,
        packagetype: objDetails.packagetype,
        transportLayer: objDetails.transportLayer
      }
    } else
      validateOptions = {
        description: objDetails.description,
        objname: objDetails.name,
        objtype: objDetails.objtype as NonGroupTypeIds,
        packagename: objDetails.parentName
      }
    return getClient(this.connId).validateNewObject(validateOptions)
  }

  private async selectTransportLayer() {
    const layers = await getClient(this.connId).packageSearchHelp(
      "transportlayers"
    )
    const items = layers.map(l => ({
      label: l.name,
      description: l.description,
      detail: l.data
    }))
    return await window.showQuickPick(items, { ignoreFocusOut: true })
  }

  private async getPackageOptions(options: NewObjectOptions) {
    const swcomp = await this.askInput(
      "Software Component",
      true,
      options.name.match(/^\$/) ? "LOCAL" : "HOME"
    )
    if (!swcomp) return
    const packagetype = (await window.showQuickPick(
      ["development", "structure", "main"],
      { ignoreFocusOut: true }
    )) as PackageTypes | undefined
    if (!packagetype) return
    const layer = await this.selectTransportLayer()
    if (!layer) return
    const packageData: PackageSpecificData = {
      swcomp,
      packagetype,
      transportLayer: layer.label
    }
    return packageData
  }
  private async askParent(parentType: string) {
    const parent = await new AdtObjectFinder(this.connId).findObject(
      "Select parent",
      parentType
    )
    if (!parent) return ["", ""]
    const devclass = await this.findPackage(parent)
    return [parent.name, devclass]
  }
  private async getObjectDetails(uri: Uri | undefined): Promise<details> {
    const hierarchy = pathSequence(getRoot(this.connId), uri)
    let devclass: string = this.guessParentByType(hierarchy, PACKAGE)
    const objType = await this.guessOrSelectObjectType(hierarchy)
    // user didn't pick one...
    if (!objType) return
    const name = await this.askName(objType.typeId)
    if (!name) return
    const description = await this.askInput("description", false)
    if (!description) return
    const responsible = getClient(this.connId).username.toUpperCase()
    const parentType = parentTypeId(objType.typeId)
    let parentName
    if (parentType !== PACKAGE) {
      parentName = this.guessParentByType(hierarchy, "FUGR/F")
      if (!parentName) [parentName, devclass] = await this.askParent(parentType)
      if (!parentName) return
    }

    if (!devclass) {
      const packageResult = await new AdtObjectFinder(this.connId).findObject(
        "Select package",
        PACKAGE,
        objType.typeId
      )
      if (!packageResult) return
      devclass = packageResult.name
    }
    if (parentType === PACKAGE) parentName = devclass
    if ((!devclass || !parentName) && objType.typeId !== PACKAGE) return
    if (!parentName) parentName = ""

    const options: NewObjectOptions | NewPackageOptions = {
      description,
      name: this.fixName(name, objType.typeId, parentName),
      objtype: objType.typeId,
      parentName,
      parentPath: objectPath(parentType, parentName, ""),
      responsible
    }
    if (isPackageType(options.objtype)) {
      const pkgopt = await this.getPackageOptions(options)
      if (!pkgopt) return
      const { swcomp, packagetype, transportLayer } = pkgopt

      const pkoptions = { ...options, swcomp, packagetype, transportLayer }
      return {
        devclass,
        options: pkoptions
      }
    } else return { devclass, options }
  }
  private async findPackage(parent: MySearchResult) {
    if (parent.packageName) return parent.packageName
    const root = getRoot(this.connId)
    const node = await root.findByAdtUri(parent.uri)
    if (!node) return ""
    const path = pathSequence(root, createUri(this.connId, node.path))
    // TODO: check questionable assumpsions
    if (path.length > 1 && path[path.length - 1].object.type === PACKAGE)
      return path[path.length - 1].object.name
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
      return this.askInput("suffix", true, "", (s: string) =>
        s.match(/^[A-Za-z]\w\w$/) ? "" : "Suffix must be 3 character long"
      )

    return this.askInput("name")
  }

  private async askInput(
    prompt: string,
    uppercase: boolean = true,
    value = "",
    validateInput = (s: string) => ""
  ): Promise<string> {
    const res =
      (await window.showInputBox({
        prompt,
        validateInput,
        value,
        ignoreFocusOut: true
      })) || ""
    return uppercase ? res.toUpperCase() : res
  }
}

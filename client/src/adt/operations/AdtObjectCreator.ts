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
  isPackageType,
  isBindingOptions,
  NewBindingOptions,
  BindinTypes
} from "abap-adt-api"
import { CreatableTypes } from "abap-adt-api"
import { Uri, window, FileStat } from "vscode"
import { selectTransport } from "../AdtTransports"
import { fieldOrder, quickPick, rfsExtract, rfsTaskEither, rfsTryCatch } from "../../lib"
import {
  MySearchResult,
  AdtObjectFinder,
  pathSequence,
  createUri
} from "./AdtObjectFinder"
import { getClient, getRoot } from "../conections"
import { isAbapFolder, isAbapStat, isFolder } from "abapfs"
import { fromNode } from "abapobject"
import { pipe } from "fp-ts/lib/pipeable"
import { bind, chain, map } from "fp-ts/lib/TaskEither"

export const PACKAGE = "DEVC/K"
export const TMPPACKAGE = "$TMP"
type details =
  | {
    options: NewObjectOptions
    devclass: string
  }
  | undefined

const validateMaxLen = (max: number, mandatory = true) => (s: string) => {
  if (mandatory && !s) return "Field is mandatory"
  if (s.length <= max) return ""
  return `Maximum current length of ${s.length} exceeds maximum (${max})`
}

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

  constructor(private connId: string) { }

  public async getObjectTypes(uri: Uri): Promise<ObjectType[]> {
    if (!this.types) this.types = await getClient(this.connId).loadTypes()
    const parent = getRoot(this.connId).getNode(uri.path)
    let otype = parent && isAbapStat(parent) && parent.object.type
    if (otype === PACKAGE) otype = ""
    return this.types!.filter(x => x.PARENT_OBJECT_TYPE === otype)
  }
  private async getAndRefreshParent(options: NewObjectOptions) {
    if (options.objtype !== "FUGR/FF") return
    const finder = new AdtObjectFinder(this.connId)
    const { file, uri } = await finder.vscodeUriWithFile(options.parentPath, false)
    if (isAbapFolder(file)) await file.refresh()
    if (isAbapStat(file)) return file.object
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
    const parent = await this.getAndRefreshParent(objDetails.options)
    const obj = fromNode(
      {
        EXPANDABLE: "",
        OBJECT_NAME: options.name,
        OBJECT_TYPE: options.objtype,
        OBJECT_URI: objectPath(options),
        OBJECT_VIT_URI: "",
        TECH_NAME: options.name
      },
      parent,
      getRoot(this.connId).service
    )
    if (options.objtype !== PACKAGE) await obj.loadStructure()
    return obj
  }

  public guessParentByType(hierarchy: FileStat[], type: ParentTypeIds): string {
    return (
      hierarchy.filter(isAbapStat).find(n => n.object.type === type)?.object
        .name || ""
    )
  }

  private async guessOrSelectObjectType(
    hierarchy: FileStat[]
  ): Promise<CreatableType | undefined> {
    const creatable = (file: FileStat) => {
      const type = isAbapStat(file) && file.object.type
      return (
        type && type !== PACKAGE && CreatableTypes.get(type as CreatableTypeIds)
      )
    }
    const first = hierarchy[0]
    if (isAbapStat(first) && first.object.type === "FUGR/F")
      return selectObjectType(first.object.type)

    for (const file of hierarchy) {
      const candidate = creatable(file)
      if (candidate) return candidate
      if (isFolder(file)) {
        for (const child of file) {
          const cc = creatable(child.file)
          if (cc) return cc
        }
      }
    }
    // Can't guess ...
    return selectObjectType()
  }

  private async validateObject(objDetails: NewObjectOptions) {
    let validateOptions: ValidateOptions
    if (isGroupType(objDetails.objtype))
      validateOptions = {
        description: objDetails.description,
        fugrname: objDetails.parentName,
        objname: objDetails.name,
        objtype: objDetails.objtype
      }
    else if (objDetails.objtype === PACKAGE && hasPackageOptions(objDetails)) {
      validateOptions = {
        description: objDetails.description,
        objname: objDetails.name,
        objtype: objDetails.objtype,
        packagename: objDetails.parentName,
        swcomp: objDetails.swcomp,
        packagetype: objDetails.packagetype,
        transportLayer: objDetails.transportLayer
      }
    } else if (isBindingOptions(objDetails)) {
      validateOptions = {
        description: objDetails.description,
        objname: objDetails.name,
        objtype: objDetails.objtype,
        package: objDetails.parentName,
        serviceBindingVersion: "ODATA\\V2",
        serviceDefinition: objDetails.service,
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
    items.push({ label: "", description: "Blank", detail: "" })
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
  private async askParent(parentType: string): Promise<[string, string]> {
    const parent = await new AdtObjectFinder(this.connId).findObject(
      "Select parent",
      parentType
    )
    if (!parent) return ["", ""]
    const devclass = await this.findPackage(parent)
    return [parent.name, devclass]
  }
  private async getServiceOptions(options: NewObjectOptions) {
    const types = BindinTypes.map(t => ({ label: t.description, payload: t }))
    const finder = rfsTryCatch(() => new AdtObjectFinder(this.connId).findObject(
      "Select Service definition", "SRVD/SRV"))
    const serviceOptions = await pipe(rfsTaskEither({}),
      bind("type", () => quickPick(types)),
      bind("service", () => finder),
      map(x => {
        if (!x.service) return
        const service = x.service.name
        const { bindingtype, category } = x.type.payload
        const opt = { ...options, bindingtype, category, service }
        if (isBindingOptions(opt)) return opt
        throw new Error("Unexpected Service binding option")
      }),
      chain(rfsTaskEither)
    )()
    return rfsExtract(serviceOptions)
  }
  private async getObjectDetails(uri: Uri | undefined): Promise<details> {
    const hierarchy = pathSequence(getRoot(this.connId), uri)
    let devclass: string = this.guessParentByType(hierarchy, PACKAGE)
    const objType = await this.guessOrSelectObjectType(hierarchy)
    // user didn't pick one...
    if (!objType) return
    const name = await this.askName(objType)
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

    const options: NewObjectOptions | NewPackageOptions | NewBindingOptions = {
      description,
      name: this.fixName(name, objType.typeId, parentName),
      objtype: objType.typeId,
      parentName,
      parentPath: objectPath(parentType, parentName, ""),
      responsible
    }
    if (options.objtype === "SRVB/SVB") {
      const o = await this.getServiceOptions(options)
      if (!o) return
      return { devclass, options: o }
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
    const last = path.length > 1 && path[path.length - 1]
    if (isAbapStat(last) && last.object.type === PACKAGE)
      return last.object.name
    return ""
  }
  private fixName(name: string, typeId: string, parentName: string): string {
    if (typeId !== "FUGR/I") return name
    const parts = parentName.split("/")

    return parts.length < 3
      ? `L${parentName}${name}`
      : `/${parts[1]}/L${parts[2]}${name}`
  }
  private askName(objType: CreatableType) {
    if (objType.typeId === "FUGR/I")
      return this.askInput("suffix", true, "", (s: string) =>
        s.match(/^[A-Za-z]\w\w$/) ? "" : "Suffix must be 3 character long"
      )

    return this.askInput("name", true, "", validateMaxLen(objType.maxLen))
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

import { Uri, window } from "vscode"
import { parsetoPromise, getNode, recxml2js } from "../AdtParserBase"
import { mapWith } from "../../functions"
import { AdtServer } from "../AdtServer"
import { isAbapNode } from "../../fs/AbapNode"
import {
  selectObjectType,
  ObjType,
  NewObjectConfig,
  OBJECTTYPES
} from "./AdtObjectTypes"
import { selectTransport } from "../AdtTransports"

interface ValidationMessage {
  SEVERITY: string
  SHORT_TEXT: string
  LONG_TEXT: string
}

interface AdtObjectType {
  OBJECT_TYPE: string
  OBJECT_TYPE_LABEL: string
  CATEGORY: string
  CATEGORY_LABEL: string
  URI_TEMPLATE: string
  PARENT_OBJECT_TYPE: string
  OBJNAME_MAXLENGTH: string
  canCreate: boolean
}
export class AdtObjectCreator {
  private types?: AdtObjectType[]

  constructor(private server: AdtServer) {}

  async loadTypes(): Promise<AdtObjectType[]> {
    const uri = this.server.connection.createUri(
      "/sap/bc/adt/repository/typestructure"
    )
    const response = await this.server.connection.request(uri, "POST")
    const raw = await parsetoPromise()(response.body)
    return getNode(
      "asx:abap/asx:values/DATA/SEU_ADT_OBJECT_TYPE_DESCRIPTOR",
      mapWith(recxml2js),
      (typedescs: any[]) => typedescs.filter(td => td.CAPABILITIES !== ""),
      mapWith(x => {
        const { CAPABILITIES, ...rest } = x
        const canCreate = !!CAPABILITIES.SEU_ACTION.find(
          (x: any) => x === "CREATE"
        )
        return { ...rest, canCreate }
      }),
      raw
    )
  }

  async getObjectTypes(uri: Uri): Promise<AdtObjectType[]> {
    if (!this.types) this.types = await this.loadTypes()
    const parent = this.server.findNode(uri)
    let otype = parent && isAbapNode(parent) && parent.abapObject.type
    if (otype === "DEVC/K") otype = ""
    return this.types!.filter(x => x.PARENT_OBJECT_TYPE === otype)
  }

  private async guessOrSelectObjectType(
    uri: Uri | undefined
  ): Promise<ObjType | undefined> {
    //TODO: guess from URI
    return selectObjectType()
  }

  private async validateObject(
    objType: ObjType,
    objDetails: NewObjectConfig
  ): Promise<ValidationMessage[]> {
    const url = this.server.connection.createUri(
      objType.getValidatePath(objDetails)
    )
    const response = await this.server.connection.request(url, "POST")
    const rawValidation = await parsetoPromise()(response.body)
    return getNode(
      "asx:abap/asx:values/DATA",
      mapWith(recxml2js),
      rawValidation
    ) as ValidationMessage[]
  }

  private async selectTransport(
    objType: ObjType,
    objDetails: NewObjectConfig
  ): Promise<string> {
    //TODO: no request for temp packages
    const uri = this.server.connection.createUri(objType.getPath(objDetails))
    return selectTransport(uri, this.server.connection)
  }
  private async create(
    objType: ObjType,
    objDetails: NewObjectConfig,
    request: string
  ) {
    const uri = this.server.connection.createUri(
      objType.getBasePath(objDetails)
    )
    let body = objType.getCreatePayload(objDetails)
    const query = request ? `corrNr=${request}` : ""
    let response = await this.server.connection.request(uri, "POST", {
      body,
      query
    })
    //TODO error handling
    return response
  }

  async createObject(uri: Uri | undefined) {
    const objType = await this.guessOrSelectObjectType(uri)
    if (!objType) return
    //TODO: objecttype dependent selection
    const name = (await window.showInputBox({ prompt: "name" })) || "",
      description =
        (await window.showInputBox({ prompt: "description" })) || "",
      parentName = (await window.showInputBox({ prompt: "parent" })) || "",
      devclass = (await window.showInputBox({ prompt: "Package" })) || ""
    const objDetails: NewObjectConfig = {
      description,
      devclass,
      parentName,
      name
    }
    const valresult = await this.validateObject(objType, objDetails)
    const err =
      valresult.length > 0 && valresult.find(x => x.SEVERITY === "ERROR")
    if (err) throw new Error(err.SHORT_TEXT)

    const trnumber = await this.selectTransport(objType, objDetails)

    const res = await this.create(objType, objDetails, trnumber)
    //TODO:error handling

    return objType.getPath(objDetails)
  }
}

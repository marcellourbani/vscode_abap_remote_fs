import { Uri } from "vscode"
import { AdtConnection } from "../adt/AdtConnection"
import { pick } from "../functions"

export const XML_EXTENSION = ".XML"
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

export class AbapObjectName {
  namespace: string
  name: string
  vsName(): string {
    return this.namespace === ""
      ? this.name
      : `／${this.namespace}／${this.name}`
  }
  abapName(): string {
    return this.namespace === "" ? this.name : `/${this.namespace}/${this.name}`
  }
  constructor(fullname: string) {
    const parts = fullname.replace(/／/g, "/").match(/^\/([^\/]*)\/(.*)/)
    if (parts) {
      this.namespace = parts[1]
      this.name = parts[2]
    } else {
      this.name = fullname
      this.namespace = ""
    }
  }
}

export class AbapObject {
  type: string
  name: string
  path: string

  constructor(type: string, name: string, path: string) {
    this.name = name
    this.type = type
    this.path = path
  }

  isLeaf() {
    return true
  }
  vsName(): string {
    return this.name.replace(/\//g, "／") + this.getExtension()
  }

  getContents(connection: AdtConnection): Promise<string> {
    const suffix = this.getExtension() === XML_EXTENSION ? "" : "/source/main"
    const uri = Uri.parse("adt://" + connection.name).with({
      path: this.path + suffix
    })
    return connection.request(uri, "GET").then(pick("body"))
  }

  getExtension(): any {
    return this.isLeaf() ? ".abap" : ""
  }
  getChildren(
    connection: AdtConnection
  ): Promise<Array<AbapNodeComponentByCategory>> {
    throw new Error("Method not implemented.")
  }
}

import { Uri } from "vscode"

export interface AbapObjectPart {
  type: string
  name: string
  parent: AbapObject
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

  getUri(base: Uri): Uri {
    return base.with({ path: this.path + "/source/main" })
  }
  namespace(): string {
    return this.name.match(/^\//)
      ? this.name.replace(/^\/([^\/]*)\/.*/, "$1")
      : ""
  }
  nameinns(): string {
    return this.name.replace(/^\/[^\/]*\/(.*)/, "$1") + this.getExtension()
  }
  getExtension(): any {
    return this.isLeaf() ? ".abap" : ""
  }
}

import { AbapObject, AbapNodeComponentByCategory } from "./AbapObject"
import { NodeStructure } from "../parsers/AdtNodeStructParser"

import { FileSystemError } from "vscode"
import { followLink } from "../../functions"
import { aggregateNodes } from "./AbapObjectUtilities"
import { isClassInclude } from "./AbapClassInclude"
import { ADTClient, isClassStructure, AbapClassStructure } from "abap-adt-api"

export class AbapClass extends AbapObject {
  structure?: AbapClassStructure
  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: string
  ) {
    super(type, name, path, expandable, techName)
  }

  async loadMetadata(client: ADTClient): Promise<AbapObject> {
    if (this.name) {
      const struc = await client.objectStructure(this.path)
      if (isClassStructure(struc)) {
        this.structure = struc
      }
    }

    return this
  }

  async getChildren(
    client: ADTClient
  ): Promise<Array<AbapNodeComponentByCategory>> {
    if (this.isLeaf()) throw FileSystemError.FileNotADirectory(this.vsName)
    if (!this.metaData) await this.loadMetadata(connection)
    const mainUri = this.getUri(connection)

    const ns: NodeStructure = {
      categories: new Map(),
      objectTypes: new Map(),
      nodes: []
    }
    const main = this.selfLeafNode()
    main.OBJECT_URI = this.metaData!.sourcePath
    if (this.metaData)
      for (const include of this.metaData.includes) {
        const OBJECT_NAME = this.name + "." + include.includeType
        const node = {
          EXPANDABLE: "",
          OBJECT_NAME,
          OBJECT_TYPE: include.type,
          OBJECT_URI: followLink(mainUri, include.sourcePath).path,
          OBJECT_VIT_URI: "",
          TECH_NAME: include.includeType //bit of sa hack, used to match include metadata
        }

        if (include.sourcePath === "source/main") ns.nodes.unshift(node)
        else ns.nodes.push(node)
      }

    const aggregated = aggregateNodes(ns, this.type)
    for (const cat of aggregated)
      for (const type of cat.types)
        for (const incl of type.objects)
          if (isClassInclude(incl)) incl.setParent(this)

    return aggregated
  }
}

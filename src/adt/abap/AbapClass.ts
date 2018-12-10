import {
  AbapObject,
  AbapNodeComponentByCategory,
  AbapMetaData
} from "./AbapObject"
import { NodeStructure } from "../parsers/AdtNodeStructParser"
import { AdtConnection } from "../AdtConnection"
import { FileSystemError } from "vscode"
import { pick, followLink } from "../../functions"
import { aggregateNodes } from "./AbapObjectUtilities"
import { parseClass, firstTextLink } from "../parsers/AdtObjectParser"
import { parseToPromise } from "../parsers/AdtParserBase"
import { ClassIncludeMeta, isClassInclude } from "./AbapClassInclude"

interface ClassMetaData extends AbapMetaData {
  includes: Array<ClassIncludeMeta>
}
export class AbapClass extends AbapObject {
  metaData?: ClassMetaData
  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: string
  ) {
    super(type, name, path, expandable, techName)
  }

  async loadMetadata(connection: AdtConnection): Promise<AbapObject> {
    if (this.name) {
      const mainUri = this.getUri(connection)
      const meta = await connection
        .request(mainUri, "GET")
        .then(pick("body"))
        .then(parseToPromise())
        .then(parseClass)
      const includes = meta.includes.map(i => {
        const sourcePath = i.header["abapsource:sourceUri"]

        return {
          includeType: i.header["class:includeType"] || "",
          type: i.header["adtcore:type"],
          version: i.header["adtcore:version"],
          createdAt: Date.parse(i.header["adtcore:createdAt"]),
          changedAt: Date.parse(i.header["adtcore:changedAt"]),
          masterLanguage: i.header["adtcore:masterLanguage"],
          masterSystem: i.header["adtcore:masterSystem"],
          sourcePath
        }
      })

      const link = firstTextLink(meta.links)
      const sourcePath = link ? link.href : ""

      this.metaData = {
        createdAt: Date.parse(meta.header["adtcore:createdAt"]),
        changedAt: Date.parse(meta.header["adtcore:createdAt"]),
        version: meta.header["adtcore:version"],
        masterLanguage: meta.header["adtcore:masterLanguage"],
        masterSystem: meta.header["adtcore:masterSystem"],
        sourcePath,
        includes
      }
    }
    return this
  }

  async getChildren(
    connection: AdtConnection
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

    const aggregated = aggregateNodes(ns)
    for (const cat of aggregated)
      for (const type of cat.types)
        for (const incl of type.objects)
          if (isClassInclude(incl)) incl.setParent(this)

    return aggregated
  }
}

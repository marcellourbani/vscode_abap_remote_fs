import { AbapObject, AbapNodeComponentByCategory } from "./AbapObject"
import { NodeStructure } from "../adt/AdtNodeStructParser"
import { AdtConnection } from "../adt/AdtConnection"
import { FileSystemError } from "vscode"
import { pick } from "../functions"
import { aggregateNodes } from "./AbapObjectUtilities"
import { parseClass, firstTextLink } from "../adt/AdtObjectParser"
import { parsetoPromise } from "../adt/AdtParserBase"

export class AbapClass extends AbapObject {
  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: string
  ) {
    super(type, name, path, expandable, techName)
  }
  getChildren(
    connection: AdtConnection
  ): Promise<Array<AbapNodeComponentByCategory>> {
    if (this.isLeaf()) throw FileSystemError.FileNotADirectory(this.vsName())
    const mainUri = this.getUri(connection)
    const follow = this.followLinkGen(mainUri)

    return connection
      .request(mainUri, "GET")
      .then(pick("body"))
      .then(
        parsetoPromise<NodeStructure>((body: string) => {
          const parsed = parseClass(body)
          const ns: NodeStructure = {
            categories: new Map(),
            objectTypes: new Map(),
            nodes: []
          }
          const mainLink = firstTextLink(parsed.links)
          const main = this.selfLeafNode()
          if (mainLink) main.OBJECT_URI = follow(mainLink.href).path

          for (const classInc of parsed.includes) {
            const name = this.name + "." + classInc.header["class:includeType"]
            const node = {
              EXPANDABLE: "",
              OBJECT_NAME: name,
              OBJECT_TYPE: classInc.header["adtcore:type"],
              OBJECT_URI: follow(classInc.header["abapsource:sourceUri"]).path,
              OBJECT_VIT_URI: "",
              TECH_NAME: name
            }
            if (classInc.header["abapsource:sourceUri"] === "source/main")
              ns.nodes.unshift(node)
            else ns.nodes.push(node)
          }

          return ns
        })
      )
      .then(aggregateNodes)
  }
}

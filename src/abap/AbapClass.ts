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
          ns.nodes.push(main)

          for (const classInc of parsed.includes) {
            if (classInc.header["abapsource:sourceUri"] !== "source/main") {
              const name =
                this.name + "." + classInc.header["class:includeType"]
              ns.nodes.push({
                EXPANDABLE: "",
                OBJECT_NAME: name,
                OBJECT_TYPE: classInc.header["adtcore:type"],
                OBJECT_URI: follow(classInc.header["abapsource:sourceUri"])
                  .path,
                OBJECT_VIT_URI: "",
                TECH_NAME: name
              })
            }
          }

          return ns
        })
      )
      .then(aggregateNodes)
  }

  // protected filterNodeStructure(nodest: NodeStructure): NodeStructure {
  //   const nodes = nodest.nodes.filter(
  //     x =>
  //       this.whiteListed(x.OBJECT_TYPE) &&
  //       (x.OBJECT_TYPE !== "PROG/I" || //keep includes only if they start with the program name
  //         x.OBJECT_NAME.length === this.name.length + 3) &&
  //       x.OBJECT_NAME.substr(0, this.name.length) === this.name
  //   )

  //   nodes.unshift({
  //     OBJECT_NAME: this.name,
  //     OBJECT_TYPE: this.type,
  //     OBJECT_URI: this.path,
  //     OBJECT_VIT_URI: this.path,
  //     EXPANDABLE: "",
  //     TECH_NAME: this.techName
  //   })

  //   return {
  //     ...nodest,
  //     nodes
  //   }
  // }
}

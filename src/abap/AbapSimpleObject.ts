import {
  AbapObject,
  XML_EXTENSION,
  AbapNodeComponentByCategory,
  AbapObjectName
} from "./AbapObject"
import { AdtConnection } from "../adt/AdtConnection"
import { Uri, FileSystemError } from "vscode"
import { pick, GroupArray, mapGetOrSet } from "../functions"
import { parseNode, aggregateNodes } from "../adt/AdtNodeStructParser"

export class AbapSimpleObjectXml extends AbapObject {
  getExtension() {
    return XML_EXTENSION
  }
}
export class AbapGenericObject extends AbapObject {
  expandable: boolean
  sapguiOnly: boolean

  constructor(type: string, name: string, path: string, expandable: string) {
    super(type, name, path)
    this.expandable = !!expandable
    this.sapguiOnly = !!path.match(/\/sap\/bc\/adt\/vit/)
  }
  isLeaf() {
    return !this.expandable
  }
  getContents(connection: AdtConnection): Promise<string> {
    if (!this.isLeaf()) throw FileSystemError.FileIsADirectory(this.vsName())
    if (this.sapguiOnly)
      return Promise.resolve(
        "Objects of this type are only supported in SAPGUI"
      )
    const suffix = this.getExtension() === XML_EXTENSION ? "" : "/source/main"
    const uri = Uri.parse("adt://" + connection.name).with({
      path: this.path + suffix
    })
    return connection.request(uri, "GET").then(pick("body"))
  }
  getChildren(
    connection: AdtConnection
  ): Promise<Array<AbapNodeComponentByCategory>> {
    if (this.isLeaf()) throw FileSystemError.FileNotADirectory(this.vsName())
    const ptype = encodeURIComponent(this.type)
    const pname = encodeURIComponent(this.name)

    const uri = Uri.parse("adt://" + connection.name).with({
      path: "/sap/bc/adt/repository/nodestructure",
      query: `parent_name=${pname}&parent_tech_name=${pname}&parent_type=${ptype}&withShortDescriptions=true`
    })
    return (
      connection
        .request(uri, "POST")
        .then(pick("body"))
        .then(parseNode)
        //filter out subobjects before aggregating
        .then(nodestr => {
          //all subcomponents like local classes, fields,...
          // have the TECH_NAME of the actual include, so remove it!
          const technames = GroupArray("TECH_NAME")(nodestr.nodes)
          const forbidden = new Map(
            [...technames].filter(([name, nodes]) =>
              nodes.find(v => v.OBJECT_NAME === name)
            )
          )

          return {
            categories: nodestr.categories,
            objectTypes: nodestr.objectTypes,
            nodes: nodestr.nodes.filter(n => {
              if (forbidden.get(n.TECH_NAME))
                return n.TECH_NAME === n.OBJECT_NAME
              return !n.OBJECT_URI.match("[#|?].*name=")
            })
          }
        })
        .then(aggregateNodes)
    )
  }
}

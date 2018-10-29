import {
  AbapObject,
  XML_EXTENSION,
  AbapNodeComponentByCategory
} from "./AbapObject"
import { AdtConnection } from "../adt/AdtConnection"
import { Uri, FileSystemError } from "vscode"
import { pick, GroupArray } from "../functions"
import { parseNode, aggregateNodes } from "../adt/AdtNodeStructParser"
import { parsetoPromise } from "../adt/AdtParserBase"

export class AbapSimpleObjectXml extends AbapObject {
  getExtension() {
    return XML_EXTENSION
  }
}
export class AbapGenericObject extends AbapObject {
  constructor(type: string, name: string, path: string, expandable: string) {
    super(type, name, path, expandable)
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

    const uri = Uri.parse(
      "adt://dummy//sap/bc/adt/repository/nodestructure"
    ).with({
      authority: connection.name,
      path: "/sap/bc/adt/repository/nodestructure",
      query: `parent_name=${pname}&parent_tech_name=${pname}&parent_type=${ptype}&withShortDescriptions=true`
    })

    connection
      .request(uri.with({ path: this.path, query: "" }), "GET")
      .then(pick("body"))
      .then(
        parsetoPromise((payload: any) => {
          const objectRoot = (payload: any) => payload[Object.keys(payload)[0]]
          const objheader = (payload: any) => objectRoot(payload)["$"]
          const mainLinks = (payload: any) =>
            objectRoot(payload)["atom:link"].map((x: any) => x["$"])
          const classIncludes = (payload: any) =>
            objectRoot(payload)["class:include"].map((x: any) => x["$"])

          let out = {
            h: objheader(payload),
            l: mainLinks(payload),
            ci: this.type.match(/CLAS/) && classIncludes(payload)
          }
          console.log(JSON.stringify(out))

          //payload[Object.keys(payload)[0]]["$"]
          //payload[Object.keys(payload)[0]]["atom:link"].map(x=>x["$"])
          //payload[Object.keys(payload)[0]]["class:include"].map(x=>x["$"])
          const header = payload["abapsource:objectStructureElement"]["$"]

          const links = payload["abapsource:objectStructureElement"][
            "atom:link"
          ].map((x: any) => x["$"])
          console.log(header, JSON.stringify(links))
        })
      )

    // connection
    //   .request(
    //     uri.with({ path: this.path + "/objectstructure", query: "" }),
    //     "GET"
    //   )
    //   .then(pick("body"))
    //   .then(
    //     parsetoPromise((payload: any) => {
    //       console.log(
    //         payload["abapsource:objectStructureElement"]["$"]["xml:base"]
    //       )
    //       const children =
    //         payload["abapsource:objectStructureElement"][
    //           "abapsource:objectStructureElement"
    //         ]
    //       const c2 = children.map((child: any) => {
    //         const nc: any = {}
    //         for (const p in child["$"]) {
    //           nc[p.replace(/.*:/, "")] = child["$"][p]
    //         }
    //         nc.links = child["atom:link"].map((l: any) => l["$"])
    //         return nc
    //       })
    //       console.log(c2, JSON.stringify(c2))
    //       const f = (ok: boolean, link: any) =>
    //         ok || !(link.href.match(/name=/) || link.href.match(/start=[0-9]/))

    //       const c3 = c2.filter((c: any) => c.links.reduce(f, false))
    //       console.log(c3, JSON.stringify(c3))
    //     })
    //   )
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
              return !(
                n.OBJECT_URI.match("[#?;].*name=") ||
                n.OBJECT_URI.match(/start=[0-9]/)
              )
            })
          }
        })
        .then(aggregateNodes)
    )
  }
}

import { AdtConnection } from "../AdtConnection"
import { commands, window } from "vscode"
import { AbapObject } from "../abap/AbapObject"
import { isAdtException } from "../AdtExceptions"
import {
  parseToPromise,
  getNode,
  getFieldAttributes
} from "../parsers/AdtParserBase"
import { mapWith } from "../../functions"
import { isString } from "util"
import { JSON2AbapXMLNode } from "../abap/JSONToAbapXml"
interface InactiveComponents {
  "adtcore:uri": string
  "adtcore:type": string
  "adtcore:name": string
  "adtcore:packageName": string
  "xmlns:adtcore": string
}
export class AdtObjectActivator {
  constructor(private connection: AdtConnection) {}
  async selectMain(obj: AbapObject): Promise<string> {
    const mainPrograms = await obj.getMainPrograms(this.connection)
    if (mainPrograms.length === 1) return mainPrograms[0]["adtcore:uri"]
    const mainProg = await window.showQuickPick(
      mainPrograms.map(p => p["adtcore:name"]),
      {
        placeHolder: "Please select a main program"
      }
    )
    if (mainProg)
      return mainPrograms.find(x => x["adtcore:name"] === mainProg)![
        "adtcore:uri"
      ]
    return ""
  }

  private async _activate(
    obj: AbapObject,
    extra?: string | InactiveComponents[]
  ): Promise<string | InactiveComponents[]> {
    const uri = obj.getContentsUri(this.connection).with({
      path: "/sap/bc/adt/activation",
      query: "method=activate&preauditRequested=true"
    })
    let components = ""
    let incl = ""
    if (isString(extra))
      incl = extra ? `?context=${encodeURIComponent(extra)}` : ""
    if (extra && !isString(extra))
      components = extra
        .map(x => JSON2AbapXMLNode(x, "adtcore:objectReference"))
        .join("\n")
    else
      components = `<adtcore:objectReference adtcore:uri="${
        obj.path
      }${incl}" adtcore:name="${obj.name}"/>`

    const payload =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
      components +
      `</adtcore:objectReferences>`

    const response = await this.connection.request(uri, "POST", {
      body: payload
    })
    if (response.body) {
      //activation error(s?)
      const raw = (await parseToPromise()(response.body)) as any

      if (raw && raw["chkl:messages"]) {
        const messages = getNode(
          "chkl:messages/msg/shortText/txt",
          raw
        ) as string[]

        return messages[0]
      } else if (raw && raw["ioc:inactiveObjects"]) {
        const components = (getNode(
          "ioc:inactiveObjects/ioc:entry",
          mapWith(getNode("ioc:object/ioc:ref")),
          mapWith(getFieldAttributes()),
          raw
        ) as InactiveComponents[]).filter(x => x)
        return components
      }
    }
    return ""
  }

  async activate(object: AbapObject) {
    const inactive = object.getActivationSubject()
    let message = ""
    try {
      let retval = await this._activate(inactive)
      if (retval) {
        if (isString(retval)) message = retval
        else {
          retval = await this._activate(inactive, retval)
          if (isString(retval)) message = retval
          else throw new Error("Unexpected activation error")
        }
      }
    } catch (e) {
      if (isAdtException(e)) {
        switch (e.type) {
          case "invalidMainProgram":
            const mainProg = await this.selectMain(inactive)
            const res = await this._activate(inactive, mainProg)
            if (isString(res)) message = res
            else throw new Error("Unexpected activation error")
            break
          default:
            throw e
        }
      } else throw e
    }
    if (message) window.showErrorMessage(message)
    else {
      //activation successful, update the status. By the book we should check if it's set by this object first...
      await inactive.loadMetadata(this.connection)
      commands.executeCommand("setContext", "abapfs:objectInactive", false)
    }
  }
}

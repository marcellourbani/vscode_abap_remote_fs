import { ADTClient, isAdtError } from "abap-adt-api"
import { window, commands } from "vscode"
import { AbapObject } from "../abap/AbapObject"

export class AdtObjectActivator {
  constructor(private client: ADTClient) {}
  public async selectMain(obj: AbapObject): Promise<string> {
    const mainPrograms = await obj.getMainPrograms(this.client)
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

  public async activate(object: AbapObject) {
    // TODO: handle multiple inactive components
    const inactive = object.getActivationSubject()
    let result
    let message
    try {
      result = await this.client.activate(inactive.name, inactive.path)
    } catch (e) {
      if (isAdtError(e) && e.type === "invalidMainProgram") {
        const mainProg = await this.selectMain(inactive)
        if (mainProg)
          result = await this.client.activate(
            inactive.name,
            inactive.path,
            mainProg
          )
      } else message = e.toString()
    }
    if (result && result.success) {
      await inactive.loadMetadata(this.client)
      commands.executeCommand("setContext", "abapfs:objectInactive", false)
    } else {
      window.showErrorMessage(
        (result && result.messages[0] && result.messages[0].shortText) ||
          message ||
          `Error activating ${object.name}`
      )
    }
  }
}

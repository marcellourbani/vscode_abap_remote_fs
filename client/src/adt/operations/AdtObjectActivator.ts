import { ADTClient, isAdtError, inactiveObjectsInResults } from "abap-adt-api"
import { AbapObject } from "../abap/AbapObject"
import { IncludeLensP } from "./IncludeLens"
import { Uri } from "vscode"

export class AdtObjectActivator {
  constructor(private client: ADTClient) {}

  public async activate(object: AbapObject, uri: Uri) {
    // TODO: handle multiple inactive components
    const inactive = object.getActivationSubject()
    let result
    let message
    try {
      result = await this.client.activate(inactive.name, inactive.path)
      if (result.inactive.length > 0) {
        const inactives = inactiveObjectsInResults(result)
        result = await this.client.activate(inactives)
      }
    } catch (e) {
      if (isAdtError(e) && e.type === "invalidMainProgram") {
        const provider = IncludeLensP.get()
        const mainProg = await provider.selectIncludeIfNeeded(uri)
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
    } else {
      message =
        (result && result.messages[0] && result.messages[0].shortText) ||
        message ||
        `Error activating ${object.name}`
      throw new Error(message)
    }
  }
}

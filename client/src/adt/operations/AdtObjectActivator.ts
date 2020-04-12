import { ADTClient, isAdtError, inactiveObjectsInResults } from "abap-adt-api"
import { AbapObject } from "../abap/AbapObject"
import { IncludeLensP } from "./IncludeLens"
import { Uri, EventEmitter } from "vscode"

export interface ActivationEvent {
  object: AbapObject
  uri: Uri
  activated: AbapObject
  mainProg?: string
}

export class AdtObjectActivator {
  constructor(private client: ADTClient) {}
  private emitter = new EventEmitter<ActivationEvent>()

  public get onActivate() {
    return this.emitter.event
  }

  public async activate(object: AbapObject, uri: Uri) {
    // TODO: handle multiple inactive components
    const inactive = object.getActivationSubject()
    let result
    let message
    let mainProg: string | undefined
    try {
      result = await this.client.activate(inactive.name, inactive.path)
      if (result.inactive.length > 0) {
        const inactives = inactiveObjectsInResults(result)
        result = await this.client.activate(inactives)
      }
    } catch (e) {
      if (isAdtError(e) && e.type === "invalidMainProgram") {
        const provider = IncludeLensP.get()
        mainProg = await provider.selectIncludeIfNeeded(uri)
        if (mainProg)
          result = await this.client.activate(
            inactive.name,
            inactive.path,
            mainProg
          )
      } else message = e.toString()
    }
    if (result && result.success) {
      this.emitter.fire({ object, uri, activated: inactive, mainProg })
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

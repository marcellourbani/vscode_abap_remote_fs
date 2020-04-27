import { ADTClient, isAdtError, inactiveObjectsInResults } from "abap-adt-api"
import { IncludeLensP } from "./IncludeLens"
import { Uri, EventEmitter } from "vscode"
import { AbapObject } from "abapobject"
import { getClient } from "../conections"

export interface ActivationEvent {
  object: AbapObject
  uri: Uri
  activated: AbapObject
  mainProg?: string
}

export class AdtObjectActivator {
  constructor(private client: ADTClient) {}
  private static instances = new Map<string, AdtObjectActivator>()
  private emitter = new EventEmitter<ActivationEvent>()
  public static get(connId: string) {
    let instance = this.instances.get(connId)
    if (!instance) {
      instance = new AdtObjectActivator(getClient(connId))
      this.instances.set(connId, instance)
    }
    return instance
  }

  public get onActivate() {
    return this.emitter.event
  }

  public async activate(object: AbapObject, uri: Uri) {
    const inactive = object.lockObject
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
      // TODO perhaps a stat is better?
      await inactive.loadStructure()
    } else {
      message =
        (result && result.messages[0] && result.messages[0].shortText) ||
        message ||
        `Error activating ${object.name}`
      throw new Error(message)
    }
  }
}

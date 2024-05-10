import { ADTClient, isAdtError, inactiveObjectsInResults } from "abap-adt-api"
import { Uri, EventEmitter } from "vscode"
import { AbapObject } from "abapobject"
import { getClient } from "../conections"
import { IncludeProvider, IncludeService } from "../includes"
import { isDefined } from "../../lib"

export interface ActivationEvent {
  object: AbapObject
  uri: Uri
  activated: AbapObject
  mainProg?: string
}

export class AdtObjectActivator {
  constructor(private client: ADTClient) { }
  private static instances = new Map<string, AdtObjectActivator>()
  private emitter = new EventEmitter<ActivationEvent>()
  public static get(connId: string) {
    let instance = this.instances.get(connId)
    if (!instance) {
      instance = new AdtObjectActivator(getClient(connId, false))
      this.instances.set(connId, instance)
    }
    return instance
  }

  public get onActivate() {
    return this.emitter.event
  }

  private async getMain(object: AbapObject, uri: Uri) {
    const service = IncludeService.get(uri.authority)
    if (!service.needMain(object)) return
    const provider = IncludeProvider.get()
    const main =
      service.current(uri.path) || (await provider.switchIncludeIfMissing(uri))
    return main?.["adtcore:uri"]
  }

  private async sibilings(object: AbapObject) {
    const inactive = (await this.client.inactiveObjects()).map(r => r.object)
    const parentUri = inactive.find(o => o?.["adtcore:uri"] === object.path)?.[
      "adtcore:parentUri"
    ]
    if (!parentUri || inactive.length <= 1) return

    return inactive
      .filter(isDefined)
      .filter(o => o?.["adtcore:parentUri"] === parentUri)
  }

  private async tryActivate(object: AbapObject, uri: Uri) {
    const { name, path } = object.lockObject
    let result
    const mainProg = await this.getMain(object, uri)
    result = await this.client.activate(name, path, mainProg, true)
    if (!result.success) {
      let inactives
      if (result.inactive.length > 0)
        inactives = inactiveObjectsInResults(result)
      else inactives = await this.sibilings(object)
      if (inactives) result = await this.client.activate(inactives)
    }
    return result
  }

  public async activate(object: AbapObject, uri: Uri) {
    const inactive = object.lockObject
    const result = await this.tryActivate(object, uri)
    const mainProg = await this.getMain(object, uri)
    if (result && result.success) {
      this.emitter.fire({ object, uri, activated: inactive, mainProg })
      await inactive.loadStructure()
    } else {
      const message =
        (result && result.messages[0] && result.messages[0].shortText) ||
        `Error activating ${object.name}`
      throw new Error(message)
    }
  }
}

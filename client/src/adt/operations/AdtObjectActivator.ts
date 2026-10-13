import type {
  ADTClient,
  ActivationResult,
  InactiveObject,
  InactiveObjectElement,
  InactiveObjectRecord,
  MainInclude
} from "abap-adt-api"
import { Uri, EventEmitter, workspace } from "vscode"
import { type AbapObject } from "abapobject"
import { isAbapFile, isAbapStat } from "abapfs"
import { ADTSCHEME, getClient, getRoot } from "../conections"
import { IncludeProvider, IncludeService } from "../includes"
import { caughtToString, createMutex } from "../../lib"
import {
  activateReferences,
  inactiveObjectRecords,
  type ActivationReference
} from "./activation/adtActivationApi"
import { pickInactiveObjects } from "./activation/activationPicker"
import {
  describeActivationError,
  isMainProgramError,
  logActivation,
  summarizeActivationFailure
} from "./activation/activationMessages"
import {
  adtObjectUri,
  hasOtherInactiveIncludes,
  inactiveProgramUnit,
  inactiveSiblings,
  objectsOf,
  sameAdtUri,
  uniqueRecords
} from "./activation/relatedInactive"

export interface ActivationEvent {
  connectionId: string
  /** objects sent to SAP that are active now */
  objects: InactiveObject[]
  /** the object activation was started from, when started from an editor */
  object?: AbapObject
  uri?: Uri
  mainProg?: string
}

export interface ActivationOutcome {
  ok: boolean
  cancelled?: boolean
  summary?: string
  details?: string
}

export interface MultipleActivationResult extends ActivationOutcome {
  availableCount: number
  selectedCount: number
  selectedObjects: InactiveObjectElement[]
  stillInactiveObjects: InactiveObjectElement[]
  /** inactive includes or main programs of the requested objects, which were not requested */
  relatedStillInactive: InactiveObjectElement[]
  notInactiveUris: string[]
}

type Attempt =
  { cancelled: true } | { cancelled?: false; result: ActivationResult; activated: InactiveObject[] }

const CANCELLED = "Activation cancelled by user"
const NOT_INACTIVE = "None of the requested objects are currently inactive"

const isInactiveStructure = (object: AbapObject) =>
  object.structure?.metaData["adtcore:version"] === "inactive"

const objectReference = (object: AbapObject): InactiveObject => ({
  "adtcore:uri": object.path,
  "adtcore:type": object.type,
  "adtcore:name": object.name,
  "adtcore:parentUri": ""
})

const decodeName = (name: string) => {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

const mainProgramName = (main: MainInclude) =>
  decodeName(main["adtcore:name"] || main["adtcore:uri"].split("/").pop() || "").toUpperCase()

const among = (objects: InactiveObjectElement[], selected: InactiveObject[]) =>
  objects.filter(object =>
    selected.some(other => sameAdtUri(other["adtcore:uri"], object["adtcore:uri"]))
  )

const relatedSummary = (activated: number, related: InactiveObjectElement[]) =>
  `Activated ${activated} object${activated === 1 ? "" : "s"}, but related objects that were not requested are still inactive: ${related.map(object => object["adtcore:name"]).join(", ")}`

export class AdtObjectActivator {
  private static instances = new Map<string, AdtObjectActivator>()
  private emitter = new EventEmitter<ActivationEvent>()
  private mutex = createMutex()

  constructor(
    private client: ADTClient,
    private connectionId: string
  ) {}

  public static get(connId: string) {
    const instance = this.instances.get(connId)
    if (instance) return instance
    const newinstance = new AdtObjectActivator(getClient(connId, false), connId)
    this.instances.set(connId, newinstance)
    return newinstance
  }

  public get onActivate() {
    return this.emitter.event
  }

  public async getInactiveObjects(): Promise<InactiveObjectElement[]> {
    return objectsOf(await inactiveObjectRecords(this.client))
  }

  /** Activates an editor object, together with its inactive siblings or includes */
  public async activate(
    object: AbapObject,
    uri: Uri,
    interactive = true
  ): Promise<ActivationOutcome> {
    try {
      const main = await this.mainProgram(object, uri)
      // a silent first attempt keeps tools from blocking on a dialog, the user is asked only on failure
      let attempt = await this.attemptActivation(object, main, false)
      if (!attempt.cancelled && !attempt.result.success)
        attempt = await this.attemptActivation(object, main, interactive)

      if (attempt.cancelled) return { ok: false, cancelled: true, summary: CANCELLED }
      if (!attempt.result.success) return summarizeActivationFailure(attempt.result, object.name)

      await this.refreshActivated(attempt.activated, object.lockObject)
      this.emitter.fire({
        connectionId: this.connectionId,
        objects: attempt.activated,
        object,
        uri,
        mainProg: main?.["adtcore:uri"]
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, summary: describeActivationError(error, "Activation") }
    }
  }

  /**
   * Activates inactive objects of the connection
   * @param objectUris exact objects to activate, skips the selection dialog
   */
  public async activateMultiple(
    interactive = true,
    objectUris?: string[]
  ): Promise<MultipleActivationResult> {
    let availableCount = 0
    let selectedObjects: InactiveObjectElement[] = []
    let notInactiveUris: string[] = []
    const outcome = (
      fields: ActivationOutcome,
      stillInactiveObjects: InactiveObjectElement[] = [],
      relatedStillInactive: InactiveObjectElement[] = []
    ): MultipleActivationResult => ({
      ...fields,
      availableCount,
      selectedCount: selectedObjects.length,
      selectedObjects,
      stillInactiveObjects,
      relatedStillInactive,
      notInactiveUris
    })

    try {
      const records = await inactiveObjectRecords(this.client)
      const inactive = objectsOf(records)
      availableCount = inactive.length

      if (objectUris) {
        selectedObjects = inactive.filter(object =>
          objectUris.some(uri => sameAdtUri(uri, object["adtcore:uri"]))
        )
        notInactiveUris = objectUris.filter(
          uri => !selectedObjects.some(object => sameAdtUri(uri, object["adtcore:uri"]))
        )
        if (!selectedObjects.length) return outcome({ ok: false, summary: NOT_INACTIVE })
      } else {
        if (!inactive.length) return outcome({ ok: true })
        const selection = interactive ? await pickInactiveObjects(records) : inactive
        if (!selection) return outcome({ ok: false, cancelled: true, summary: CANCELLED })
        if (!selection.length)
          return outcome({
            ok: false,
            cancelled: true,
            summary: "No objects selected for activation"
          })
        selectedObjects = selection
      }

      const result = await this.send(selectedObjects)
      const remaining = await inactiveObjectRecords(this.client)
      const stillInactive = among(objectsOf(remaining), selectedObjects)
      const activated = selectedObjects.filter(
        object =>
          !stillInactive.some(other => sameAdtUri(other["adtcore:uri"], object["adtcore:uri"]))
      )
      if (activated.length) {
        await this.refreshActivated(activated)
        this.emitter.fire({ connectionId: this.connectionId, objects: activated })
      }
      const related = objectUris ? await this.relatedStillInactive(selectedObjects, remaining) : []

      if (!result.success)
        return outcome(
          summarizeActivationFailure(result, selectedObjects[0]["adtcore:name"]),
          stillInactive,
          related
        )
      if (stillInactive.length) {
        const count = stillInactive.length
        const names = stillInactive.map(object => object["adtcore:name"]).join(", ")
        return outcome(
          {
            ok: false,
            summary: `Activation finished, but ${count} selected object${count === 1 ? " is" : "s are"} still inactive: ${names}`
          },
          stillInactive,
          related
        )
      }
      if (related.length)
        return outcome(
          { ok: true, summary: relatedSummary(activated.length, related) },
          [],
          related
        )
      return outcome({ ok: true })
    } catch (error) {
      // the activation might have partially happened before the error
      const stillInactive = selectedObjects.length
        ? await this.stillInactive(selectedObjects).catch(() => [])
        : []
      return outcome(
        { ok: false, summary: describeActivationError(error, "Multiple activation") },
        stillInactive
      )
    }
  }

  private async attemptActivation(
    object: AbapObject,
    main: MainInclude | undefined,
    interactive: boolean
  ): Promise<Attempt> {
    const lockObject = object.lockObject
    const records = await this.inactiveRecordsIfAvailable()
    const related = await this.relatedInactive(object, main, records)
    if (related.length > 1) return this.activateRecords(related, interactive)

    const result = await this.exclusive(() =>
      this.client.activate(lockObject.name, lockObject.path, main?.["adtcore:uri"], true)
    )
    if (result.success) return { result, activated: [objectReference(lockObject)] }

    // SAP lists the objects it wants activated together, programs rely on their include list
    const fallback =
      lockObject.type === "PROG/P" || !result.inactive.length
        ? related
        : result.inactive.filter(record => record.object)
    if (!fallback.length) return { result, activated: [] }
    const retry = await this.activateRecords(fallback, interactive && fallback.length > 1)
    return retry.cancelled ? { result, activated: [] } : retry
  }

  private async activateRecords(
    records: InactiveObjectRecord[],
    interactive: boolean
  ): Promise<Attempt> {
    const selection = interactive ? await pickInactiveObjects(records) : objectsOf(records)
    if (!selection?.length) return { cancelled: true }
    return { result: await this.send(selection), activated: selection }
  }

  /** The by-name activation does not need the list, so a failing list request is not fatal */
  private async inactiveRecordsIfAvailable() {
    try {
      return await inactiveObjectRecords(this.client)
    } catch (error) {
      logActivation(`Could not read inactive objects: ${caughtToString(error)}`)
      return []
    }
  }

  private async relatedInactive(
    object: AbapObject,
    main: MainInclude | undefined,
    records: InactiveObjectRecord[]
  ): Promise<InactiveObjectRecord[]> {
    if (!records.length) return []
    const lockObject = object.lockObject

    if (lockObject.type === "PROG/P") {
      const includes = hasOtherInactiveIncludes(records)
        ? await this.programIncludeUris(lockObject.name)
        : []
      return inactiveProgramUnit(records, lockObject.path, includes)
    }

    if (object.type === "PROG/I") {
      if (!main) return []
      const includes = hasOtherInactiveIncludes(records, object.path)
        ? await this.programIncludeUris(mainProgramName(main))
        : []
      return inactiveProgramUnit(records, main["adtcore:uri"], includes, object.path)
    }

    return inactiveSiblings(records, object.path)
  }

  /** Includes straight from SAP: the file system hides them for non expandable programs */
  private async programIncludeUris(programName: string) {
    if (!programName) return []
    try {
      const structure = await this.client.statelessClone.nodeContents(
        "PROG/P",
        programName,
        undefined,
        undefined,
        true
      )
      return structure.nodes
        .filter(node => node.OBJECT_TYPE === "PROG/I" && node.OBJECT_URI)
        .map(node => node.OBJECT_URI)
    } catch (error) {
      // still activates the main program and the current include
      logActivation(`Could not read includes of ${programName}: ${caughtToString(error)}`)
      return []
    }
  }

  private async mainProgram(object: AbapObject, uri: Uri): Promise<MainInclude | undefined> {
    const service = IncludeService.get(uri.authority)
    if (!service.needMain(object)) return
    return service.current(uri.path) || (await IncludeProvider.get().switchIncludeIfMissing(uri))
  }

  private async includeMainUri(object: InactiveObject): Promise<string | undefined> {
    const objectUri = object["adtcore:uri"]
    if (object["adtcore:type"] !== "PROG/I") return
    try {
      const node = await getRoot(this.connectionId).findByAdtUri(objectUri)
      if (!node || !isAbapFile(node.file)) return
      const uri = Uri.from({ scheme: ADTSCHEME, authority: this.connectionId, path: node.path })
      return (await this.mainProgram(node.file.object, uri))?.["adtcore:uri"]
    } catch (error) {
      logActivation(`Could not resolve main program of ${objectUri}: ${caughtToString(error)}`)
    }
  }

  private async includeMainUris(objects: InactiveObject[]) {
    const mains: (string | undefined)[] = []
    // sequential: resolving a main program can prompt, and concurrent quick picks cancel each other
    for (const object of objects) mains.push(await this.includeMainUri(object))
    return mains
  }

  private references(
    objects: InactiveObject[],
    mains: (string | undefined)[],
    useContext: (mainUri: string) => boolean
  ): ActivationReference[] {
    return objects.map((object, index) => {
      const objectUri = object["adtcore:uri"]
      const main = mains[index]
      return {
        uri:
          main && useContext(main) ? `${objectUri}?context=${encodeURIComponent(main)}` : objectUri,
        type: object["adtcore:type"],
        name: object["adtcore:name"],
        parentUri: object["adtcore:parentUri"]
      }
    })
  }

  /**
   * Objects without parent URI come from the plain XML list and need the raw request.
   * SAP checks an include context against the active main program: a never activated program
   * needs the context, an active one that lacks a newly added INCLUDE rejects it
   */
  private async send(objects: InactiveObject[]): Promise<ActivationResult> {
    if (objects.every(object => object["adtcore:parentUri"]))
      return this.exclusive(() => this.client.activate(objects))
    const mains = await this.includeMainUris(objects)
    const activate = (useContext: (mainUri: string) => boolean) =>
      this.exclusive(() =>
        activateReferences(this.client, this.references(objects, mains, useContext))
      )
    const inBatch = (mainUri: string) =>
      objects.some(object => sameAdtUri(object["adtcore:uri"], mainUri))
    try {
      return await activate(() => true)
    } catch (error) {
      if (!isMainProgramError(error) || !mains.some(main => main && inBatch(main))) throw error
      logActivation("SAP rejected the include context, retrying with the main program in the batch")
      return activate(mainUri => !inBatch(mainUri))
    }
  }

  /** Serializes activation requests of this connection, prompts must stay outside */
  private exclusive<T>(request: () => Promise<T>): Promise<T> {
    return this.mutex("activation", request)
  }

  private async stillInactive(selected: InactiveObject[]) {
    return among(await this.getInactiveObjects(), selected)
  }

  /** SAP can activate a program against the active version of its includes and leave them behind */
  private async relatedStillInactive(
    requested: InactiveObjectElement[],
    remaining: InactiveObjectRecord[]
  ) {
    const others = remaining.filter(
      record =>
        !requested.some(object => sameAdtUri(object["adtcore:uri"], record.object?.["adtcore:uri"]))
    )
    if (!others.length) return []
    const related: InactiveObjectRecord[] = []
    for (const object of requested) related.push(...(await this.relatedRecords(object, others)))
    return objectsOf(uniqueRecords(related))
  }

  private async relatedRecords(object: InactiveObjectElement, others: InactiveObjectRecord[]) {
    const uri = object["adtcore:uri"]
    if (object["adtcore:type"] === "PROG/P") {
      const includes = hasOtherInactiveIncludes(others)
        ? await this.programIncludeUris(object["adtcore:name"])
        : []
      return inactiveProgramUnit(others, uri, includes)
    }
    if (object["adtcore:type"] === "PROG/I") {
      const main = await this.knownMainProgram(object)
      if (!main) return []
      const includes = hasOtherInactiveIncludes(others, uri)
        ? await this.programIncludeUris(mainProgramName(main))
        : []
      return inactiveProgramUnit(others, main["adtcore:uri"], includes)
    }
    return inactiveSiblings([{ object }, ...others], uri).filter(record => record.object !== object)
  }

  /** Main program the include service can tell without asking the user */
  private async knownMainProgram(object: InactiveObject): Promise<MainInclude | undefined> {
    const objectUri = object["adtcore:uri"]
    try {
      const node = await getRoot(this.connectionId).findByAdtUri(objectUri)
      if (!node || !isAbapFile(node.file)) return
      const service = IncludeService.get(this.connectionId)
      const current = service.current(node.path)
      if (current) return current
      const candidates = await service.candidates(node.path)
      return candidates?.length === 1 ? candidates[0] : undefined
    } catch (error) {
      logActivation(`Could not resolve main program of ${objectUri}: ${caughtToString(error)}`)
    }
  }

  /** Drops cached inactive structures, so the activate button and decorations update */
  private async refreshActivated(objects: InactiveObject[], editorObject?: AbapObject) {
    const targets = new Set<AbapObject>(editorObject ? [editorObject] : [])
    try {
      const root = getRoot(this.connectionId)
      for (const object of objects)
        root.service.invalidateStructCache(adtObjectUri(object["adtcore:uri"]))
      for (const document of workspace.textDocuments) {
        const { scheme, authority, path } = document.uri
        if (scheme !== ADTSCHEME || authority !== this.connectionId) continue
        const node = root.getNode(path)
        if (!isAbapStat(node)) continue
        const lockObject = node.object.lockObject
        const activated = objects.some(
          object =>
            sameAdtUri(object["adtcore:uri"], lockObject.path) ||
            sameAdtUri(object["adtcore:uri"], node.object.path)
        )
        if (activated) targets.add(lockObject)
      }
    } catch (error) {
      logActivation(`Could not refresh activated objects: ${caughtToString(error)}`)
    }
    await Promise.all([...targets].map(target => this.reloadStructure(target)))
  }

  private async reloadStructure(object: AbapObject) {
    try {
      await object.loadStructure(true)
      // loadStructure shares a request started before the activation, that one is stale
      if (isInactiveStructure(object)) await object.loadStructure(true)
    } catch (error) {
      logActivation(`Could not reload ${object.name} after activation: ${caughtToString(error)}`)
    }
  }
}

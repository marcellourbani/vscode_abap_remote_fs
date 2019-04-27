import { MainProgram } from "../../../server/api"
import {
  CodeLensProvider,
  TextDocument,
  CancellationToken,
  EventEmitter,
  window,
  Uri,
  CodeLens,
  Range
} from "vscode"
import { AbapObject } from "../abap/AbapObject"
import { ADTClient } from "abap-adt-api"
import { fromUri } from "../AdtServer"
import { command, AbapFsCommands } from "../../commands"
import { isAbapNode } from "../../fs/AbapNode"
import { PACKAGE } from "./AdtObjectCreator"

export class IncludeLensP implements CodeLensProvider {
  public static get() {
    if (!this.instance) this.instance = new IncludeLensP()
    return this.instance
  }
  private static instance?: IncludeLensP
  @command(AbapFsCommands.changeInclude)
  private static async changeMain(uri: Uri) {
    const provider = this.get()
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    if (!obj) return
    const main = await provider.selectMain(obj, server.client, uri)
    if (!main) return
    provider.includes.set(uri.toString(), main)
    provider.emitter.fire()
  }
  private emitter = new EventEmitter<void>()
  private selectedEmitter = new EventEmitter<MainProgram>()
  private includes: Map<string, string> = new Map()
  private notInclude: Map<string, boolean> = new Map()
  private currentUri?: Uri

  public get onDidChangeCodeLenses() {
    return this.emitter.event
  }

  public get onDidSelectInclude() {
    return this.selectedEmitter.event
  }

  private constructor() {}

  public getMain(uri: Uri) {
    return this.includes.get(uri.toString())
  }

  public async guessMain(uri: Uri) {
    let mainProg = this.getMain(uri)
    if (mainProg) return mainProg
    const key = uri.toString()

    if (this.notInclude.get(key)) return

    const server = fromUri(uri)
    const [obj, parent] = await this.getObjectAndParent(uri)
    if (!obj) return
    // if I opened this from a function group or program, set the main include to that
    if (parent && parent.type !== PACKAGE) mainProg = parent.path
    if (!mainProg) {
      const mainPrograms = await obj.getMainPrograms(server.client)
      mainProg =
        mainPrograms && mainPrograms[0] && mainPrograms[0]["adtcore:uri"]
    }
    return mainProg
  }

  public async selectIncludeIfNeeded(uri: Uri) {
    let mainProg = this.getMain(uri)
    if (mainProg) return mainProg
    const key = uri.toString()

    if (this.notInclude.get(key)) return

    const server = fromUri(uri)
    const [obj, parent] = await this.getObjectAndParent(uri)
    if (!obj) return
    // if I opened this from a function group or program, set the main include to that
    if (parent && parent.type !== PACKAGE) mainProg = parent.path
    if (!mainProg) {
      this.currentUri = uri
      mainProg = await this.selectMain(obj, server.client, uri)
    } else this.notInclude.set(uri.toString(), true)
    if (mainProg) {
      this.includes.set(uri.toString(), mainProg)
      this.emitter.fire()
    }
    this.currentUri = undefined
    return mainProg
  }

  public async selectMain(
    obj: AbapObject,
    client: ADTClient,
    uri: Uri
  ): Promise<string> {
    try {
      const mainPrograms = await obj.getMainPrograms(client)
      let mainProgramUri
      if (mainPrograms.length === 1)
        mainProgramUri = mainPrograms[0]["adtcore:uri"]
      if (!mainProgramUri) {
        const mainProg = await window.showQuickPick(
          mainPrograms.map(p => p["adtcore:name"]),
          {
            placeHolder: `Please select a main program for ${obj.name}`
          }
        )
        if (mainProg)
          mainProgramUri = mainPrograms.find(
            x => x["adtcore:name"] === mainProg
          )!["adtcore:uri"]
      }
      if (mainProgramUri)
        this.selectedEmitter.fire({
          includeUri: uri.toString(),
          mainProgramUri
        })
      return mainProgramUri || ""
    } catch (e) {
      this.notInclude.set(uri.toString(), true)
    }
    return ""
  }

  public provideCodeLenses(document: TextDocument, token: CancellationToken) {
    const lenses = []

    if (this.hasMain(document.uri) || document.uri === this.currentUri) {
      if (this.notInclude.get(document.uri.toString())) return []
      const main = this.getMain(document.uri)
      const title = main
        ? `main program:${decodeURIComponent(main.replace(/.*\//, ""))}`
        : "Select main program"
      const changeInclude = {
        command: AbapFsCommands.changeInclude,
        title,
        arguments: [document.uri]
      }
      const lens = new CodeLens(new Range(0, 0, 0, 0), changeInclude)
      lenses.push(lens)
    }
    return lenses
  }

  private async getObjectAndParent(uri: Uri) {
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    const h = server.findNodeHierarchy(uri)
    const parentNode = h.find(n => isAbapNode(n) && n.abapObject !== obj)
    const parent = parentNode && isAbapNode(parentNode) && parentNode.abapObject
    return [obj, parent]
  }

  private hasMain(uri: Uri) {
    return this.includes.has(uri.toString())
  }
}

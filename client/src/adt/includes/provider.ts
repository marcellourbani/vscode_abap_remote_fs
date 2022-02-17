import {
  CodeLensProvider,
  TextDocument,
  EventEmitter,
  CodeLens,
  Range,
  window,
  Uri
} from "vscode"
import { abapUri } from "../conections"
import { IncludeService } from "./service"
import { MainProgram } from "vscode-abap-remote-fs-sharedapi"
import { AbapFsCommands } from "../../commands"

export class IncludeProvider implements CodeLensProvider {
  private static _instance: IncludeProvider
  static get() {
    if (!this._instance) this._instance = new IncludeProvider()
    return this._instance
  }
  private selectedEmitter = new EventEmitter<MainProgram>()
  private lensEmitter = new EventEmitter<void>()
  readonly onDidChangeCodeLenses = this.lensEmitter.event
  readonly onDidSelectInclude = this.selectedEmitter.event

  async provideCodeLenses(document: TextDocument) {
    const { uri } = document
    if (!abapUri(uri)) return
    const service = IncludeService.get(uri.authority)
    const candidates = await service.candidates(uri.path)
    if (!candidates) return
    const current = service.current(uri.path)
    const title = current
      ? `main program:${service.mainName(current!)}`
      : "Select main program"
    const changeInclude = {
      command: AbapFsCommands.changeInclude,
      title,
      arguments: [uri, this]
    }
    const lens = new CodeLens(new Range(0, 0, 0, 0), changeInclude)
    if (!current) this.switchInclude(uri)
    return [lens]
  }

  private async selectInclude(uri: Uri) {
    const service = IncludeService.get(uri.authority)
    let candidates = await service.candidates(uri.path)
    const guessed = service.guessParent(uri.path)
    if (guessed) return guessed
    if (!candidates?.length)
      candidates = await service.candidates(uri.path, true)
    if (!candidates?.length) return
    const sources = candidates.map(include => ({
      label: service.mainName(include),
      include
    }))
    const placeHolder = `Please select a main program for ${uri.path.replace(
      /.*\//,
      ""
    )}`
    const main = await window.showQuickPick(sources, { placeHolder })
    return main?.include
  }

  async switchInclude(uri: Uri) {
    if (!abapUri(uri)) return
    const service = IncludeService.get(uri.authority)
    const previous = service.current(uri.path)
    const newInclude = await this.selectInclude(uri)
    if (newInclude) {
      service.setInclude(uri.path, newInclude)
      if (newInclude["adtcore:uri"] !== previous?.["adtcore:uri"]) {
        const { "adtcore:uri": mainProgramUri } = newInclude
        const { includeUri } = service.includeData(uri.path) || {}
        if (includeUri)
          this.selectedEmitter.fire({ includeUri, mainProgramUri })
      }
      this.lensEmitter.fire()
    }
    return newInclude
  }

  async switchIncludeIfMissing(uri: Uri) {
    if (!abapUri(uri)) return
    const service = IncludeService.get(uri.authority)
    const current = service.current(uri.path)
    if (current) return current
    return this.switchInclude(uri)
  }

}

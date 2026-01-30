import { QuickDiffProvider, Uri } from "vscode"
import { AbapRevisionService } from "./abaprevisionservice"
import { abapUri } from "../../adt/conections"
import { quickDiffUri, AbapRevision } from "./documentprovider"
import { Revision } from "abap-adt-api"
import { AbapRevisionLens } from "./lenses"
import { toMs } from "./abapscm"

export class AbapQuickDiff implements QuickDiffProvider {
  public static get() {
    if (!this.instance) this.instance = new AbapQuickDiff()
    return this.instance
  }

  getCurrentRev(uri: Uri) {
    return this.currents.get(uri.toString())
  }

  setCurrentRev(uri: Uri, rev?: Revision) {
    if (rev) this.currents.set(uri.toString(), rev)
    else this.currents.delete(uri.toString())
    AbapRevisionLens.get().notify()
    const qu = quickDiffUri(uri)
    if (qu) AbapRevision.get().notifyChanged(qu)
  }

  async provideOriginalResource?(uri: Uri) {
    if (!abapUri(uri)) return
    const uritxt = uri.toString()
    const current = this.currents.get(uritxt)
    if (current) return quickDiffUri(uri)

    const service = AbapRevisionService.get(uri.authority)
    const revisions = await service.uriRevisions(uri, false)
    if (!revisions || revisions.length < 2) return
    const reference =
      revisions.find(r => toMs(revisions[0]!.date) - toMs(r.date) > 90000) ||
      revisions[1]!
    if (!reference) return
    this.currents.set(uritxt, reference)
    return quickDiffUri(uri)
  }
  private constructor() { }
  private static instance: AbapQuickDiff | undefined
  private currents = new Map<string, Revision>()
}

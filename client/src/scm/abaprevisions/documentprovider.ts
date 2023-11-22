import { TextDocumentContentProvider, Uri, EventEmitter } from "vscode"
import { Revision } from "abap-adt-api"
import { atob, btoa } from "../../lib"
import { abapUri, ADTSCHEME, getClient, getOrCreateClient, uriRoot } from "../../adt/conections"
import { isAbapFile } from "abapfs"
import { prettyPrint } from "./prettyprint"
import { AbapQuickDiff } from "./quickdiff"

export const ADTREVISIONSCHEME = "adt_revision"

interface SimpleSelector {
  type: "simple"
  revision?: Revision
  normalized: boolean
  origFragment?: string
}

interface QuickDiffSelector {
  type: "quickdiff"
  origFragment?: string
}
type Selector = SimpleSelector | QuickDiffSelector
const isQuickDiff = (s: Selector): s is QuickDiffSelector =>
  s.type === "quickdiff"

export function revisionUri(uri: Uri, revision?: Revision, normalized = false) {
  if (!abapUri(uri)) return
  const selector: SimpleSelector = {
    type: "simple",
    revision,
    normalized,
    origFragment: uri.fragment
  }
  const fragment = btoa(JSON.stringify(selector))
  return uri.with({ scheme: ADTREVISIONSCHEME, fragment })
}

export const quickDiffUri = (uri: Uri) => {
  if (!abapUri(uri)) return
  const selector: Selector = {
    type: "quickdiff",
    origFragment: uri.fragment
  }
  const fragment = btoa(JSON.stringify(selector))
  return uri.with({ scheme: ADTREVISIONSCHEME, fragment })
}

const decodeRevisionUri = (uri: Uri) => {
  if (uri.scheme !== ADTREVISIONSCHEME) return {}
  const selector: Selector = JSON.parse(atob(uri.fragment))
  const adtUri = uri.with({
    scheme: ADTSCHEME,
    fragment: selector.origFragment
  })
  return { adtUri, selector }
}

export class AbapRevision implements TextDocumentContentProvider {
  public static get() {
    if (!this.instance) this.instance = new AbapRevision()
    return this.instance
  }
  public get onDidChange() {
    return this.emitter.event
  }

  public notifyChanged(uri: Uri) {
    this.emitter.fire(uri)
  }

  async provideTextDocumentContent(uri: Uri) {
    const { adtUri, selector } = decodeRevisionUri(uri)
    if (!adtUri || !selector) return
    const client = await getOrCreateClient(uri.authority)
    let source = ""
    if (isQuickDiff(selector)) {
      const revision = AbapQuickDiff.get().getCurrentRev(adtUri)
      if (revision) source = await client.getObjectSource(revision.uri)
    } else {
      if (selector.revision) {
        source = await client.getObjectSource(selector.revision.uri)
      } else {
        const node = uriRoot(adtUri).getNode(adtUri.path)
        if (isAbapFile(node)) source = await node.object.read()
      }
      if (selector.normalized) source = await prettyPrint(uri, source) || ""
    }
    return source
  }
  private emitter = new EventEmitter<Uri>()
  private static instance?: AbapRevision
}

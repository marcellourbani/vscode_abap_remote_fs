import { cache } from "../../lib"
import {
  ADTClient,
  classIncludes,
  Revision,
  AbapObjectStructure
} from "abap-adt-api"
import { getClient, abapUri, getRoot } from "../../adt/conections"
import { AbapObject, isAbapClassInclude } from "abapobject"
import { Uri } from "vscode"
import { isAbapFile } from "abapfs"

export const revLabel = (rev: Revision | undefined, fallback: string) =>
  (rev && rev.version) || (rev && rev.date) || fallback

export class AbapRevisionService {
  public static get(connId: string) {
    return this.services.get(connId)
  }

  public async objRevisions(obj: AbapObject, refresh = false) {
    const cached = this.revisions.get(obj.key)
    if (cached && !refresh) return cached

    if (!obj.structure) await obj.loadStructure()
    const [include, structure] = isAbapClassInclude(obj)
      ? [obj.techName as classIncludes, obj.parent.structure]
      : [undefined, obj.structure]
    if (!structure) return []
    const revisions = await this.readRevisions(obj.key, structure, include)
    this.revisions.set(obj.key, revisions)
    return revisions
  }

  public async uriRevisions(uri: Uri, refresh: boolean) {
    if (!abapUri(uri)) return
    if (!uri.path.match(/\.abap/)) return
    const node = await getRoot(this.connId).getNodeAsync(uri.path)
    if (!isAbapFile(node)) return
    return this.objRevisions(node.object, refresh)
  }

  private async readRevisions(
    key: string,
    structure: AbapObjectStructure,
    include?: classIncludes
  ) {
    const prom =
      this.pending.get(key) || this.client.revisions(structure, include)
    this.pending.set(key, prom)
    prom.finally(() => this.pending.delete(key))
    return prom
  }

  private client: ADTClient
  private constructor(readonly connId: string) {
    this.client = getClient(connId)
  }
  private revisions = new Map<string, Revision[]>()
  private pending = new Map<string, Promise<Revision[]>>()
  private static services = cache(
    (connId: string) => new AbapRevisionService(connId)
  )
}

import { AbapFsService } from "./AFsService"
import { create, PACKAGE, PACKAGEBASEPATH, TMPPACKAGE } from "../../abapObject"
import { AbapFolder, isAbapFolder } from "./abapFolder"
import { Folder, PathItem } from "./folder"
import { PathStep } from "abap-adt-api"
import { isAbapStat } from "./abapFile"
import { FileStat } from "vscode"

const tag = Symbol("fsRoot")

export const TMPFOLDER = "$TMP"
export const LIBFOLDER = "System Library"
const createPkg = (name: string, service: AbapFsService) =>
  create(PACKAGE, name, PACKAGEBASEPATH, true, "", undefined, service)

const findInFolder = (
  file: FileStat,
  name: string,
  step: PathStep
): PathItem | undefined => {
  if (!isAbapFolder(file)) return
  if (
    file.object.type === step["adtcore:type"] &&
    file.object.name === step["adtcore:name"]
  )
    return { file, path: `${name}` }
  return file.findAbapObject(
    step["adtcore:type"],
    step["adtcore:name"],
    `${name}`
  )
}

export class Root extends Folder {
  [tag] = true
  constructor(readonly connId: string, readonly service: AbapFsService) {
    super()
    const tmp = createPkg(TMPPACKAGE, service)
    this.set(TMPFOLDER, new AbapFolder(tmp, this, service), true)
    const main = createPkg("", service)
    this.set(LIBFOLDER, new AbapFolder(main, this, service), true)
  }

  async findByAdtUri(uri: string, main = false) {
    // TODO: extract query and fragment
    const steps = await this.service.objectPath(uri)
    if (!steps.length) return
    // add a fake $TMP if neeeded
    const { "adtcore:type": type, "adtcore:name": name } = steps[0]
    if (type === PACKAGE && name !== TMPFOLDER && name.match(/^\$/))
      steps.unshift({
        "adtcore:name": TMPFOLDER,
        "adtcore:type": PACKAGE,
        "adtcore:uri": PACKAGEBASEPATH,
        "projectexplorer:category": ""
      })

    const [first, ...next] = steps
    let node = await this.findRoot(first)
    for (const step of next) {
      const file = node?.file
      if (!node || !isAbapFolder(file)) break
      const hit = findInFolder(node.file, node.path, step)
      if (hit) node = hit
      else {
        await file.refresh()
        node = findInFolder(node.file, node.path, step)
      }
    }
    if (isAbapFolder(node?.file) && main) {
      if (node?.file.size === 0) await node.file.refresh()
      return node?.file.mainInclude(node.path)
    }
    return node
  }

  private async findRoot(step: PathStep) {
    for (const { file, name } of this) {
      const hit = findInFolder(file, `/${name}`, step)
      if (hit) return hit
    }
    for (const { file, name } of this) {
      if (!isAbapFolder(file)) continue
      await file.refresh()
      const hit = findInFolder(file, `/${name}`, step)
      if (hit) return hit
    }
  }
}

export function createRoot(connId: string, service: AbapFsService) {
  return new Root(connId, service)
}

export const isRoot = (x: any): x is Root => !!x?.[tag]

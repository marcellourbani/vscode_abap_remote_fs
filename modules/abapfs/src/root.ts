import { AbapFsService } from "./AFsService"
import { create, PACKAGE, PACKAGEBASEPATH, TMPPACKAGE } from "../../abapObject"
import { AbapFolder, isAbapFolder } from "./abapFolder"
import { Folder, PathItem } from "./folder"
import { PathStep } from "abap-adt-api"
import { FileStat } from "vscode"
import { LockManager } from "./lockManager"
import { isAbapFile, isAbapStat } from "./abapFile"

const tag = Symbol("fsRoot")

interface AFItem extends PathItem {
  file: AbapFolder
}
const isAFItem = (i: PathItem): i is AFItem => isAbapFolder(i.file)

export const TMPFOLDER = "$TMP"
export const LIBFOLDER = "System Library"
const createPkg = (name: string, service: AbapFsService) =>
  create(PACKAGE, name, PACKAGEBASEPATH, true, "", undefined, "", service)

const toInclude = async (node: PathItem | undefined, adtPath: string, main: boolean) => {
  if (node && isAbapFolder(node?.file) && (main || node.path !== adtPath)) {
    if (node.file.size === 0) await node.file.refresh()
    for (const i of node.file.expandPath(node.path))
      if (isAbapFile(i.file) && i.file.object.structure && i.file.object.contentsPath() === adtPath)
        return i

    for (const i of node.file.expandPath(node.path))
      if (isAbapFile(i.file) && !i.file.object.structure) {
        try {
          await node.file.object.loadStructure()
          if (i.file.object.contentsPath() === adtPath)
            return i
        } catch (error) {
          // ignore
        }
      }

    if (main)
      return node.file.mainInclude(node.path)
  }
  return node
}

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
    step["adtcore:uri"],
    `${name}`
  )
}

export class Root extends Folder {
  [tag] = true
  lockManager: LockManager
  constructor(readonly connId: string, readonly service: AbapFsService) {
    super()
    const tmp = createPkg(TMPPACKAGE, service)
    this.set(TMPFOLDER, new AbapFolder(tmp, this, service), true)
    const main = createPkg("", service)
    this.set(LIBFOLDER, new AbapFolder(main, this, service), true)
    this.lockManager = new LockManager(this)
  }

  private adtToFs = new Map<string, string>()

  async findByAdtUri(uri: string, main = false) {
    const baseUrl = uri.replace(/[\?#].*/, "")
    const path = this.adtToFs.get(baseUrl)
    if (path) {
      const file = this.getNode(path)
      if (file) return toInclude({ path, file }, baseUrl, main)
    }
    const node = await this.findByAdtUriInt(baseUrl)
    if (node?.path) this.adtToFs.set(baseUrl, node.path)
    return toInclude(node, baseUrl, main)
  }

  private async childNode(node: AFItem, uri: string) {
    const found = node.file.object.path
    if (found !== uri && uri.startsWith(found)) {
      if (!node.file.size) await node.file.refresh()
      for (const n of node.file.expandPath(node.path))
        if (isAbapStat(n.file) && n.file.object.path === uri) return n
    }
    return node
  }

  private async findByAdtUriInt(uri: string) {
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
    // got the object, uri might be a subobject
    if (node && isAFItem(node)) node = await this.childNode(node, uri)
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

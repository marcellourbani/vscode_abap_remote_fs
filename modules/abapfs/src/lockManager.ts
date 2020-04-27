import { Root } from "./root"
import { LockObject, delay } from "./lockObject"
import { isAbapFile } from "./abapFile"
import { FileSystemError } from "vscode"

export class LockManager {
  constructor(private root: Root) {}
  private fileObjects = new Map<string, string>()
  private objects = new Map<string, LockObject>();

  *lockedPaths() {
    for (const [path, key] of this.fileObjects)
      if (this.objects.get(key)?.status.status !== "unlocked") yield path
  }

  lockObject(path: string) {
    const key = this.fileObjects.get(path)
    let lockObject = key && this.objects.get(key)
    if (lockObject) return lockObject

    const node = this.root.getNode(path)
    if (!isAbapFile(node))
      throw FileSystemError.FileNotFound(`Can't acquire lock for ${path}`)

    const toLock = node.object.lockObject
    this.fileObjects.set(path, toLock.key)
    lockObject = this.objects.get(toLock.key)
    if (!lockObject) {
      lockObject = new LockObject(toLock, this.root.service)
      this.objects.set(toLock.key, lockObject)
    }
    return lockObject
  }

  requestLock(path: string) {
    return this.lockObject(path).requestLock(path)
  }

  requestUnlock(path: string) {
    const request = this.lockObject(path).requestUnlock(path)
    this.checkSession()
    return request
  }

  lockStatus(path: string) {
    return this.lockObject(path).status
  }

  finalStatus(path: string) {
    return this.lockObject(path).finalStatus
  }

  private noLocksOrPending() {
    for (const obj of this.objects.values())
      if (obj.status.status !== "unlocked") return false
    return true
  }
  private async checkSession() {
    if (!this.noLocksOrPending) {
      await delay(500)
      if (!this.noLocksOrPending) this.root.service.dropSession()
    }
  }
}

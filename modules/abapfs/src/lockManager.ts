import { Root } from "./root"
import { LockObject, delay } from "./lockObject"
import { isAbapStat } from "./abapFile"
import { FileSystemError } from "vscode"
import { isAdtError, isCsrfError } from "abap-adt-api"

export class LockManager {
  constructor(private root: Root) { }
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

    if (!isAbapStat(node))
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
    return this.lockObject(path).requestLock(path).catch(async (error) => {
      if (isAdtError(error) && error.err === 401 || isCsrfError(error)) throw new Error(await this.relogin())
      throw error
    })
  }

  async relogin() {
    await this.dropall(true)?.catch(() => {/* */ })
    const result = await this.root.service.login().then(() => "successful", () => "failed")
    return (`All locks dropped due to expired sessions - login ${result}`)
  }

  requestUnlock(path: string, immediate = false) {
    const request = this.lockObject(path).requestUnlock(path, immediate)
    request.catch(e => {
      if (isCsrfError(e)) this.dropall()
      throw e
    })
    this.checkSession()
    return request
  }
  dropall(expired = false) {
    this.objects.clear()
    this.fileObjects.clear()
    if (!expired) return this.root.service.dropSession()
  }

  lockStatus(path: string) {
    return this.lockObject(path).status
  }

  finalStatus(path: string) {
    return this.lockObject(path).finalStatus
  }

  /** used to restore locks after a session drop */
  async restore() {
    this.root.service.login()
    for (const obj of this.objects.values()) await obj.restore()
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

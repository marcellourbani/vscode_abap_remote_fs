import { getServer, ADTSCHEME } from "../AdtServer"
import { ADTClient, session_types, AdtLock } from "abap-adt-api"
import { AbapObject, TransportStatus } from "../abap/AbapObject"
import { log } from "../../logger"
import { window, TextDocument, StatusBarAlignment, Uri } from "vscode"
import { uriName, promiseQueue, asyncCache, cache } from "../../functions"

const statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100)
type LockValidator = (l: AdtLock) => Promise<boolean>
async function validateLock(lock: AdtLock) {
  const ok = "Ok"
  if (lock && lock.IS_LINK_UP) {
    const resp = await window.showWarningMessage(
      `Object is locked, a new task will be created in ${lock.CORRUSER}'s ${
        lock.CORRNR
      } ${lock.CORRTEXT}`,
      ok,
      "Cancel"
    )
    return resp === ok
  }
  return true
}

export async function setDocumentLock(
  document: TextDocument,
  interactive = false
) {
  const uri = document.uri
  const lockManager = LockManager.get()
  if (uri.scheme === ADTSCHEME) {
    const cb = interactive ? validateLock : undefined
    if (document.isDirty)
      try {
        await lockManager.lock(uri, cb)
      } catch (e) {
        window.showErrorMessage(
          `${e.toString()}\nWon't be able to save changes`
        )
      }
    else await lockManager.unlock(uri)
  }
  return await lockManager.getFinalStatus(uri)
}
// when the extension is deactivated, all locks are dropped
// try to restore them as needed
export async function restoreLocks() {
  return Promise.all(
    window.visibleTextEditors.map(e => setDocumentLock(e.document))
  )
}

export class LockObject {
  public get transport(): string | TransportStatus {
    if (!this.lock) return TransportStatus.UNKNOWN
    return (
      this.lock.CORRNR ||
      (this.lock.IS_LOCAL ? TransportStatus.LOCAL : TransportStatus.REQUIRED)
    )
  }

  private children = new Set<string>()
  private lock?: AdtLock
  private current = promiseQueue(this.lock)

  public get finalStatus() {
    return this.current()
  }

  public get isLocked() {
    return !!this.lock
  }

  public get lockId() {
    return (this.lock && this.lock.LOCK_HANDLE) || ""
  }

  constructor(public main: AbapObject, private client: ADTClient) {}

  public async requestLock(uri: Uri, validate?: LockValidator) {
    // if (un)lock pending, wait for it
    const isLocked = await this.finalStatus
    const key = uri.toString()
    if (this.children.has(key)) return this.lock

    if (!isLocked) {
      let error: Error | undefined
      const onerr = (e: Error) => (error = e)
      const previous = this.lock

      const lockCB = async () => {
        this.client.stateful = session_types.stateful
        const lock = await this.client.lock(this.main.path)
        return lock
      }
      const validateCB = async (lock?: AdtLock) => {
        if (error || !lock) return lock
        if (!validate || (await validate(lock))) {
          log(`locked ${uriName(uri)} ${lock.LOCK_HANDLE}`)
          return lock
        } else {
          await this.client.unLock(this.main.path, lock.LOCK_HANDLE)
          return previous // undefined if unlock fails will return lock
        }
      }

      this.current(lockCB, onerr)
      const newLock = await this.current(validateCB, onerr)

      this.setLock(key, newLock)
      if (error) throw error // will not affect other (un)lock calls
    }
    return this.lock
  }

  public async requestUnLock(uri: Uri) {
    await this.finalStatus
    const key = uri.toString()
    if (this.children.size === 1 && this.children.has(key)) {
      if (this.lock) {
        let error
        const onerr = (e: Error) => (error = e)
        const cb = async () => {
          if (this.lock) {
            const handle = this.lock.LOCK_HANDLE
            await this.client.unLock(this.main.path, handle)
            log(`unlocked ${uriName(uri)} ${handle}`)
          }
          return undefined
        }

        this.setLock(key, await this.current(cb, onerr))
        if (error) throw error
      } else this.setLock(key)
    }
  }

  private setLock(key: string, lock?: AdtLock) {
    this.lock = lock
    if (lock) {
      this.children.add(key)
    } else this.children.delete(key)
  }
}

const createLC = (connId: string) => {
  const server = getServer(connId)
  const mains = new Map<string, AbapObject>()
  const getObjKey = async (uri: string) => {
    const vuri = Uri.parse(uri)
    const obj = await server.findAbapObject(vuri)
    const main = obj.getLockTarget()
    mains.set(main.key, main)
    return main.key
  }
  const objKeys = asyncCache(getObjKey, (u: Uri) => u.toString())
  const getLock = (key: string) => {
    const main = mains.get(key)
    if (!main) throw new Error("Locking object not found")
    return new LockObject(main, server.client)
  }
  const locks = cache(getLock)
  return {
    server,
    objKeys,
    locks
  }
}
// tslint:disable-next-line: max-classes-per-file
export class LockManager {
  public static get(): LockManager {
    if (!this.instance) this.instance = new LockManager()
    return this.instance
  }
  private static instance: LockManager
  private connections = cache(createLC)

  public async lock(uri: Uri, validate?: LockValidator) {
    const lo = await this.getLockObjAsync(uri)
    if (lo) {
      const result = await lo.requestLock(uri, validate)
      this.setCount(uri)
      return result
    }
  }

  public async unlock(uri: Uri) {
    const lo = await this.getLockObjAsync(uri)
    if (!lo) return
    await lo.requestUnLock(uri)
    const conn = this.connections.get(uri.authority)
    if (conn && !this.hasLocks(uri.authority))
      conn.server.client.stateful = session_types.stateless
    this.setCount(uri)
  }

  public getLockId(uri: Uri) {
    const lo = this.getLockObj(uri)
    return lo ? lo.lockId : ""
  }

  public getTransport(uri: Uri) {
    const lo = this.getLockObj(uri)
    return (lo && lo.transport) || TransportStatus.UNKNOWN
  }

  public async isLockedAsync(uri: Uri) {
    return !!(await this.getFinalStatus(uri))
  }

  public numLocked(connId: string) {
    const conn = this.connections.get(connId)
    if (!conn) return 0
    const locked = [...conn.locks].filter(x => x.isLocked)
    return locked.length
  }

  public async getFinalStatus(uri: Uri) {
    const lo = await this.getLockObjAsync(uri)
    if (!lo) return
    return lo.finalStatus
  }

  public hasLocks(connId?: string) {
    for (const conn of this.connections)
      if (!connId || conn.server.connectionId === connId)
        for (const l of conn.locks) if (l.isLocked) return true
    return false
  }

  private getLockObj(uri: Uri) {
    if (uri.scheme !== ADTSCHEME) return
    const conn = this.connections.get(uri.authority)
    const objKey = conn.objKeys.getSync(uri)
    return objKey && conn.locks.get(objKey)
  }

  private setCount(uri: Uri) {
    statusBarItem.text = `${uri.authority}:${this.numLocked(
      uri.authority
    )} objects locked`
    statusBarItem.show()
  }

  private async getLockObjAsync(uri: Uri) {
    if (uri.scheme !== ADTSCHEME) return

    const conn = this.connections.get(uri.authority)
    const objKey = await conn.objKeys.get(uri)
    return await conn.locks.get(objKey)
  }
}

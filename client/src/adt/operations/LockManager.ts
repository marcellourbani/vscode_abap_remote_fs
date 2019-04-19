import { AdtServer, getServer } from "./../AdtServer"
import { ADTSCHEME, fromUri } from "../AdtServer"
import { ADTClient, session_types, AdtLock } from "abap-adt-api"
import { AbapObject, TransportStatus } from "../abap/AbapObject"
import { log } from "../../logger"
import { window, TextDocument, StatusBarAlignment, Uri } from "vscode"
import { uriName, stringOrder } from "../../functions"

const eatException = (cb: (...args: any[]) => any) => (...args: any[]) => {
  try {
    return cb(...args)
  } catch (e) {
    return
  }
}

const cache = <TK, TP, TAK>(
  creator: (k: TAK) => TP,
  keyTran: (k: TK) => TAK = (x: any) => x
) => {
  const values = new Map<TAK, TP>()
  return {
    get: (k: TK) => {
      const ak = keyTran(k)
      let cur = values.get(ak)
      if (!cur) {
        cur = creator(ak)
        values.set(ak, cur)
      }
      return cur
    },
    get size() {
      return values.size
    },
    *[Symbol.iterator]() {
      const v = values.values()
      const r = v.next()
      if (!r.done) yield r.value
    }
  }
}

const asyncCache = <TK, TP, TAK>(
  creator: (k: TAK) => Promise<TP>,
  keyTran: (k: TK) => TAK = (x: any) => x
) => {
  const values = new Map<TAK, TP>()

  function get(k: TK) {
    return new Promise(async resolve => {
      const ak = keyTran(k)
      let cur = values.get(ak)
      if (!cur) {
        cur = await creator(ak)
        values.set(ak, cur)
      }
      resolve(cur)
    })
  }
  return {
    get,
    getSync: (k: TK) => values.get(keyTran(k)),
    get size() {
      return values.size
    },
    *[Symbol.iterator]() {
      const v = values.values()
      const r = v.next()
      if (!r.done) yield r.value
    }
  }
}

const promiseQueue = <T>(initial: T) => {
  let current = Promise.resolve(initial)
  let last = initial

  return (cb?: (c: T) => Promise<T>, onErr?: (e: Error) => void) => {
    // must guarantee current will always resolve!
    if (cb)
      current = current.then(async cur => {
        try {
          const newres = await cb(cur)
          last = newres
          return newres
        } catch (e) {
          if (onErr) eatException(onErr)(e)
          return last
        }
      })
    return current
  }
}

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
  public transport: string | TransportStatus = TransportStatus.UNKNOWN

  private children = new Set<string>()
  private get locked() {
    return !!this.lock
  }
  private lock?: AdtLock
  private current = promiseQueue(this.lock)

  public get hasLocks() {
    return this.children.size > 0 || this.status !== false
  }

  public get finalStatus() {
    return this.current()
  }

  public get status() {
    return this.locked
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
      this.transport =
        lock.CORRNR ||
        (lock.IS_LOCAL ? TransportStatus.LOCAL : TransportStatus.REQUIRED)
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
    const result = lo.requestUnLock(uri)
    const conn = this.connections.get(uri.authority)
    if (conn && !this.hasLocks(uri.authority))
      conn.server.client.stateful = session_types.stateless
    this.setCount(uri)
    return result
  }

  public getLockId(uri: Uri) {
    const lo = this.getLockObj(uri)
    return lo ? lo.lockId : ""
  }

  public async isLockedAsync(uri: Uri) {
    return !!(await this.getFinalStatus(uri))
  }

  public numLocked(connId: string) {
    const conn = this.connections.get(connId)
    if (!conn) return 0
    return [...conn.locks].filter(x => x.hasLocks).length
  }

  public async getFinalStatus(uri: Uri) {
    const lo = await this.getLockObjAsync(uri)
    if (!lo) return
    return lo.finalStatus
  }

  public hasLocks(connId?: string) {
    for (const conn of this.connections)
      if (!connId || conn.server.connectionId === connId)
        for (const l of conn.locks) if (l.hasLocks) return true
    return false
  }

  private getLockObj(uri: Uri) {
    if (uri.scheme !== ADTSCHEME) return ""
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

import { ADTSCHEME, fromUri } from "../AdtServer"
import { ADTClient, session_types, AdtLock } from "abap-adt-api"
import { AbapObject, TransportStatus } from "../abap/AbapObject"
import { log } from "../../logger"
import { window, TextDocument, StatusBarAlignment } from "vscode"

enum LockStatuses {
  LOCKED,
  UNLOCKED,
  LOCKING,
  UNLOCKING
}
const statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100)
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
  if (uri.scheme === ADTSCHEME) {
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    const shouldLock = document.isDirty
    // no need to lock objects already locked
    if (shouldLock !== server.lockManager.isLocked(obj)) {
      if (shouldLock) {
        try {
          if (interactive) await server.lockManager.lock(obj, validateLock)
          else await server.lockManager.lock(obj)
        } catch (e) {
          window.showErrorMessage(
            `${e.toString()}\nWon't be able to save changes`
          )
        }
      } else await server.lockManager.unlock(obj)
    }

    statusBarItem.text = `${uri.authority}:${
      server.lockManager.lockedObjects.length
    } objects locked`
    statusBarItem.show()
    return server.lockManager.isLocked(obj)
  }
}
// when the extension is deactivated, all locks are dropped
// try to restore them as needed
export async function restoreLocks() {
  return Promise.all(
    window.visibleTextEditors.map(e => setDocumentLock(e.document))
  )
}

class LockObject {
  public children: Set<string> = new Set()
  public listeners: Array<(s: LockStatuses) => void> = []
  public lockId: string = ""
  private pLockStatus = LockStatuses.UNLOCKED
  get lockStatus() {
    return this.pLockStatus
  }

  constructor(public main: AbapObject) {}

  public setLockStatus(status: LockStatuses, lockId: string = "") {
    this.pLockStatus = status
    this.lockId = status === LockStatuses.LOCKED ? lockId : ""
    const l = this.listeners
    this.listeners = []
    l.forEach(x => x(status))
  }

  public needLock(child: AbapObject) {
    this.children.add(child.key)
    return (
      this.lockStatus === LockStatuses.UNLOCKED ||
      this.lockStatus === LockStatuses.UNLOCKING
    )
  }

  public isLocked(child: AbapObject) {
    return this.children.has(child.key)
  }

  /**
   * Removes the child from the list of locked subobjects
   * returns true if the list of children is empty and an unlock is required
   *
   * @param {AbapObject} child
   * @returns
   * @memberof LockObject
   */
  public removeObject(child: AbapObject) {
    this.children.delete(child.key)
    return (
      this.children.size === 0 &&
      (this.lockStatus === LockStatuses.LOCKED ||
        this.lockStatus === LockStatuses.LOCKING)
    )
  }

  public waitStatusUpdate() {
    const waitUpdate = new Promise<LockStatuses>(resolve => {
      this.listeners.push(resolve)
    })
    return waitUpdate
  }
}

// tslint:disable-next-line:max-classes-per-file
export class LockManager {
  public l: Map<string, LockObject> = new Map()
  constructor(private client: ADTClient) {}

  public getLockId(obj: AbapObject): string {
    const lockObj = this.getLockObject(obj)
    // const lockId = this.locks.get(obj)
    if (lockObj.lockId) return lockObj.lockId
    throw new Error(`Object ${obj.name} is not locked`)
  }

  get needStateFul(): boolean {
    return this.lockedObjects.length > 0
  }

  public async lock(
    obj: AbapObject,
    validate?: (l: AdtLock) => Promise<boolean>
  ) {
    if (!obj.canBeWritten) return
    const lockObj = this.getLockObject(obj)
    if (!lockObj.needLock(obj)) return
    // if unlocking in process, wait for it to finish and then lock
    // perhaps we should check the status returned...
    if (lockObj.lockStatus === LockStatuses.UNLOCKING)
      await lockObj.waitStatusUpdate()

    if (!lockObj.needLock(obj)) return // in case another object triggered before

    lockObj.setLockStatus(LockStatuses.LOCKING)
    try {
      this.client.stateful = session_types.stateful
      const lock = await this.client.lock(lockObj.main.path)
      if (!validate || (await validate(lock))) {
        obj.transport =
          lock.CORRNR ||
          (lock.IS_LOCAL ? TransportStatus.LOCAL : TransportStatus.REQUIRED)
        lockObj.setLockStatus(LockStatuses.LOCKED, lock.LOCK_HANDLE)
        log("locked", obj.name)
        return lock
      } else {
        if (lockObj.removeObject(obj)) {
          lockObj.setLockStatus(LockStatuses.UNLOCKING)
          await this.client.unLock(lockObj.main.path, lock.LOCK_HANDLE)
          lockObj.setLockStatus(LockStatuses.UNLOCKED)
        }
      }
    } catch (e) {
      if (
        lockObj.removeObject(obj) &&
        lockObj.lockStatus === LockStatuses.LOCKING
      )
        lockObj.setLockStatus(LockStatuses.UNLOCKED)
      if (!this.needStateFul) this.client.stateful = session_types.stateless
      log("failed to lock", obj.name, e.toString())
      throw e
    }
  }

  public async unlock(obj: AbapObject) {
    if (!obj.canBeWritten) return
    const lockObj = this.getLockObject(obj)
    if (!lockObj.removeObject(obj)) return
    // if locking in process, wait for it to finish and then unlock
    // perhaps we should check the status returned...
    if (lockObj.lockStatus === LockStatuses.LOCKING)
      await lockObj.waitStatusUpdate()

    if (!lockObj.removeObject(obj)) return // in case another object triggered before
    const lockId = lockObj.lockId

    lockObj.setLockStatus(LockStatuses.UNLOCKING)
    try {
      // TODO: check if unlocking the right object. lock is on main one
      await this.client.unLock(obj.path, lockObj.lockId)
      lockObj.setLockStatus(LockStatuses.UNLOCKED)
      log("unlocked", obj.name)
    } catch (e) {
      // unlocking failed, restore the original ID
      if (
        lockObj.needLock(obj) &&
        lockObj.lockStatus === LockStatuses.UNLOCKING
      )
        lockObj.setLockStatus(LockStatuses.LOCKED, lockId)
    }
    if (!this.needStateFul) this.client.stateful = session_types.stateless
  }

  public isLocked(obj: AbapObject) {
    const lockObj = this.getLockObject(obj)
    return lockObj.isLocked(obj)
  }

  public async waitLocked(obj: AbapObject) {
    const lockObj = this.getLockObject(obj)
    if (
      lockObj.lockStatus === LockStatuses.LOCKING ||
      lockObj.lockStatus === LockStatuses.UNLOCKING
    )
      await lockObj.waitStatusUpdate()
    return lockObj.isLocked(obj)
  }
  get lockedObjects() {
    let children: string[] = []
    this.l.forEach(x => (children = [...children, ...[...x.children]]))
    return children
  }

  private getLockObject(child: AbapObject) {
    const lockSubject = child.getLockTarget()
    let lockObj = this.l.get(lockSubject.key)
    if (!lockObj) {
      lockObj = new LockObject(lockSubject)
      this.l.set(lockSubject.key, lockObj)
    }
    return lockObj
  }
}

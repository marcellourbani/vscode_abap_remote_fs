import { ADTSCHEME, fromUri } from "../AdtServer"
import { ADTClient, session_types } from "abap-adt-api"
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
          const ok = "Ok"
          const lock = await server.lockManager.lock(obj)
          if (interactive && lock && lock.IS_LINK_UP) {
            const resp = await window.showWarningMessage(
              `Object is locked, a new task will be created in ${
                lock.CORRUSER
              }'s ${lock.CORRNR} ${lock.CORRTEXT}`,
              ok,
              "Cancel"
            )
            if (resp !== ok) await server.lockManager.unlock(obj)
          }
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
  public children: Set<AbapObject> = new Set()
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
    this.children.add(child)
    return (
      this.lockStatus === LockStatuses.UNLOCKED ||
      this.lockStatus === LockStatuses.UNLOCKING
    )
  }

  public isLocked(child: AbapObject) {
    return this.children.has(child)
  }
  public needUnlock(child: AbapObject) {
    this.children.delete(child)
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
  public l: Map<AbapObject, LockObject> = new Map()
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

  public async lock(obj: AbapObject) {
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
      lockObj.setLockStatus(LockStatuses.LOCKED, lock.LOCK_HANDLE)
      obj.transport =
        lock.CORRNR ||
        (lock.IS_LOCAL ? TransportStatus.LOCAL : TransportStatus.REQUIRED)
      log("locked", obj.name)
      return lock
    } catch (e) {
      if (
        lockObj.needUnlock(obj) &&
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
    if (!lockObj.needUnlock(obj)) return
    // if locking in process, wait for it to finish and then unlock
    // perhaps we should check the status returned...
    if (lockObj.lockStatus === LockStatuses.LOCKING)
      await lockObj.waitStatusUpdate()

    if (!lockObj.needUnlock(obj)) return // in case another object triggered before
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

  get lockedObjects() {
    let children: AbapObject[] = []
    this.l.forEach(x => (children = [...children, ...[...x.children]]))
    return children
  }
  private getLockObject(child: AbapObject) {
    const lockSubject = child.getLockTarget()
    let lockObj = this.l.get(lockSubject)
    if (!lockObj) {
      lockObj = new LockObject(lockSubject)
      this.l.set(lockSubject, lockObj)
    }
    return lockObj
  }
}

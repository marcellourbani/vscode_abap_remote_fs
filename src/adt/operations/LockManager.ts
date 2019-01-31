import { ADTClient } from "abap-adt-api"
import { StateRequestor } from "../AdtConnection"
import { AbapObject, TransportStatus } from "../abap/AbapObject"
import { session_types } from "abap-adt-api/build/AdtHTTP"

enum LockStatuses {
  LOCKED,
  UNLOCKED,
  LOCKING,
  UNLOCKING
}

class LockObject {
  children: Set<AbapObject> = new Set()
  listeners: Array<(s: LockStatuses) => void> = []
  private _lockStatus = LockStatuses.UNLOCKED
  get lockStatus() {
    return this._lockStatus
  }
  lockId: string = ""

  constructor(public main: AbapObject) {}

  setLockStatus(status: LockStatuses, lockId: string = "") {
    this._lockStatus = status
    this.lockId = status === LockStatuses.LOCKED ? lockId : ""
    const l = this.listeners
    this.listeners = []
    l.forEach(x => x(status))
  }

  needLock(child: AbapObject) {
    this.children.add(child)
    return (
      this.lockStatus === LockStatuses.UNLOCKED ||
      this.lockStatus === LockStatuses.UNLOCKING
    )
  }

  isLocked(child: AbapObject) {
    return this.children.has(child)
  }
  needUnlock(child: AbapObject) {
    this.children.delete(child)
    return (
      this.children.size === 0 &&
      (this.lockStatus === LockStatuses.LOCKED ||
        this.lockStatus === LockStatuses.LOCKING)
    )
  }

  waitStatusUpdate() {
    const waitUpdate = new Promise<LockStatuses>(resolve => {
      this.listeners.push(resolve)
    })
    return waitUpdate
  }
}

export class LockManager implements StateRequestor {
  l: Map<AbapObject, LockObject> = new Map()
  constructor(private client: ADTClient) {}

  private getLockObject(child: AbapObject) {
    const lockSubject = child.getLockTarget()
    let lockObj = this.l.get(lockSubject)
    if (!lockObj) {
      lockObj = new LockObject(lockSubject)
      this.l.set(lockSubject, lockObj)
    }
    return lockObj
  }

  getLockId(obj: AbapObject): string {
    const lockObj = this.getLockObject(obj)
    // const lockId = this.locks.get(obj)
    if (lockObj.lockId) return lockObj.lockId
    throw new Error(`Object ${obj.name} is not locked`)
  }

  get needStateFul(): boolean {
    return this.lockedObjects.length > 0
  }

  async lock(obj: AbapObject) {
    if (!obj.canBeWritten) return
    const lockObj = this.getLockObject(obj)
    if (!lockObj.needLock(obj)) return
    //if unlocking in process, wait for it to finish and then lock
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
        lock.CORRNR || lock.IS_LOCAL
          ? TransportStatus.LOCAL
          : TransportStatus.REQUIRED
      console.log("locked", obj.name)
    } catch (e) {
      if (
        lockObj.needUnlock(obj) &&
        lockObj.lockStatus === LockStatuses.LOCKING
      )
        lockObj.setLockStatus(LockStatuses.UNLOCKED)
      if (!this.needStateFul) this.client.stateful = session_types.stateless
      throw e
    }
  }

  async unlock(obj: AbapObject) {
    if (!obj.canBeWritten) return
    const lockObj = this.getLockObject(obj)
    if (!lockObj.needUnlock(obj)) return
    //if locking in process, wait for it to finish and then unlock
    // perhaps we should check the status returned...
    if (lockObj.lockStatus === LockStatuses.LOCKING)
      await lockObj.waitStatusUpdate()

    if (!lockObj.needUnlock(obj)) return // in case another object triggered before
    const lockId = lockObj.lockId

    lockObj.setLockStatus(LockStatuses.UNLOCKING)
    try {
      //TODO: check if unlocking the right object. lock is on main one
      await this.client.unLock(obj.path, lockObj.lockId)
      lockObj.setLockStatus(LockStatuses.UNLOCKED)
      console.log("unlocked", obj.name)
    } catch (e) {
      //unlocking failed, restore the original ID
      if (
        lockObj.needLock(obj) &&
        lockObj.lockStatus === LockStatuses.UNLOCKING
      )
        lockObj.setLockStatus(LockStatuses.LOCKED, lockId)
    }
    if (!this.needStateFul) this.client.stateful = session_types.stateless
  }

  isLocked(obj: AbapObject) {
    const lockObj = this.getLockObject(obj)
    return lockObj.isLocked(obj)
  }

  get lockedObjects() {
    let children: AbapObject[] = []
    this.l.forEach(x => (children = [...children, ...[...x.children]]))
    return children
  }
}

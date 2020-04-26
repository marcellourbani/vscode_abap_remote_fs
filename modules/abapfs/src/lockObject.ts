import { AbapObject } from "../../abapObject"
import { AdtLock } from "abap-adt-api"
import { AFsService, AbapFsService } from "./AFsService"

export interface Locked extends AdtLock {
  status: "locked"
}
export interface Unlocked {
  status: "unlocked"
}
export interface Locking {
  status: "locking"
  locked: Promise<AdtLock>
}
export interface Unlocking extends AdtLock {
  status: "unlocking"
  unlocked: Promise<void>
}

export type LockStatus = Locked | Unlocked | Locking | Unlocking

export const delay = (t: number) => new Promise(r => setTimeout(r, t))

export class LockObject {
  constructor(private object: AbapObject, private service: AbapFsService) {}
  get key() {
    return this.object.key
  }

  status: LockStatus = { status: "unlocked" }
  public get pending() {
    if (this.status.status === "locking")
      return this.status.locked.then(() => undefined)
    if (this.status.status === "unlocking")
      return this.status.unlocked.then(() => undefined)
  }
  get finalStatus() {
    const fs = async (): Promise<Locked | Unlocked> => {
      while (
        this.status.status === "locking" ||
        this.status.status === "unlocking"
      ) {
        await this.pending
      }
      return this.status
    }
    return fs()
  }
  async requestLock(path: string) {
    this.claims.add(path)
    await this.sync()
    return this.finalStatus
  }

  async requestUnlock(path: string) {
    this.claims.delete(path)
    await this.sync()
    return this.finalStatus
  }

  private async sync() {
    const status = this.status.status
    if (this.claims.size && status === "unlocked") {
      await this.lock()
    } else if (this.claims.size === 0 && status === "locked") {
      // do not unlock if another lock request comes in within a second
      await delay(1000)
      if (this.claims.size === 0) await this.unlock()
    }
    return this.status
  }

  private async unlock() {
    if (this.status.status === "locked") {
      const prevState = this.status
      const unlocked = this.service.unlock(
        this.object.lockObject.path,
        this.status.LOCK_HANDLE
      )
      this.status = {
        ...this.status,
        status: "unlocking",
        unlocked
      }
      try {
        await unlocked
        this.status = { status: "unlocked" }
      } catch (error) {
        this.status = prevState
      }
    }
  }

  private async lock() {
    const status = this.status.status
    if (status === "locking" || status === "locked") return

    const locked = this.service.lock(this.object.lockObject.path)
    this.status = {
      status: "locking",
      locked
    }
    try {
      const lock = await locked
      this.status = { ...lock, status: "locked" }
    } catch (error) {
      this.status = { status: "unlocked" }
    }
  }

  private claims = new Set<string>()
}

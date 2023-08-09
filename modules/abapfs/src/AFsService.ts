import { AOService, AbapObjectService } from "../../abapObject/out"
import { PathStep, AdtLock, session_types } from "abap-adt-api"

export interface AbapFsService extends AbapObjectService {
  objectPath: (path: string) => Promise<PathStep[]>
  lock(path: string): Promise<AdtLock>
  unlock(path: string, lockHandle: string): Promise<string>
  readonly sessionType: session_types
  dropSession: () => Promise<void>
  login: () => Promise<void>
  readonly user: string
}

export class AFsService extends AOService implements AbapFsService {
  objectPath(path: string) {
    return this.client.statelessClone.findObjectPath(path)
  }
  async lock(path: string) {
    const oldstateful = this.client.stateful
    this.client.stateful = session_types.stateful
    try {
      return await this.client.lock(path)
    } catch (error) {
      this.client.stateful = oldstateful
      throw error
    }
  }

  async unlock(path: string, lockHandle: string) {
    const oldstateful = this.client.stateful
    this.client.stateful = session_types.stateful
    try {
      return await this.client.unLock(path, lockHandle)
    } catch (error) {
      this.client.stateful = oldstateful
      throw error
    }
  }

  get sessionType() {
    return this.client.stateful
  }

  get user() {
    return this.client.username
  }

  login() {
    return this.client.login()
  }

  dropSession() {
    return this.client.dropSession()
  }
}

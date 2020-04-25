import { AOService, AbapObjectService } from "../../abapObject/out"
import { PathStep } from "abap-adt-api"

export interface AbapFsService extends AbapObjectService {
  objectPath: (path: string) => Promise<PathStep[]>
}

export class AFsService extends AOService implements AbapFsService {
  objectPath(path: string) {
    return this.client.findObjectPath(path)
  }
}

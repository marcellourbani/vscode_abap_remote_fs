import { AbapObjectDetail, objectIsValid } from "sharedtypes"
import { getObjectDetails } from "./clientapis"

const cache: Map<string, AbapObjectDetail> = new Map()

export async function getObject(uri: string) {
  let object: AbapObjectDetail | undefined = cache.get(uri)
  if (!object) {
    object = await getObjectDetails(uri)
    if (object && objectIsValid(object)) cache.set(uri, object)
  }

  return object
}

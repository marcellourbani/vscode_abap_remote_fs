import { AbapObjectDetail, objectIsValid } from "sharedtypes"
import { getObjectDetails, getVSCodeUri } from "./clientapis"

const cache: Map<string, AbapObjectDetail> = new Map()
const vsurlCache: Map<string, string> = new Map()

export async function getObject(uri: string) {
  let object: AbapObjectDetail | undefined = cache.get(uri)
  if (!object) {
    object = await getObjectDetails(uri)
    if (object && objectIsValid(object)) cache.set(uri, object)
  }

  return object
}

export async function vscUrl(confKey: string, uri: string) {
  const key = `${confKey} ${uri}`
  let vsurl = vsurlCache.get(key)
  if (!vsurl && vsurl !== "") {
    vsurl = await getVSCodeUri(confKey, uri)
    vsurlCache.set(key, vsurl)
  }
  return vsurl
}

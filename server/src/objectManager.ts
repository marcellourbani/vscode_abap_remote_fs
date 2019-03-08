import { AbapObjectDetail, objectIsValid } from "./api"
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

export async function vscUrl(
  confKey: string,
  uri: string,
  main: boolean = true
) {
  const key = `${confKey} ${uri} ${main}`
  let vsurl = vsurlCache.get(key)
  if (!vsurl && vsurl !== "") {
    vsurl = await getVSCodeUri(confKey, uri, main)
    vsurlCache.set(key, vsurl)
  }
  return vsurl
}

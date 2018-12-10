import { defaultVal, mapWith } from "../../functions"

import { getNode, recxml2js } from "../parsers/AdtParserBase"

interface AdtLock {
  LOCK_HANDLE: string
  CORRNR: string
  CORRUSER: string
  CORRTEXT: string
  IS_LOCAL: string
  IS_LINK_UP: string
  MODIFICATION_SUPPORT: string
}
export const adtLockParser = defaultVal(
  [],
  getNode("asx:abap/asx:values/DATA", mapWith(recxml2js), (x: any[]) => x[0])
) as (xml: string) => AdtLock

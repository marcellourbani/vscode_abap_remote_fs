import { createRoot, AFsService, Root } from ".."
import { ADTClient } from "abap-adt-api"
import { Agent } from "https"
/** this will connect to a real server, and mostly rely on abapgit as sample data
 *   tests might brek with future versions of abapgit
 *   tested on 7.52, paths could change with releases
 */
const getRootForTest = () => {
  const {
    ADT_SYSTEMID = "",
    ADT_URL = "",
    ADT_USER = "",
    ADT_PASS = ""
  } = process.env
  if (ADT_URL && ADT_USER && ADT_PASS) {
    const options = ADT_URL.match(/^https/i) ? { httpsAgent: new Agent({ rejectUnauthorized: false }) } : {}
    const client = new ADTClient(ADT_URL, ADT_USER, ADT_PASS, undefined, undefined, options)
    const service = new AFsService(client)
    return { root: createRoot(`adt_${ADT_SYSTEMID}`, service), client }
  }
  return {}
}
export const runTest = (f: (c: Root) => Promise<void>) => {
  const { root, client } = getRootForTest()
  return async () => {
    if (!root || !client) {
      // tslint:disable-next-line:no-console
      console.log("Connection not configured, no test was run")
      return
    }
    try {
      await f(root)
    } finally {
      jest.setTimeout(5000) // restore the default 5000
      if (client.statelessClone.loggedin) client.statelessClone.logout()
      if (client.loggedin) client.logout()
    }
  }
}

import { createRoot, AFsService } from ".."
import { ADTClient } from "abap-adt-api"
/** this will connect to a real server, and mostly rely on abapgit as sample data
 *   tests might brek with future versions of abapgit
 *   tested on 7.52, paths could change with releases
 */
export const getRootForTest = () => {
  const {
    ADT_SYSTEMID = "",
    ADT_URL = "",
    ADT_USER = "",
    ADT_PASS = ""
  } = process.env
  if (ADT_URL && ADT_USER && ADT_PASS) {
    const client = new ADTClient(ADT_URL, ADT_USER, ADT_PASS)
    const service = new AFsService(client)
    return createRoot(`adt_${ADT_SYSTEMID}`, service)
  } else
    throw new Error("Please set reuired environment variables in setenv.js")
}

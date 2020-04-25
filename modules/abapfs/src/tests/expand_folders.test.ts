// this will connect to a real server, and mostly rely on abapgit as sample data
// tests might brek with future versions of abapgit
// tested on 7.52, paths could change with releases

import { ADTClient } from "abap-adt-api"
import { isFolder, AFsService, createRoot, isAbapFile } from ".."

const getRoot = () => {
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

test("class in $ABAPGIT", async () => {
  const root = getRoot()
  const clas = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/Source Code Library/Classes/ZCL_ABAPGIT_AUTH"
  )
  expect(isFolder(clas)).toBe(true)
  let main = root.getNode(
    "/$TMP/$ABAPGIT/Source Code Library/Classes/ZCL_ABAPGIT_AUTH/ZCL_ABAPGIT_AUTH.clas.abap"
  )
  expect(main).toBeUndefined()
  main = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/Source Code Library/Classes/ZCL_ABAPGIT_AUTH/ZCL_ABAPGIT_AUTH.clas.abap"
  )
  expect(isAbapFile(main)).toBe(true)
  const definitions = root.getNode(
    "/$TMP/$ABAPGIT/Source Code Library/Classes/ZCL_ABAPGIT_AUTH/ZCL_ABAPGIT_AUTH.clas.locals_def.abap"
  )
  expect(isAbapFile(definitions)).toBe(true)
})

test("interface in $ABAPGIT_UI_CORE", async () => {
  const root = getRoot()
  const intf = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/$ABAPGIT_UI/$ABAPGIT_UI_CORE/Source Code Library/Interfaces/ZIF_ABAPGIT_HTML.intf.abap"
  )
  expect(isAbapFile(intf)).toBe(true)
  // loading an interface loads the others in the same package...
  const definitions = root.getNode(
    "/$TMP/$ABAPGIT/$ABAPGIT_UI/$ABAPGIT_UI_CORE/Source Code Library/Interfaces/ZIF_ABAPGIT_GUI_SERVICES.intf.abap"
  )
  expect(isAbapFile(definitions)).toBe(true)
})

test("fm in $ABAPGIT", async () => {
  const root = getRoot()
  const func = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/Source Code Library/Function Groups/ZABAPGIT_PARALLEL/Function Modules/Z_ABAPGIT_SERIALIZE_PARALLEL.fugr.abap"
  )
  expect(isAbapFile(func)).toBe(true)
})

test("SALV table", async () => {
  const root = getRoot()
  const incl = await root.getNodeAsync(
    "/System Library/BASIS/SALV/SALV_OM/SALV_OM_OBJECTS/Source Code Library/Classes/CL_SALV_TABLE/CL_SALV_TABLE.clas.abap"
  )
  expect(isAbapFile(incl)).toBe(true)
})

test("namespaced object", async () => {
  const root = getRoot()
  const incl = await root.getNodeAsync(
    "/System Library/∕SAPTRX∕EM_BASIS/∕SAPTRX∕ATIF/Source Code Library/Includes/∕SAPTRX∕CONSTANTS.prog.abap"
  )
  expect(isAbapFile(incl)).toBe(true)
})

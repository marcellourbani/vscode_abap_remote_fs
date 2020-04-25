import { isFolder, isAbapFile } from ".."
import { getRootForTest } from "./connectServer"

test("class in $ABAPGIT", async () => {
  const root = getRootForTest()
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

test("Program $ABAPGIT", async () => {
  const root = getRootForTest()
  const prog = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT"
  )
  expect(isFolder(prog)).toBe(true)
  let main = root.getNode(
    "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT/ZABAPGIT.prog.abap"
  )
  expect(main).toBeUndefined()
  main = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT/ZABAPGIT.prog.abap"
  )
  expect(isAbapFile(main)).toBe(true)
})

test("interface in $ABAPGIT_UI_CORE", async () => {
  const root = getRootForTest()
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
  const root = getRootForTest()
  const func = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/Source Code Library/Function Groups/ZABAPGIT_PARALLEL/Function Modules/Z_ABAPGIT_SERIALIZE_PARALLEL.fugr.abap"
  )
  expect(isAbapFile(func)).toBe(true)
})

test("SALV table", async () => {
  const root = getRootForTest()
  const incl = await root.getNodeAsync(
    "/System Library/BASIS/SALV/SALV_OM/SALV_OM_OBJECTS/Source Code Library/Classes/CL_SALV_TABLE/CL_SALV_TABLE.clas.abap"
  )
  expect(isAbapFile(incl)).toBe(true)
})

test("namespaced object", async () => {
  const root = getRootForTest()
  const incl = await root.getNodeAsync(
    "/System Library/∕SAPTRX∕EM_BASIS/∕SAPTRX∕ATIF/Source Code Library/Includes/∕SAPTRX∕CONSTANTS.prog.abap"
  )
  expect(isAbapFile(incl)).toBe(true)
})

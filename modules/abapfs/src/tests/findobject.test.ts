import { getRootForTest } from "./connectServer"
import { isAbapStat } from "../abapFile"

test("find object in $TMP", async () => {
  const root = getRootForTest()
  const abapgit = await root.findByAdtUri(
    "/sap/bc/adt/programs/programs/zabapgit"
  )
  expect(abapgit).toBeDefined()
  if (!isAbapStat(abapgit?.file)) fail("Abap Object expected")
  expect(abapgit?.file.object.name).toBe("ZABAPGIT")
  expect(abapgit?.path).toBe(
    "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT"
  )
})

test("find main include in $TMP", async () => {
  const root = getRootForTest()
  const abapgit = await root.findByAdtUri(
    "/sap/bc/adt/programs/programs/zabapgit",
    true
  )
  expect(abapgit).toBeDefined()
  if (!isAbapStat(abapgit?.file)) fail("Abap Object expected")
  expect(abapgit?.file.object.name).toBe("ZABAPGIT")
  expect(abapgit?.path).toBe(
    "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT/ZABAPGIT.prog.abap"
  )
})

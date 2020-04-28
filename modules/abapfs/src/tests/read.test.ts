import { getRootForTest } from "./connectServer"
import { isAbapStat, isAbapFile } from "../abapFile"

test("read program ", async () => {
  const root = getRootForTest()
  const abapgit = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT/ZABAPGIT.prog.abap"
  )
  if (!isAbapFile(abapgit)) fail("Abap Object expected")
  const source = await abapgit.read()
  expect(source).toMatch(/report\s+zabapgit\s+line-size\s+\d+/i)
})
test("read interface", async () => {
  const root = getRootForTest()
  const intf = await root.getNodeAsync(
    "/$TMP/Source Code Library/Interfaces/ZIF_APACK_MANIFEST.intf.abap"
  )
  if (!isAbapFile(intf)) fail("Interface should be a file")
  const source = await intf.read()
  expect(source).toMatch(/endinterface/i)
})

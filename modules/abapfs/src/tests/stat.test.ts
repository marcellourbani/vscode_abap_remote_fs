import { getRootForTest } from "./connectServer"
import { isAbapStat, isAbapFile } from "../abapFile"
test("stat program ", async () => {
  const root = getRootForTest()
  const abapgit = await root.getNodeAsync(
    "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT/ZABAPGIT.prog.abap"
  )
  if (!isAbapFile(abapgit)) fail("Abap Object expected")
  await abapgit.stat()
  expect(abapgit.object.structure).toBeDefined()
})

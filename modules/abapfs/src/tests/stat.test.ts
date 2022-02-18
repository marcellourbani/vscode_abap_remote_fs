import { runTest } from "./connectServer"
import { isAbapFile } from "../abapFile"
import { mock } from "jest-mock-extended"

test(
  "stat program ",
  runTest(async root => {
    const abapgit = await root.getNodeAsync(
      "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT/ZABAPGIT.prog.abap"
    )
    if (!isAbapFile(abapgit)) fail("Abap Object expected")
    await abapgit.stat()
    expect(abapgit.object.structure).toBeDefined()
  })
)

test(
  "stat interface ",
  runTest(async root => {
    const intf = await root.getNodeAsync(
      "/$TMP/Source Code Library/Interfaces/ZIF_APACK_MANIFEST.intf.abap"
    )
    if (!isAbapFile(intf)) fail("Abap Object expected")
    await intf.stat()
    expect(intf.object.structure).toBeDefined()
  })
)

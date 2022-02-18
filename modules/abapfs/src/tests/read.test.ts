import { runTest } from "./connectServer"
import { isAbapFile } from "../abapFile"
import { mock } from "jest-mock-extended"

test(
  "read program ",
  runTest(async root => {
    const abapgit = await root.getNodeAsync(
      "/$TMP/$ABAPGIT/Source Code Library/Programs/ZABAPGIT/ZABAPGIT.prog.abap"
    )
    if (!isAbapFile(abapgit)) fail("Abap Object expected")
    const source = await abapgit.read()
    expect(source).toMatch(/report\s+zabapgit\s+line-size\s+\d+/i)
  })
)
test(
  "read interface",
  runTest(async root => {
    const intf = await root.getNodeAsync(
      "/$TMP/Source Code Library/Interfaces/ZIF_APACK_MANIFEST.intf.abap"
    )
    if (!isAbapFile(intf)) fail("Interface should be a file")
    const source = await intf.read()
    expect(source).toMatch(/endinterface/i)
  })
)

test(
  "read structure with namespace",
  runTest(async root => {
    const struc = await root.getNodeAsync(
      "/System Library/∕UI5∕UI5_INFRA_STRU/∕UI5∕UI5_MAIN/∕UI5∕DESCRIPTOR_INFRA/∕UI5∕APP_INDEX/Dictionary/Structures/∕UI5∕APP_INDEX_COMP_DATA.abap"
    )
    if (!isAbapFile(struc)) fail("Structure should be a file")
    const source = await struc.read()
    expect(source).toMatch(/define\s+structure/i)
  })
)

test(
  "read table with namespace",
  runTest(async root => {
    const table = await root.getNodeAsync(
      "/System Library/∕UI5∕UI5_INFRA_STRU/∕UI5∕UI5_MAIN/∕UI5∕DESCRIPTOR_INFRA/∕UI5∕APP_INDEX/Dictionary/Database Tables/∕UI5∕APPIDX.abap"
    )
    if (!isAbapFile(table)) fail("Table should be a file")
    const source = await table.read()
    expect(source).toMatch(/define\s+table/i)
  })
)

test(
  "read table without namespace",
  runTest(async root => {
    const table = await root.getNodeAsync(
      "/System Library/BASIS/SCTS_REQ/Dictionary/Database Tables/E070.abap"
    )
    if (!isAbapFile(table)) fail("Table should be a file")
    const source = await table.read()
    expect(source).toMatch(/define\s+table/i)
  })
)

test(
  "read cds data def",
  runTest(async root => {
    const ddef = await root.getNodeAsync(
      "/System Library/S_NWDEMO_BASIS/S_NWDEMO/S_EPM_STAKEHOLDERS/S_EPM_CDS/Core Data Services/Data Definitions/SEPM_SDDL_ADDRESS.ddls.asddls"
    )
    if (!isAbapFile(ddef)) fail("Table should be a file")
    const source = await ddef.read()
    expect(source).toMatch(/define\s+view/i)
  })
)

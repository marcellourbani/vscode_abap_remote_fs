import { runTest } from "./connectServer"
import { isAbapStat, isAbapFile } from "../abapFile"
import { mock } from "jest-mock-extended"

test(
  "find object in $TMP",
  runTest(async root => {
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
)

test(
  "find main include in $TMP",
  runTest(async root => {
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
    if (!isAbapFile(abapgit?.file))
      fail("Leaf node expected for main program include")
    const source = await abapgit?.file.read()
    expect(source?.match(/report ZABAPGIT\s*line-size\s*[\d]+/i)).toBeTruthy()
  })
)

test(
  "main include in CL_ABAP_TABLEDESCR",
  runTest(async root => {
    const tabledesc = await root.findByAdtUri(
      "/sap/bc/adt/oo/classes/cl_abap_tabledescr",
      true
    )
    expect(tabledesc).toBeDefined()
    if (!isAbapStat(tabledesc?.file)) fail("Abap Object expected")
    expect(tabledesc?.file.object.name).toBe("CL_ABAP_TABLEDESCR.main")
    expect(tabledesc?.path).toBe(
      "/System Library/BASIS/SABP_MAIN/SABP_RTTI/Source Code Library/Classes/CL_ABAP_TABLEDESCR/CL_ABAP_TABLEDESCR.clas.abap"
    )
    if (!isAbapFile(tabledesc?.file))
      fail("Leaf node expected for main program include")
    const source = await tabledesc?.file.read()
    expect(
      source?.match(/class\s+CL_ABAP_TABLEDESCR\s+definition/i)
    ).toBeTruthy()
  })
)

test(
  "main class include with name",
  runTest(async root => {
    const tabledesc = await root.findByAdtUri(
      "/sap/bc/adt/oo/classes/cl_abap_tabledescr/source/main#start=14,9",
      false
    )
    if (!isAbapFile(tabledesc?.file)) fail("Abap Object expected")
    expect(tabledesc?.file.object.name).toBe("CL_ABAP_TABLEDESCR.main")
    expect(tabledesc?.path).toBe(
      "/System Library/BASIS/SABP_MAIN/SABP_RTTI/Source Code Library/Classes/CL_ABAP_TABLEDESCR/CL_ABAP_TABLEDESCR.clas.abap"
    )
    if (!isAbapFile(tabledesc?.file))
      fail("Leaf node expected for main program include")
    const source = await tabledesc?.file.read()
    expect(
      source?.match(/class\s+CL_ABAP_TABLEDESCR\s+definition/i)
    ).toBeTruthy()
  })
)

test(
  "other class include with name",
  runTest(async root => {
    const tabledesc = await root.findByAdtUri(
      "/sap/bc/adt/oo/classes/cl_abap_tabledescr/includes/localtypes#start=1,9",
      false
    )
    if (!isAbapFile(tabledesc?.file)) fail("Abap Object expected")
    expect(tabledesc?.file.object.name).toBe("CL_ABAP_TABLEDESCR.localtypes")
    expect(tabledesc?.path).toBe(
      "/System Library/BASIS/SABP_MAIN/SABP_RTTI/Source Code Library/Classes/CL_ABAP_TABLEDESCR/CL_ABAP_TABLEDESCR.clas.localtypes.abap"
    )
    if (!isAbapFile(tabledesc?.file))
      fail("Leaf node expected for main program include")
    const source = await tabledesc?.file.read()
    expect(source?.match(/local classes.*CL_ABAP_TABLEDESCR/i)).toBeTruthy()
  })
)

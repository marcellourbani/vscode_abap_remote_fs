import { isFolder, isAbapFile, isAbapStat } from ".."
import { runTest } from "./connectServer"
import { convertSlash } from "../../../abapObject/out"
import { mock } from "jest-mock-extended"

test(
  "class in $ABAPGIT",
  runTest(async root => {
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
)

test(
  "Program $ABAPGIT",
  runTest(async root => {
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
)

test(
  "interface in $ABAPGIT_UI_CORE",
  runTest(async root => {
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
)

test(
  "fm in $ABAPGIT",
  runTest(async root => {
    const func = await root.getNodeAsync("/$TMP/$ABAPGIT/$ABAPGIT_OBJECTS/$ABAPGIT_OBJECTS_CORE/Source Code Library/Function Groups/ZABAPGIT_PARALLEL/Function Modules/Z_ABAPGIT_SERIALIZE_PARALLEL.fugr.abap")
    expect(isAbapFile(func)).toBe(true)
  })
)
test(
  "SALV table",
  runTest(async root => {
    const incl = await root.getNodeAsync(
      "/System Library/BASIS/SALV/SALV_OM/SALV_OM_OBJECTS/Source Code Library/Classes/CL_SALV_TABLE/CL_SALV_TABLE.clas.abap"
    )
    expect(isAbapFile(incl)).toBe(true)
  })
)

test(
  "namespaced object",
  runTest(async root => {
    const incl = await root.getNodeAsync(
      "/System Library/∕SAPTRX∕EM_BASIS/∕SAPTRX∕ATIF/Source Code Library/Includes/∕SAPTRX∕CONSTANTS.prog.abap"
    )
    expect(isAbapFile(incl)).toBe(true)
  })
)
//

test(
  "gt parameters",
  runTest(async root => {
    const para = await root.getNodeAsync(
      "/System Library/BASIS/SCTS_REQ/Others/" +
      convertSlash("SET/GET Parameters")
    ) || await root.getNodeAsync(
      "/System Library/BASIS/SCTS_REQ/" + // in hana 1909 has a different path
      convertSlash("SET/GET Parameters")
    )
    expect(isAbapStat(para)).toBe(false)
    expect(para?.size).toBeGreaterThan(1)
  })
)

test(
  "Transformations",
  runTest(async root => {
    const tran = await root.getNodeAsync(
      "/$TMP/$ADTBACKEND/Transformations/ZABAPGIT_ST_REPO_INFO_EXT_REQ.xslt.xml"
    )

    if (!isAbapFile(tran)) fail("Transformaton should be a file")
    const source = await tran.read()
    expect(source.match(/sap\.transform/i)).toBeTruthy()
  })
)

test(
  "path for namespaced object",
  runTest(async root => {
    const path = await root.getNodePathAsync(
      "/System Library/∕SAPTRX∕EM_BASIS/∕SAPTRX∕ATIF/Source Code Library/Includes/∕SAPTRX∕CONSTANTS.prog.abap"
    )
    expect(path.length).toBe(7)
  })
)

import { create } from "."
import { mock } from "jest-mock-extended"
import { AbapObjectService } from "./AOService"

import {
  isAbapClass,
  isAbapCds,
  isAbapInclude,
  isAbapClassInclude
} from "./objectTypes"

test("Creates classes", () => {
  const client = mock<AbapObjectService>()
  const cut = create(
    "CLAS/OC",
    "ZCL_ABAPGIT_USER_EXIT",
    "/sap/bc/adt/oo/classes/zcl_abapgit_user_exit",
    true,
    "==============================CP",
    undefined,
    "",
    client
  )
  expect(isAbapClass(cut)).toBeTruthy()
})

test("Creates cds", () => {
  const client = mock<AbapObjectService>()
  let cut = create(
    "DDLS/DF",
    "ZAPIDUMMY_DATADEF",
    "/sap/bc/adt/ddic/ddl/sources/zapidummy_datadef",
    false,
    "ZAPIDUMMY_DATADEF",
    undefined,
    "",
    client
  )
  expect(isAbapCds(cut)).toBeTruthy()
  expect(cut.fsName).toBe("ZAPIDUMMY_DATADEF.ddls.asddls")

  cut = create(
    "DDLX/EX",
    "ZAPIDUMMY_METADATA",
    "/sap/bc/adt/ddic/ddlx/sources/zapidummy_metadata",
    false,
    "ZAPIDUMMY_METADATA",
    undefined,
    "",
    client
  )
  expect(isAbapCds(cut)).toBeTruthy()
  expect(cut.fsName).toBe("ZAPIDUMMY_METADATA.ddlx.asddlxs")
})

test("create Class include", () => {
  const client = mock<AbapObjectService>()
  const clas = create(
    "CLAS/OC",
    "ZCL_ABAPGIT_USER_EXIT",
    "/sap/bc/adt/oo/classes/zcl_abapgit_user_exit",
    false,
    "main",
    undefined,
    "",
    client
  )
  const cut = create(
    "CLAS/I",
    "ZCL_ABAPGIT_USER_EXIT.main",
    "/sap/bc/adt/oo/classes/zcl_abapgit_user_exit/source/main",
    false,
    "main",
    clas,
    "",
    client
  )
  expect(isAbapClassInclude(cut)).toBeTruthy()
})
test("create include", () => {
  const client = mock<AbapObjectService>()
  const cut = create(
    "PROG/I",
    "ZADTTESTINCLUDEINC",
    "/sap/bc/adt/programs/includes/zadttestincludeinc",
    false,
    "ZADTTESTINCLUDEINC",
    undefined,
    "",
    client
  )
  expect(isAbapInclude(cut)).toBeTruthy()
})

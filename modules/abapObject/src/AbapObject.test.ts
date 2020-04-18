import { AbapObjectBase, AbapObject } from "./AbapObject"
import { AbapObjectService } from "./AOService"
import { mock, MockProxy } from "jest-mock-extended"
import { isAbapObjectError, Kind } from "./AOError"

async function expectException(fn: () => any, kind: Kind) {
  try {
    await fn()
    fail("Exception expected")
  } catch (error) {
    if (isAbapObjectError(error)) expect(error.kind).toBe(kind)
    else throw error
  }
}

function neverCalled(client: MockProxy<AbapObjectService>) {
  expect(client.getObjectSource).toBeCalledTimes(0)
  expect(client.mainPrograms).toBeCalledTimes(0)
  expect(client.nodeContents).toBeCalledTimes(0)
  expect(client.objectStructure).toBeCalledTimes(0)
  expect(client.setObjectSource).toBeCalledTimes(0)
}

async function packageAssertions(
  cut: AbapObject,
  client: MockProxy<AbapObjectService>
) {
  expect(cut.expandable).toBeTruthy()
  expect(cut.canBeWritten).toBeFalsy()
  await expectException(() => cut.contentsPath(), "NotLeaf")
  await expectException(() => cut.write("", "", ""), "NotLeaf")
  await expectException(() => cut.read(), "NotLeaf")
  await expectException(() => cut.mainPrograms(), "NotLeaf")
  expect(cut.lockObject).toBe(cut)
  neverCalled(client)
  cut.childComponents()
  expect(client.nodeContents).toBeCalledTimes(1)
}

async function unsupportedAssertions(
  cut: AbapObject,
  client: MockProxy<AbapObjectService>
) {
  expect(cut.expandable).toBeFalsy()
  expect(cut.canBeWritten).toBeFalsy()
  await expectException(() => cut.contentsPath(), "NotSupported")
  await expectException(() => cut.write("", "", ""), "NotSupported")
  await expectException(() => cut.mainPrograms(), "NotSupported")
  await expectException(() => cut.childComponents(), "NoChildren")
  await expectException(() => cut.loadStructure(), "NoStructure")
  expect(cut.lockObject).toBe(cut)
  neverCalled(client)
}

async function supportedFolderAssertions(
  cut: AbapObject,
  client: MockProxy<AbapObjectService>
) {
  expect(cut.expandable).toBeTruthy()
  expect(cut.canBeWritten).toBeFalsy()
  await expectException(() => cut.contentsPath(), "NotLeaf")
  await expectException(() => cut.write("", "", ""), "NotLeaf")
  await expectException(() => cut.read(), "NotLeaf")
  await expectException(() => cut.mainPrograms(), "NotLeaf")
  // classes do have children but need special handling
  await expectException(() => cut.childComponents(), "NotSupported")
  expect(cut.lockObject).toBe(cut)
  neverCalled(client)
  cut.loadStructure()
  expect(client.objectStructure).toBeCalledTimes(1)
}

async function supportedFileAssertions(
  cut: AbapObject,
  client: MockProxy<AbapObjectService>
) {
  expect(cut.expandable).toBeFalsy()
  expect(cut.canBeWritten).toBeTruthy()
  await expectException(() => cut.childComponents(), "NoChildren")
  await expectException(() => cut.loadStructure(), "NotSupported")
  expect(cut.lockObject).toBe(cut)
  neverCalled(client)
  cut.read()
  expect(client.getObjectSource).toBeCalledTimes(1)
  cut.write("", "", "")
  expect(client.setObjectSource).toBeCalledTimes(1)
}

test("create $TMP package", async () => {
  const client = mock<AbapObjectService>()
  const cut = new AbapObjectBase(
    "DEVC/K",
    "$TMP",
    "/sap/bc/adt/repository/nodestructure",
    true,
    "",
    client
  )
  expect(cut.fsName).toBe("$TMP")
  expect(cut.key).toBe("DEVC/K $TMP")
  await packageAssertions(cut, client)
})

test("create dummy root package", async () => {
  const client = mock<AbapObjectService>()
  const cut = new AbapObjectBase(
    "DEVC/K",
    "",
    "/sap/bc/adt/repository/nodestructure",
    true,
    "",
    client
  )
  expect(cut.fsName).toBe("")
  expect(cut.key).toBe("DEVC/K ")
  await packageAssertions(cut, client)
})

test("create $ABAPGIT package", async () => {
  const client = mock<AbapObjectService>()
  const cut = new AbapObjectBase(
    "DEVC/K",
    "$ABAPGIT",
    "/sap/bc/adt/packages/%24abapgit",
    true,
    "",
    client
  )
  expect(cut.fsName).toBe("$ABAPGIT")
  expect(cut.key).toBe("DEVC/K $ABAPGIT")
  await packageAssertions(cut, client)
})

test("create unsupported object", async () => {
  const client = mock<AbapObjectService>()
  const cut = new AbapObjectBase(
    "ENQU/DL",
    "EZABAPGIT",
    "/sap/bc/adt/vit/wb/object_type/enqudl/object_name/EZABAPGIT",
    false,
    "EZABAPGIT",
    client
  )
  expect(cut.fsName).toBe("EZABAPGIT.txt")
  expect(cut.key).toBe("ENQU/DL EZABAPGIT")
  await unsupportedAssertions(cut, client)
})

test("create class", async () => {
  const client = mock<AbapObjectService>()
  const cut = new AbapObjectBase(
    "CLAS/OC",
    "ZCL_ABAPGIT_USER_EXIT",
    "/sap/bc/adt/oo/classes/zcl_abapgit_user_exit",
    true,
    "==============================CP",
    client
  )
  expect(cut.fsName).toBe("ZCL_ABAPGIT_USER_EXIT")
  expect(cut.key).toBe("CLAS/OC ZCL_ABAPGIT_USER_EXIT")
  await supportedFolderAssertions(cut, client)
})

test("create class include", async () => {
  const client = mock<AbapObjectService>()
  const cut = new AbapObjectBase(
    "CLAS/I",
    "ZCL_Z001_DPC_EXT.main",
    "/sap/bc/adt/oo/classes/zcl_z001_dpc_ext/source/main",
    false,
    "main",
    client
  )
  expect(cut.fsName).toBe("ZCL_Z001_DPC_EXT.main.abap")
  expect(cut.key).toBe("CLAS/I ZCL_Z001_DPC_EXT.main")
  supportedFileAssertions(cut, client)
  await expect(cut.contentsPath()).toBe(cut.path)
})

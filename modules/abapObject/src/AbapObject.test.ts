import { AbapObjectBase, AbapObject } from "./AbapObject"
import { AbapObjectService } from "./AOService"
import { mock, MockProxy } from "jest-mock-extended"
import { isAbapObjectError, Kind } from "./AOError"
import sampleNodeContents from "./sampledata/nodeContents1.json"
import sampleMetadata from "./sampledata/classstructure1.json"
import { create } from "."

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
  // const expected = await readJson("./sampledata/nodeContents1.json")
  client.nodeContents.mockReturnValue(Promise.resolve(sampleNodeContents))
  const result = await cut.childComponents()
  expect(result).toEqual(sampleNodeContents)
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
  expect(cut.createdBy).toBe("")
  expect(cut.changedBy).toBe("")
  expect(cut.createdAt).toBeUndefined()
  expect(cut.changedAt).toBeUndefined()
}

async function supportedFolderAssertions(
  cut: AbapObject,
  client: MockProxy<AbapObjectService>,
  isClass = false
) {
  expect(cut.expandable).toBeTruthy()
  expect(cut.canBeWritten).toBeFalsy()
  await expectException(() => cut.contentsPath(), "NotLeaf")
  await expectException(() => cut.write("", "", ""), "NotLeaf")
  await expectException(() => cut.read(), "NotLeaf")
  await expectException(() => cut.mainPrograms(), "NotLeaf")
  // classes do have children but need special handling
  if (!isClass)
    await expectException(() => cut.childComponents(), "NotSupported")
  expect(cut.lockObject).toBe(cut)
  neverCalled(client)
  expect(cut.createdBy).toBe("")
  expect(cut.changedBy).toBe("")
  expect(cut.createdAt).toBeUndefined()
  expect(cut.changedAt).toBeUndefined()
  client.objectStructure.mockReturnValue(Promise.resolve(sampleMetadata))
  const struc = await cut.loadStructure()
  expect(client.objectStructure).toBeCalledTimes(1)
  expect(struc).toEqual(sampleMetadata)
  expect(cut.structure).toEqual(sampleMetadata)
  expect(cut.createdBy).toBe("DEVELOPER")
  expect(cut.changedBy).toBe("DEVELOPER")
  expect(cut.createdAt?.getTime()).toBe(1586736000000)
  expect(cut.changedAt?.getTime()).toBe(1586763315000)
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
  const sample = "Hello, World"
  client.getObjectSource.mockReturnValue(Promise.resolve(sample))
  const source = await cut.read()
  expect(client.getObjectSource).toBeCalledTimes(1)
  expect(source).toBe(sample)
  cut.write("", "", "")
  expect(client.setObjectSource).toBeCalledTimes(1)
}

test("create $TMP package", async () => {
  const client = mock<AbapObjectService>()
  const cut = create(
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
  const cut = create(
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
  const cut = create(
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
  const cut = create(
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
  const cut = create(
    "CLAS/OC",
    "ZCL_ABAPGIT_USER_EXIT",
    "/sap/bc/adt/oo/classes/zcl_abapgit_user_exit",
    true,
    "==============================CP",
    client
  )
  expect(cut.fsName).toBe("ZCL_ABAPGIT_USER_EXIT")
  expect(cut.key).toBe("CLAS/OC ZCL_ABAPGIT_USER_EXIT")
  await supportedFolderAssertions(cut, client, true)
})

test("create class main include", async () => {
  const client = mock<AbapObjectService>()
  const cut = create(
    "CLAS/I",
    "ZCL_Z001_DPC_EXT.main",
    "/sap/bc/adt/oo/classes/zcl_z001_dpc_ext/source/main",
    false,
    "main",
    client
  )
  expect(cut.fsName).toBe("ZCL_Z001_DPC_EXT.clas.abap")
  expect(cut.key).toBe("CLAS/I ZCL_Z001_DPC_EXT.main")
  supportedFileAssertions(cut, client)
  await expect(cut.contentsPath()).toBe(cut.path)
})

test("create class definitions include", async () => {
  const client = mock<AbapObjectService>()
  const cut = create(
    "CLAS/I",
    "ZCL_Z001_DPC_EXT.definitions",
    "/sap/bc/adt/oo/classes/zcl_z001_dpc_ext/source/definitions",
    false,
    "definitions",
    client
  )
  expect(cut.fsName).toBe("ZCL_Z001_DPC_EXT.clas.locals_def.abap")
  expect(cut.key).toBe("CLAS/I ZCL_Z001_DPC_EXT.definitions")
  supportedFileAssertions(cut, client)
  await expect(cut.contentsPath()).toBe(cut.path)
})

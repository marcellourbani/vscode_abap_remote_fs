import { AbapObject, convertSlash } from "./AbapObject"
import { AbapObjectService } from "./AOService"
import { mock, MockProxy } from "jest-mock-extended"
import { isAbapObjectError, Kind } from "./AOError"
import sampleNodeContents from "./sampledata/nodeContents1.json"
import sampleMetadata from "./sampledata/classstructure1.json"
import sampleFuncIncludeMeta from "./sampledata/funcIncludestruct.json"
import { create } from "."
import {
  AbapClassInclude,
  isAbapClassInclude,
  isAbapFunctionGroup,
  isAbapInclude
} from "./objectTypes"
interface Counts {
  getObjectSource?: number
  mainPrograms?: number
  nodeContents?: number
  objectStructure?: number
  setObjectSource?: number
}

async function expectException(fn: () => any, kind: Kind) {
  try {
    await fn()
    fail("Exception expected")
  } catch (error) {
    if (isAbapObjectError(error)) expect(error.kind).toBe(kind)
    else throw error
  }
}

function neverCalled(client: MockProxy<AbapObjectService>, numbers?: Counts) {
  const counts = {
    ...{
      getObjectSource: 0,
      mainPrograms: 0,
      nodeContents: 0,
      objectStructure: 0,
      setObjectSource: 0
    },
    ...numbers
  }
  expect(client.getObjectSource).toBeCalledTimes(counts.getObjectSource)
  expect(client.mainPrograms).toBeCalledTimes(counts.mainPrograms)
  expect(client.nodeContents).toBeCalledTimes(counts.nodeContents)
  expect(client.objectStructure).toBeCalledTimes(counts.objectStructure)
  expect(client.setObjectSource).toBeCalledTimes(counts.setObjectSource)
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
  expect(client.nodeContents).toBeCalledTimes(1)
  const found = result.nodes.find(n => n.OBJECT_NAME === "ZALV_EXAMPLE_1_BASIC")
  expect(found).toBeTruthy()
  const type = result.objectTypes.find(
    t => t.OBJECT_TYPE === found?.OBJECT_TYPE
  )
  expect(type?.CATEGORY_TAG).toBeTruthy()
  expect(type?.OBJECT_TYPE_LABEL).toBeTruthy()
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
  // await expectException(() => cut.loadStructure(), "NoStructure")
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
  expect(cut.lockObject).toBe(cut)
  if (isClass) {
    const struc = await cut.loadStructure()
    expect(cut.structure).toEqual(sampleMetadata)
    expect(cut.createdBy).toBe("DEVELOPER")
    expect(cut.changedBy).toBe("DEVELOPER")
    expect(cut.createdAt).toBeDefined()
    expect(cut.changedAt).toBeDefined()
    neverCalled(client, { objectStructure: 1 })
  } else {
    expect(cut.createdBy).toBe("")
    expect(cut.changedBy).toBe("")
    expect(cut.createdAt).toBeUndefined()
    expect(cut.changedAt).toBeUndefined()
    neverCalled(client)
  }
  await expectException(() => cut.contentsPath(), "NotLeaf")
  await expectException(() => cut.write("", "", ""), "NotLeaf")
  await expectException(() => cut.read(), "NotLeaf")
  await expectException(() => cut.mainPrograms(), "NotLeaf")
  expect(cut.structure).toEqual(sampleMetadata)
  expect(cut.createdBy).toBe("DEVELOPER")
  expect(cut.changedBy).toBe("DEVELOPER")
  expect(cut.createdAt?.getTime()).toBe(1586736000000)
  expect(cut.changedAt?.getTime()).toBe(1586763315000)
}

async function supportedFileAssertions(
  cut: AbapClassInclude,
  client: MockProxy<AbapObjectService>,
  checkinvalidate = true
) {
  expect(cut.expandable).toBeFalsy()
  expect(cut.canBeWritten).toBeTruthy()
  await expectException(() => cut.childComponents(), "NoChildren")
  expect(cut.lockObject).toBe(cut.parent)
  neverCalled(client)
  const sample = "Hello, World"
  client.getObjectSource.mockReturnValue(Promise.resolve(sample))
  const source = await cut.read()
  expect(client.getObjectSource).toBeCalledTimes(1)
  expect(source).toBe(sample)
  cut.write("", "", "")
  expect(client.setObjectSource).toBeCalledTimes(1)
  if (checkinvalidate)
    expect(client.invalidateStructCache).toBeCalledTimes(2)
}

test("create $TMP package", async () => {
  const client = mock<AbapObjectService>()
  const cut = create(
    "DEVC/K",
    "$TMP",
    "/sap/bc/adt/repository/nodestructure",
    true,
    "",
    undefined,
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
    undefined,
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
    undefined,
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
    undefined,
    "",
    client
  )
  expect(cut.fsName).toBe("EZABAPGIT.txt")
  expect(cut.key).toBe("ENQU/DL EZABAPGIT")
  await unsupportedAssertions(cut, client)
})

test("create class", async () => {
  const client = mock<AbapObjectService>()
  client.objectStructure.mockResolvedValue(sampleMetadata)
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
  expect(cut.fsName).toBe("ZCL_ABAPGIT_USER_EXIT")
  expect(cut.key).toBe("CLAS/OC ZCL_ABAPGIT_USER_EXIT")
  await supportedFolderAssertions(cut, client, true)
})

const createClas = (client: AbapObjectService) =>
  create(
    "CLAS/OC",
    "ZCL_Z001_DPC_EXT",
    "/sap/bc/adt/oo/classes/zcl_z001_dpc_ext",
    false,
    "main",
    undefined,
    "",
    client
  )

const classMetaData = () => {
  let cur = JSON.stringify(sampleMetadata)
  let old
  do {
    old = cur
    cur = cur.replace(/ZCL_ABAPGIT_USER_EXIT/, "ZCL_Z001_DPC_EXT").replace(/zcl_abapgit_user_exit/, "zcl_z001_dpc_ext")

  } while (old !== cur)
  return JSON.parse(cur)
}

test("create class main include", async () => {
  const client = mock<AbapObjectService>()
  client.objectStructure.mockResolvedValue(classMetaData())
  const cut = create(
    "CLAS/I",
    "ZCL_Z001_DPC_EXT.main",
    "/sap/bc/adt/oo/classes/zcl_z001_dpc_ext/source/main",
    false,
    "main",
    createClas(client),
    "",
    client
  )
  if (!isAbapClassInclude(cut)) fail("Class include expected")
  expect(cut.fsName).toBe("ZCL_Z001_DPC_EXT.clas.abap")
  expect(cut.key).toBe("CLAS/I ZCL_Z001_DPC_EXT.main")
  await supportedFileAssertions(cut, client, false) // TODO - fix test
  expect(cut.contentsPath()).toBe(cut.path)
})

test("create class definitions include", async () => {
  const client = mock<AbapObjectService>()
  client.objectStructure.mockResolvedValue(classMetaData())
  const cut = create(
    "CLAS/I",
    "ZCL_Z001_DPC_EXT.definitions",
    "/sap/bc/adt/oo/classes/zcl_z001_dpc_ext/source/definitions",
    false,
    "definitions",
    createClas(client),
    "",
    client
  )
  if (!isAbapClassInclude(cut)) fail("Class include expected")
  expect(cut.fsName).toBe("ZCL_Z001_DPC_EXT.clas.locals_def.abap")
  expect(cut.key).toBe("CLAS/I ZCL_Z001_DPC_EXT.definitions")
  await supportedFileAssertions(cut, client, false)
  expect(cut.contentsPath()).toBe(cut.path)
})

const createGroup = (): [MockProxy<AbapObjectService>, AbapObject] => {
  const client = mock<AbapObjectService>()
  const group = create(
    "FUGR/F",
    "/FOO/BAR",
    "/sap/bc/adt/functions/groups/%2ffoo%2fbar",
    true,
    "",
    undefined,
    "",
    client
  )
  return [client, group]
}

test("create function group", async () => {
  const [client, cut] = createGroup()
  if (!isAbapFunctionGroup(cut)) fail("Function group expected")
  expect(cut.fsName).toBe(convertSlash("/FOO/BAR"))
})

test("contents uri of fg include", async () => {
  const [client, group] = createGroup()
  client.objectStructure.mockResolvedValue(sampleFuncIncludeMeta)
  const cut = create(
    "FUGR/I",
    "/FOO/LBARTOP",
    "/sap/bc/adt/functions/groups/%2ffoo%2fbar/includes/%2ffoo%2flbartop",
    false,
    "",
    group,
    "",
    client
  )
  if (!isAbapInclude(cut)) fail("Include expected")
  await cut.loadStructure()
  expect(cut.contentsPath()).toBe(
    "/sap/bc/adt/functions/groups/%2ffoo%2fbar/includes/%2ffoo%2flbartop/source/main"
  )
})

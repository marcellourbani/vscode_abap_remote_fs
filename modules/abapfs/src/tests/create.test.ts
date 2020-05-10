import { createRoot, isRoot, TMPFOLDER, LIBFOLDER } from "../root"
import { AbapFsService } from ".."
import { mock, MockProxy } from "jest-mock-extended"
import { isAbapFolder } from "../abapFolder"
import { Folder, isFolder } from "../folder"
import sampleNodeContents from "../testdata/nodeContents1.json"
import sampleclas from "../testdata/zcl_ca_alv.json"
import { isAbapFile } from "../abapFile"
const createFile = () => ({ type: 1, mtime: 0, ctime: 0, size: 0 })

test("create root", async () => {
  const client = mock<AbapFsService>()
  const root = createRoot("MYConn", client)
  expect(isRoot(root)).toBe(true)

  const tmp = root.get(TMPFOLDER)
  if (isAbapFolder(tmp)) expect(tmp?.size).toBe(0)
  else fail("Tmp folder undefined or unexpected type")
  const lib = root.get(LIBFOLDER)
  if (isAbapFolder(lib)) expect(lib.size).toBe(0)
  else fail("Tmp folder undefined or unexpected type")
})

test("find path root", async () => {
  const client = mock<AbapFsService>()
  const root = createRoot("MYConn", client)
  expect(isRoot(root)).toBe(true)

  const tmp = root.get(TMPFOLDER)
  if (isAbapFolder(tmp)) {
    const child = new Folder()
    child.set("foo", createFile())
    tmp.set("child", child)
  } else fail("Tmp folder undefined or unexpected type")
  const lib = root.get(LIBFOLDER)
  if (isAbapFolder(lib)) {
    const child = new Folder()
    child.set("bar", createFile())
    lib.set("zchild", child)
  } else fail("Tmp folder undefined or unexpected type")

  expect(root.getNode("/")).toBe(root)
  expect(isFolder(root.getNode("/$TMP/child"))).toBe(true)
  expect(isFolder(root.getNode("/System Library/zchild"))).toBe(true)
  expect(root.getNode("/$TMP/child/foo")).toBeTruthy()
  expect(root.getNode("/System Library/zchild/bar")).toBeTruthy()
  expect(isFolder(root.getNode("/$TMP/child/foo"))).toBe(false)
  expect(isFolder(root.getNode("/System Library/zchild/bar"))).toBe(false)
  expect(root.getNode("/$TMP/child/foo/2")).toBeUndefined()
})

test("expand single package", async () => {
  const client = mock<AbapFsService>()
  client.nodeContents.mockReturnValueOnce(Promise.resolve(sampleNodeContents))
  const root = createRoot("MYConn", client)
  const tmpPackage = root.get(TMPFOLDER)
  if (!isAbapFolder(tmpPackage)) fail("Tmp package expected to be a folder")
  await tmpPackage.refresh()
  expect(tmpPackage.size).toBe(1)
  const lib = tmpPackage.get("Source Code Library")
  if (!isFolder(lib)) fail("Source Code Library should be a folder")
  lib.set("foobar", createFile())
  expect(lib.size).toBe(3)
  const classes = lib.get("Classes")
  if (!isFolder(classes)) fail("Classes expected")
  const programs = lib.get("Programs")
  expect(classes.size).toBe(1)
  if (!isFolder(programs)) fail("Programs expected")
  expect(programs.size).toBe(4)
  client.nodeContents.mockReturnValueOnce(
    Promise.resolve({ categories: [], objectTypes: [], nodes: [] })
  )
  // non manual objects should be removed
  await tmpPackage.refresh()
  expect(lib.size).toBe(1)
  expect(lib.get("foobar")).toBeDefined()
})

test("expand package on demand", async () => {
  const client = mock<AbapFsService>()
  client.nodeContents.mockReturnValueOnce(Promise.resolve(sampleNodeContents))
  client.objectStructure.mockReturnValueOnce(Promise.resolve(sampleclas))
  const root = createRoot("MYConn", client)
  const file = await root.getNodeAsync(
    "/$TMP/Source Code Library/Classes/ZCL_CA_ALV/ZCL_CA_ALV.clas.abap"
  )
  expect(file).toBeDefined()
  expect(isAbapFile(file)).toBe(true)
})

test("expand package hierarchy on demand", async () => {
  const client = mock<AbapFsService>()
  client.nodeContents.mockReturnValueOnce(Promise.resolve(sampleNodeContents))
  client.objectStructure.mockReturnValueOnce(Promise.resolve(sampleclas))
  const root = createRoot("MYConn", client)
  const objpath =
    "/$TMP/Source Code Library/Classes/ZCL_CA_ALV/ZCL_CA_ALV.clas.abap"
  const path = await root.getNodePathAsync(objpath)
  expect(path).toBeDefined()
  expect(isAbapFile(path[0].file)).toBe(true)
  const expectedPath = [
    "/$TMP/Source Code Library/Classes/ZCL_CA_ALV/ZCL_CA_ALV.clas.abap",
    "/$TMP/Source Code Library/Classes/ZCL_CA_ALV",
    "/$TMP/Source Code Library/Classes",
    "/$TMP/Source Code Library",
    "/$TMP",
    "/"
  ]
  const pah2 = root.getNodePath(objpath).map(x => x.path)
  expect(pah2).toEqual(expectedPath)
  expect(path.map(x => x.path)).toEqual(expectedPath)
})

const addNewClass = (client: MockProxy<AbapFsService>) => {
  // simulate a creation
  const { nodes } = sampleNodeContents
  const clas = nodes.find(n => n.OBJECT_NAME === "ZCL_CA_ALV")
  if (!clas) fail("not found")
  clas.OBJECT_NAME = "ZCL_NEWLY_CREATED"
  const nc = { ...sampleNodeContents, nodes: [clas] }
  client.nodeContents.mockReturnValueOnce(Promise.resolve(nc))
  let { metaData } = sampleclas
  metaData = { ...metaData, "adtcore:name": "ZCL_NEWLY_CREATED" }
  client.objectStructure.mockReturnValueOnce(
    Promise.resolve({ ...sampleclas, metaData })
  )
}
test("refresh on demand", async () => {
  const objpath =
    "/$TMP/Source Code Library/Classes/ZCL_CA_ALV/ZCL_CA_ALV.clas.abap"
  const newobjpath =
    "/$TMP/Source Code Library/Classes/ZCL_NEWLY_CREATED/ZCL_NEWLY_CREATED.clas.abap"
  const expectedPath = [
    "/$TMP/Source Code Library/Classes/ZCL_NEWLY_CREATED/ZCL_NEWLY_CREATED.clas.abap",
    "/$TMP/Source Code Library/Classes/ZCL_NEWLY_CREATED",
    "/$TMP/Source Code Library/Classes",
    "/$TMP/Source Code Library",
    "/$TMP",
    "/"
  ]
  const client = mock<AbapFsService>()
  client.nodeContents.mockReturnValue(Promise.resolve(sampleNodeContents))
  client.objectStructure.mockReturnValueOnce(Promise.resolve(sampleclas))
  const root = createRoot("MYConn", client)
  const path = await root.getNodePathAsync(objpath)
  expect(path).toBeDefined()
  expect(isAbapFile(path[0].file)).toBe(true)

  let newpath = await root.getNodePathAsync(newobjpath)
  expect(newpath).toBeDefined()
  expect(newpath.length).toBe(0)

  // simulate a creation
  addNewClass(client)

  newpath = await root.getNodePathAsync(newobjpath)
  expect(newpath).toBeDefined()
  expect(newpath.map(x => x.path)).toEqual(expectedPath)
  const pah2 = root.getNodePath(newobjpath)
  expect(pah2).toEqual(newpath)
})

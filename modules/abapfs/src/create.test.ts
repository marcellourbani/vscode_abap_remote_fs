import { createRoot, isRoot, TMPFOLDER, LIBFOLDER } from "./root"
import { AbapFsService } from "."
import { mock } from "jest-mock-extended"
import { isAbapFolder, AbapFolder } from "./abapFolder"
import { Folder, isFolder } from "./folder"
import sampleNodeContents from "./testdata/nodeContents1.json"
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

  expect(root.byPath("/")).toBe(root)
  expect(isFolder(root.byPath("/$TMP/child"))).toBe(true)
  expect(isFolder(root.byPath("/System Library/zchild"))).toBe(true)
  expect(root.byPath("/$TMP/child/foo")).toBeTruthy()
  expect(root.byPath("/System Library/zchild/bar")).toBeTruthy()
  expect(isFolder(root.byPath("/$TMP/child/foo"))).toBe(false)
  expect(isFolder(root.byPath("/System Library/zchild/bar"))).toBe(false)
  expect(root.byPath("/$TMP/child/foo/2")).toBeUndefined()
})

test("expand single package", async () => {
  const client = mock<AbapFsService>()
  client.nodeContents.mockReturnValueOnce(Promise.resolve(sampleNodeContents))
  const root = createRoot("MYConn", client)
  const lib = root.get(LIBFOLDER)
  if (!isAbapFolder(lib)) fail("wrong type")
  await lib.refresh()
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
  await lib.refresh()
  expect(lib.size).toBe(1)
  expect(lib.get("foobar")).toBeDefined()
})

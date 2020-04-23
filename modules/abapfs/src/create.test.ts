import { createRoot, isRoot, TMPFOLDER, LIBFOLDER } from "./root"
import { AbapFsService } from "."
import { mock } from "jest-mock-extended"
import { isAbapFolder } from "./abapFolder"
import { Folder, isFolder } from "./folder"
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
  const root = createRoot("MYConn", client)
})

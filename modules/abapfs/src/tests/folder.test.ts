import { Folder, isFolder } from "../folder"
import { mock } from "jest-mock-extended"

const createFile = () => ({ type: 1, mtime: 0, ctime: 0, size: 0 })

test("folder iterator", () => {
  const folder = new Folder()
  const same = folder.set("foo", createFile())
  expect(same).toBe(folder)
  folder.set("bar", createFile())
  folder.set("foo", createFile(), false)

  expect(folder.size).toBe(2)

  const keys = new Map<string, boolean>()

  for (const child of folder) {
    keys.set(child.name, true)
    expect(child.file.size).toBe(0)
  }
  expect(keys.get("foo")).toBe(true)
  expect(keys.get("bar")).toBe(true)

  // check a second run of the iterator yields all the children
  expect([...folder].length).toBe(2)
})

test("deep folder iterator", () => {
  const folder = new Folder()
  const inner = new Folder()
  const deep = new Folder()
  deep.set("deep", createFile())
  inner.set("baz", deep)
  folder.set("foo", createFile()).set("bar", inner).set("foobar", createFile())
  const expanded = [...folder.expandPath()]
  expect(expanded.length).toBe(5)
  expect(expanded.find(e => (e.path = "/bar/baz/deep"))).toBeTruthy()
})

test("merging folders", () => {
  const folder = new Folder()
  folder.set("foo", new Folder(), false)
  let tmp = new Folder()
  tmp.set("barfile1", createFile())
  tmp.set("barfile2", createFile())
  folder.set("bar", tmp, true)
  folder.set("baz", createFile(), false)
  tmp = new Folder()
  tmp.set("file1", createFile(), false)
  tmp.set("file2", createFile(), false)

  folder.merge([{ name: "foo", file: tmp }])

  expect(folder.get("baz")).toBeUndefined()
  const bar = folder.get("bar")
  if (isFolder(bar)) {
    expect(bar.get("barfile1")).toBeDefined()
    expect(bar.get("barfile2")).toBeDefined()
    expect(bar.size).toBe(2)
  } else fail("removed manual folder")
  const foo = folder.get("foo")
  if (isFolder(foo)) {
    expect(foo.get("file1")).toBeDefined()
    expect(foo.get("file2")).toBeDefined()
    expect(foo.size).toBe(2)
  } else fail("folder replaced or removed")
})

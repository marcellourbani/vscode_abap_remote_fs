import { Folder } from "./folder"

const createFile = () => ({ type: 1, mtime: 0, ctime: 0, size: 0 })

test("folder iterator", () => {
  const folder = new Folder()
  folder.set("foo", createFile())
  folder.set("bar", createFile())
  folder.set("foo", createFile(), true)

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

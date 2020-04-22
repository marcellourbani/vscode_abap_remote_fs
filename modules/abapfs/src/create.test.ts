import { createRoot, isRoot, TMPFOLDER, LIBFOLDER } from "./root"
import { AbapFsService } from "."
import { mock } from "jest-mock-extended"
import { isAbapFolder } from "./abapFolder"

test("create root", async () => {
  const client = mock<AbapFsService>()
  const root = createRoot("MYConn", client)
  expect(isRoot(root)).toBe(true)

  const tmp = root.children.get(TMPFOLDER)
  if (isAbapFolder(tmp?.file)) expect(tmp?.file.children.size).toBe(0)
  else fail("Tmp folder undefined or unexpected type")
  const lib = root.children.get(LIBFOLDER)
  if (isAbapFolder(lib?.file)) expect(lib?.file.children.size).toBe(0)
  else fail("Tmp folder undefined or unexpected type")
})

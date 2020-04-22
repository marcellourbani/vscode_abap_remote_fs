import { createRoot, isRoot, TMPFOLDER, LIBFOLDER } from "./root"
import { AbapFsService } from "."
import { mock } from "jest-mock-extended"
import { isAbapFolder } from "./abapFolder"

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

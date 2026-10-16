import { mock } from "vitest-mock-extended"
import type { FileStat } from "vscode"
import type { AbapObject } from "abapobject"
import { AbapFile } from "../abapFile"
import type { AbapFsService } from ".."

const fileFor = (object: AbapObject) =>
  new AbapFile(object, mock<FileStat>(), mock<AbapFsService>())

test("write loads missing metadata of a refreshed node before saving", async () => {
  let structure: any
  const object = mock<AbapObject>({ supported: true })
  Object.defineProperty(object, "structure", { get: () => structure })
  object.loadStructure.mockImplementation(
    async () => (structure = { metaData: {}, links: [] } as any)
  )
  object.write.mockImplementation(async () => {
    if (!structure) throw new Error("Unable to retrieve metadata")
  })

  await fileFor(object).write("REPORT ztest.", "lock", "")

  expect(object.loadStructure).toHaveBeenCalled()
  expect(object.write).toHaveBeenCalledWith("REPORT ztest.", "lock", "")
})

test("write keeps loaded metadata", async () => {
  const object = mock<AbapObject>({ supported: true, structure: { metaData: {} } as any })

  await fileFor(object).write("REPORT ztest.", "lock", "")

  expect(object.loadStructure).not.toHaveBeenCalled()
  expect(object.write).toHaveBeenCalled()
})

test("write invalidates cached source even when the modification time is unchanged", async () => {
  const object = mock<AbapObject>({
    supported: true,
    modtime: 1,
    structure: { metaData: {} } as any
  })
  object.read.mockResolvedValueOnce("REPORT old.").mockResolvedValue("REPORT new.")
  const file = fileFor(object)

  expect(await file.read()).toBe("REPORT old.")
  expect(await file.read()).toBe("REPORT old.")
  expect(object.read).toHaveBeenCalledTimes(1)
  await file.write("REPORT new.", "lock")
  expect(await file.read()).toBe("REPORT new.")
  expect(object.read).toHaveBeenCalledTimes(2)
  await file.write("REPORT new.", "lock")
})

test("a rejected write also invalidates cached source", async () => {
  const object = mock<AbapObject>({
    supported: true,
    modtime: 1,
    structure: { metaData: {} } as any
  })
  object.read.mockResolvedValueOnce("REPORT old.").mockResolvedValue("REPORT current.")
  object.write.mockRejectedValueOnce(new Error("save failed"))
  const file = fileFor(object)

  expect(await file.read()).toBe("REPORT old.")
  await expect(file.write("REPORT new.", "lock")).rejects.toThrow("save failed")
  expect(await file.read()).toBe("REPORT current.")
  expect(object.read).toHaveBeenCalledTimes(2)
  await file.write("REPORT current.", "lock")
})

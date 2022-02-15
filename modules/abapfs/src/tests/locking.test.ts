import { mock } from "jest-mock-extended"
import { AbapFsService, createRoot } from ".."
import sampleNodeContents from "../testdata/nodeContents1.json"
import sampleclas from "../testdata/zcl_ca_alv.json"
import { delay } from "../lockObject"
import { Root } from "../root"

const mockClient = () => {
  const client = mock<AbapFsService>()
  const locks = new Map<string, string>()
  client.nodeContents.mockReturnValueOnce(Promise.resolve(sampleNodeContents))
  client.objectStructure.mockReturnValueOnce(Promise.resolve(sampleclas))
  client.lock.mockImplementation(async (path: string) => {
    if (locks.get(path)) throw new Error("Object locked by another user")
    await delay(50)
    const LOCK_HANDLE = Math.random().toString()
    locks.set(path, LOCK_HANDLE)
    return {
      CORRNR: "",
      LOCK_HANDLE,
      CORRUSER: "",
      CORRTEXT: "",
      IS_LOCAL: "",
      IS_LINK_UP: "",
      MODIFICATION_SUPPORT: ""
    }
  })
  client.unlock.mockImplementation(async (path, handle) => {
    if (locks.get(path) !== handle) throw new Error(`Lock ID not matching`)
    await delay(50)
    locks.delete(path)
    return ""
  })
  return client
}
const curStat = (root: Root) => (path: string) =>
  root.lockManager.lockStatus(path).status
const main = "/$TMP/Source Code Library/Classes/ZCL_CA_ALV/ZCL_CA_ALV.clas.abap"
const localdef =
  "/$TMP/Source Code Library/Classes/ZCL_CA_ALV/ZCL_CA_ALV.clas.locals_def.abap"

test("lock/unlock class members", async () => {
  const client = mockClient()
  const root = createRoot("MYConn", client)
  try {
    await root.lockManager.requestLock(main)
    fail("lock should not be allowed until filename is resolved")
  } catch (error) {
    // expected
  }
  await root.getNodeAsync(main)
  const lock = await root.lockManager.requestLock(main)
  expect(lock.status).toBe("locked")
  expect(curStat(root)(localdef)).toBe("locked")
  const newstat = await root.lockManager.requestUnlock(main)
  expect(newstat.status).toBe("unlocked")
  expect(curStat(root)(localdef)).toBe("unlocked")
})

test("lock multiple related includes", async () => {
  const root = createRoot("MYConn", mockClient())
  await root.getNodeAsync(localdef)
  const cur = curStat(root)
  expect(cur(main)).toBe("unlocked")
  expect(cur(localdef)).toBe("unlocked")
  root.lockManager.requestLock(localdef)
  const lock = await root.lockManager.requestLock(main)
  expect(lock.status).toBe("locked")
  expect(cur(main)).toBe("locked")
  expect(cur(localdef)).toBe("locked")
})

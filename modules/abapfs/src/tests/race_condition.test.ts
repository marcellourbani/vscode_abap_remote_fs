import { mock } from "jest-mock-extended"
import { AbapFsService, createRoot } from ".."
import sampleNodeContents from "../testdata/nodeContents1.json"
import sampleclas from "../testdata/zcl_ca_alv.json"
import { delay } from "../lockObject"

const mockClient = () => {
  const client = mock<AbapFsService>()
  const locks = new Map<string, string>()
  client.nodeContents.mockReturnValue(Promise.resolve(sampleNodeContents))
  client.objectStructure.mockReturnValue(Promise.resolve(sampleclas))
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
      MODIFICATION_SUPPORT: "",
      status: "locked"
    } as any
  })
  client.unlock.mockImplementation(async (path, handle) => {
    // if (locks.get(path) !== handle) throw new Error(`Lock ID not matching`)
    await delay(50)
    locks.delete(path)
    return ""
  })
  return client
}

const main = "/$TMP/Source Code Library/Classes/ZCL_CA_ALV/ZCL_CA_ALV.clas.abap"

test("lock race condition: request lock while unlocking", async () => {
  const client = mockClient()
  const root = createRoot("MYConn", client)

  await root.getNodeAsync(main)

  // 1. Initial lock
  await root.lockManager.requestLock(main)
  expect(root.lockManager.lockStatus(main).status).toBe("locked")

  // 2. Start unlock (immediate to avoid the 1s delay for easier testing)
  const unlockPromise = root.lockManager.requestUnlock(main, true)

  // 3. Immediately request lock again WHILE unlock is pending
  const relockPromise = root.lockManager.requestLock(main)

  await Promise.all([unlockPromise, relockPromise])

  // The final status should be "locked"
  expect(root.lockManager.lockStatus(main).status).toBe("locked")

  // Verify that lock was called again after unlock
  // Initial lock + relock = 2 calls
  expect(client.lock).toHaveBeenCalledTimes(2)
})

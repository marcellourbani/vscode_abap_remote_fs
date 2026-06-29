jest.mock("../../extension", () => ({
  context: {
    globalState: {
      get: jest.fn(),
      update: jest.fn()
    }
  }
}))

import { getRecent, addRecent, clearRecent, RecentObject, RECENT_MAX } from "./recentObjects"
import { context } from "../../extension"

const mockGet = context.globalState.get as jest.Mock
const mockUpdate = context.globalState.update as jest.Mock

const makeItem = (uri: string, name = "OBJ"): RecentObject => ({
  uri,
  type: "PROG/P",
  name,
  packageName: "ZPKG",
  description: "Test description"
})

describe("recentObjects", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("getRecent", () => {
    it("returns empty array when nothing stored", () => {
      mockGet.mockReturnValue(undefined)
      expect(getRecent("conn1")).toEqual([])
    })

    it("returns stored items", () => {
      const items = [makeItem("/uri/1")]
      mockGet.mockReturnValue(items)
      expect(getRecent("conn1")).toEqual(items)
      expect(mockGet).toHaveBeenCalledWith("abapfs.recentObjects.conn1")
    })
  })

  describe("addRecent", () => {
    it("adds item to front of empty list", async () => {
      mockGet.mockReturnValue([])
      const item = makeItem("/uri/1")
      await addRecent("conn1", item)

      expect(mockUpdate).toHaveBeenCalledWith("abapfs.recentObjects.conn1", [item])
    })

    it("deduplicates by URI — moves existing item to front", async () => {
      const existing = [makeItem("/uri/1", "FIRST"), makeItem("/uri/2", "SECOND")]
      mockGet.mockReturnValue(existing)

      const updated = makeItem("/uri/2", "UPDATED")
      await addRecent("conn1", updated)

      const stored = mockUpdate.mock.calls[0][1] as RecentObject[]
      expect(stored[0].uri).toBe("/uri/2")
      expect(stored[0].name).toBe("UPDATED")
      expect(stored[1].uri).toBe("/uri/1")
      expect(stored).toHaveLength(2)
    })

    it("most recent item is always first", async () => {
      const existing = [makeItem("/uri/1"), makeItem("/uri/2")]
      mockGet.mockReturnValue(existing)

      await addRecent("conn1", makeItem("/uri/3"))

      const stored = mockUpdate.mock.calls[0][1] as RecentObject[]
      expect(stored[0].uri).toBe("/uri/3")
      expect(stored[1].uri).toBe("/uri/1")
      expect(stored[2].uri).toBe("/uri/2")
    })

    it("caps list at RECENT_MAX items", async () => {
      const existing = Array.from({ length: RECENT_MAX }, (_, i) => makeItem(`/uri/${i}`))
      mockGet.mockReturnValue(existing)

      await addRecent("conn1", makeItem("/uri/new"))

      const stored = mockUpdate.mock.calls[0][1] as RecentObject[]
      expect(stored).toHaveLength(RECENT_MAX)
      expect(stored[0].uri).toBe("/uri/new")
      // The last item from the original list should have been dropped
      expect(stored.find(r => r.uri === `/uri/${RECENT_MAX - 1}`)).toBeUndefined()
    })
  })

  describe("clearRecent", () => {
    it("clears stored items", async () => {
      await clearRecent("conn1")
      expect(mockUpdate).toHaveBeenCalledWith("abapfs.recentObjects.conn1", [])
    })
  })
})

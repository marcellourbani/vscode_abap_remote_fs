import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock("../../lib", () => ({ log: vi.fn() }))
vi.mock("./query", async original => ({
  ...(await original<typeof import("./query")>()),
  ensureConnected: vi.fn()
}))
vi.mock("./engine", () => ({ imgSearchViaEngine: vi.fn(), imgIndexRead: vi.fn() }))
import { ensureConnected } from "./query"
import { imgSearchViaEngine, imgIndexRead } from "./engine"
import { handleImgSearch } from "./discovery"

const runQuery = vi.fn()
const input = { connectionId: "example", keyword: "plant" }
const hit = {
  ACTIVITY: "Z_PLANT",
  TEXT: "Plant configuration",
  OBJECTTYPE: "V",
  OBJECTNAME: "V_ZCFG",
  TCODE: "SM30"
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(ensureConnected).mockResolvedValue({ statelessClone: { runQuery } } as never)
  vi.mocked(imgSearchViaEngine).mockResolvedValue({ hits: [hit], messages: [], capped: false })
  runQuery.mockResolvedValue({ values: [], columns: [] })
})

describe("IMG discovery", () => {
  it("prefers server-side search and includes maintenance context", async () => {
    const text = (await handleImgSearch(input)).content[0].text
    for (const value of [
      "Z_PLANT",
      "Plant configuration",
      "V_ZCFG",
      "SM30",
      "full CUS_IMGACT scan"
    ])
      expect(text).toContain(value)
    expect(runQuery).not.toHaveBeenCalled()
  })
  it("forwards keyword, selected language and result limit", async () => {
    await handleImgSearch({ ...input, keyword: " plant ", language: "D", maxResults: 20 })
    expect(imgSearchViaEngine).toHaveBeenCalledWith("example", {
      keyword: "plant",
      language: "D",
      maxRows: 20
    })
  })
  it("reports no engine matches without raw fallback", async () => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue({ hits: [], messages: [], capped: false })
    expect((await handleImgSearch(input)).content[0].text).toContain("No IMG activities matching")
    expect(runQuery).not.toHaveBeenCalled()
  })
  it("reports capped engine results", async () => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue({
      hits: [hit],
      messages: ["Result capped at 1"],
      capped: true
    })
    expect((await handleImgSearch(input)).content[0].text).toContain("Result capped at 1")
  })
  it.each(["EE", "E'", " "])("rejects unsafe language %s", async language => {
    await expect(handleImgSearch({ ...input, language })).rejects.toThrow("language")
    expect(imgSearchViaEngine).not.toHaveBeenCalled()
  })
  it.each(["V", "S", "C", "T", "D", "UNKNOWN"])(
    "formats engine object type %s",
    async OBJECTTYPE => {
      vi.mocked(imgSearchViaEngine).mockResolvedValue({
        hits: [{ ...hit, OBJECTTYPE }],
        messages: [],
        capped: false
      })
      expect((await handleImgSearch(input)).content[0].text).toContain("Z_PLANT")
    }
  )
  it("uses raw bounded search for a namespace", async () => {
    runQuery.mockResolvedValue({ values: [hit], columns: [] })
    const result = await handleImgSearch({ ...input, namespace: "Z_" })
    expect(result.content[0].text).toContain("Z_PLANT")
    expect(imgSearchViaEngine).not.toHaveBeenCalled()
    expect(runQuery.mock.calls[0][0]).toContain("a~ACTIVITY >= 'Z_'")
  })
  it("escapes raw namespace literals", async () => {
    await handleImgSearch({ ...input, namespace: "Z'" })
    expect(runQuery.mock.calls[0][0]).toContain("a~ACTIVITY >= 'Z''' ")
  })
  it.each(["PLANT", "Z_PLANT", "V_ZCFG", "SM30"])(
    "matches raw keyword against title/id/object/tcode: %s",
    async keyword => {
      runQuery.mockResolvedValue({ values: [hit], columns: [] })
      expect(
        (await handleImgSearch({ ...input, namespace: "Z_", keyword })).content[0].text
      ).toContain("Z_PLANT")
    }
  )
  it("labels a capped raw scan as partial", async () => {
    runQuery.mockResolvedValue({ values: [hit], columns: [] })
    expect(
      (await handleImgSearch({ ...input, namespace: "Z_", maxResults: 1 })).content[0].text
    ).toContain("PARTIAL SCAN")
  })
  it("filters activated scope without requiring a namespace", async () => {
    runQuery
      .mockResolvedValueOnce({ values: [hit, { ...hit, ACTIVITY: "Z_OTHER" }], columns: [] })
      .mockResolvedValueOnce({ values: [{ ACTIVITY: "Z_PLANT" }], columns: [] })
    const text = (await handleImgSearch({ ...input, inScopeOnly: true })).content[0].text
    expect(text).toContain("Z_PLANT")
    expect(text).not.toContain("Z_OTHER")
    expect(runQuery.mock.calls[1][0]).toBe("SELECT ACTIVITY FROM CUS_IMGACH_SCOPE")
  })
  it("reports unavailable scope data", async () => {
    runQuery.mockResolvedValueOnce({ values: [hit], columns: [] })
    expect((await handleImgSearch({ ...input, inScopeOnly: true })).content[0].text).toContain(
      "inScopeOnly ignored"
    )
  })
  it("uses ADT fallback when a search operation is unsupported", async () => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue(null)
    expect((await handleImgSearch(input)).content[0].text).toContain("No matches in the first")
    expect(runQuery).toHaveBeenCalled()
  })
  it("falls back from search errors but propagates raw SQL failure", async () => {
    vi.mocked(imgSearchViaEngine).mockRejectedValue(new Error("Unsupported operation"))
    runQuery.mockRejectedValue(new Error("SQL denied"))
    await expect(handleImgSearch(input)).rejects.toThrow("SQL denied")
  })
  it.each([true, false])("formats index breadcrumbs with path=%s", async withPath => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue(null)
    runQuery
      .mockResolvedValueOnce({ values: [{ TREE_ID: "TREE", GEN_DATE: "20260101" }], columns: [] })
      .mockResolvedValueOnce({ values: [{ ID: "TREE" }], columns: [] })
    vi.mocked(imgIndexRead).mockResolvedValue({
      status: "ok",
      messages: [],
      hits: [
        {
          TEXT: "Plant",
          PATH: withPath ? "Enterprise > Plant" : "",
          NODE_ID: "NODE",
          EXTENSION: "ZACT",
          STRUCTURE_ID: "TREE"
        }
      ]
    })
    const text = (await handleImgSearch(input)).content[0].text
    expect(text).toContain(withPath ? "Enterprise > Plant" : "Plant")
    expect(text).toContain("[ZACT]")
    expect(text).toContain("STREE index TREE @20260101")
    expect(imgIndexRead).toHaveBeenCalledWith("example", {
      structureId: "TREE",
      language: "E",
      keyword: "plant",
      maxRows: 200
    })
  })
  it("reports no index matches without claiming to have searched raw data", async () => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue(null)
    runQuery
      .mockResolvedValueOnce({ values: [{ TREE_ID: "TREE" }], columns: [] })
      .mockResolvedValueOnce({ values: [{ ID: "TREE" }], columns: [] })
    vi.mocked(imgIndexRead).mockResolvedValue({ status: "ok", messages: [], hits: [] })
    expect((await handleImgSearch(input)).content[0].text).toContain("No IMG nodes matching")
    expect(runQuery).toHaveBeenCalledTimes(2)
  })
  it("falls back if indexed trees are not IMG trees", async () => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue(null)
    runQuery.mockResolvedValueOnce({ values: [{ TREE_ID: "OTHER" }], columns: [] })
    expect((await handleImgSearch(input)).content[0].text).toContain("No matches in the first")
    expect(imgIndexRead).not.toHaveBeenCalled()
  })
  it("falls back when engine cannot read an existing index", async () => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue(null)
    runQuery
      .mockResolvedValueOnce({ values: [{ TREE_ID: "TREE" }], columns: [] })
      .mockResolvedValueOnce({ values: [{ ID: "TREE" }], columns: [] })
    vi.mocked(imgIndexRead).mockResolvedValue({ status: "no_index", messages: [], hits: [] })
    expect((await handleImgSearch(input)).content[0].text).toContain("No matches in the first")
  })
  it("deduplicates indexed tree generations and limits accumulated hits", async () => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue(null)
    runQuery
      .mockResolvedValueOnce({
        values: [
          { TREE_ID: "TREE", GEN_DATE: "20260201" },
          { TREE_ID: "TREE", GEN_DATE: "20260101" },
          { TREE_ID: "OTHER" }
        ],
        columns: []
      })
      .mockResolvedValueOnce({ values: [{ ID: "TREE" }, { ID: "OTHER" }], columns: [] })
    vi.mocked(imgIndexRead).mockResolvedValue({
      status: "ok",
      messages: [],
      hits: [{ TEXT: "Plant", PATH: "", NODE_ID: "NODE", EXTENSION: "", STRUCTURE_ID: "TREE" }]
    })
    const text = (await handleImgSearch({ ...input, maxResults: 1 })).content[0].text
    expect(text).toContain("@20260201")
    expect(imgIndexRead).toHaveBeenCalledTimes(1)
  })
  it("does not invoke an index reader when no index exists", async () => {
    vi.mocked(imgSearchViaEngine).mockResolvedValue(null)
    await handleImgSearch(input)
    expect(imgIndexRead).not.toHaveBeenCalled()
  })
})

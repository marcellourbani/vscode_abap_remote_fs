jest.mock("../../lib", () => ({ log: () => {} }))

import { determineFeedType, getDefaultQuery, toFeedMetadata, parseFeedEntry, parseFeedResponse } from "./feedParsers"
import { FeedType } from "./feedTypes"
import { Feed } from "abap-adt-api"

const makeFeed = (href: string, title = "Test Feed"): Feed => ({
  href,
  title,
  queryVariants: []
} as any)

describe("determineFeedType", () => {
  test("detects DUMPS feed", () => {
    expect(determineFeedType(makeFeed("/sap/bc/adt/runtime/dumps/feeds"))).toBe(FeedType.DUMPS)
  })

  test("detects ATC feed", () => {
    expect(determineFeedType(makeFeed("/sap/bc/adt/atc/feeds/verdicts"))).toBe(FeedType.ATC)
  })

  test("detects GATEWAY_ERROR feed", () => {
    expect(determineFeedType(makeFeed("/sap/bc/adt/gw/errorlog"))).toBe(FeedType.GATEWAY_ERROR)
  })

  test("detects SYSTEM_MESSAGES feed", () => {
    expect(determineFeedType(makeFeed("/sap/bc/adt/runtime/systemmessages"))).toBe(FeedType.SYSTEM_MESSAGES)
  })

  test("detects URI_ERRORS feed", () => {
    expect(determineFeedType(makeFeed("/sap/bc/adt/error/urimapper"))).toBe(FeedType.URI_ERRORS)
  })

  test("detects RAP_CONTRACT feed", () => {
    expect(determineFeedType(makeFeed("/sap/bc/adt/bo/feeds/ccviolations"))).toBe(FeedType.RAP_CONTRACT)
  })

  test("detects EEE_ERROR feed", () => {
    expect(determineFeedType(makeFeed("/sap/bc/adt/eee/errorlog"))).toBe(FeedType.EEE_ERROR)
  })

  test("returns UNKNOWN for unrecognized path", () => {
    expect(determineFeedType(makeFeed("/sap/bc/adt/something/else"))).toBe(FeedType.UNKNOWN)
  })

  test("is case-insensitive", () => {
    expect(determineFeedType(makeFeed("/SAP/BC/ADT/RUNTIME/DUMPS/feeds"))).toBe(FeedType.DUMPS)
  })
})

describe("getDefaultQuery", () => {
  test("returns undefined when no query variants", () => {
    expect(getDefaultQuery(makeFeed("/test"))).toBeUndefined()
  })

  test("returns default variant query string", () => {
    const feed = {
      href: "/test",
      title: "Test",
      queryVariants: [
        { queryString: "q1", isDefault: false },
        { queryString: "q2", isDefault: true }
      ]
    } as any
    expect(getDefaultQuery(feed)).toBe("q2")
  })

  test("returns first variant when no default", () => {
    const feed = {
      href: "/test",
      title: "Test",
      queryVariants: [
        { queryString: "q1", isDefault: false },
        { queryString: "q2", isDefault: false }
      ]
    } as any
    expect(getDefaultQuery(feed)).toBe("q1")
  })
})

describe("toFeedMetadata", () => {
  test("adds feedType and defaultQuery", () => {
    const feed = makeFeed("/sap/bc/adt/runtime/dumps/feeds")
    const meta = toFeedMetadata(feed)
    expect(meta.feedType).toBe(FeedType.DUMPS)
    expect(meta.href).toBe(feed.href)
  })
})

describe("parseFeedEntry", () => {
  test("parses a basic entry", () => {
    const raw = {
      id: "entry-1",
      title: "Test Entry",
      updated: "2024-01-15T10:00:00Z",
      summary: "A summary",
      author: { name: "TESTUSER" }
    }
    const entry = parseFeedEntry(raw, "DEV", "Dumps", "/dumps", FeedType.DUMPS)
    expect(entry.id).toBe("entry-1")
    expect(entry.systemId).toBe("DEV")
    expect(entry.feedTitle).toBe("Dumps")
    expect(entry.author).toBe("TESTUSER")
    expect(entry.isNew).toBe(true)
    expect(entry.isRead).toBe(false)
    expect(entry.severity).toBe("error") // dumps = error
  })

  test("extracts runtime error category for dumps", () => {
    const raw = {
      id: "d1",
      title: "Some title",
      categories: [
        { term: "DBSQL_SQL_ERROR", label: "ABAP runtime error" }
      ]
    }
    const entry = parseFeedEntry(raw, "DEV", "Dumps", "/dumps", FeedType.DUMPS)
    expect(entry.title).toBe("DBSQL_SQL_ERROR")
  })

  test("falls back to first category term for dumps", () => {
    const raw = {
      id: "d2",
      title: "Something",
      categories: [{ term: "SOME_ERROR", label: "Other label" }]
    }
    const entry = parseFeedEntry(raw, "DEV", "Dumps", "/dumps", FeedType.DUMPS)
    expect(entry.title).toBe("SOME_ERROR")
  })

  test("determines severity for ATC findings by priority", () => {
    const base = { id: "a1", title: "ATC Finding" }
    expect(parseFeedEntry({ ...base, priority: 1 }, "D", "ATC", "/atc", FeedType.ATC).severity).toBe("error")
    expect(parseFeedEntry({ ...base, priority: 2 }, "D", "ATC", "/atc", FeedType.ATC).severity).toBe("warning")
    expect(parseFeedEntry({ ...base, priority: 3 }, "D", "ATC", "/atc", FeedType.ATC).severity).toBe("info")
  })

  test("gateway errors are always error severity", () => {
    const entry = parseFeedEntry({ id: "g1", title: "GW" }, "D", "GW", "/gw", FeedType.GATEWAY_ERROR)
    expect(entry.severity).toBe("error")
  })

  test("unknown feed type defaults to info severity", () => {
    const entry = parseFeedEntry({ id: "u1", title: "Unknown" }, "D", "U", "/u", FeedType.UNKNOWN)
    expect(entry.severity).toBe("info")
  })

  test("extracts summary from string summary", () => {
    const entry = parseFeedEntry({ id: "s1", title: "T", summary: "Hello" }, "D", "F", "/f", FeedType.UNKNOWN)
    expect(entry.summary).toBe("Hello")
  })

  test("extracts summary from object summary with #text", () => {
    const entry = parseFeedEntry({ id: "s2", title: "T", summary: { "#text": "Rich text" } }, "D", "F", "/f", FeedType.UNKNOWN)
    expect(entry.summary).toBe("Rich text")
  })

  test("strips HTML from content summary", () => {
    const entry = parseFeedEntry({ id: "s3", title: "T", content: "<b>Bold</b> text" }, "D", "F", "/f", FeedType.UNKNOWN)
    expect(entry.summary).toBe("Bold text")
  })

  test("extracts category from object", () => {
    const entry = parseFeedEntry({ id: "c1", title: "T", category: { term: "CAT1" } }, "D", "F", "/f", FeedType.UNKNOWN)
    expect(entry.category).toBe("CAT1")
  })

  test("extracts category from array", () => {
    const entry = parseFeedEntry({ id: "c2", title: "T", category: [{ term: "CAT2" }] }, "D", "F", "/f", FeedType.UNKNOWN)
    expect(entry.category).toBe("CAT2")
  })

  test("extracts category from string", () => {
    const entry = parseFeedEntry({ id: "c3", title: "T", category: "simple" }, "D", "F", "/f", FeedType.UNKNOWN)
    expect(entry.category).toBe("simple")
  })

  test("parses date from string", () => {
    const entry = parseFeedEntry({ id: "d1", title: "T", updated: "2024-06-15T12:00:00Z" }, "D", "F", "/f", FeedType.UNKNOWN)
    expect(entry.timestamp.getFullYear()).toBe(2024)
  })

  test("uses current date for missing date", () => {
    const before = Date.now()
    const entry = parseFeedEntry({ id: "d2", title: "T" }, "D", "F", "/f", FeedType.UNKNOWN)
    expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })
})

describe("parseFeedResponse", () => {
  test("parses array response", () => {
    const data = [
      { id: "1", title: "Entry 1" },
      { id: "2", title: "Entry 2" }
    ]
    const entries = parseFeedResponse(data, "DEV", "Test", "/test", FeedType.UNKNOWN)
    expect(entries).toHaveLength(2)
    expect(entries[0].id).toBe("1")
  })

  test("parses response with entries property", () => {
    const data = {
      entries: [{ id: "1", title: "Entry 1" }]
    }
    const entries = parseFeedResponse(data, "DEV", "Test", "/test", FeedType.UNKNOWN)
    expect(entries).toHaveLength(1)
  })

  test("parses response with dumps property", () => {
    const data = {
      dumps: [{ id: "1", title: "Dump 1" }]
    }
    const entries = parseFeedResponse(data, "DEV", "Dumps", "/dumps", FeedType.DUMPS)
    expect(entries).toHaveLength(1)
  })

  test("parses single entry property", () => {
    const data = { entry: { id: "1", title: "Single" } }
    const entries = parseFeedResponse(data, "DEV", "T", "/t", FeedType.UNKNOWN)
    expect(entries).toHaveLength(1)
  })

  test("returns empty for unknown structure", () => {
    const entries = parseFeedResponse({ foo: "bar" }, "DEV", "T", "/t", FeedType.UNKNOWN)
    expect(entries).toHaveLength(0)
  })

  test("returns empty for null data", () => {
    const entries = parseFeedResponse(null, "DEV", "T", "/t", FeedType.UNKNOWN)
    expect(entries).toHaveLength(0)
  })
})

vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  }
}))
vi.mock("../../adt/conections", () => ({ getClient: vi.fn() }))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
vi.mock("./abapKeywordDocu/keywordDocuAdt", () => ({
  getKeywordDocuRoute: vi.fn(),
  searchKeywordDocu: vi.fn(),
  getKeywordDocuTopic: vi.fn()
}))

import type { Mock } from "vitest"
import { AbapKeywordDocuTool } from "./abapKeywordDocuTool"
import { getClient } from "../../adt/conections"
import {
  getKeywordDocuRoute,
  getKeywordDocuTopic,
  searchKeywordDocu
} from "./abapKeywordDocu/keywordDocuAdt"
import {
  HITS_HTML,
  INVALID_TOPIC_HTML,
  LEGACY_HITS_HTML,
  NO_RESULTS_HTML,
  SINGLE_HIT_HTML,
  TOPIC_HTML
} from "./abapKeywordDocu/docuFixtures"

const client = { id: "client" }
const ADT_ROUTE = { kind: "adt", url: "/sap/bc/adt/docu/abap/langu" }
const LEGACY_ROUTE = { kind: "legacy", url: "https://sap.example.com/sap/public/bc/abap/docu" }
const token = {} as any

async function run(input: Record<string, unknown>) {
  const result: any = await new AbapKeywordDocuTool().invoke({ input } as any, token)
  return result.parts[0].text as string
}

describe("AbapKeywordDocuTool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getClient as Mock).mockReturnValue(client)
    ;(getKeywordDocuRoute as Mock).mockResolvedValue(ADT_ROUTE)
  })

  test.each([
    [{ keyword: "COND" }, "connectionId is required"],
    [{ connectionId: "dev100" }, "Provide a keyword or topicId"],
    [{ connectionId: "dev100", topicId: "bad id!" }, "Invalid topicId"],
    [{ connectionId: "dev100", keyword: "COND", version: "Z" }, "version must be one of"],
    [{ connectionId: "dev100", keyword: "COND", language: "ENGLISH" }, "Invalid language"]
  ])("rejects invalid input %o", async (input, message) => {
    await expect(run(input)).rejects.toThrow(message)
    expect(getKeywordDocuRoute).not.toHaveBeenCalled()
  })

  test("reports connection lookup failures without checking discovery", async () => {
    vi.mocked(getClient).mockImplementationOnce(() => {
      throw new Error("Not connected")
    })
    const text = await run({ connectionId: "dev100", keyword: "COND" })
    expect(text).toBe("Could not use SAP connection dev100: Not connected")
    expect(getKeywordDocuRoute).not.toHaveBeenCalled()
  })

  test("reports discovery failures without claiming the feature is unsupported", async () => {
    ;(getKeywordDocuRoute as Mock).mockRejectedValue(new Error("socket hang up"))
    const text = await run({ connectionId: "DEV100", keyword: "COND" })
    expect(getClient).toHaveBeenCalledWith("dev100")
    expect(text).toContain("socket hang up")
    expect(text).toContain("support could not be checked")
    expect(searchKeywordDocu).not.toHaveBeenCalled()
  })

  test("reports missing ADT support", async () => {
    ;(getKeywordDocuRoute as Mock).mockResolvedValue(undefined)
    const text = await run({ connectionId: "dev100", keyword: "COND" })
    expect(text).toContain("No ABAP keyword documentation search route was found")
    expect(searchKeywordDocu).not.toHaveBeenCalled()
  })

  test("returns hit lists without fetching any topic", async () => {
    ;(searchKeywordDocu as Mock).mockResolvedValue(HITS_HTML)
    const text = await run({ connectionId: "dev100", keyword: "DEMO READ" })
    expect(searchKeywordDocu).toHaveBeenCalledWith(client, ADT_ROUTE, "DEMO READ", "EN", "X")
    expect(getKeywordDocuTopic).not.toHaveBeenCalled()
    expect(text).toContain('Search "DEMO READ" matched 2 topics. No topic was fetched')
    expect(text).toContain("Demo Language:\n- DEMO_READ | DEMO READ itab, Statement")
    expect(text).toContain(
      "Obsolete Elements:\n- DEMO_READ_OLD | DEMO READ dbtab, Obsolete Statement"
    )
  })

  test("returns a single-hit topic without fetching it again", async () => {
    ;(searchKeywordDocu as Mock).mockResolvedValue(SINGLE_HIT_HTML)
    const text = await run({
      connectionId: "dev100",
      keyword: "DEMO",
      language: "de",
      version: "5"
    })
    expect(searchKeywordDocu).toHaveBeenCalledWith(client, ADT_ROUTE, "DEMO", "DE", "5")
    expect(getKeywordDocuTopic).not.toHaveBeenCalled()
    expect(text).toMatch(/^Topic DEMO_TOPIC\n\n/)
    expect(text).toContain("# DEMO, Demo Operator")
    expect(text).toContain("Related topics (call this tool with topicId to read one):")
    expect(text).toContain("- DEMO_ROOT | Demo - Help (parent)")
    expect(text).toContain("Search page body.")
  })

  test("reads a topic by id", async () => {
    ;(getKeywordDocuTopic as Mock).mockResolvedValue(TOPIC_HTML)
    const text = await run({ connectionId: "dev100", topicId: "demo_topic" })
    expect(getKeywordDocuTopic).toHaveBeenCalledWith(
      client,
      ADT_ROUTE,
      "DEMO_TOPIC",
      "EN",
      "X",
      undefined
    )
    expect(searchKeywordDocu).not.toHaveBeenCalled()
    expect(text).toMatch(/^Topic DEMO_TOPIC\n\n/)
  })

  test("returns cleaned HTML on request", async () => {
    ;(getKeywordDocuTopic as Mock).mockResolvedValue(TOPIC_HTML)
    const text = await run({ connectionId: "dev100", topicId: "DEMO_TOPIC", format: "html" })
    expect(text).toContain('<span class="h1">')
    expect(text).not.toMatch(/<style|<script|<img|Mail Feedback/)
  })

  test("reports searches without results", async () => {
    ;(searchKeywordDocu as Mock).mockResolvedValue(NO_RESULTS_HTML)
    const text = await run({ connectionId: "dev100", keyword: "nothing" })
    expect(text).toContain('No ABAP keyword documentation found for Search "nothing"')
    expect(text).toContain(`We couldn't find any results for "nothing"`)
  })

  test("legacy search returns choices without fetching a topic", async () => {
    ;(getKeywordDocuRoute as Mock).mockResolvedValue(LEGACY_ROUTE)
    ;(searchKeywordDocu as Mock).mockResolvedValue(LEGACY_HITS_HTML)
    const text = await run({ connectionId: "dev100", keyword: "LOOP AT" })
    expect(text).toContain("matched 3 topics. No topic was fetched")
    expect(text).toContain("with topicId and the same keyword")
    expect(text).toContain("DEMO_LOOP_GROUP | LOOP AT GROUP, ABAP Statement")
    expect(getKeywordDocuTopic).not.toHaveBeenCalled()
  })

  test("legacy topic follow-up sends both the topic and original keyword", async () => {
    ;(getKeywordDocuRoute as Mock).mockResolvedValue(LEGACY_ROUTE)
    ;(getKeywordDocuTopic as Mock).mockResolvedValue(TOPIC_HTML)
    const text = await run({ connectionId: "dev100", keyword: "LOOP AT", topicId: "DEMO_TOPIC" })
    expect(getKeywordDocuTopic).toHaveBeenCalledWith(
      client,
      LEGACY_ROUTE,
      "DEMO_TOPIC",
      "EN",
      "X",
      "LOOP AT"
    )
    expect(text).toContain("Related topics (call this tool with topicId and the original keyword")
  })

  test("reports unknown topics", async () => {
    ;(getKeywordDocuTopic as Mock).mockResolvedValue(INVALID_TOPIC_HTML)
    const text = await run({ connectionId: "dev100", topicId: "DEMO_MISSING" })
    expect(text).toContain("No ABAP keyword documentation found for topic DEMO_MISSING")
    expect(text).toContain("Invalid request")
  })

  test("reports failed documentation requests", async () => {
    ;(searchKeywordDocu as Mock).mockRejectedValue(new Error("Error 500"))
    const text = await run({ connectionId: "dev100", keyword: "COND" })
    expect(text).toBe("The ABAP keyword documentation request on dev100 failed: Error 500")
  })

  test("caps the full response including the truncation notice and related topics", async () => {
    const longTopic = TOPIC_HTML.replace(
      "</div></body>",
      `<p>${"word ".repeat(400)}</p></div></body>`
    )
    ;(getKeywordDocuTopic as Mock).mockResolvedValue(longTopic)
    const text = await run({ connectionId: "dev100", topicId: "DEMO_TOPIC", maxChars: 1000 })
    expect(text).toHaveLength(1000)
    expect(text).toContain("[Truncated.")
  })
})

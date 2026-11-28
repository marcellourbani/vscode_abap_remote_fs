import type { Page } from "@playwright/test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { detectRuntimeError, inspectDumpDocument } from "./dump-detector"

const labels = ["Category", "Runtime Errors", "Application Component", "Short Text"]
afterEach(() => vi.unstubAllGlobals())

function documentFor(text: string, color = "rgb(255, 130, 130)") {
  const header = { innerText: "Category", getClientRects: () => [{}] }
  vi.stubGlobal("document", { body: { innerText: text }, querySelectorAll: () => [header] })
  vi.stubGlobal("getComputedStyle", () => ({
    display: "block",
    visibility: "visible",
    backgroundColor: color
  }))
}

function pageWithFrame(frameResult: unknown, detachFirst = false) {
  const main = {}
  const child = { evaluate: vi.fn(async () => frameResult) }
  const detached = {
    evaluate: vi.fn(async () => {
      throw new Error("Frame detached")
    })
  }
  const page = {
    title: async () => "SAP screen",
    url: () => "https://example.invalid",
    evaluate: vi.fn(async () => null),
    mainFrame: () => main,
    frames: () => (detachFirst ? [main, detached, child] : [main, child]),
    locator: () => ({ first: () => ({ isVisible: async () => false }), evaluate: async () => "" })
  }
  return { page: page as unknown as Page, child }
}

describe("full dump screen signature", () => {
  it.each(["COMPUTE_INT_ZERODIVIDE", "MESSAGE_TYPE_X", "ANY_FUTURE_ERROR"])(
    "does not depend on the runtime error identifier: %s",
    errorId => {
      documentFor(
        `Category\nDifferent category\nRuntime Errors\t${errorId}\nApplication Component\nNot assigned\nShort Text\nExplanation`
      )
      expect(inspectDumpDocument()).toMatchObject({ redHeader: true })
    }
  )
  it("tolerates case, line breaks and nonbreaking whitespace", () => {
    documentFor("CATEGORY\nruntime\u00a0errors\nAPPLICATION\n COMPONENT\nSHORT\tTEXT")
    expect(inspectDumpDocument()).not.toBeNull()
  })
  it.each(labels)("requires the %s label even with a red background", missing => {
    documentFor(labels.filter(label => label !== missing).join("\n"))
    expect(inspectDumpDocument()).toBeNull()
  })
  it.each(["rgb(255, 255, 255)", "rgba(255, 0, 0, 0)", "rgb(0, 128, 255)"])(
    "detects the labels without requiring red styling: %s",
    color => {
      documentFor(labels.join("\n"), color)
      expect(inspectDumpDocument()).toMatchObject({ redHeader: false })
    }
  )
  it("does not mistake a red business-validation screen for a dump", () => {
    documentFor("Category: Input validation\nShort Text: Enter a valid value")
    expect(inspectDumpDocument()).toBeNull()
  })
  it("does not trigger on a Runtime Errors label alone", () => {
    documentFor("Runtime Errors\nSearch historical entries")
    expect(inspectDumpDocument()).toBeNull()
  })
  it("finds Short Text beyond the old 2000-character body slice", () => {
    documentFor(`Category\nRuntime Errors\nApplication Component\n${" ".repeat(3000)}Short Text`)
    expect(inspectDumpDocument()).not.toBeNull()
  })
  it("detects a dump in a child frame and preserves supporting color evidence", async () => {
    const { page, child } = pageWithFrame({ text: labels.join("\n"), redHeader: true })
    expect(await detectRuntimeError(page)).toMatchObject({
      kind: "dump",
      redHeader: true,
      snippet: expect.stringContaining("Short Text")
    })
    expect(child.evaluate).toHaveBeenCalledWith(inspectDumpDocument)
  })
  it("checks later frames after a detached frame", async () => {
    const { page } = pageWithFrame({ text: labels.join("\n"), redHeader: false }, true)
    expect(await detectRuntimeError(page)).toMatchObject({ kind: "dump", redHeader: false })
  })
  it.each(["Runtime Errors", "Category", "Short Text"])(
    "does not classify an ordinary page containing only %s",
    async label => {
      documentFor(label)
      const { page } = pageWithFrame(null)
      Object.assign(page, {
        evaluate: async (fn: () => unknown) => fn(),
        locator: () => ({
          first: () => ({ isVisible: async () => false }),
          evaluate: async () => label
        })
      })
      expect(await detectRuntimeError(page)).toBeNull()
    }
  )
  it("detects the complete signature in the outer document", async () => {
    documentFor(labels.join("\n"))
    const { page } = pageWithFrame(null)
    Object.assign(page, { evaluate: async (fn: () => unknown) => fn() })
    expect(await detectRuntimeError(page)).toMatchObject({ kind: "dump", redHeader: true })
  })
  it("does not combine partial labels from separate documents", async () => {
    documentFor("Category\nRuntime Errors")
    const { page } = pageWithFrame(null)
    expect(await detectRuntimeError(page)).toBeNull()
  })
})

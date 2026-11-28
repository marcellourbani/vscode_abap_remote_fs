import type { Page } from "@playwright/test"
import { describe, expect, it, vi } from "vitest"
import { detectRuntimeError, detectSilentBounce } from "./dump-detector"

function pageFor(
  title = "Healthy screen",
  body = "Normal content",
  url = "https://example.invalid",
  password = false
) {
  return {
    title: vi.fn(async () => title),
    url: () => url,
    locator: (selector: string) => ({
      first: () => ({ isVisible: async () => password }),
      evaluate: async () => body
    }),
    frameLocator: () => ({ getByText: () => ({ count: async () => 0 }) })
  } as unknown as Page
}

describe("runtime failure detection", () => {
  it("leaves a healthy SAP screen alone", async () => {
    expect(await detectRuntimeError(pageFor())).toBeNull()
  })
  it.each([
    "ABAP Runtime Error",
    "Runtime Errors",
    "Session Terminated",
    "500 Internal Server Error",
    "Web Dynpro Component - Runtime Error"
  ])("detects failure title %s", async title => {
    expect(await detectRuntimeError(pageFor(title))).toMatchObject({ kind: "dump", title })
  })
  it.each(["SAP Logon", "Please log on again", "Session ended"])(
    "detects logon title %s",
    async title => {
      expect(await detectRuntimeError(pageFor(title))).toMatchObject({ kind: "logon" })
    }
  )
  it("detects a password form even when its title looks healthy", async () => {
    expect(await detectRuntimeError(pageFor("Welcome", "Login", undefined, true))).toMatchObject({
      kind: "logon"
    })
  })
  it("detects body-only dumps and caps attached snippets", async () => {
    const result = await detectRuntimeError(
      pageFor("Unknown", "The current ABAP program " + "x".repeat(3000))
    )
    expect(result?.kind).toBe("dump")
    expect(result?.snippet).toHaveLength(500)
  })
  it("classifies an ITS error URL", async () => {
    expect(
      await detectRuntimeError(pageFor("Error", "", "https://example.invalid/its/error"))
    ).toMatchObject({ kind: "its" })
  })
  it("does not misclassify an ordinary help URL in page text as a dump", async () => {
    expect(
      await detectRuntimeError(
        pageFor("Application help", "Documentation URL http://example.invalid")
      )
    ).toBeNull()
  })
  it.each(["S000", "SESSION_MANAGER", "*s000"])("allows intentional Easy Access %s", async tx => {
    expect(await detectSilentBounce(pageFor("SAP Easy Access"), tx)).toBeNull()
  })
  it("rejects an unintended Easy Access bounce", async () => {
    expect(await detectSilentBounce(pageFor("SAP Easy Access"), "SE16N")).not.toBeNull()
  })
})

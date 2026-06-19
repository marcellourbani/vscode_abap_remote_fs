jest.mock("../services/funMessenger", () => ({ funWindow: {} }))
jest.mock("../adt/conections", () => ({}))
jest.mock("vscode", () => ({}), { virtual: true })

import { injectUrlHandler } from "./utilities"

describe("injectUrlHandler", () => {
  test("replaces double-quoted href with onClick", () => {
    const html = '<a href="adt://DEV/sap/bc/adt/programs/foo">Link</a>'
    const result = injectUrlHandler(html)
    expect(result).toContain("onClick='abapClick(\"adt://DEV/sap/bc/adt/programs/foo\")'")
    expect(result).not.toContain("href=")
  })

  test("replaces single-quoted href with onClick", () => {
    const html = "<a href='adt://DEV/sap/bc/adt/programs/foo'>Link</a>"
    const result = injectUrlHandler(html)
    expect(result).toContain('onClick="abapClick(')
    expect(result).not.toContain("href=")
  })

  test("injects script into existing <head>", () => {
    const html = "<html><head><title>Test</title></head><body>Hi</body></html>"
    const result = injectUrlHandler(html)
    expect(result).toContain("<head><script type=")
    expect(result).toContain("acquireVsCodeApi")
    expect(result).toContain("<title>Test</title>")
  })

  test("adds <head> with script when none exists", () => {
    const html = "<p>Some content</p>"
    const result = injectUrlHandler(html)
    expect(result).toMatch(/^<head>.*<\/head>/s)
    expect(result).toContain("acquireVsCodeApi")
    expect(result).toContain("<p>Some content</p>")
  })

  test("handles multiple links", () => {
    const html = '<a href="url1">One</a> <a href="url2">Two</a>'
    const result = injectUrlHandler(html)
    expect(result).toContain("abapClick(\"url1\")")
    expect(result).toContain("abapClick(\"url2\")")
  })

  test("is case-insensitive for href attribute", () => {
    const html = '<a HREF="test">Link</a>'
    const result = injectUrlHandler(html)
    expect(result).toContain("abapClick")
  })
})

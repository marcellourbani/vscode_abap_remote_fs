import { toLf, withLineEndingsOf } from "./lineEndings"

describe("toLf", () => {
  it("turns CRLF into LF", () => {
    expect(toLf("REPORT zdemo.\r\nWRITE 1.\r\n")).toBe("REPORT zdemo.\nWRITE 1.\n")
  })

  it("leaves LF text unchanged", () => {
    expect(toLf("a\nb\n")).toBe("a\nb\n")
  })
})

describe("withLineEndingsOf", () => {
  it("restores CRLF when the existing file uses it", () => {
    expect(withLineEndingsOf("a\nb\n", "x\r\ny\r\n")).toBe("a\r\nb\r\n")
  })

  it("does not double existing CRLF in the new content", () => {
    expect(withLineEndingsOf("a\r\nb\nc", "x\r\ny")).toBe("a\r\nb\r\nc")
  })

  it("keeps LF when the existing file uses LF", () => {
    expect(withLineEndingsOf("a\nb\n", "x\ny\n")).toBe("a\nb\n")
  })

  it("keeps the agent's content for new files", () => {
    expect(withLineEndingsOf("a\r\nb\n", undefined)).toBe("a\r\nb\n")
  })
})

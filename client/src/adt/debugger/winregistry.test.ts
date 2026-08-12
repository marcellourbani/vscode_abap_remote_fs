import { execFileSync } from "child_process"

jest.mock("child_process", () => ({
  execFileSync: jest.fn()
}))
jest.mock("../../lib", () => ({
  log: { debug: jest.fn() },
  caughtToString: jest.fn((e: any) => String(e))
}))

import { readWindowsRegistryString } from "./winregistry"
import { log } from "../../lib"

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>
const mockLogDebug = log.debug as jest.MockedFunction<typeof log.debug>

describe("readWindowsRegistryString", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test("parses a REG_SZ value from reg query output", () => {
    mockExecFileSync.mockReturnValueOnce(
      "\r\nHKEY_CURRENT_USER\\Software\\SAP\\ABAP Debugging\r\n    TerminalID    REG_SZ    ABC123DEF456\r\n\r\n" as any
    )
    const result = readWindowsRegistryString(
      "HKEY_CURRENT_USER",
      "Software\\SAP\\ABAP Debugging",
      "TerminalID"
    )
    expect(result).toBe("ABC123DEF456")
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining("found"))
  })

  test("invokes reg.exe with the expected arguments", () => {
    mockExecFileSync.mockReturnValueOnce("    TerminalID    REG_SZ    ABC123\r\n" as any)
    readWindowsRegistryString("HKEY_CURRENT_USER", "Software\\SAP\\ABAP Debugging", "TerminalID")
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "reg",
      ["query", "HKEY_CURRENT_USER\\Software\\SAP\\ABAP Debugging", "/v", "TerminalID"],
      expect.objectContaining({ encoding: "utf8" })
    )
  })

  test("returns undefined when the value is missing from the output", () => {
    mockExecFileSync.mockReturnValueOnce(
      "\r\nHKEY_CURRENT_USER\\Software\\SAP\\ABAP Debugging\r\n\r\n" as any
    )
    expect(
      readWindowsRegistryString("HKEY_CURRENT_USER", "Software\\SAP\\ABAP Debugging", "TerminalID")
    ).toBeUndefined()
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining("was not found"))
  })

  test("returns undefined when reg.exe throws (e.g. key not found)", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("ERROR: The system was unable to find the specified registry key.")
    })
    expect(
      readWindowsRegistryString("HKEY_CURRENT_USER", "Software\\SAP\\ABAP Debugging", "TerminalID")
    ).toBeUndefined()
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.stringContaining("ERROR: The system was unable to find the specified registry key.")
    )
  })
})

jest.mock("vscode", () => ({
  FileSystemError: {
    FileNotFound: (msg: string) => new Error(`FileNotFound: ${msg}`)
  },
  workspace: {
    workspaceFolders: undefined
  },
  Uri: {
    parse: jest.fn((s: string) => ({ scheme: s.split("://")[0], authority: s.split("://")[1]?.split("/")[0], toString: () => s }))
  }
}), { virtual: true })

jest.mock("../config", () => ({
  RemoteManager: { get: jest.fn() },
  createClient: jest.fn()
}))

jest.mock("./debugger", () => ({ LogOutPendingDebuggers: jest.fn().mockResolvedValue([]) }))
jest.mock("../services/sapSystemValidator", () => ({
  SapSystemValidator: {
    getInstance: jest.fn().mockReturnValue({ validateSystemAccess: jest.fn().mockResolvedValue(undefined) })
  }
}))
jest.mock("../fs/LocalFsProvider", () => ({
  LocalFsProvider: { useLocalStorage: jest.fn().mockReturnValue(false) }
}))
jest.mock("../lib", () => ({ log: jest.fn() }))
jest.mock("abapfs", () => ({}))

import { ADTSCHEME, ADTURIPATTERN, abapUri, getClient, getRoot, rootIsConnected } from "./conections"

describe("ADTSCHEME", () => {
  it("is 'adt'", () => {
    expect(ADTSCHEME).toBe("adt")
  })
})

describe("ADTURIPATTERN", () => {
  it("matches ADT URI paths", () => {
    expect(ADTURIPATTERN.test("/sap/bc/adt/programs/programs/zprog")).toBe(true)
    expect(ADTURIPATTERN.test("/sap/bc/adt/classes/classes/zcl_test/source/main")).toBe(true)
  })

  it("does not match non-ADT paths", () => {
    expect(ADTURIPATTERN.test("/some/other/path")).toBe(false)
    expect(ADTURIPATTERN.test("/sap/bc/gui")).toBe(false)
  })
})

describe("abapUri", () => {
  it("returns true for adt:// URIs", () => {
    const uri = { scheme: "adt" } as any
    expect(abapUri(uri)).toBe(true)
  })

  it("returns false for file:// URIs", () => {
    const uri = { scheme: "file" } as any
    expect(abapUri(uri)).toBe(false)
  })

  it("returns false/undefined for undefined", () => {
    expect(abapUri(undefined)).toBeFalsy()
  })

  it("returns false for untitled scheme", () => {
    const uri = { scheme: "untitled" } as any
    expect(abapUri(uri)).toBeFalsy()
  })
})

describe("getClient", () => {
  it("throws when connection not established", () => {
    expect(() => getClient("nonexistent_conn")).toThrow()
  })

  it("throws with helpful message about inaccessible system", () => {
    expect(() => getClient("nonexistent_conn")).toThrow(/not accessible|not found/i)
  })
})

describe("getRoot", () => {
  it("throws FileNotFound when root not established", () => {
    expect(() => getRoot("nonexistent_conn")).toThrow(/FileNotFound/)
  })
})

describe("rootIsConnected", () => {
  it("returns false when workspaceFolders is undefined", () => {
    const { workspace } = require("vscode")
    workspace.workspaceFolders = undefined
    expect(rootIsConnected("myconn")).toBe(false)
  })

  it("returns false when no matching ADT folder", () => {
    const { workspace } = require("vscode")
    workspace.workspaceFolders = [
      { uri: { scheme: "file", authority: "myconn" } }
    ]
    expect(rootIsConnected("myconn")).toBe(false)
  })

  it("returns true when matching ADT folder exists", () => {
    const { workspace } = require("vscode")
    workspace.workspaceFolders = [
      { uri: { scheme: "adt", authority: "myconn" } }
    ]
    expect(rootIsConnected("myconn")).toBe(true)
  })

  it("is case-insensitive for connId", () => {
    const { workspace } = require("vscode")
    workspace.workspaceFolders = [
      { uri: { scheme: "adt", authority: "myconn" } }
    ]
    expect(rootIsConnected("MYCONN")).toBe(true)
  })
})

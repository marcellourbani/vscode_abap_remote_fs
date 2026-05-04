/**
 * Tests for views/query/query.ts
 * Tests showQuery function.
 */

jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({
      toString: () => s,
      authority: s.replace(/.*?:\/\//, "").split("/")[0] ?? "",
      scheme: s.split(":")[0],
    })),
  },
}), { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {},
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  ADTSCHEME: "adt",
  abapUri: jest.fn(),
  getClient: jest.fn(),
}), { virtual: true })

jest.mock("../../adt/operations/AdtObjectFinder", () => ({
  findAbapObject: jest.fn(),
}), { virtual: true })

jest.mock("../../extension", () => ({
  context: { extensionUri: { fsPath: "/ext" } },
}), { virtual: true })

jest.mock("./queryPanel", () => ({
  QueryPanel: {
    createOrShow: jest.fn(),
  },
}), { virtual: true })

jest.mock("../../lib", () => ({
  viewableObjecttypes: new Set(["TABL", "VIEW", "DDLS"]),
}), { virtual: true })

jest.mock("../../commands/commands", () => ({
  currentUri: jest.fn(),
}), { virtual: true })

import { showQuery } from "./query"
import { abapUri, getClient } from "../../adt/conections"
import { findAbapObject } from "../../adt/operations/AdtObjectFinder"
import { QueryPanel } from "./queryPanel"
import { currentUri } from "../../commands/commands"

const mockedAbapUri = abapUri as jest.Mock
const mockedGetClient = getClient as jest.Mock
const mockedFindAbapObject = findAbapObject as jest.Mock
const mockedCurrentUri = currentUri as jest.Mock

describe("showQuery", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns early if no current URI", async () => {
    mockedCurrentUri.mockReturnValue(undefined)
    await showQuery()
    expect(QueryPanel.createOrShow).not.toHaveBeenCalled()
  })

  it("returns early if URI is not an ABAP URI", async () => {
    const mockUri = { scheme: "file", toString: () => "file:///foo.ts", authority: "" }
    mockedCurrentUri.mockReturnValue(mockUri)
    mockedAbapUri.mockReturnValue(false)
    await showQuery()
    expect(QueryPanel.createOrShow).not.toHaveBeenCalled()
  })

  it("creates panel with provided table name", async () => {
    const mockUri = { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" }
    mockedCurrentUri.mockReturnValue(mockUri)
    mockedAbapUri.mockReturnValue(true)
    const mockClient = {} as any
    mockedGetClient.mockReturnValue(mockClient)

    await showQuery("MARA")
    expect(QueryPanel.createOrShow).toHaveBeenCalledWith(
      expect.anything(),
      mockClient,
      "MARA"
    )
    expect(mockedFindAbapObject).not.toHaveBeenCalled()
  })

  it("uses object name as table when object type is viewable", async () => {
    const mockUri = { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" }
    mockedCurrentUri.mockReturnValue(mockUri)
    mockedAbapUri.mockReturnValue(true)
    const mockClient = {} as any
    mockedGetClient.mockReturnValue(mockClient)
    mockedFindAbapObject.mockResolvedValue({ type: "TABL", name: "MARA" })

    await showQuery() // no table provided
    expect(mockedFindAbapObject).toHaveBeenCalled()
    expect(QueryPanel.createOrShow).toHaveBeenCalledWith(
      expect.anything(),
      mockClient,
      "MARA"
    )
  })

  it("uses empty table name when object type is not viewable", async () => {
    const mockUri = { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" }
    mockedCurrentUri.mockReturnValue(mockUri)
    mockedAbapUri.mockReturnValue(true)
    const mockClient = {} as any
    mockedGetClient.mockReturnValue(mockClient)
    mockedFindAbapObject.mockResolvedValue({ type: "PROG/P", name: "ZTEST" })

    await showQuery()
    expect(QueryPanel.createOrShow).toHaveBeenCalledWith(
      expect.anything(),
      mockClient,
      "" // not a viewable type
    )
  })
})

jest.mock("vscode", () => ({
  ProgressLocation: { Notification: 15 },
  workspace: {
    openTextDocument: jest.fn()
  }
}), { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    withProgress: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showTextDocument: jest.fn()
  }
}))

jest.mock("../adt/conections", () => ({
  getOrCreateClient: jest.fn()
}))

jest.mock("../config", () => ({
  pickAdtRoot: jest.fn()
}))

import { listAdtFeedsCommand } from "./listAdtFeeds"
import { funWindow as window } from "../services/funMessenger"
import { getOrCreateClient } from "../adt/conections"
import { pickAdtRoot } from "../config"
import * as vscode from "vscode"

const mockWindow = window as jest.Mocked<typeof window>
const mockPickAdtRoot = pickAdtRoot as jest.MockedFunction<typeof pickAdtRoot>
const mockGetOrCreateClient = getOrCreateClient as jest.MockedFunction<typeof getOrCreateClient>

beforeEach(() => {
  jest.clearAllMocks()
  ;(mockWindow.withProgress as jest.Mock).mockImplementation((_opts: any, fn: Function) => fn({ report: jest.fn() }))
  ;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({ getText: () => "" })
  ;(mockWindow.showTextDocument as jest.Mock).mockResolvedValue(undefined)
})

describe("listAdtFeedsCommand", () => {
  test("returns early when user cancels connection pick", async () => {
    mockPickAdtRoot.mockResolvedValue(undefined)

    await listAdtFeedsCommand()

    expect(mockWindow.withProgress).not.toHaveBeenCalled()
  })

  test("shows info message when no feeds found", async () => {
    mockPickAdtRoot.mockResolvedValue({ uri: { authority: "dev100" } } as any)
    const mockClient = { feeds: jest.fn().mockResolvedValue([]) }
    mockGetOrCreateClient.mockResolvedValue(mockClient as any)

    await listAdtFeedsCommand()

    expect(mockWindow.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("No ADT feeds found")
    )
  })

  test("shows text document with feed list when feeds found", async () => {
    mockPickAdtRoot.mockResolvedValue({ uri: { authority: "dev100" } } as any)
    const mockFeeds = [
      {
        title: "Runtime Dumps",
        href: "/sap/bc/adt/runtime/dumps/feeds",
        summary: "SAP runtime dumps",
        author: "SAP",
        updated: new Date("2024-01-01"),
        refresh: { value: 5, unit: "minutes" },
        paging: 50,
        queryIsObligatory: false,
        queryVariants: [],
        attributes: []
      }
    ]
    const mockClient = { feeds: jest.fn().mockResolvedValue(mockFeeds) }
    mockGetOrCreateClient.mockResolvedValue(mockClient as any)

    await listAdtFeedsCommand()

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ language: "markdown" })
    )
    expect(mockWindow.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("1 ADT feed"),
      "OK"
    )
  })

  test("includes feed details in document content", async () => {
    mockPickAdtRoot.mockResolvedValue({ uri: { authority: "dev100" } } as any)
    const mockFeeds = [
      {
        title: "Runtime Dumps",
        href: "/sap/bc/adt/runtime/dumps/feeds",
        summary: "Dump summary",
        author: "SAP",
        updated: new Date("2024-01-01"),
        refresh: { value: 10, unit: "seconds" },
        paging: 100,
        queryIsObligatory: true,
        queryVariants: [
          { title: "Last week", queryString: "q=lastweek", isDefault: true },
          { title: "Today", queryString: "q=today", isDefault: false }
        ],
        attributes: [{ label: "user" }, { label: "type" }]
      }
    ]
    const mockClient = { feeds: jest.fn().mockResolvedValue(mockFeeds) }
    mockGetOrCreateClient.mockResolvedValue(mockClient as any)

    let capturedContent = ""
    ;(vscode.workspace.openTextDocument as jest.Mock).mockImplementation((opts: any) => {
      capturedContent = opts.content
      return Promise.resolve({ getText: () => capturedContent })
    })

    await listAdtFeedsCommand()

    expect(capturedContent).toContain("Runtime Dumps")
    expect(capturedContent).toContain("10")
    expect(capturedContent).toContain("seconds")
    expect(capturedContent).toContain("100 entries")
    expect(capturedContent).toContain("Query Required")
    expect(capturedContent).toContain("Last week")
    expect(capturedContent).toContain("user")
    expect(capturedContent).toContain("type")
  })

  test("shows error message on exception", async () => {
    mockPickAdtRoot.mockResolvedValue({ uri: { authority: "dev100" } } as any)
    mockGetOrCreateClient.mockRejectedValue(new Error("Connection failed"))

    await listAdtFeedsCommand()

    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Failed to list ADT feeds")
    )
  })

  test("handles null feeds response", async () => {
    mockPickAdtRoot.mockResolvedValue({ uri: { authority: "dev100" } } as any)
    const mockClient = { feeds: jest.fn().mockResolvedValue(null) }
    mockGetOrCreateClient.mockResolvedValue(mockClient as any)

    await listAdtFeedsCommand()

    expect(mockWindow.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("No ADT feeds found")
    )
  })

  test("uses connection ID from selected root", async () => {
    mockPickAdtRoot.mockResolvedValue({ uri: { authority: "qas200" } } as any)
    const mockClient = { feeds: jest.fn().mockResolvedValue([]) }
    mockGetOrCreateClient.mockResolvedValue(mockClient as any)

    await listAdtFeedsCommand()

    expect(mockGetOrCreateClient).toHaveBeenCalledWith("qas200")
  })
})

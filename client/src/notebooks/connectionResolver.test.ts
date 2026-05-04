jest.mock("../config", () => ({ connectedRoots: jest.fn() }), { virtual: false })
jest.mock("../adt/conections", () => ({ getClient: jest.fn() }), { virtual: false })
jest.mock("../services/funMessenger", () => ({
  funWindow: {
    showWarningMessage: jest.fn(),
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showErrorMessage: jest.fn(),
    createOutputChannel: jest.fn(() => ({
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), trace: jest.fn(),
    })),
  },
}), { virtual: false })
jest.mock("vscode", () => ({}), { virtual: true })

import { resolveConnection, NotebookConnectionError } from "./connectionResolver"
import { connectedRoots } from "../config"
import { getClient } from "../adt/conections"
import { funWindow as window } from "../services/funMessenger"

const mockConnectedRoots = connectedRoots as jest.Mock
const mockGetClient = getClient as jest.Mock
const mockShowWarningMessage = (window as any).showWarningMessage as jest.Mock
const mockShowQuickPick = (window as any).showQuickPick as jest.Mock

describe("NotebookConnectionError", () => {
  test("is an Error subclass", () => {
    const err = new NotebookConnectionError("test")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(NotebookConnectionError)
  })

  test("has name 'NotebookConnectionError'", () => {
    const err = new NotebookConnectionError("oops")
    expect(err.name).toBe("NotebookConnectionError")
  })

  test("stores message correctly", () => {
    const err = new NotebookConnectionError("no system")
    expect(err.message).toBe("no system")
  })
})

describe("resolveConnection — no systems", () => {
  beforeEach(() => jest.clearAllMocks())

  test("throws NotebookConnectionError when no systems are connected", async () => {
    mockConnectedRoots.mockReturnValue(new Map())
    await expect(resolveConnection()).rejects.toThrow(NotebookConnectionError)
    await expect(resolveConnection()).rejects.toThrow("No SAP systems connected")
  })
})

describe("resolveConnection — single system", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const map = new Map([["dev100", {}]])
    mockConnectedRoots.mockReturnValue(map)
  })

  test("shows confirmation dialog when only one system connected", async () => {
    mockShowWarningMessage.mockResolvedValue("Yes, run")
    mockGetClient.mockReturnValue({ /* mock client */ })
    await resolveConnection()
    expect(mockShowWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("dev100"),
      { modal: true },
      "Yes, run"
    )
  })

  test("returns resolved connection when user confirms", async () => {
    const fakeClient = { runQuery: jest.fn() }
    mockShowWarningMessage.mockResolvedValue("Yes, run")
    mockGetClient.mockReturnValue(fakeClient)
    const result = await resolveConnection()
    expect(result.connectionId).toBe("dev100")
    expect(result.client).toBe(fakeClient)
  })

  test("throws NotebookConnectionError when user cancels single-system prompt", async () => {
    mockShowWarningMessage.mockResolvedValue(undefined)
    await expect(resolveConnection()).rejects.toThrow(NotebookConnectionError)
    await expect(resolveConnection()).rejects.toThrow("cancelled")
  })

  test("throws NotebookConnectionError when getClient throws", async () => {
    mockShowWarningMessage.mockResolvedValue("Yes, run")
    mockGetClient.mockImplementation(() => { throw new Error("client creation failed") })
    await expect(resolveConnection()).rejects.toThrow(NotebookConnectionError)
    await expect(resolveConnection()).rejects.toThrow("connection failed")
  })
})

describe("resolveConnection — multiple systems", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const map = new Map([["dev100", {}], ["qas200", {}]])
    mockConnectedRoots.mockReturnValue(map)
  })

  test("shows QuickPick with all connected system IDs", async () => {
    mockShowQuickPick.mockResolvedValue(undefined)
    await expect(resolveConnection()).rejects.toThrow(NotebookConnectionError)
    expect(mockShowQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: "dev100" }),
        expect.objectContaining({ label: "qas200" }),
      ]),
      expect.objectContaining({ placeHolder: expect.any(String) })
    )
  })

  test("throws NotebookConnectionError when nothing selected from QuickPick", async () => {
    mockShowQuickPick.mockResolvedValue(undefined)
    await expect(resolveConnection()).rejects.toThrow(NotebookConnectionError)
    await expect(resolveConnection()).rejects.toThrow("No system selected")
  })

  test("shows confirmation dialog after QuickPick selection", async () => {
    mockShowQuickPick.mockResolvedValue({ label: "qas200" })
    mockShowWarningMessage.mockResolvedValue(undefined)
    await expect(resolveConnection()).rejects.toThrow(NotebookConnectionError)
    expect(mockShowWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("qas200"),
      { modal: true },
      "Yes, run"
    )
  })

  test("throws when user declines confirmation for multi-system", async () => {
    mockShowQuickPick.mockResolvedValue({ label: "dev100" })
    mockShowWarningMessage.mockResolvedValue("No")
    await expect(resolveConnection()).rejects.toThrow(NotebookConnectionError)
  })

  test("returns resolved connection for selected system", async () => {
    const fakeClient = { runQuery: jest.fn() }
    mockShowQuickPick.mockResolvedValue({ label: "qas200" })
    mockShowWarningMessage.mockResolvedValue("Yes, run")
    mockGetClient.mockReturnValue(fakeClient)
    const result = await resolveConnection()
    expect(result.connectionId).toBe("qas200")
    expect(result.client).toBe(fakeClient)
  })

  test("throws NotebookConnectionError when getClient throws for selected system", async () => {
    mockShowQuickPick.mockResolvedValue({ label: "dev100" })
    mockShowWarningMessage.mockResolvedValue("Yes, run")
    mockGetClient.mockImplementation(() => { throw new Error("net error") })
    await expect(resolveConnection()).rejects.toThrow(NotebookConnectionError)
  })
})

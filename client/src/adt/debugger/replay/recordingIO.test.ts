jest.mock("vscode", () => ({
  Uri: {
    file: jest.fn((p: string) => ({ scheme: "file", fsPath: p, toString: () => `file://${p}` })),
    parse: jest.fn((s: string) => ({ scheme: "file", toString: () => s }))
  },
  workspace: {
    fs: {
      readFile: jest.fn(),
      writeFile: jest.fn()
    }
  }
}), { virtual: true })
jest.mock("../../../lib", () => ({
  log: jest.fn(),
  caughtToString: jest.fn((e: any) => String(e))
}))
jest.mock("../../../services/funMessenger", () => ({
  funWindow: {
    showSaveDialog: jest.fn(),
    showOpenDialog: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn()
  }
}))
jest.mock("os", () => ({
  homedir: jest.fn(() => "/home/user")
}))
jest.mock("path", () => ({
  join: jest.fn((...parts: string[]) => parts.join("/"))
}))

import { saveRecording, loadRecording, loadRecordingFromUri } from "./recordingIO"
import { workspace, Uri } from "vscode"
import { funWindow as window } from "../../../services/funMessenger"
import type { DebugRecording } from "./types"

const mockWriteFile = workspace.fs.writeFile as jest.MockedFunction<typeof workspace.fs.writeFile>
const mockReadFile = workspace.fs.readFile as jest.MockedFunction<typeof workspace.fs.readFile>
const mockShowSaveDialog = window.showSaveDialog as jest.MockedFunction<typeof window.showSaveDialog>
const mockShowOpenDialog = window.showOpenDialog as jest.MockedFunction<typeof window.showOpenDialog>
const mockShowErrorMessage = window.showErrorMessage as jest.MockedFunction<typeof window.showErrorMessage>

function makeRecording(overrides: Partial<DebugRecording> = {}): DebugRecording {
  return {
    version: 1,
    recordedAt: "2026-01-01T00:00:00.000Z",
    connectionId: "TST",
    totalSteps: 2,
    duration: 1000,
    snapshots: [
      {
        stepNumber: 0,
        timestamp: 1000,
        threadId: 1,
        stack: [{ name: "ZPROG", sourcePath: "adt://TST/p", adtUri: "/p", line: 1, stackPosition: 0 }],
        scopes: [{ name: "LOCAL", variables: [] }],
        changedVars: []
      },
      {
        stepNumber: 1,
        timestamp: 2000,
        threadId: 1,
        stack: [{ name: "ZPROG", sourcePath: "adt://TST/p", adtUri: "/p", line: 2, stackPosition: 0 }],
        scopes: [{ name: "LOCAL", variables: [] }],
        changedVars: []
      }
    ],
    ...overrides
  }
}

describe("saveRecording", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test("returns undefined when user cancels dialog", async () => {
    mockShowSaveDialog.mockResolvedValueOnce(undefined)
    const result = await saveRecording(makeRecording())
    expect(result).toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  test("writes JSON to chosen uri", async () => {
    const savedUri = { fsPath: "/home/user/TST-2026-01-01.abaprecord", toString: () => "file:///home/user/TST.abaprecord" } as any
    mockShowSaveDialog.mockResolvedValueOnce(savedUri)
    mockWriteFile.mockResolvedValueOnce(undefined)
    const recording = makeRecording()
    const result = await saveRecording(recording)
    expect(result).toBe(savedUri)
    expect(mockWriteFile).toHaveBeenCalledWith(
      savedUri,
      expect.any(Buffer)
    )
    // Verify the content is valid JSON of the recording
    const [, buf] = mockWriteFile.mock.calls[0]
    const parsed = JSON.parse((buf as Buffer).toString())
    expect(parsed.version).toBe(1)
    expect(parsed.totalSteps).toBe(2)
  })

  test("shows error and returns undefined on write failure", async () => {
    const savedUri = { fsPath: "/fail.abaprecord" } as any
    mockShowSaveDialog.mockResolvedValueOnce(savedUri)
    mockWriteFile.mockRejectedValueOnce(new Error("disk full"))
    const result = await saveRecording(makeRecording())
    expect(result).toBeUndefined()
    expect(mockShowErrorMessage).toHaveBeenCalled()
  })

  test("includes default filename based on connectionId", async () => {
    mockShowSaveDialog.mockResolvedValueOnce(undefined)
    await saveRecording(makeRecording({ connectionId: "DEV100" }))
    const callArgs = mockShowSaveDialog.mock.calls[0]?.[0] as any
    const uriStr = callArgs?.defaultUri?.fsPath ?? callArgs?.defaultUri?.toString() ?? ""
    expect(uriStr).toContain("DEV100")
  })

  test("uses objectName in default filename when available", async () => {
    mockShowSaveDialog.mockResolvedValueOnce(undefined)
    await saveRecording(makeRecording({ objectName: "ZMYPROGRAM" }))
    const callArgs = mockShowSaveDialog.mock.calls[0]?.[0] as any
    const uriStr = callArgs?.defaultUri?.fsPath ?? callArgs?.defaultUri?.toString() ?? ""
    expect(uriStr).toContain("ZMYPROGRAM")
  })
})

describe("loadRecording", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test("returns undefined when user cancels dialog", async () => {
    mockShowOpenDialog.mockResolvedValueOnce(undefined)
    const result = await loadRecording()
    expect(result).toBeUndefined()
  })

  test("returns undefined for empty selection", async () => {
    mockShowOpenDialog.mockResolvedValueOnce([])
    const result = await loadRecording()
    expect(result).toBeUndefined()
  })

  test("loads and parses a valid recording", async () => {
    const recording = makeRecording()
    const json = JSON.stringify(recording)
    const fileUri = { fsPath: "/home/user/test.abaprecord" } as any
    mockShowOpenDialog.mockResolvedValueOnce([fileUri])
    mockReadFile.mockResolvedValueOnce(Buffer.from(json, "utf-8") as any)
    const result = await loadRecording()
    expect(result).toBeDefined()
    expect(result!.version).toBe(1)
    expect(result!.totalSteps).toBe(2)
  })

  test("shows error and returns undefined for invalid JSON", async () => {
    const fileUri = { fsPath: "/broken.abaprecord" } as any
    mockShowOpenDialog.mockResolvedValueOnce([fileUri])
    mockReadFile.mockResolvedValueOnce(Buffer.from("not json", "utf-8") as any)
    const result = await loadRecording()
    expect(result).toBeUndefined()
    expect(mockShowErrorMessage).toHaveBeenCalled()
  })
})

describe("loadRecordingFromUri", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test("parses valid recording file", async () => {
    const recording = makeRecording()
    mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(recording)) as any)
    const uri = { fsPath: "/test.abaprecord" } as any
    const result = await loadRecordingFromUri(uri)
    expect(result).toBeDefined()
    expect(result!.connectionId).toBe("TST")
  })

  test("returns undefined for invalid recording structure (wrong version)", async () => {
    const invalid = { version: 2, totalSteps: 1, snapshots: [{}] }
    mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(invalid)) as any)
    const uri = { fsPath: "/bad.abaprecord" } as any
    const result = await loadRecordingFromUri(uri)
    expect(result).toBeUndefined()
    expect(mockShowErrorMessage).toHaveBeenCalledWith("Invalid recording file format")
  })

  test("returns undefined when snapshots array is empty", async () => {
    const invalid = { version: 1, totalSteps: 0, snapshots: [] }
    mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(invalid)) as any)
    const uri = { fsPath: "/empty.abaprecord" } as any
    const result = await loadRecordingFromUri(uri)
    expect(result).toBeUndefined()
  })

  test("returns undefined when snapshots lack required fields", async () => {
    const invalid = {
      version: 1,
      totalSteps: 1,
      snapshots: [{ noStack: true }]
    }
    mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(invalid)) as any)
    const uri = { fsPath: "/invalid-snap.abaprecord" } as any
    const result = await loadRecordingFromUri(uri)
    expect(result).toBeUndefined()
  })

  test("returns undefined when sources is not an object", async () => {
    const recording = { ...makeRecording(), sources: [1, 2, 3] }
    mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(recording)) as any)
    const uri = { fsPath: "/invalid.abaprecord" } as any
    const result = await loadRecordingFromUri(uri)
    expect(result).toBeUndefined()
  })

  test("accepts recording with valid sources object", async () => {
    const recording = { ...makeRecording(), sources: { "adt://TST/p": "REPORT Z." } }
    mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(recording)) as any)
    const uri = { fsPath: "/valid-with-sources.abaprecord" } as any
    const result = await loadRecordingFromUri(uri)
    expect(result).toBeDefined()
    expect(result!.sources).toEqual({ "adt://TST/p": "REPORT Z." })
  })

  test("accepts recording without sources field", async () => {
    const { sources, ...recordingNoSources } = { ...makeRecording(), sources: undefined }
    mockReadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(recordingNoSources)) as any)
    const uri = { fsPath: "/no-sources.abaprecord" } as any
    const result = await loadRecordingFromUri(uri)
    expect(result).toBeDefined()
  })

  test("shows error on read failure", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("file not found"))
    const uri = { fsPath: "/missing.abaprecord" } as any
    const result = await loadRecordingFromUri(uri)
    expect(result).toBeUndefined()
    expect(mockShowErrorMessage).toHaveBeenCalled()
  })
})

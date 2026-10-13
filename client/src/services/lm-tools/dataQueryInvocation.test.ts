import { ExecuteDataQueryTool, type IExecuteDataQueryParameters } from "./dataQueryTool"
import { createMcpAuthorizedOptions } from "./toolGuard"
import * as vscode from "vscode"

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  runQuery: vi.fn(),
  createOrUpdateWebview: vi.fn(),
  writeFile: vi.fn(),
  getSAPSystemInfo: vi.fn()
}))

vi.mock("vscode", () => ({
  LanguageModelToolResult: class {
    constructor(public content: unknown[]) {}
  },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  workspace: { fs: { writeFile: mocks.writeFile } }
}))
vi.mock("./toolRegistry", () => ({ registerToolWithRegistry: vi.fn() }))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("../../adt/conections", () => ({ getClient: mocks.getClient }))
vi.mock("../sapSystemInfo", () => ({ getSAPSystemInfo: mocks.getSAPSystemInfo }))
vi.mock("../funMessenger", () => ({ funWindow: {} }))
vi.mock("../productionSqlControl", () => ({
  getProductionSqlPreference: () => "allow",
  configureProductionSqlControlForConnection: vi.fn()
}))
vi.mock("../structuredDataExportService", () => ({ buildCsv: vi.fn(), buildXlsx: vi.fn() }))
vi.mock("../webviewManager", () => ({
  WebviewManager: {
    getInstance: () => ({ createOrUpdateWebview: mocks.createOrUpdateWebview })
  }
}))

const validInput: IExecuteDataQueryParameters = {
  sql: "SELECT * FROM zexample",
  connectionId: "example",
  displayMode: "internal",
  rowRange: { start: 0, end: 10 }
}
const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getClient.mockReturnValue({ runQuery: mocks.runQuery })
  mocks.runQuery.mockResolvedValue({ columns: [{ name: "VALUE" }], values: [{ VALUE: "ok" }] })
})

it.each([
  { input: { rowRange: undefined }, error: /MANDATORY/ },
  { input: { rowRange: { start: 0, end: 1500 } }, error: /1000 rows/ },
  { input: { rowRange: { start: -1, end: 10 } }, error: /rowRange/ },
  { input: { rowRange: { start: 0, end: 0 } }, error: /rowRange/ },
  { input: { rowRange: { start: NaN, end: 10 } }, error: /rowRange/ },
  { input: { rowRange: { start: 0, end: Infinity } }, error: /rowRange/ },
  { input: { rowRange: { start: 0.5, end: 10 } }, error: /rowRange/ },
  { input: { maxRows: 50001 }, error: /maxRows/ },
  { input: { maxRows: 0 }, error: /maxRows/ },
  { input: { maxRows: NaN }, error: /maxRows/ },
  { input: { maxRows: Infinity }, error: /maxRows/ },
  { input: { maxRows: 1.5 }, error: /maxRows/ },
  { input: { sql: "UPDATE zexample SET value = 'bad'" }, error: /dangerous/ },
  { input: { sql: "SELECT * FROM zexample; DELETE FROM zexample" }, error: /dangerous/ },
  { input: { sql: "EXECUTE example" }, error: /Only SELECT/ },
  { input: { sql: undefined }, error: /requires SQL/ },
  { input: { webviewId: "example" }, error: /LOGICAL CONFLICT/ },
  {
    input: { data: { columns: [{ name: "VALUE", type: "C" }], values: [] } },
    error: /LOGICAL CONFLICT/
  },
  { input: { displayMode: "download_to_file" as const }, error: /filePath/ }
])("rejects invalid MCP invocation before any side effects: $input", async ({ input, error }) => {
  const tool = new ExecuteDataQueryTool()
  const request = { ...validInput, ...input }
  await expect(tool.prepareInvocation({ input: request }, token)).rejects.toThrow(error)
  const options = createMcpAuthorizedOptions(request)
  await expect(
    tool.invoke(
      options as vscode.LanguageModelToolInvocationOptions<IExecuteDataQueryParameters>,
      token
    )
  ).rejects.toThrow(error)
  expect(mocks.getClient).not.toHaveBeenCalled()
  expect(mocks.runQuery).not.toHaveBeenCalled()
  expect(mocks.getSAPSystemInfo).not.toHaveBeenCalled()
  expect(mocks.createOrUpdateWebview).not.toHaveBeenCalled()
  expect(mocks.writeFile).not.toHaveBeenCalled()
})

it("accepts valid direct MCP invocation without preparation", async () => {
  const result = await new ExecuteDataQueryTool().invoke(
    createMcpAuthorizedOptions(
      validInput
    ) as vscode.LanguageModelToolInvocationOptions<IExecuteDataQueryParameters>,
    token
  )
  expect(mocks.runQuery).toHaveBeenCalledWith(validInput.sql, 11, true)
  const part = result.content[1] as vscode.LanguageModelTextPart
  expect(JSON.parse(part.value).data.values).toEqual([{ VALUE: "ok" }])
})

it("allows an internal range of exactly 1000 rows", async () => {
  await new ExecuteDataQueryTool().invoke(
    createMcpAuthorizedOptions({
      ...validInput,
      rowRange: { start: 0, end: 1000 }
    }) as vscode.LanguageModelToolInvocationOptions<IExecuteDataQueryParameters>,
    token
  )
  expect(mocks.runQuery).toHaveBeenCalledWith(validInput.sql, 1001, true)
})

vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  }
}))

vi.mock("../../adt/conections", () => ({}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("../MermaidWebviewManager", () => ({
  MermaidWebviewManager: {
    getInstance: vi.fn()
  }
}))
vi.mock("../MermaidDocumentation", () => ({
  MERMAID_DOCUMENTATION: {
    flowchart: {
      description: "Flowchart description",
      syntax: "graph TD",
      keywords: ["graph", "flowchart"],
      examples: ["graph TD\nA-->B"]
    },
    sequence: {
      description: "Sequence description",
      syntax: "sequenceDiagram",
      keywords: ["sequenceDiagram"],
      examples: []
    }
  }
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import {
  CreateMermaidDiagramTool,
  ValidateMermaidSyntaxTool,
  GetMermaidDocumentationTool,
  DetectMermaidDiagramTypeTool
} from "./mermaidTools"
import { MermaidWebviewManager } from "../MermaidWebviewManager"
import { logTelemetry } from "../telemetry"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockWebviewManager = {
  renderDiagram: vi.fn(),
  validateSyntax: vi.fn(),
  detectDiagramType: vi.fn()
}

describe("CreateMermaidDiagramTool", () => {
  let tool: CreateMermaidDiagramTool

  beforeEach(() => {
    tool = new CreateMermaidDiagramTool()
    vi.clearAllMocks()
    ;(MermaidWebviewManager.getInstance as Mock).mockReturnValue(mockWebviewManager)
  })

  describe("prepareInvocation", () => {
    it("returns invocation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ code: "graph TD\nA-->B", theme: "dark" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("diagram")
    })

    it("shows default theme in message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ code: "graph TD\nA-->B" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("forest")
    })

    it("shows provided theme in message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ code: "graph TD\nA-->B", theme: "dark" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("dark")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockWebviewManager.renderDiagram.mockResolvedValue({
        success: true,
        diagramType: "flowchart"
      })
      await tool.invoke(makeOptions({ code: "graph TD\nA-->B" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_create_mermaid_diagram_called")
    })

    it("uses 'forest' as default theme", async () => {
      mockWebviewManager.renderDiagram.mockResolvedValue({
        success: true,
        diagramType: "flowchart"
      })
      await tool.invoke(makeOptions({ code: "graph TD\nA-->B" }), mockToken)
      expect(mockWebviewManager.renderDiagram).toHaveBeenCalledWith("graph TD\nA-->B", "forest")
    })

    it("uses provided theme", async () => {
      mockWebviewManager.renderDiagram.mockResolvedValue({
        success: true,
        diagramType: "flowchart"
      })
      await tool.invoke(makeOptions({ code: "graph TD\nA-->B", theme: "dark" }), mockToken)
      expect(mockWebviewManager.renderDiagram).toHaveBeenCalledWith("graph TD\nA-->B", "dark")
    })

    it("returns success message with diagram type", async () => {
      mockWebviewManager.renderDiagram.mockResolvedValue({
        success: true,
        diagramType: "flowchart"
      })
      const result: any = await tool.invoke(makeOptions({ code: "graph TD\nA-->B" }), mockToken)
      expect(result.parts[0].text).toContain("flowchart")
      expect(result.parts[0].text).toContain("Successfully")
    })

    it("throws when render fails", async () => {
      mockWebviewManager.renderDiagram.mockResolvedValue({
        success: false,
        error: "Parse error on line 1"
      })
      await expect(tool.invoke(makeOptions({ code: "invalid code" }), mockToken)).rejects.toThrow(
        "Failed to create diagram"
      )
    })

    it("wraps Parse error as syntax error", async () => {
      mockWebviewManager.renderDiagram.mockRejectedValue(
        new Error("Parse error on line 1: unexpected token")
      )
      await expect(tool.invoke(makeOptions({ code: "bad code" }), mockToken)).rejects.toThrow(
        "Syntax error in diagram code"
      )
    })
  })
})

describe("ValidateMermaidSyntaxTool", () => {
  let tool: ValidateMermaidSyntaxTool

  beforeEach(() => {
    tool = new ValidateMermaidSyntaxTool()
    vi.clearAllMocks()
    ;(MermaidWebviewManager.getInstance as Mock).mockReturnValue(mockWebviewManager)
  })

  describe("prepareInvocation", () => {
    it("returns invocation message mentioning validate", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ code: "graph TD\nA-->B" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("alid")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockWebviewManager.validateSyntax.mockResolvedValue({ valid: true })
      await tool.invoke(makeOptions({ code: "graph TD\nA-->B" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_validate_mermaid_syntax_called")
    })

    it("returns valid message for correct syntax", async () => {
      mockWebviewManager.validateSyntax.mockResolvedValue({ valid: true })
      const result: any = await tool.invoke(makeOptions({ code: "graph TD\nA-->B" }), mockToken)
      expect(result.parts[0].text).toContain("valid")
    })

    it("returns invalid message with error details", async () => {
      mockWebviewManager.validateSyntax.mockResolvedValue({
        valid: false,
        error: "Unexpected token on line 2"
      })
      const result: any = await tool.invoke(makeOptions({ code: "bad code" }), mockToken)
      expect(result.parts[0].text).toContain("Unexpected token")
    })

    it("suppressErrors=true returns false instead of throwing", async () => {
      mockWebviewManager.validateSyntax.mockRejectedValue(new Error("parse error"))
      const result: any = await tool.invoke(
        makeOptions({ code: "bad code", suppressErrors: true }),
        mockToken
      )
      expect(result.parts[0].text).toBeDefined()
    })
  })
})

describe("GetMermaidDocumentationTool", () => {
  let tool: GetMermaidDocumentationTool

  beforeEach(() => {
    tool = new GetMermaidDocumentationTool()
    vi.clearAllMocks()
  })

  describe("prepareInvocation", () => {
    it("returns invocation message", async () => {
      const result = await tool.prepareInvocation(makeOptions({ diagramType: "all" }), mockToken)
      expect(result.invocationMessage).toContain("documentation")
    })

    it("mentions specific diagram type", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ diagramType: "flowchart" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("flowchart")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      await tool.invoke(makeOptions({ diagramType: "all" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_mermaid_documentation_called")
    })

    it("returns documentation content", async () => {
      const result: any = await tool.invoke(makeOptions({ diagramType: "all" }), mockToken)
      expect(result.parts[0].text).toBeDefined()
      expect(result.parts[0].text.length).toBeGreaterThan(0)
    })

    it("includes flowchart in all documentation", async () => {
      const result: any = await tool.invoke(makeOptions({ diagramType: "all" }), mockToken)
      expect(result.parts[0].text).toContain("flowchart")
    })

    it("returns specific diagram type documentation", async () => {
      const result: any = await tool.invoke(makeOptions({ diagramType: "flowchart" }), mockToken)
      expect(result.parts[0].text).toContain("flowchart")
    })
  })
})

describe("DetectMermaidDiagramTypeTool", () => {
  let tool: DetectMermaidDiagramTypeTool

  beforeEach(() => {
    tool = new DetectMermaidDiagramTypeTool()
    vi.clearAllMocks()
    ;(MermaidWebviewManager.getInstance as Mock).mockReturnValue(mockWebviewManager)
  })

  describe("prepareInvocation", () => {
    it("returns invocation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ code: "graph TD\nA-->B" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("etect")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockWebviewManager.detectDiagramType.mockResolvedValue({ diagramType: "flowchart" })
      await tool.invoke(makeOptions({ code: "graph TD\nA-->B" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_detect_mermaid_diagram_type_called")
    })

    it("returns detected diagram type", async () => {
      mockWebviewManager.detectDiagramType.mockResolvedValue({ diagramType: "flowchart" })
      const result: any = await tool.invoke(makeOptions({ code: "graph TD\nA-->B" }), mockToken)
      expect(result.parts[0].text).toContain("flowchart")
    })
  })
})

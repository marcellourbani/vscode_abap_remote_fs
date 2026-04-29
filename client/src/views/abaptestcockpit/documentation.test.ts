jest.mock(
  "vscode",
  () => ({
    commands: {
      executeCommand: jest.fn()
    },
    Uri: {
      parse: jest.fn((s: string) => ({ toString: () => s, scheme: "adt" }))
    },
    CancellationToken: {},
    WebviewView: {},
    WebviewViewResolveContext: {}
  }),
  { virtual: true }
)

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn()
}))

jest.mock("../../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: jest.fn().mockImplementation(() => ({
    displayAdtUri: jest.fn()
  }))
}))

jest.mock("../../commands", () => ({
  AbapFsCommands: { atcDocHistoryBack: "back", atcDocHistoryForward: "forward" },
  command: () => (_target: any, _key: string, descriptor: PropertyDescriptor) => descriptor
}))

jest.mock("../history", () => ({
  History: jest.fn().mockImplementation((initial?: any) => {
    let items: any[] = initial !== undefined ? [initial] : []
    let idx = 0
    return {
      get current() {
        return items[idx]
      },
      get hasPrevious() {
        return idx > 0
      },
      get hasNext() {
        return idx < items.length - 1
      },
      append: jest.fn((item: any) => {
        items = [...items.slice(0, idx + 1), item]
        idx++
      }),
      back: jest.fn(() => {
        if (idx > 0) idx--
      }),
      forward: jest.fn(() => {
        if (idx < items.length - 1) idx++
      })
    }
  })
}))

jest.mock("../utilities", () => ({
  injectUrlHandler: jest.fn((html: string) => `<injected>${html}</injected>`)
}))

jest.mock("../../context", () => ({
  setContext: jest.fn()
}))

import { ATCDocumentation, DocumentationItem } from "./documentation"
import { getClient } from "../../adt/conections"
import { injectUrlHandler } from "../utilities"
import { setContext } from "../../context"

const mockGetClient = getClient as jest.MockedFunction<typeof getClient>
const mockInjectUrlHandler = injectUrlHandler as jest.MockedFunction<typeof injectUrlHandler>
const mockSetContext = setContext as jest.MockedFunction<typeof setContext>

const makeWebviewPanel = () => ({
  webview: {
    options: {},
    html: "",
    onDidReceiveMessage: jest.fn()
  }
})

describe("ATCDocumentation.get()", () => {
  it("returns singleton instance", () => {
    const inst1 = ATCDocumentation.get()
    const inst2 = ATCDocumentation.get()
    expect(inst1).toBe(inst2)
  })

  it("returns an ATCDocumentation instance", () => {
    expect(ATCDocumentation.get()).toBeInstanceOf(ATCDocumentation)
  })
})

describe("ATCDocumentation.viewType", () => {
  it("has the correct view type", () => {
    expect(ATCDocumentation.viewType).toBe("abapfs.views.atcdocs")
  })
})

describe("ATCDocumentation.showDocumentation", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns without setting html when no view is resolved", async () => {
    // Get fresh instance (singleton was created above but view is not set)
    const inst = ATCDocumentation.get()
    const doc: DocumentationItem = { url: "/doc/url", connId: "myconn" }
    // Should not throw even without a view
    await expect(inst.showDocumentation(doc)).resolves.toBeUndefined()
  })

  it("fetches html and injects url handler when view is resolved", async () => {
    const panel = makeWebviewPanel()
    const mockClient = {
      atcDocumentation: jest.fn().mockResolvedValue({ body: "<html>doc</html>" })
    }
    mockGetClient.mockReturnValue(mockClient as any)
    mockInjectUrlHandler.mockReturnValue("<injected><html>doc</html></injected>")

    const inst = ATCDocumentation.get()
    // Resolve the webview
    await inst.resolveWebviewView(panel as any, {} as any, {} as any)

    const doc: DocumentationItem = { url: "/doc/url", connId: "myconn" }
    await inst.showDocumentation(doc)

    expect(mockGetClient).toHaveBeenCalledWith("myconn")
    expect(mockClient.atcDocumentation).toHaveBeenCalledWith("/doc/url")
    expect(mockInjectUrlHandler).toHaveBeenCalledWith("<html>doc</html>")
    expect(panel.webview.html).toBe("<injected><html>doc</html></injected>")
  })

  it("sets context for navigation flags", async () => {
    const panel = makeWebviewPanel()
    const mockClient = {
      atcDocumentation: jest.fn().mockResolvedValue({ body: "<html/>" })
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const inst = ATCDocumentation.get()
    await inst.resolveWebviewView(panel as any, {} as any, {} as any)
    await inst.showDocumentation({ url: "/u", connId: "c" })

    expect(mockSetContext).toHaveBeenCalledWith(
      "abapfs:atcdoc:navigation:next",
      expect.any(Boolean)
    )
    expect(mockSetContext).toHaveBeenCalledWith(
      "abapfs:atcdoc:navigation:back",
      expect.any(Boolean)
    )
  })
})

describe("ATCDocumentation.resolveWebviewView", () => {
  beforeEach(() => jest.clearAllMocks())

  it("sets webview options to enable scripts", async () => {
    const panel = makeWebviewPanel()
    const mockClient = {
      atcDocumentation: jest.fn().mockResolvedValue({ body: "" })
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const inst = ATCDocumentation.get()
    await inst.resolveWebviewView(panel as any, {} as any, {} as any)

    expect(panel.webview.options).toEqual({ enableScripts: true })
  })

  it("shows 'No document selected' when no documentation is set", async () => {
    // Create a fresh instance by resetting the singleton
    ;(ATCDocumentation as any).instance = undefined
    const panel = makeWebviewPanel()
    const inst = ATCDocumentation.get()

    await inst.resolveWebviewView(panel as any, {} as any, {} as any)

    expect(panel.webview.html).toBe("<body>No document selected</body>")
  })
})

describe("DocumentationItem interface", () => {
  it("can hold url and connId", () => {
    const item: DocumentationItem = { url: "https://example.com", connId: "myconn" }
    expect(item.url).toBe("https://example.com")
    expect(item.connId).toBe("myconn")
  })
})

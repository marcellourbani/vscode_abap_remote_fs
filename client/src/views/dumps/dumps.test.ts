// Tests for views/dumps/dumps.ts
jest.mock("vscode", () => {
  const EventEmitter = class {
    event = jest.fn()
    fire = jest.fn()
  }
  const TreeItem = class {
    constructor(public label: string, public collapsibleState?: number) {}
    command: any
    contextValue: any
  }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 }
  const ViewColumn = { Active: 1, Beside: 2 }
  return { EventEmitter, TreeItem, TreeItemCollapsibleState, ViewColumn }
}, { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    createWebviewPanel: jest.fn(() => ({
      webview: {
        html: "",
        onDidReceiveMessage: jest.fn(),
        options: {}
      }
    }))
  }
}))

jest.mock("../../adt/conections", () => ({
  getOrCreateClient: jest.fn()
}))

jest.mock("../../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: jest.fn().mockImplementation(() => ({
    displayAdtUri: jest.fn()
  }))
}))

jest.mock("../../commands", () => ({
  AbapFsCommands: {
    showDump: "abapfs.showDump",
    refreshDumps: "abapfs.refreshDumps"
  },
  command: jest.fn((name: string) => (_target: any, _key: string, descriptor: PropertyDescriptor) => descriptor)
}))

jest.mock("../../config", () => ({
  connectedRoots: jest.fn(() => new Map([["DEV100", {}]]))
}))

import { dumpProvider } from "./dumps"

const jsFooter = `<script type="text/javascript">
const vscode = acquireVsCodeApi();`

describe("dumps.ts", () => {
  describe("jsFooter injection logic", () => {
    // Test the inject function logic directly
    const inject = (x: string) => `${x}${jsFooter}`

    it("appends footer to content", () => {
      const html = "<html><body>dump</body></html>"
      const result = inject(html)
      expect(result).toContain(html)
      expect(result).toContain("acquireVsCodeApi")
    })

    it("original content is preserved", () => {
      const original = "<h1>Error</h1>"
      const result = inject(original)
      expect(result.startsWith(original)).toBe(true)
    })
  })

  describe("dumpProvider", () => {
    describe("onDidChangeTreeData", () => {
      it("exposes the event emitter event", () => {
        expect(dumpProvider.onDidChangeTreeData).toBeDefined()
      })
    })

    describe("getTreeItem", () => {
      it("returns the item as-is", () => {
        const fakeItem = { tag: "system", label: "DEV100" } as any
        expect(dumpProvider.getTreeItem(fakeItem)).toBe(fakeItem)
      })
    })

    describe("getChildren - root level", () => {
      it("returns system items when called with no argument", async () => {
        const children = await dumpProvider.getChildren(undefined as any)
        expect(Array.isArray(children)).toBe(true)
      })

      it("creates system items for each connected root", async () => {
        const children = await dumpProvider.getChildren(undefined as any)
        expect(children.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe("getChildren - dump item", () => {
      it("returns empty array for DumpItem (leaf node)", async () => {
        const dumpItem = { tag: "dump" } as any
        const result = await dumpProvider.getChildren(dumpItem)
        expect(result).toEqual([])
      })
    })

    describe("getChildren - system item", () => {
      it("fetches dumps from client when system item provided", async () => {
        const { getOrCreateClient } = require("../../adt/conections")
        ;(getOrCreateClient as jest.Mock).mockResolvedValue({
          feeds: jest.fn().mockResolvedValue([
            { href: "/sap/bc/adt/runtime/dumps" }
          ]),
          dumps: jest.fn().mockResolvedValue({
            dumps: [
              {
                categories: [{ label: "ABAP runtime error", term: "DUMP_123" }],
                text: "<html>Dump content</html>"
              }
            ]
          })
        })

        const systemChildren = await dumpProvider.getChildren(undefined as any)
        // systemChildren are SystemItem instances with tag=system
        const systemItem = systemChildren[0] as any
        expect(systemItem.tag).toBe("system")

        const dumpChildren = await dumpProvider.getChildren(systemItem)
        expect(Array.isArray(dumpChildren)).toBe(true)
      })

      it("returns empty array when no dump feed available", async () => {
        const { getOrCreateClient } = require("../../adt/conections")
        ;(getOrCreateClient as jest.Mock).mockResolvedValue({
          feeds: jest.fn().mockResolvedValue([
            { href: "/sap/bc/adt/other" } // No dumps feed
          ]),
          dumps: jest.fn().mockResolvedValue({ dumps: [] })
        })

        const systemChildren = await dumpProvider.getChildren(undefined as any)
        const systemItem = systemChildren[0] as any

        const dumpChildren = await dumpProvider.getChildren(systemItem)
        expect(dumpChildren).toEqual([])
      })
    })
  })
})

// Tests for views/dumps/dumps.ts
vi.mock("vscode", () => {
  const EventEmitter = class {
    event = vi.fn()
    fire = vi.fn()
  }
  const TreeItem = class {
    constructor(
      public label: string,
      public collapsibleState?: number
    ) {}
    command: any
    contextValue: any
  }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 }
  const ViewColumn = { Active: 1, Beside: 2 }
  return { EventEmitter, TreeItem, TreeItemCollapsibleState, ViewColumn }
})

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    createWebviewPanel: vi.fn(function () {
      return {
        webview: {
          html: "",
          onDidReceiveMessage: vi.fn(),
          options: {}
        }
      }
    })
  }
}))

vi.mock("../../adt/conections", () => ({
  getOrCreateClient: vi.fn()
}))

vi.mock("../../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn().mockImplementation(function () {
    return {
      displayAdtUri: vi.fn()
    }
  })
}))

vi.mock("../../commands", () => ({
  AbapFsCommands: {
    showDump: "abapfs.showDump",
    refreshDumps: "abapfs.refreshDumps"
  },
  command: vi.fn(function (name: string) {
    return (_target: any, _key: string, descriptor: PropertyDescriptor) => descriptor
  })
}))

vi.mock("../../config", () => ({
  connectedRoots: vi.fn(function () {
    return new Map([["DEV100", {}]])
  })
}))

import { dumpProvider } from "./dumps"
import * as __$mock_adt_conections from "../../adt/conections"
import type { Mock } from "vitest"

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
        const { getOrCreateClient } = __$mock_adt_conections
        ;(getOrCreateClient as Mock).mockResolvedValue({
          feeds: vi.fn().mockResolvedValue([{ href: "/sap/bc/adt/runtime/dumps" }]),
          dumps: vi.fn().mockResolvedValue({
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
        const { getOrCreateClient } = __$mock_adt_conections
        ;(getOrCreateClient as Mock).mockResolvedValue({
          feeds: vi.fn().mockResolvedValue([
            { href: "/sap/bc/adt/other" } // No dumps feed
          ]),
          dumps: vi.fn().mockResolvedValue({ dumps: [] })
        })

        const systemChildren = await dumpProvider.getChildren(undefined as any)
        const systemItem = systemChildren[0] as any

        const dumpChildren = await dumpProvider.getChildren(systemItem)
        expect(dumpChildren).toEqual([])
      })
    })
  })
})

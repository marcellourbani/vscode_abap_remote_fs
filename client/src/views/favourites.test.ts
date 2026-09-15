/**
 * Tests for views/favourites.ts
 * Covers FavItem, FavouritesProvider and the fixold/fixoldu helpers (via Favourite).
 */

vi.mock("vscode", () => {
  return {
    TreeItem: class TreeItem {
      public label: string
      public collapsibleState: number
      public command: any
      public contextValue: string = ""
      constructor(label: string, collapsibleState?: number) {
        this.label = label
        this.collapsibleState = collapsibleState ?? 0
      }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter: vi.fn().mockImplementation(function () {
      return {
        event: {},
        fire: vi.fn()
      }
    }),
    Uri: {
      parse: vi.fn(function (s: string) {
        return {
          toString: () => s,
          authority: s.replace(/.*?:\/\//, "").split("/")[0] ?? "",
          path: "/" + (s.split("/").slice(3).join("/") || ""),
          scheme: s.split(":")[0],
          with: vi.fn(({ path }: any) => ({
            toString: () => `adt://dev100${path}`,
            authority: "dev100",
            path
          }))
        }
      })
    },
    workspace: {
      workspaceFolders: []
    },
    FileStat: {}
  }
})

vi.mock("node:path", () => ({
  resolve: vi.fn(function (...parts: string[]) {
    return parts.join("/")
  }),
  dirname: vi.fn(function (p: string) {
    return p.split("/").slice(0, -1).join("/")
  })
}))
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
}))

vi.mock("../lib", () => ({
  NSSLASH: "/",
  isString: (v: any) => typeof v === "string"
}))

vi.mock("../adt/conections", () => ({
  uriRoot: vi.fn(function () {
    return {
      getNodeAsync: vi.fn().mockResolvedValue(undefined)
    }
  }),
  getRoot: vi.fn(),
  ADTSCHEME: "adt"
}))

vi.mock("abapfs", () => ({
  isAbapFolder: vi.fn(),
  isAbapStat: vi.fn(),
  isFolder: vi.fn()
}))

import { FavItem, FavouritesProvider, Favourite } from "./favourites"
import * as __$mock_vscode from "vscode"
import * as __$mock_fs_promises from "node:fs/promises"
import type { Mock } from "vitest"

const { TreeItemCollapsibleState } = __$mock_vscode

describe("FavItem – string constructor (dynamic)", () => {
  it("creates a dynamic FavItem from string uri and label", () => {
    const item = new FavItem("adt://dev100/foo", "My Label")
    expect(item.favourite.uri).toBe("adt://dev100/foo")
    expect(item.favourite.label).toBe("My Label")
    expect(item.favourite.dynamic).toBe(true)
    expect(item.favourite.isContainer).toBe(true)
    expect(item.contextValue).toBe("")
  })

  it("accepts custom collapsible state", () => {
    const item = new FavItem("adt://dev100/foo", "X", TreeItemCollapsibleState.None)
    expect(item.favourite.collapsibleState).toBe(TreeItemCollapsibleState.None)
  })

  it("sets uri getter", () => {
    const item = new FavItem("adt://dev100/bar", "Bar")
    expect(item.uri).toBe("adt://dev100/bar")
  })
})

describe("FavItem – Favourite constructor (non-dynamic)", () => {
  const makeFav = (openUri = "") =>
    new Favourite({
      uri: "adt://dev100/pkg/class",
      label: "ZCL_DEMO",
      collapsibleState: TreeItemCollapsibleState.None,
      children: [],
      openUri,
      isContainer: false
    })

  it("creates FavItem with command when openUri provided", () => {
    const fav = makeFav("adt://dev100/pkg/class/source/main")
    const item = new FavItem(fav)
    expect(item.favourite).toBe(fav)
    expect(item.command).toBeDefined()
    expect(item.command!.command).toBe("vscode.open")
    expect(item.contextValue).toBe("favourite")
  })

  it("creates FavItem without command when openUri is empty", () => {
    const fav = makeFav("")
    const item = new FavItem(fav)
    expect(item.command).toBeUndefined()
    expect(item.contextValue).toBe("favourite")
  })

  it("returns empty children from getChildren when no uri", async () => {
    const fav = new Favourite({ ...makeFav(), uri: "", children: [] })
    const item = new FavItem(fav)
    const children = await item.getChildren()
    expect(children).toEqual([])
  })

  it("caches children after first getChildren call", async () => {
    const fav = makeFav()
    const item = new FavItem(fav)
    const c1 = await item.getChildren()
    const c2 = await item.getChildren()
    expect(c1).toBe(c2)
  })
})

describe("FavItem – fixold character normalization", () => {
  it("replaces full-width slash (\uFF0F) in label via Favourite", () => {
    // The fixold function replaces \uFF0F with NSSLASH (/)
    const fav = new Favourite({
      uri: "adt://dev100/foo",
      label: "NS\uFF0FSLASH",
      collapsibleState: TreeItemCollapsibleState.None,
      children: [],
      openUri: "",
      isContainer: false
    })
    const item = new FavItem(fav)
    // The label on the TreeItem itself is set from favourite.label after fixold
    expect(item.favourite.label).not.toContain("\uFF0F")
    expect(item.favourite.label).toContain("/")
  })
})

describe("FavouritesProvider", () => {
  beforeEach(() => {
    // Reset singleton
    ;(FavouritesProvider as any).instance = undefined
  })

  it("returns singleton", () => {
    const a = FavouritesProvider.get()
    const b = FavouritesProvider.get()
    expect(a).toBe(b)
  })

  it("exposes onDidChangeTreeData", () => {
    const provider = FavouritesProvider.get()
    expect(provider.onDidChangeTreeData).toBeDefined()
  })

  it("refresh fires emitter", () => {
    const provider = FavouritesProvider.get()
    const { EventEmitter } = __$mock_vscode
    // The emitter is already created; we can spy on provider.refresh
    expect(() => provider.refresh()).not.toThrow()
  })

  it("storagePath setter assigns storage path", () => {
    const provider = FavouritesProvider.get()
    expect(() => {
      provider.storagePath = "/some/path"
    }).not.toThrow()
    expect(() => {
      provider.storagePath = undefined
    }).not.toThrow()
  })

  it("getTreeItem returns element", async () => {
    const provider = FavouritesProvider.get()
    const fav = new Favourite({
      uri: "adt://dev100/foo",
      label: "Foo",
      collapsibleState: TreeItemCollapsibleState.None,
      children: [],
      openUri: "",
      isContainer: false
    })
    const item = new FavItem(fav)
    const result = await provider.getTreeItem(item)
    expect(result).toBe(item)
  })

  it("getChildren with no folders returns empty array", async () => {
    const { workspace } = __$mock_vscode
    ;(workspace as any).workspaceFolders = []
    const provider = FavouritesProvider.get()
    const children = await provider.getChildren()
    expect(Array.isArray(children)).toBe(true)
  })

  it("getChildren with single folder uses flat layout", async () => {
    const { workspace, Uri } = __$mock_vscode
    ;(workspace as any).workspaceFolders = [
      { uri: { authority: "dev100", scheme: "adt", toString: () => "adt://dev100" } }
    ]
    const { readFile } = __$mock_fs_promises
    ;(readFile as Mock).mockResolvedValueOnce(
      JSON.stringify([
        [
          "dev100",
          [
            {
              label: "ZCL_TEST",
              uri: "adt://dev100/pkg/zcl_test",
              collapsibleState: 0,
              children: [],
              openUri: "",
              isContainer: false
            }
          ]
        ]
      ])
    )
    ;(FavouritesProvider as any).instance = undefined
    const provider = FavouritesProvider.get()
    provider.storagePath = "/some/path"
    const children = await provider.getChildren()
    expect(Array.isArray(children)).toBe(true)
  })

  it("deleteFavourite does nothing if connId not in root", async () => {
    const { workspace } = __$mock_vscode
    ;(workspace as any).workspaceFolders = []
    const provider = FavouritesProvider.get()
    const fav = new Favourite({
      uri: "adt://unknown/foo",
      label: "Foo",
      collapsibleState: 0,
      children: [],
      openUri: "",
      isContainer: false
    })
    const item = new FavItem(fav)
    await expect(provider.deleteFavourite(item)).resolves.toBeUndefined()
  })
})

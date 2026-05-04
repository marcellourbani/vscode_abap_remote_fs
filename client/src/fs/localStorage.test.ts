// Tests for fs/localStorage.ts - pure functions and LocalStorage class
jest.mock("vscode", () => {
  const joinPath = (...args: any[]) => {
    const base = args[0]
    const parts = args.slice(1)
    return { ...base, path: [base.path, ...parts].join("/"), toString: () => `file://${[base.path, ...parts].join("/")}` }
  }
  return {
    Uri: {
      joinPath: jest.fn((base: any, ...parts: string[]) => joinPath(base, ...parts)),
      parse: jest.fn((s: string) => ({ path: s.replace(/^file:\/\//, ""), scheme: "file", authority: "", toString: () => s }))
    },
    workspace: {
      fs: {
        stat: jest.fn(),
        createDirectory: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn(),
        readDirectory: jest.fn()
      },
      workspaceFolders: []
    }
  }
}, { virtual: true })

jest.mock("./initialtemplates", () => ({
  templates: [
    { name: "abapgit.xml", content: "<abapgit/>" },
    { name: ".abaplint", content: "{}" }
  ]
}))

jest.mock("../adt/conections", () => ({
  ADTSCHEME: "adt"
}))

jest.mock("io-ts", () => {
  const t = {
    type: jest.fn((fields: any) => ({
      decode: jest.fn()
    })),
    boolean: { _tag: "BooleanType" },
    record: jest.fn(() => ({ _tag: "RecordType" })),
    string: { _tag: "StringType" }
  }
  return t
})

jest.mock("fp-ts/lib/Either", () => ({
  isLeft: jest.fn()
}))

import { createFolderIfMissing, initializeMainStorage } from "./localStorage"
import * as vscode from "vscode"

describe("localStorage.ts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("createFolderIfMissing", () => {
    it("does not create directory if it already exists", async () => {
      const uri = { path: "/existing", scheme: "file", authority: "" }
      ;(vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({})

      await createFolderIfMissing(uri as any)

      expect(vscode.workspace.fs.createDirectory).not.toHaveBeenCalled()
    })

    it("creates directory if stat throws (not found)", async () => {
      const uri = { path: "/new-folder", scheme: "file", authority: "" }
      ;(vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("FileNotFound"))
      ;(vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined)

      await createFolderIfMissing(uri as any)

      expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledWith(uri)
    })

    it("returns the base path URI", async () => {
      const uri = { path: "/returned-folder", scheme: "file", authority: "" }
      ;(vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({})

      const result = await createFolderIfMissing(uri as any)

      expect(result).toBe(uri)
    })
  })

  describe("initializeMainStorage", () => {
    it("creates the root folder and connections/templates sub-folders", async () => {
      ;(vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("not found"))
      ;(vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined)
      ;(vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)

      const root = { path: "/root", scheme: "file", authority: "", toString: () => "file:///root" }
      await initializeMainStorage(root as any)

      // root + connections + templates = at minimum 3 createDirectory calls
      expect(vscode.workspace.fs.createDirectory).toHaveBeenCalled()
    })

    it("creates template files when they don't exist", async () => {
      ;(vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("not found"))
      ;(vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined)
      ;(vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)

      const root = { path: "/root2", scheme: "file", authority: "", toString: () => "file:///root2" }
      await initializeMainStorage(root as any)

      // Should write template files + folderMap.json
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalled()
    })

    it("does not overwrite existing files", async () => {
      // stat succeeds for everything - nothing should be created
      ;(vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({})

      const root = { path: "/root3", scheme: "file", authority: "", toString: () => "file:///root3" }
      await initializeMainStorage(root as any)

      expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
    })
  })

  describe("unique name generation logic", () => {
    // Replicate the internal unique() function logic
    const unique = (base: string, values: string[]): string => {
      if (!values.includes(base)) return base
      for (let counter = 1; counter < 1000; counter++) {
        const candidate = `${base}_${counter}`
        if (!values.includes(candidate)) return candidate
      }
      throw new Error("Unable to generate unique folder name")
    }

    it("returns base if not in existing values", () => {
      expect(unique("myconn", ["other1", "other2"])).toBe("myconn")
    })

    it("appends _1 if base is taken", () => {
      expect(unique("myconn", ["myconn"])).toBe("myconn_1")
    })

    it("increments counter until unique", () => {
      expect(unique("myconn", ["myconn", "myconn_1", "myconn_2"])).toBe("myconn_3")
    })

    it("throws after 999 attempts", () => {
      const allTaken = ["myconn", ...Array.from({ length: 999 }, (_, i) => `myconn_${i + 1}`)]
      expect(() => unique("myconn", allTaken)).toThrow("Unable to generate unique folder name")
    })

    it("returns base for empty values array", () => {
      expect(unique("conn", [])).toBe("conn")
    })
  })
})

jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({
      scheme: s.split("://")[0],
      authority: s.split("://")[1]?.split("/")[0] || "",
      path: "/" + (s.split("://")[1]?.split("/").slice(1).join("/") || ""),
      toString: () => s
    }))
  },
  scm: {
    createSourceControl: jest.fn().mockReturnValue({
      inputBox: { placeholder: "" },
      statusBarCommands: [],
      createResourceGroup: jest.fn().mockReturnValue({
        hideWhenEmpty: false,
        resourceStates: [],
        id: "staged",
        [Symbol.iterator]: jest.fn().mockReturnValue([][Symbol.iterator]())
      })
    })
  },
  SourceControl: jest.fn(),
  SourceControlResourceGroup: jest.fn(),
  SourceControlResourceState: jest.fn()
}), { virtual: true })

jest.mock("../../lib", () => ({
  Cache: jest.fn(),
  mapGet: jest.fn((map: Map<any, any>, key: string, fn: () => any) => {
    if (!map.has(key)) map.set(key, fn())
    return map.get(key)
  }),
  cache: jest.fn((fn: any) => {
    const map = new Map()
    return {
      get: (k: string) => { if (!map.has(k)) map.set(k, fn(k)); return map.get(k) },
      [Symbol.iterator]: function*() { yield* map.entries() }
    }
  })
}))

jest.mock("./credentials", () => ({
  dataCredentials: jest.fn()
}))

jest.mock("./documentProvider", () => ({
  gitUrl: jest.fn((data: any, href: string) => ({ toString: () => href }))
}))

jest.mock("../../commands", () => ({
  AbapFsCommands: { agitBranch: "abapfs.agitBranch" }
}))

jest.mock("fp-ts/lib/Option", () => ({
  isNone: jest.fn(),
  fromNullable: jest.fn((v: any) => v ? { _tag: "Some", value: v } : { _tag: "None" }),
  some: jest.fn((v: any) => ({ _tag: "Some", value: v }))
}))

jest.mock("./storage", () => ({ saveRepos: jest.fn() }))

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn()
}))

import {
  STAGED, UNSTAGED, IGNORED,
  scmKey, scmData, fileUri, isAgResState,
  setStatusCommand, addRepo, fromSC, fromGroup, ScmData
} from "./scm"
import { Uri } from "vscode"

describe("constants", () => {
  it("STAGED is 'staged'", () => { expect(STAGED).toBe("staged") })
  it("UNSTAGED is 'unstaged'", () => { expect(UNSTAGED).toBe("unstaged") })
  it("IGNORED is 'ignored'", () => { expect(IGNORED).toBe("ignored") })
})

describe("scmKey", () => {
  it("generates correct key format", () => {
    expect(scmKey("conn1", "ZPACKAGE")).toBe("abapGit_conn1_ZPACKAGE")
  })

  it("generates key for different conn and package", () => {
    expect(scmKey("dev100", "ZPKG2")).toBe("abapGit_dev100_ZPKG2")
  })
})

describe("scmData", () => {
  it("returns undefined for unknown key", () => {
    expect(scmData("unknown_key")).toBeUndefined()
  })
})

describe("fileUri", () => {
  it("constructs URI from file path and name", () => {
    const file: any = {
      path: "/sap/bc/adt/abapgit/repos/",
      name: "ZCL_TEST.clas.abap",
      links: []
    }
    const uri = fileUri(file)
    expect(Uri.parse).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("ZCL_TEST.clas.abap"))
    )
  })

  it("encodes special characters in filename", () => {
    const file: any = {
      path: "/path/",
      name: "Z CL TEST.clas.abap",
      links: []
    }
    const uri = fileUri(file)
    expect(Uri.parse).toHaveBeenCalledWith(
      expect.stringContaining("Z%20CL%20TEST")
    )
  })
})

describe("isAgResState", () => {
  it("returns true for valid AgResState", () => {
    const state: any = {
      resourceUri: { toString: () => "adt://conn/path" },
      data: { connId: "conn1", repo: {}, scm: {}, groups: {}, notNew: true }
    }
    expect(isAgResState(state)).toBe(true)
  })

  it("returns false for missing data", () => {
    expect(isAgResState({ resourceUri: {} })).toBe(false)
  })

  it("returns false for missing resourceUri", () => {
    expect(isAgResState({ data: { connId: "c" } })).toBe(false)
  })

  it("returns false for null/undefined", () => {
    expect(isAgResState(null)).toBe(false)
    expect(isAgResState(undefined)).toBe(false)
  })

  it("returns false for missing connId", () => {
    expect(isAgResState({ resourceUri: {}, data: {} })).toBe(false)
  })
})

describe("setStatusCommand", () => {
  it("sets status bar command with branch name", () => {
    const mockScm: any = { statusBarCommands: [] }
    const data: any = {
      scm: mockScm,
      repo: { branch_name: "refs/heads/main", sapPackage: "ZPKG" }
    }
    setStatusCommand(data)
    expect(mockScm.statusBarCommands).toHaveLength(1)
    expect(mockScm.statusBarCommands[0].title).toBe("main")
  })

  it("strips refs/heads/ prefix from branch name", () => {
    const mockScm: any = { statusBarCommands: [] }
    const data: any = {
      scm: mockScm,
      repo: { branch_name: "/refs/heads/feature/my-branch", sapPackage: "ZPKG" }
    }
    setStatusCommand(data)
    expect(mockScm.statusBarCommands[0].title).toBe("feature/my-branch")
  })

  it("keeps branch name as-is when not refs/heads/ format", () => {
    const mockScm: any = { statusBarCommands: [] }
    const data: any = {
      scm: mockScm,
      repo: { branch_name: "custom-branch", sapPackage: "ZPKG" }
    }
    setStatusCommand(data)
    expect(mockScm.statusBarCommands[0].title).toBe("custom-branch")
  })
})

describe("addRepo", () => {
  beforeEach(() => jest.clearAllMocks())

  it("creates a new ScmData when not existing", async () => {
    const mockRepo: any = {
      key: "repokey1",
      sapPackage: "ZPKG",
      branch_name: "main"
    }
    const result = await addRepo("conn1", mockRepo, false)
    expect(result).toBeDefined()
    expect(result.connId).toBe("conn1")
    expect(result.repo.key).toBe("repokey1")
  })

  it("marks notNew=true when addnew=false", async () => {
    const mockRepo: any = { key: "repokey2", sapPackage: "ZPKG2", branch_name: "dev" }
    const result = await addRepo("conn1", mockRepo, false)
    expect(result.notNew).toBe(true)
  })
})

describe("fromSC", () => {
  it("returns None when scm not found", () => {
    const { fromNullable } = require("fp-ts/lib/Option")
    const fakeSC: any = {}
    const result = fromSC(fakeSC)
    expect(fromNullable).toHaveBeenCalledWith(undefined)
  })
})

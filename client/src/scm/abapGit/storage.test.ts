vi.mock("vscode", () => ({}))
vi.mock("../../lib", () => ({
  mapGet: vi.fn(async function (map: Map<any, any>, key: any, fn: () => any) {
    if (!map.has(key)) map.set(key, await fn())
    return map.get(key)
  }),
  ArrayToMap: vi.fn(function (key: string) {
    return (arr: any[]) => new Map(arr.map((x: any) => [x[key], x]))
  }),
  cache: (creator: any, keyTranslator: any = (x: any) => x) => {
    const values = new Map()
    return {
      get: (key: any) => {
        const mapKey = keyTranslator(key)
        if (!values.has(mapKey)) values.set(mapKey, creator(key))
        return values.get(mapKey)
      },
      get size() {
        return values.size
      },
      *[Symbol.iterator]() {
        yield* values.values()
      }
    }
  }
}))
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock(".", () => ({ addRepo: vi.fn() }))
vi.mock("./documentProvider", () => ({
  registerGitDocProvider: vi.fn(() => ({ dispose: vi.fn() }))
}))

import { saveRepos, registerAbapGit } from "./storage"
import type { ScmData, ScmCredentials } from "./scm"
import { getOrCreateClient } from "../../adt/conections"
import { addRepo } from "."
import type { Mock } from "vitest"

function makeScmData(overrides: {
  connId: string
  repo: any
  credentials?: ScmCredentials
  [k: string]: any
}): ScmData {
  return {
    scm: {} as any,
    groups: {} as any,
    notNew: true,
    ...overrides
  } as any as ScmData
}

describe("saveRepos", () => {
  it("does nothing when storage not initialized", () => {
    // saveRepos called before registerAbapGit => storage is undefined
    const scms = new Map<string, ScmData>()
    const result = saveRepos(scms)
    expect(result).toBeUndefined()
  })

  it("saves correct StoredRepo format after registration", () => {
    const mockUpdate = vi.fn()
    const mockContext = {
      workspaceState: { get: vi.fn().mockReturnValue([]), update: mockUpdate },
      subscriptions: []
    }
    ;(getOrCreateClient as Mock).mockResolvedValue({
      gitRepos: vi.fn().mockResolvedValue([])
    })
    registerAbapGit(mockContext as any)

    const scms = new Map<string, ScmData>()
    scms.set(
      "key1",
      makeScmData({
        connId: "DEV",
        repo: { key: "repo1" },
        credentials: { user: "admin", password: "secret" }
      })
    )

    saveRepos(scms)

    expect(mockUpdate).toHaveBeenCalledWith("abapGitRepos", [
      { connId: "DEV", repoKey: "repo1", user: "admin" }
    ])
  })

  it("handles empty scms map", () => {
    const mockUpdate = vi.fn()
    const mockContext = {
      workspaceState: { get: vi.fn().mockReturnValue([]), update: mockUpdate },
      subscriptions: []
    }
    ;(getOrCreateClient as Mock).mockResolvedValue({
      gitRepos: vi.fn().mockResolvedValue([])
    })
    registerAbapGit(mockContext as any)

    saveRepos(new Map())

    expect(mockUpdate).toHaveBeenCalledWith("abapGitRepos", [])
  })

  it("includes user credentials when present", () => {
    const mockUpdate = vi.fn()
    const mockContext = {
      workspaceState: { get: vi.fn().mockReturnValue([]), update: mockUpdate },
      subscriptions: []
    }
    ;(getOrCreateClient as Mock).mockResolvedValue({
      gitRepos: vi.fn().mockResolvedValue([])
    })
    registerAbapGit(mockContext as any)

    const scms = new Map<string, ScmData>()
    scms.set(
      "k1",
      makeScmData({
        connId: "C1",
        repo: { key: "r1" },
        credentials: { user: "user1", password: "pw1" }
      })
    )
    scms.set(
      "k2",
      makeScmData({
        connId: "C2",
        repo: { key: "r2" },
        credentials: { user: "user2", password: "pw2" }
      })
    )

    saveRepos(scms)

    const stored = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][1]
    expect(stored).toHaveLength(2)
    expect(stored[0].user).toBe("user1")
    expect(stored[1].user).toBe("user2")
    // password is NOT stored
    expect(stored[0]).not.toHaveProperty("password")
    expect(stored[1]).not.toHaveProperty("password")
  })

  it("omits user field when credentials are absent", () => {
    const mockUpdate = vi.fn()
    const mockContext = {
      workspaceState: { get: vi.fn().mockReturnValue([]), update: mockUpdate },
      subscriptions: []
    }
    ;(getOrCreateClient as Mock).mockResolvedValue({
      gitRepos: vi.fn().mockResolvedValue([])
    })
    registerAbapGit(mockContext as any)

    const scms = new Map<string, ScmData>()
    scms.set(
      "k1",
      makeScmData({
        connId: "C1",
        repo: { key: "r1" }
        // no credentials
      })
    )

    saveRepos(scms)

    const stored = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][1]
    expect(stored).toEqual([{ connId: "C1", repoKey: "r1", user: undefined }])
  })

  it("saves multiple repos from different connections", () => {
    const mockUpdate = vi.fn()
    const mockContext = {
      workspaceState: { get: vi.fn().mockReturnValue([]), update: mockUpdate },
      subscriptions: []
    }
    ;(getOrCreateClient as Mock).mockResolvedValue({
      gitRepos: vi.fn().mockResolvedValue([])
    })
    registerAbapGit(mockContext as any)

    const scms = new Map<string, ScmData>()
    scms.set("a", makeScmData({ connId: "DEV", repo: { key: "r1" } }))
    scms.set(
      "b",
      makeScmData({ connId: "QAS", repo: { key: "r2" }, credentials: { user: "u", password: "p" } })
    )
    scms.set("c", makeScmData({ connId: "DEV", repo: { key: "r3" } }))

    saveRepos(scms)

    const stored = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][1]
    expect(stored).toHaveLength(3)
    expect(stored.map((s: any) => s.connId)).toEqual(["DEV", "QAS", "DEV"])
    expect(stored.map((s: any) => s.repoKey)).toEqual(["r1", "r2", "r3"])
  })
})

describe("registerAbapGit", () => {
  it("uses workspaceState from context and triggers loadRepos", () => {
    const mockGet = vi.fn().mockReturnValue([])
    const mockContext = {
      workspaceState: { get: mockGet, update: vi.fn() },
      subscriptions: []
    }
    ;(getOrCreateClient as Mock).mockResolvedValue({
      gitRepos: vi.fn().mockResolvedValue([])
    })

    registerAbapGit(mockContext as any)

    // After registering, saveRepos should work (storage is set)
    const scms = new Map<string, ScmData>()
    const result = saveRepos(scms)
    // Should have called update (not returned undefined)
    expect(mockContext.workspaceState.update).toHaveBeenCalled()
  })

  it("loads stored repos and calls addRepo for matching ones", async () => {
    const mockRepo = { key: "repo1", url: "https://example.com" }
    const storedRepos = [{ connId: "DEV", repoKey: "repo1", user: "admin" }]
    ;(getOrCreateClient as Mock).mockResolvedValue({
      gitRepos: vi.fn().mockResolvedValue([mockRepo])
    })
    ;(addRepo as Mock).mockResolvedValue({ credentials: undefined })

    const mockContext = {
      workspaceState: { get: vi.fn().mockReturnValue(storedRepos), update: vi.fn() },
      subscriptions: []
    }

    registerAbapGit(mockContext as any)

    // Wait for async loadRepos to complete
    await new Promise(r => setTimeout(r, 50))

    expect(addRepo).toHaveBeenCalledWith("DEV", mockRepo)
  })
})

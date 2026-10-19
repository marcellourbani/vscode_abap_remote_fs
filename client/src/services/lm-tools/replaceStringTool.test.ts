import { vi } from "vitest"

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  register: vi.fn(),
  fail: vi.fn(),
  getNodeAsync: vi.fn(),
  getInactiveSource: vi.fn(),
  getClient: vi.fn(),
  getOrCreateRoot: vi.fn()
}))

vi.mock("vscode", () => ({
  Uri: {
    parse: vi.fn((value: string) => {
      const parsed = new URL(value)
      return {
        scheme: parsed.protocol.slice(0, -1),
        authority: parsed.host,
        path: parsed.pathname,
        toString: () => value
      }
    })
  },
  workspace: {
    fs: {
      readFile: mocks.readFile,
      writeFile: mocks.writeFile
    }
  }
}))
vi.mock("abapfs", () => ({
  isAbapFile: vi.fn((value: unknown) => Boolean(value))
}))
vi.mock("../../adt/conections", () => ({
  getClient: mocks.getClient,
  getOrCreateRoot: mocks.getOrCreateRoot
}))
vi.mock("../transportIntentService", () => ({
  TransportIntentService: {
    get: vi.fn(() => ({
      register: mocks.register,
      fail: mocks.fail
    }))
  }
}))

import { executeReplace, findAndReplace } from "./replaceStringTool"

describe("findAndReplace", () => {
  it("replaces exactly one literal occurrence", () => {
    expect(findAndReplace("one\ntwo\nthree", "two", "changed")).toBe("one\nchanged\nthree")
  })

  it.each(["$&", "$$", "$`", "$'", "$1", "$<name>"])(
    "inserts replacement token %s literally on both matching paths",
    token => {
      expect(findAndReplace("before old after", "old", token)).toBe(`before ${token} after`)
      expect(findAndReplace("before\r\nold\r\nafter", "before\nold", token)).toBe(
        `${token}\r\nafter`
      )
    }
  )

  it.each([
    ["one\r\ntwo\r\none\r\ntwo", "one\ntwo"],
    ["one\ntwo\none\ntwo", "one\r\ntwo"],
    ["one\r\ntwo\none\r\ntwo", "one\ntwo"]
  ])("rejects ambiguous normalized matches", (content, oldString) => {
    expect(() => findAndReplace(content, oldString, "new")).toThrow(/2 occurrences/)
  })

  it("preserves CRLF line endings when matching normalized input", () => {
    expect(
      findAndReplace(
        "REPORT ztest.\r\nWRITE old.\r\n",
        "REPORT ztest.\nWRITE old.\n",
        "REPORT ztest.\nWRITE new.\n"
      )
    ).toBe("REPORT ztest.\r\nWRITE new.\r\n")
  })

  it("rejects missing, ambiguous, and no-op replacements", () => {
    expect(() => findAndReplace("one", "missing", "new")).toThrow(/Could not find/)
    expect(() => findAndReplace("one one", "one", "new")).toThrow(/2 occurrences/)
    expect(() => findAndReplace("one", "one", "one")).toThrow(/identical/)
  })
})

describe("executeReplace transport integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readFile.mockReset().mockResolvedValue(Buffer.from("REPORT old.\n", "utf8"))
    mocks.writeFile.mockReset().mockResolvedValue(undefined)
    mocks.register.mockReturnValue({ intentId: "intent-1" })
    mocks.getNodeAsync.mockResolvedValue({
      object: { structure: {}, contentsPath: vi.fn(() => "/object/source/main") }
    })
    mocks.getOrCreateRoot.mockResolvedValue({ getNodeAsync: mocks.getNodeAsync })
    mocks.getClient.mockReturnValue({
      statelessClone: { getObjectSource: mocks.getInactiveSource }
    })
    mocks.getInactiveSource.mockReset().mockResolvedValue("REPORT new.\n")
  })

  it("preserves all four parallel replacements for the same file", async () => {
    let source = "one\ntwo\nthree\nfour\n"
    mocks.readFile.mockImplementation(async () => Buffer.from(source))
    mocks.writeFile.mockImplementation(async (_uri: unknown, content: Buffer) => {
      source = content.toString("utf8")
    })
    mocks.getInactiveSource.mockImplementation(async () => source)

    await Promise.all([
      executeReplace("adt://DEV100/object/source/main", "one", "first"),
      executeReplace("adt://dev100/object/source/main", "two", "second"),
      executeReplace("adt://dev100/object/source/main", "three", "third"),
      executeReplace("adt://dev100/object/source/main", "four", "fourth")
    ])

    expect(source).toBe("first\nsecond\nthird\nfourth\n")
    expect(mocks.writeFile).toHaveBeenCalledTimes(4)
    expect(mocks.getInactiveSource).toHaveBeenCalledTimes(4)
  })

  it("reports parallel replacements in save order with their own before and after", async () => {
    let source = "one\ntwo\n"
    mocks.readFile.mockImplementation(async () => Buffer.from(source))
    mocks.writeFile.mockImplementation(async (_uri: unknown, content: Buffer) => {
      source = content.toString("utf8")
    })
    mocks.getInactiveSource.mockImplementation(async () => source)
    const applied: [string, string][] = []
    const onApplied = (_uri: unknown, before: string, after: string) => {
      applied.push([before, after])
    }

    await Promise.all([
      executeReplace("adt://dev100/object/source/main", "one", "first", undefined, onApplied),
      executeReplace("adt://DEV100/object/source/main", "two", "second", undefined, onApplied)
    ])

    expect(applied).toEqual([
      ["one\ntwo\n", "first\ntwo\n"],
      ["first\ntwo\n", "first\nsecond\n"]
    ])
  })

  it("does not start the next replacement until the applied callback finishes", async () => {
    let source = "one\ntwo\n"
    mocks.readFile.mockImplementation(async () => Buffer.from(source))
    mocks.writeFile.mockImplementation(async (_uri: unknown, content: Buffer) => {
      source = content.toString("utf8")
    })
    mocks.getInactiveSource.mockImplementation(async () => source)
    let releaseCallback!: () => void
    const callbackDone = new Promise<void>(resolve => (releaseCallback = resolve))
    const onApplied = vi.fn(() => (onApplied.mock.calls.length === 1 ? callbackDone : undefined))

    const first = executeReplace(
      "adt://dev100/object/source/main",
      "one",
      "first",
      undefined,
      onApplied
    )
    const second = executeReplace(
      "adt://dev100/object/source/main",
      "two",
      "second",
      undefined,
      onApplied
    )
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(mocks.readFile).toHaveBeenCalledTimes(1)

    releaseCallback()
    await Promise.all([first, second])
    expect(onApplied).toHaveBeenCalledTimes(2)
  })

  it("reports a write SAP accepted even when verification fails", async () => {
    mocks.getNodeAsync.mockRejectedValue(new Error("node vanished"))
    const onApplied = vi.fn()

    await expect(
      executeReplace("adt://dev100/object/source/main", "old", "new", undefined, onApplied)
    ).rejects.toThrow(/could not be verified/)
    expect(onApplied).toHaveBeenCalledWith(expect.anything(), "REPORT old.\n", "REPORT new.\n")
  })

  it("does not start the next read until the previous verification completes", async () => {
    let releaseVerification!: (source: string) => void
    let verificationStarted!: () => void
    const started = new Promise<void>(resolve => {
      verificationStarted = resolve
    })
    const verification = new Promise<string>(resolve => {
      releaseVerification = resolve
    })
    mocks.readFile
      .mockResolvedValueOnce(Buffer.from("REPORT old.\n"))
      .mockResolvedValue(Buffer.from("REPORT new.\n"))
    mocks.getInactiveSource
      .mockImplementationOnce(() => {
        verificationStarted()
        return verification
      })
      .mockResolvedValue("REPORT latest.\n")

    const first = executeReplace("adt://dev100/object/source/main", "old", "new")
    const second = executeReplace("adt://DEV100/object/source/main", "new", "latest")
    await started
    const readsDuringVerification = mocks.readFile.mock.calls.length
    releaseVerification("REPORT new.\n")
    const results = await Promise.all([first, second])

    expect(readsDuringVerification).toBe(1)
    expect(results).toEqual(["REPORT new.\n", "REPORT latest.\n"])
  })

  it("continues queued replacements after a failed write", async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error("SAP rejected write"))
    const first = executeReplace("adt://dev100/object/source/main", "old", "new")
    const second = executeReplace("adt://dev100/object/source/main", "old", "new")

    const results = await Promise.allSettled([first, second])

    expect(results[0]).toEqual({ status: "rejected", reason: expect.any(Error) })
    expect(results[1]).toEqual({ status: "fulfilled", value: "REPORT new.\n" })
    expect(mocks.writeFile).toHaveBeenCalledTimes(2)
  })

  it("allows different files and connections to proceed independently", async () => {
    let releaseRead!: (content: Buffer) => void
    const blockedRead = new Promise<Buffer>(resolve => {
      releaseRead = resolve
    })
    mocks.readFile.mockImplementationOnce(() => blockedRead)
    const blocked = executeReplace("adt://dev100/object/source/main", "old", "new")
    let results: string[]
    try {
      results = await Promise.all([
        executeReplace("adt://dev100/other/source/main", "old", "new"),
        executeReplace("adt://dev200/object/source/main", "old", "new")
      ])
    } finally {
      releaseRead(Buffer.from("REPORT old.\n"))
      await blocked
    }

    expect(results).toEqual(["REPORT new.\n", "REPORT new.\n"])
  })

  it("registers the approved transport before writing and verifies inactive source", async () => {
    const result = await executeReplace("adt://DEV100/object/source/main", "old", "new", {
      type: "existing",
      number: "DEVK900123"
    })

    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        process: "normal-edit",
        transportChoice: { type: "existing", number: "DEVK900123" }
      })
    )
    expect(mocks.register.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeFile.mock.invocationCallOrder[0]
    )
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ scheme: "adt" }),
      Buffer.from("REPORT new.\n", "utf8")
    )
    expect(mocks.getOrCreateRoot).toHaveBeenCalledWith("dev100")
    expect(mocks.getClient).toHaveBeenCalledWith("dev100")
    expect(mocks.getInactiveSource).toHaveBeenCalledWith("/object/source/main", {
      version: "inactive"
    })
    expect(result).toBe("REPORT new.\n")
  })

  it("keeps the existing provider behavior when no transport choice is supplied", async () => {
    await executeReplace("adt://dev100/object/source/main", "old", "new")

    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.writeFile).toHaveBeenCalled()
    expect(mocks.getInactiveSource).toHaveBeenCalled()
  })

  it("fails the armed intent when the filesystem write rejects", async () => {
    const error = new Error("SAP rejected write")
    mocks.writeFile.mockRejectedValue(error)

    await expect(
      executeReplace("adt://dev100/object/source/main", "old", "new", {
        type: "new",
        description: "User-approved request"
      })
    ).rejects.toThrow("SAP rejected write")

    expect(mocks.fail).toHaveBeenCalledWith("intent-1", error)
    expect(mocks.getInactiveSource).not.toHaveBeenCalled()
  })

  describe("inactive source verification", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const replaceSettled = async () => {
      const outcome = executeReplace("adt://dev100/object/source/main", "old", "new").then(
        value => ({ value }),
        (error: Error) => ({ error })
      )
      await vi.runAllTimersAsync()
      return outcome
    }

    it("waits until SAP returns the saved source", async () => {
      mocks.getInactiveSource
        .mockResolvedValueOnce("REPORT old.\n")
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValue("REPORT new.\n")

      expect(await replaceSettled()).toEqual({ value: "REPORT new.\n" })
      expect(mocks.getInactiveSource).toHaveBeenCalledTimes(3)
    })

    it("ignores line ending and trailing whitespace differences", async () => {
      mocks.getInactiveSource.mockResolvedValue("REPORT new.  \r\n\r\n")

      expect(await replaceSettled()).toEqual({ value: "REPORT new.\n" })
      expect(mocks.getInactiveSource).toHaveBeenCalledTimes(1)
    })

    it("reports a save that never reached SAP", async () => {
      mocks.getInactiveSource.mockResolvedValue("REPORT old.\n")

      const outcome = await replaceSettled()

      expect(mocks.getInactiveSource).toHaveBeenCalledTimes(10)
      expect(outcome).toEqual({ error: expect.any(Error) })
      expect((outcome as { error: Error }).error.message).toMatch(/still has the previous source/)
    })

    it("reports the first line that differs", async () => {
      mocks.getInactiveSource.mockResolvedValue("REPORT other.\n")

      const outcome = await replaceSettled()

      expect((outcome as { error: Error }).error.message).toMatch(
        /inactive source does not match.*line 1.*REPORT new\..*REPORT other\./s
      )
    })

    it("loads missing metadata before reading back the saved source", async () => {
      const object = {
        structure: undefined as unknown,
        loadStructure: vi.fn(async () => (object.structure = {})),
        contentsPath: vi.fn(() => {
          if (!object.structure) throw new Error("Unable to retrieve metadata")
          return "/object/source/main"
        })
      }
      mocks.getNodeAsync.mockResolvedValue({ object })

      expect(await replaceSettled()).toEqual({ value: "REPORT new.\n" })
      expect(object.loadStructure).toHaveBeenCalled()
    })

    it("says the write went through when verification cannot start", async () => {
      mocks.getNodeAsync.mockRejectedValue(new Error("node vanished"))

      const outcome = await replaceSettled()

      expect((outcome as { error: Error }).error.message).toMatch(
        /SAP accepted the write.*could not be verified.*node vanished.*abapfs_get_object_source/s
      )
    })

    it("reports the read error when SAP never answers", async () => {
      mocks.getInactiveSource.mockRejectedValue(new Error("timeout"))

      const outcome = await replaceSettled()

      expect((outcome as { error: Error }).error.message).toMatch(
        /could not be read back.*timeout/s
      )
    })
  })

  it("rejects non-ADT URIs before reading or arming an intent", async () => {
    await expect(
      executeReplace("file:///tmp/ztest", "old", "new", { type: "existing", number: "DEVK900123" })
    ).rejects.toThrow(/Expected 'adt/)
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })
})

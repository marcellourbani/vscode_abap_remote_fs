jest.mock("vscode", () => ({
  extensions: { getExtension: jest.fn().mockReturnValue({ packageJSON: { version: "2.1.0" } }) },
  window: { createStatusBarItem: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
  StatusBarAlignment: { Left: 1, Right: 2 }
}), { virtual: true })

jest.mock("./funMessenger", () => ({
  funWindow: {
    createStatusBarItem: jest.fn().mockReturnValue({
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
      text: "",
      tooltip: "",
      command: ""
    }),
    showInformationMessage: jest.fn().mockResolvedValue(undefined),
    showErrorMessage: jest.fn().mockResolvedValue(undefined)
  }
}))

// Reset singleton before each test
beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
})

// Helper to get a fresh validator instance after module reset
function getValidator() {
  jest.resetModules()
  jest.mock("vscode", () => ({
    extensions: {
      getExtension: jest.fn().mockReturnValue({ packageJSON: { version: "2.1.0" } })
    },
    window: {
      createStatusBarItem: jest.fn().mockReturnValue({
        show: jest.fn(), hide: jest.fn(), dispose: jest.fn(), text: "", tooltip: "", command: ""
      }),
      showInformationMessage: jest.fn().mockResolvedValue(undefined),
      showErrorMessage: jest.fn().mockResolvedValue(undefined)
    },
    StatusBarAlignment: { Left: 1, Right: 2 }
  }), { virtual: true })
  jest.mock("./funMessenger", () => ({
    funWindow: {
      createStatusBarItem: jest.fn().mockReturnValue({
        show: jest.fn(), hide: jest.fn(), dispose: jest.fn(), text: "", tooltip: "", command: ""
      }),
      showInformationMessage: jest.fn().mockResolvedValue(undefined),
      showErrorMessage: jest.fn().mockResolvedValue(undefined)
    }
  }))
  const { SapSystemValidator } = require("./sapSystemValidator")
  // Reset singleton
  ;(SapSystemValidator as any).instance = undefined
  return SapSystemValidator.getInstance() as InstanceType<typeof SapSystemValidator>
}

import { SapSystemValidator } from "./sapSystemValidator"

// ─── Singleton pattern ───────────────────────────────────────────────────────

describe("SapSystemValidator singleton", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  test("getInstance returns the same instance on repeated calls", () => {
    const a = SapSystemValidator.getInstance()
    const b = SapSystemValidator.getInstance()
    expect(a).toBe(b)
  })
})

// ─── initialize — ALLOW_ALL flags ────────────────────────────────────────────

describe("initialize with ALLOW_ALL flags", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  test("skips whitelist fetch when both ALLOW_ALL flags are true", async () => {
    const validator = SapSystemValidator.getInstance()
    // Default configuration has ALLOW_ALL_SYSTEMS = true and ALLOW_ALL_USERS = true
    const fetchSpy = jest.spyOn(validator as any, "fetchWhitelist")
    await validator.initialize()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ─── checkSystemAccess — ALLOW_ALL mode ──────────────────────────────────────

describe("checkSystemAccess with ALLOW_ALL_SYSTEMS and ALLOW_ALL_USERS true", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  test("allows any URL when both flags are true", async () => {
    const validator = SapSystemValidator.getInstance()
    const result = await validator.checkSystemAccess("https://any-sap.example.com", undefined, "anyuser")
    expect(result.allowed).toBe(true)
  })

  test("does not set failureReason when allowed", async () => {
    const validator = SapSystemValidator.getInstance()
    const result = await validator.checkSystemAccess("https://any-sap.example.com")
    expect(result.failureReason).toBeUndefined()
  })
})

// ─── isVersionCompatible (via parseVersion internals) ────────────────────────

describe("version compatibility (tested via checkSystemAccess version check)", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  test("same version is compatible", () => {
    const validator = SapSystemValidator.getInstance()
    const isCompatible = (validator as any).isVersionCompatible("2.1.0", "2.1.0")
    expect(isCompatible).toBe(true)
  })

  test("higher major version is compatible", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).isVersionCompatible("3.0.0", "2.0.0")).toBe(true)
  })

  test("lower major version is incompatible", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).isVersionCompatible("1.9.9", "2.0.0")).toBe(false)
  })

  test("higher minor version is compatible", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).isVersionCompatible("2.2.0", "2.1.0")).toBe(true)
  })

  test("lower minor version is incompatible", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).isVersionCompatible("2.0.9", "2.1.0")).toBe(false)
  })

  test("higher patch version is compatible", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).isVersionCompatible("2.1.5", "2.1.3")).toBe(true)
  })

  test("lower patch version is incompatible", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).isVersionCompatible("2.1.2", "2.1.3")).toBe(false)
  })

  test("malformed version returns false (parse error)", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).isVersionCompatible("abc", "1.0.0")).toBe(false)
  })
})

// ─── parseVersion ────────────────────────────────────────────────────────────

describe("parseVersion", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  test("parses standard semver", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test("fills missing parts with 0", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).parseVersion("1")).toEqual({ major: 1, minor: 0, patch: 0 })
  })

  test("handles two-part version", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).parseVersion("2.5")).toEqual({ major: 2, minor: 5, patch: 0 })
  })
})

// ─── extractHostname ─────────────────────────────────────────────────────────

describe("extractHostname", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  test("extracts hostname from full https URL", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).extractHostname("https://my-sap.example.com/sap/bc")).toBe(
      "my-sap.example.com"
    )
  })

  test("extracts hostname from http URL", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).extractHostname("http://sap.corp.com:8000")).toBe("sap.corp.com")
  })

  test("treats plain hostname as-is when URL parsing fails", () => {
    const validator = SapSystemValidator.getInstance()
    // A plain hostname without scheme - falls back to lowercase
    const result = (validator as any).extractHostname("my-plain-host")
    expect(result).toBe("my-plain-host")
  })

  test("lowercases the result", () => {
    const validator = SapSystemValidator.getInstance()
    expect((validator as any).extractHostname("https://MY-SAP.EXAMPLE.COM")).toBe(
      "my-sap.example.com"
    )
  })
})

// ─── matchesWhitelist ────────────────────────────────────────────────────────

describe("matchesWhitelist", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  function validatorWithDomains(domains: string[]) {
    const v = SapSystemValidator.getInstance()
    ;(v as any).allowedDomains = domains
    return v
  }

  test("exact hostname match returns true", () => {
    const v = validatorWithDomains(["sap.example.com"])
    expect((v as any).matchesWhitelist("sap.example.com")).toBe(true)
  })

  test("non-matching hostname returns false", () => {
    const v = validatorWithDomains(["sap.example.com"])
    expect((v as any).matchesWhitelist("other.example.com")).toBe(false)
  })

  test("wildcard prefix matches", () => {
    const v = validatorWithDomains(["*dev*"])
    expect((v as any).matchesWhitelist("mydev100")).toBe(true)
  })

  test("wildcard prefix does not match unrelated hostname", () => {
    const v = validatorWithDomains(["*dev*"])
    expect((v as any).matchesWhitelist("production.corp.com")).toBe(false)
  })

  test("case insensitive matching", () => {
    const v = validatorWithDomains(["*DEV*"])
    expect((v as any).matchesWhitelist("MyDev100")).toBe(true)
  })
})

// ─── matchesUserWhitelist ────────────────────────────────────────────────────

describe("matchesUserWhitelist", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  function validatorWithUsers(users: string[]) {
    const v = SapSystemValidator.getInstance()
    ;(v as any).allowedUsers = users
    return v
  }

  test("allows all users when list is empty", () => {
    const v = validatorWithUsers([])
    expect((v as any).matchesUserWhitelist("anyone")).toBe(true)
  })

  test("exact username match", () => {
    const v = validatorWithUsers(["john.doe"])
    expect((v as any).matchesUserWhitelist("john.doe")).toBe(true)
  })

  test("case insensitive username match", () => {
    const v = validatorWithUsers(["JOHN.DOE"])
    expect((v as any).matchesUserWhitelist("john.doe")).toBe(true)
  })

  test("wildcard match", () => {
    const v = validatorWithUsers(["*user1*"])
    expect((v as any).matchesUserWhitelist("myuser1_dev")).toBe(true)
  })

  test("non-matching user returns false", () => {
    const v = validatorWithUsers(["*user1*", "*user2*"])
    expect((v as any).matchesUserWhitelist("completely.different")).toBe(false)
  })
})

// ─── getUserMapping ──────────────────────────────────────────────────────────

describe("getUserMapping", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  test("returns null for unknown user", () => {
    const v = SapSystemValidator.getInstance()
    expect(v.getUserMapping("unknown.user")).toBeNull()
  })

  test("returns mapping for known user (case insensitive)", () => {
    const v = SapSystemValidator.getInstance()
    ;(v as any).userMapping.set("john.doe", { uniqueId: "dev-abc123", manager: "Jane Smith" })
    expect(v.getUserMapping("JOHN.DOE")).toEqual({ uniqueId: "dev-abc123", manager: "Jane Smith" })
  })
})

// ─── parseWhitelistData ──────────────────────────────────────────────────────

describe("parseWhitelistData", () => {
  beforeEach(() => {
    ;(SapSystemValidator as any).instance = undefined
  })

  test("parses developers array and builds userMapping", () => {
    const v = SapSystemValidator.getInstance()
    const data = {
      allowedDomains: ["*dev*"],
      developers: [
        { manager: "Boss", userIds: ["user1", "user2"] }
      ]
    }
    ;(v as any).parseWhitelistData(data)

    expect((v as any).allowedUsers).toContain("user1")
    expect((v as any).allowedUsers).toContain("user2")
    expect((v as any).userMapping.get("user1")?.manager).toBe("Boss")
    expect((v as any).userMapping.get("user2")?.manager).toBe("Boss")
  })

  test("same manager has same uniqueId for all their users", () => {
    const v = SapSystemValidator.getInstance()
    const data = {
      allowedDomains: ["*dev*"],
      developers: [
        { manager: "Boss", userIds: ["user1", "user2"] }
      ]
    }
    ;(v as any).parseWhitelistData(data)

    const uid1 = (v as any).userMapping.get("user1")?.uniqueId
    const uid2 = (v as any).userMapping.get("user2")?.uniqueId
    expect(uid1).toBe(uid2)
  })

  test("different managers get different uniqueIds", () => {
    const v = SapSystemValidator.getInstance()
    const data = {
      allowedDomains: ["*dev*"],
      developers: [
        { manager: "Boss1", userIds: ["user1"] },
        { manager: "Boss2", userIds: ["user2"] }
      ]
    }
    ;(v as any).parseWhitelistData(data)

    const uid1 = (v as any).userMapping.get("user1")?.uniqueId
    const uid2 = (v as any).userMapping.get("user2")?.uniqueId
    expect(uid1).not.toBe(uid2)
  })

  test("throws when version is below minimum", () => {
    const v = SapSystemValidator.getInstance()
    // Force getCurrentExtensionVersion to return 1.0.0
    jest.spyOn(v as any, "getCurrentExtensionVersion").mockReturnValue("1.0.0")

    const data = {
      allowedDomains: [],
      version: { minimumExtensionVersion: "2.0.0" }
    }
    expect(() => (v as any).parseWhitelistData(data)).toThrow(/below minimum/)
  })

  test("does not throw when version meets minimum", () => {
    const v = SapSystemValidator.getInstance()
    jest.spyOn(v as any, "getCurrentExtensionVersion").mockReturnValue("2.1.0")

    const data = {
      allowedDomains: [],
      version: { minimumExtensionVersion: "2.0.0" }
    }
    expect(() => (v as any).parseWhitelistData(data)).not.toThrow()
  })
})

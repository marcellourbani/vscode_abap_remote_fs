import { fileURLToPath } from "node:url"

const mocks = vi.hoisted(() => ({
  enabled: false,
  focused: false,
  remoteName: undefined as string | undefined,
  platform: "win32",
  arch: "x64",
  notify: vi.fn(),
  windows: vi.fn(),
  mac: vi.fn(),
  linux: vi.fn(),
  chmod: vi.fn()
}))

vi.mock("node:fs", () => ({ chmodSync: mocks.chmod }))

vi.mock("node:os", () => ({
  platform: () => mocks.platform,
  arch: () => mocks.arch
}))

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: (key: string, fallback: boolean) =>
        key === "nativeNotifications" ? mocks.enabled : fallback
    }))
  },
  window: {
    get state() {
      return { focused: mocks.focused }
    }
  },
  env: {
    get remoteName() {
      return mocks.remoteName
    }
  }
}))

vi.mock("node-notifier", () => ({
  default: {
    WindowsToaster: class {
      constructor(options: unknown) {
        mocks.windows(options)
      }
      notify = mocks.notify
    },
    NotificationCenter: class {
      constructor(options: unknown) {
        mocks.mac(options)
      }
      notify = mocks.notify
    },
    NotifySend: class {
      constructor() {
        mocks.linux()
      }
      notify = mocks.notify
    }
  }
}))

import { showNativeNotification } from "./nativeNotifications"

describe("native notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.notify.mockReset()
    mocks.enabled = false
    mocks.focused = false
    mocks.remoteName = undefined
    mocks.platform = "win32"
    mocks.arch = "x64"
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it("does nothing by default", () => {
    showNativeNotification("Activation failed", "Error")
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.windows).not.toHaveBeenCalled()
  })

  it("does nothing while VS Code is focused", () => {
    mocks.enabled = true
    mocks.focused = true
    showNativeNotification("Activation failed", "Error")
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it("does not send notifications on a remote extension host", () => {
    mocks.enabled = true
    mocks.remoteName = "ssh-remote"
    showNativeNotification("Activation failed", "Error")
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it.each(["Information", "Warning", "Error"] as const)(
    "mirrors %s messages with their severity",
    severity => {
      mocks.enabled = true
      showNativeNotification("An ABAP FS message", severity)
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: `ABAP FS - ${severity}`,
          message: "An ABAP FS message"
        }),
        expect.any(Function)
      )
    }
  )

  it.each(["x64", "arm64", "ia32"] as const)(
    "uses the packaged Windows helper for %s",
    arch => {
      mocks.enabled = true
      mocks.arch = arch
      showNativeNotification("Done", "Information")
      const suffix = arch === "x64" ? "64" : "86"
      expect(mocks.windows).toHaveBeenCalledWith({
        customPath: fileURLToPath(
          new URL(
            `./vendor/node-notifier/snoreToast/snoretoast-x${suffix}.exe`,
            import.meta.url
          )
        )
      })
    }
  )

  it("uses the packaged macOS helper", () => {
    mocks.enabled = true
    mocks.platform = "darwin"
    showNativeNotification("Done", "Information")
    const customPath = fileURLToPath(
      new URL(
        "./vendor/node-notifier/mac.noindex/terminal-notifier.app/Contents/MacOS/terminal-notifier",
        import.meta.url
      )
    )
    expect(mocks.chmod).toHaveBeenCalledWith(customPath, 0o755)
    expect(mocks.mac).toHaveBeenCalledWith({ customPath })
  })

  it("uses the desktop notification service on Linux", () => {
    mocks.enabled = true
    mocks.platform = "linux"
    showNativeNotification("Done", "Information")
    expect(mocks.linux).toHaveBeenCalledOnce()
  })

  it("logs delivery errors", () => {
    mocks.enabled = true
    showNativeNotification("Done", "Information")
    const callback = mocks.notify.mock.calls[0][1]
    const error = new Error("Notifications are unavailable")
    callback(error)
    expect(console.warn).toHaveBeenCalledWith(
      "ABAP FS: OS notification could not be delivered",
      error
    )
  })

  it("logs synchronous failures without interrupting the VS Code message", () => {
    mocks.enabled = true
    mocks.notify.mockImplementation(() => {
      throw new Error("Cannot launch notification helper")
    })
    expect(() => showNativeNotification("Done", "Information")).not.toThrow()
    expect(console.warn).toHaveBeenCalledWith(
      "ABAP FS: OS notification could not be delivered",
      expect.objectContaining({ message: "Cannot launch notification helper" })
    )
  })
})

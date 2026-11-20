import { beforeEach, describe, expect, it, vi } from "vitest"
import { runInNewContext } from "node:vm"
import { resolve } from "node:path"
vi.mock("vscode", () => ({
  window: {
    showSaveDialog: vi.fn(),
    withProgress: vi.fn(async (_options, run) =>
      run({ report: vi.fn() }, { isCancellationRequested: false })
    )
  },
  workspace: { fs: { writeFile: vi.fn() } },
  commands: { executeCommand: vi.fn() },
  Uri: { file: vi.fn(path => ({ fsPath: path })) },
  ProgressLocation: { Notification: 15 }
}))
vi.mock("../../config", () => ({ connectedRoots: vi.fn() }))
vi.mock("../../services/customizing/setup", () => ({
  checkInstallation: vi.fn(),
  deployInstallation: vi.fn(),
  provisionServices: vi.fn(),
  validateDeployment: vi.fn(input => input)
}))
vi.mock("../../services/customizing/archive", () => ({
  buildAbapGitArchive: vi.fn(() => Buffer.from("zip"))
}))
vi.mock("node:fs", () => ({ readFileSync: vi.fn(() => '<script nonce="{{NONCE}}"></script>') }))
import * as vscode from "vscode"
import { connectedRoots } from "../../config"
import {
  checkInstallation,
  deployInstallation,
  provisionServices,
  validateDeployment
} from "../../services/customizing/setup"
import { CustomizingSetupView } from "./setupView"

function harness() {
  let receive: (message: unknown) => Promise<void> | void = () => {}
  const postMessage = vi.fn().mockResolvedValue(true),
    dispose = vi.fn()
  const webview = {
    options: {},
    html: "",
    postMessage,
    onDidReceiveMessage: vi.fn(callback => {
      receive = callback
      return { dispose }
    })
  }
  const view = { webview, onDidDispose: vi.fn() }
  const provider = new CustomizingSetupView("example-extension")
  provider.resolveWebviewView(view as never)
  return {
    webview,
    view,
    postMessage,
    dispose,
    send: async (message: unknown) => {
      receive(message)
      await vi.waitFor(() => expect(postMessage).toHaveBeenCalled())
      // Complete all promises in the message handler without timers or SAP calls.
      for (let index = 0; index < 10; index++) await Promise.resolve()
    }
  }
}

describe("Customizing setup view", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(connectedRoots).mockReturnValue(new Map([["example", {}]]) as never)
    vi.mocked(checkInstallation).mockResolvedValue({ ready: false } as never)
    vi.mocked(validateDeployment).mockImplementation(input => ({
      ...input,
      transport: input.transport
    }))
    vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, run) =>
      run({ report: vi.fn() }, { isCancellationRequested: false } as never)
    )
  })
  it("loads external media with a fresh CSP nonce and no local resource access", () => {
    const first = harness(),
      second = harness()
    expect(first.webview.options).toEqual({ enableScripts: true, localResourceRoots: [] })
    expect(first.webview.html).not.toContain("{{NONCE}}")
    expect(first.webview.html).not.toBe(second.webview.html)
  })
  it("lists connected systems without auto-selecting or deploying", async () => {
    const view = harness()
    await view.send({ command: "ready" })
    expect(view.postMessage).toHaveBeenCalledWith({ type: "systems", systems: ["example"] })
    expect(deployInstallation).not.toHaveBeenCalled()
  })
  it("returns status associated with the selected system and request", async () => {
    const view = harness()
    await view.send({ command: "check", connectionId: "example", requestId: 3 })
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "status",
      connectionId: "example",
      requestId: 3,
      status: { ready: false }
    })
  })
  it("rejects stale/disconnected selections without touching SAP", async () => {
    const view = harness()
    await view.send({ command: "check", connectionId: "disconnected" })
    expect(checkInstallation).not.toHaveBeenCalled()
    expect(view.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }))
  })
  it("does not write a ZIP when Save As is cancelled", async () => {
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined)
    const view = harness()
    await view.send({ command: "export" })
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "busy", busy: false })
  })
  it("exports locally without a system selection", async () => {
    const destination = { fsPath: "example.zip" }
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(destination as never)
    const view = harness()
    await view.send({ command: "export" })
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(destination, Buffer.from("zip"))
    expect(checkInstallation).not.toHaveBeenCalled()
  })
  it("opens the bundled markdown guide", async () => {
    const view = harness()
    await view.send({ command: "guide" })
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "markdown.showPreview",
      expect.objectContaining({ fsPath: expect.stringContaining("GUIDE.md") })
    )
  })
  it("reports deployment failure and restores controls", async () => {
    vi.mocked(deployInstallation).mockRejectedValue(new Error("Transport is released"))
    const view = harness()
    await view.send({ command: "deploy", connectionId: "example", packageName: "$TMP" })
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "error",
      command: "deploy",
      text: "Transport is released"
    })
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "busy", busy: false })
  })
  it("keeps direct deployment accessible from the view", async () => {
    vi.mocked(deployInstallation).mockResolvedValue({
      completed: [],
      installation: { ready: true },
      note: "Installed"
    } as never)
    const view = harness()
    await view.send({
      command: "deploy",
      connectionId: "example",
      packageName: "ZCFG",
      transport: "EXAK900001",
      requestId: 7
    })
    expect(deployInstallation).toHaveBeenCalledWith(
      { connectionId: "example", packageName: "ZCFG", transport: "EXAK900001" },
      expect.stringContaining("customizing"),
      expect.any(Function),
      expect.any(Function)
    )
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "status",
      connectionId: "example",
      requestId: 7,
      status: { ready: true }
    })
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "success",
      command: "deploy",
      text: "Installed"
    })
  })
  it.each([{ packageName: 123 }, { packageName: "$TMP", transport: 123 }, {}])(
    "rejects invalid deployment fields %#",
    async fields => {
      const view = harness()
      await view.send({ command: "deploy", connectionId: "example", ...fields })
      expect(view.postMessage).toHaveBeenCalledWith({
        type: "error",
        command: "deploy",
        text: "Invalid deployment fields"
      })
      expect(deployInstallation).not.toHaveBeenCalled()
    }
  )
  it("reports ZIP write failure and restores controls", async () => {
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue({ fsPath: "example.zip" } as never)
    vi.mocked(vscode.workspace.fs.writeFile).mockRejectedValueOnce(new Error("Disk full"))
    const view = harness()
    await view.send({ command: "export" })
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "error",
      command: "export",
      text: "Disk full"
    })
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "busy", busy: false })
  })
  it("reports setup inspection errors", async () => {
    vi.mocked(checkInstallation).mockRejectedValueOnce(new Error("Connection lost"))
    const view = harness()
    await view.send({ command: "check", connectionId: "example" })
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "error",
      command: "check",
      text: "Connection lost"
    })
  })
  it("lists no systems honestly", async () => {
    vi.mocked(connectedRoots).mockReturnValue(new Map() as never)
    const view = harness()
    await view.send({ command: "ready" })
    expect(view.postMessage).toHaveBeenCalledWith({ type: "systems", systems: [] })
  })
  it("ignores duplicate actions while setup is busy", async () => {
    let release!: (value: never) => void
    vi.mocked(checkInstallation).mockReturnValueOnce(
      new Promise(resolve => {
        release = resolve
      })
    )
    const view = harness()
    await view.send({ command: "check", connectionId: "example" })
    await view.send({ command: "deploy", connectionId: "example", packageName: "$TMP" })
    expect(deployInstallation).not.toHaveBeenCalled()
    release({ ready: false } as never)
  })
  it("configures services separately using shared deployment fields and posts the result", async () => {
    vi.mocked(provisionServices).mockResolvedValue({
      installation: { ready: true },
      note: "Services configured"
    } as never)
    const view = harness()
    const input = { connectionId: "example", packageName: "ZCFG", transport: "EXAK900001" }
    await view.send({ command: "configureServices", ...input, requestId: 9 })
    expect(validateDeployment).toHaveBeenCalledWith(input)
    expect(provisionServices).toHaveBeenCalledWith(
      input,
      expect.stringContaining("customizing"),
      expect.any(Function),
      expect.any(Function)
    )
    expect(deployInstallation).not.toHaveBeenCalled()
    expect(vscode.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Configuring ABAP FS Customizing SICF services",
        cancellable: true,
        location: vscode.ProgressLocation.Notification
      }),
      expect.any(Function)
    )
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "status",
      connectionId: "example",
      requestId: 9,
      status: { ready: true }
    })
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "success",
      command: "configureServices",
      text: "Services configured"
    })
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "busy", busy: false })
  })
  it.each([undefined, "disconnected"])(
    "rejects service setup on unavailable system %s",
    async connectionId => {
      const view = harness()
      await view.send({ command: "configureServices", connectionId, packageName: "$TMP" })
      expect(provisionServices).not.toHaveBeenCalled()
      expect(vscode.window.withProgress).not.toHaveBeenCalled()
      expect(view.postMessage).toHaveBeenCalledWith({
        type: "error",
        command: "configureServices",
        text: "Choose a currently connected SAP system"
      })
      expect(view.postMessage).toHaveBeenLastCalledWith({ type: "busy", busy: false })
    }
  )
  it.each([{ packageName: 123 }, { packageName: "$TMP", transport: 123 }, {}])(
    "rejects malformed service fields %#",
    async fields => {
      const view = harness()
      await view.send({ command: "configureServices", connectionId: "example", ...fields })
      expect(provisionServices).not.toHaveBeenCalled()
      expect(view.postMessage).toHaveBeenCalledWith({
        type: "error",
        command: "configureServices",
        text: "Invalid deployment fields"
      })
    }
  )
  it.each(["deploy", "configureServices"])(
    "uses shared field validation before %s",
    async command => {
      vi.mocked(validateDeployment).mockImplementationOnce(() => {
        throw new Error("A Workbench request is required for a transportable package")
      })
      const view = harness()
      await view.send({ command, connectionId: "example", packageName: "ZCFG" })
      expect(provisionServices).not.toHaveBeenCalled()
      expect(deployInstallation).not.toHaveBeenCalled()
      expect(vscode.window.withProgress).not.toHaveBeenCalled()
      expect(view.postMessage).toHaveBeenCalledWith({
        type: "error",
        command,
        text: "A Workbench request is required for a transportable package"
      })
    }
  )
  it("reports service setup failures and restores controls", async () => {
    vi.mocked(provisionServices).mockRejectedValueOnce(
      new Error("SICF authorization denied; partial changes remain")
    )
    const view = harness()
    await view.send({ command: "configureServices", connectionId: "example", packageName: "$TMP" })
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "error",
      command: "configureServices",
      text: "SICF authorization denied; partial changes remain"
    })
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "busy", busy: false })
    expect(view.postMessage.mock.calls.some(([message]) => message.type === "status")).toBe(false)
  })
  it.each(["deploy", "configureServices"])("passes live cancellation to %s", async command => {
    const token = { isCancellationRequested: false }
    vi.mocked(vscode.window.withProgress).mockImplementationOnce(async (_options, run) =>
      run({ report: vi.fn() }, token as never)
    )
    const operation = command === "deploy" ? deployInstallation : provisionServices
    vi.mocked(operation).mockImplementationOnce(async (_input, _assets, cancelled) => {
      expect(cancelled!()).toBe(false)
      token.isCancellationRequested = true
      expect(cancelled!()).toBe(true)
      throw new Error("Cancelled; completed SAP changes were not rolled back")
    })
    const view = harness()
    await view.send({ command, connectionId: "example", packageName: "$TMP" })
    expect(view.postMessage).toHaveBeenCalledWith({
      type: "error",
      command,
      text: "Cancelled; completed SAP changes were not rolled back"
    })
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "busy", busy: false })
  })
  it("blocks duplicate actions during service provisioning", async () => {
    let reject!: (error: Error) => void
    vi.mocked(provisionServices).mockReturnValueOnce(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise
      })
    )
    const view = harness()
    await view.send({ command: "configureServices", connectionId: "example", packageName: "$TMP" })
    for (const command of ["configureServices", "deploy", "check", "export"]) {
      await view.send({ command, connectionId: "example", packageName: "$TMP" })
    }
    expect(provisionServices).toHaveBeenCalledTimes(1)
    expect(deployInstallation).not.toHaveBeenCalled()
    expect(checkInstallation).not.toHaveBeenCalled()
    expect(vscode.window.showSaveDialog).not.toHaveBeenCalled()
    reject(new Error("Stopped"))
    await vi.waitFor(() =>
      expect(view.postMessage).toHaveBeenLastCalledWith({ type: "busy", busy: false })
    )
  })
  it("keeps service-only fields visible for abapGit and wires explicit actions", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs")
    const html = fs.readFileSync(resolve("client/media/customizing/setup.html"), "utf8")
    expect(html).toContain("Deploy objects &amp; configure SICF")
    expect(html.replace(/\s+/g, " ")).toContain("real SAP mutation, not a harmless test")
    expect(html.replace(/\s+/g, " ")).toContain(
      "SICF service nodes use the package and Workbench request above; the generated installer report stays in $TMP"
    )
    expect(html).toMatch(/id="check"[\s\S]*?id="guide"[\s\S]*?id="installation"/)
    expect(html).toMatch(
      /id="setupFields">[\s\S]*?id="package"[\s\S]*?id="transport"[\s\S]*?<\/div>\s*<div id="direct">/
    )
    const elements = new Map<string, any>()
    for (const id of [
      "system",
      "method",
      "package",
      "transport",
      "direct",
      "abapgit",
      "check",
      "deploy",
      "configureServices",
      "export",
      "guide",
      "installation",
      "checkMessage",
      "guideMessage",
      "deployMessage",
      "exportMessage",
      "configureServicesMessage"
    ]) {
      elements.set(id, {
        value: "",
        disabled: false,
        hidden: false,
        addEventListener: vi.fn(),
        append: vi.fn()
      })
    }
    elements.get("package").value = "$TMP"
    elements.get("method").value = "direct"
    const postMessage = vi.fn()
    let receive!: (event: any) => void
    runInNewContext(html.match(/<script nonce="[^\"]+">([\s\S]*?)<\/script>/)![1], {
      acquireVsCodeApi: () => ({ postMessage, getState: () => ({}), setState: vi.fn() }),
      document: {
        getElementById: (id: string) => elements.get(id),
        createElement: () => ({}),
        body: { setAttribute: vi.fn() }
      },
      window: {
        addEventListener: (_event: string, callback: typeof receive) => {
          receive = callback
        }
      }
    })
    receive({ data: { type: "systems", systems: ["example"] } })
    expect(elements.get("configureServices").disabled).toBe(true)
    elements.get("system").value = "example"
    elements.get("method").value = "abapgit"
    const trigger = (id: string, event: string) =>
      elements
        .get(id)
        .addEventListener.mock.calls.find(([name]: string[]) => name === event)[1]()
    trigger("method", "change")
    expect(elements.get("direct").hidden).toBe(true)
    expect(elements.get("abapgit").hidden).toBe(false)
    expect(elements.get("package").hidden).toBe(false)
    expect(elements.get("transport").hidden).toBe(false)
    expect(elements.get("configureServices").disabled).toBe(false)
    trigger("configureServices", "click")
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: "configureServices",
        connectionId: "example",
        packageName: "$TMP",
        transport: ""
      })
    )
    receive({
      data: {
        type: "error",
        command: "configureServices",
        text: "SICF setup failed"
      }
    })
    expect(elements.get("configureServicesMessage").textContent).toBe("SICF setup failed")
    elements.get("package").value = "$LOCAL"
    trigger("package", "input")
    expect(elements.get("configureServices").disabled).toBe(false)
    elements.get("package").value = "ZCFG"
    trigger("package", "input")
    expect(elements.get("configureServices").disabled).toBe(true)
    elements.get("transport").value = "EXAK900001"
    trigger("transport", "input")
    expect(elements.get("configureServices").disabled).toBe(false)
    receive({ data: { type: "busy", busy: true } })
    for (const id of ["configureServices", "deploy", "package", "transport"])
      expect(elements.get(id).disabled).toBe(true)
    receive({ data: { type: "busy", busy: false } })
    expect(elements.get("configureServices").disabled).toBe(false)
  })
  it("renders friendly statuses with raw diagnostics only in collapsed text-only details", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs")
    const html = fs.readFileSync(resolve("client/media/customizing/setup.html"), "utf8")
    type Node = {
      tag: string
      textContent: string
      children: Node[]
      value: string
      append: (...nodes: Node[]) => void
      replaceChildren: () => void
      addEventListener: () => void
    }
    const node = (tag: string): Node => ({
      tag,
      textContent: "",
      children: [],
      value: "",
      append(...nodes) {
        this.children.push(...nodes)
      },
      replaceChildren() {
        this.children = []
      },
      addEventListener() {}
    })
    const elements = new Map<string, Node>()
    const getElementById = (id: string) => {
      if (!elements.has(id)) elements.set(id, node(id))
      return elements.get(id)!
    }
    getElementById("system").value = "example"
    getElementById("package").value = "$TMP"
    let receive!: (event: unknown) => void
    runInNewContext(html.match(/<script nonce="[^\"]+">([\s\S]*?)<\/script>/)![1], {
      acquireVsCodeApi: () => ({ postMessage: vi.fn(), getState: () => ({}), setState: vi.fn() }),
      document: { getElementById, createElement: node, body: { setAttribute: vi.fn() } },
      window: {
        addEventListener: (_event: string, callback: typeof receive) => {
          receive = callback
        }
      }
    })
    const raw = 'HTTP 404 <img src=x onerror="bad()">'
    const status = {
      ready: false,
      version: "1",
      objects: ["current", "missing", "outdated", "unversioned", "error"].map((status, index) => ({
        name: "OBJECT_" + index,
        status,
        ...(status === "current" ? { version: "1" } : {}),
        ...(status === "missing" ? { error: "Install the backend object.", detail: raw } : {})
      })),
      services: [
        { path: "/available", reachable: true, version: "1", expectedVersion: "1" },
        {
          path: "/unavailable",
          reachable: false,
          expectedVersion: "1",
          error: "Check service setup.",
          detail: raw
        }
      ]
    }
    receive({ data: { type: "status", connectionId: "example", requestId: 0, status } })
    const rows = getElementById("installation").children[2].children
    expect(rows.map(row => row.textContent)).toEqual([
      "OBJECT_0: Installed / up-to-date (1)",
      "OBJECT_1: Not installed — Install the backend object.",
      "OBJECT_2: Update needed",
      "OBJECT_3: Existing object not recognized",
      "OBJECT_4: Unable to check",
      "/available: Available (1)",
      "/unavailable: Unavailable — Check service setup."
    ])
    for (const row of rows) {
      expect(row.textContent).not.toContain("404")
      expect(row).not.toHaveProperty("innerHTML")
    }
    for (const index of [1, 6]) {
      const details = rows[index].children[0]
      expect(details.tag).toBe("details")
      expect(details).not.toHaveProperty("open")
      expect(details.children.map(child => [child.tag, child.textContent])).toEqual([
        ["summary", "Technical details"],
        ["pre", raw]
      ])
      expect(details.children[1]).not.toHaveProperty("innerHTML")
    }
    expect(rows[0].children).toEqual([])
    receive({
      data: {
        type: "status",
        connectionId: "other",
        requestId: 0,
        status: { ...status, objects: [] }
      }
    })
    expect(getElementById("installation").children[2].children).toHaveLength(7)
  })
  it("disposes message listeners with the view", () => {
    const view = harness()
    view.view.onDidDispose.mock.calls[0][0]()
    expect(view.dispose).toHaveBeenCalledTimes(1)
  })
  it.each([null, "message", {}, { command: "unknown" }])("ignores invalid messages %#", message => {
    const view = harness()
    expect(() => view.webview.onDidReceiveMessage.mock.calls[0][0](message)).not.toThrow()
    expect(deployInstallation).not.toHaveBeenCalled()
  })
})
